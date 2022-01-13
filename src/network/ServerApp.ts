import fs from 'fs';
import path from 'path';

import {fastify, FastifyRequest,FastifyReply} from 'fastify';
import * as fa_static from 'fastify-static';
import fastifyCookie from 'fastify-cookie';
import fastifySession from 'fastify-session';

import {Event, Vector2} from 'three';
import {BaseSystem} from 'ecs-threejs';
import {NetConfig, ExtWebSocket, WsServer} from './WsServer';
import {DataHelperPool} from './DataHelperPool';
import {BaseRoom} from '../rooms/BaseRoom';
import {MessagesHelper, protocol, DataHelper} from '2d-client-network';


export interface ServerConfig extends NetConfig{
	ssl:boolean;
	sslKey:string;
	sslCert:string;
	wsPort:number;
	appPort:number;
	stepWorld:number; // 60
	rateSocket:number; // 60/30
	worldWrap:boolean;
	worldSize:Vector2;
}

export class ServerApp extends BaseSystem{

	public messagesHelper:typeof MessagesHelper;
	public dataHelperPool:DataHelperPool = new DataHelperPool();
	public rooms:{[k:string]:BaseRoom} = {};
	public config:ServerConfig;
	public secretSession:string = 'SessionC0DESessionC0DESessionC0D';
	private lastUid:number = 0;
	private dataHelper:DataHelper;
	private httpServer = fastify({ logger: !true });
	private wsServer:WsServer;
	private startServerTime:number = 0;
	private lastTickTime:number = 0;
	private stepWorld:number;
	private ticks:number = 0;
	private lastDebugTime:number = 0;


	constructor(config:ServerConfig, messagesHelper:typeof MessagesHelper)
	{
		super();
		this.wsServer = new WsServer(config);
		this.wsServer.addEventListener('connection', this.onConnection.bind(this));
		this.wsServer.addEventListener('close', this.onDisconnect.bind(this));
		this.wsServer.addEventListener('message', this.onPack.bind(this));
		this.config = config;
		this.messagesHelper = messagesHelper;
		var wrap = this.dataHelperPool.get();
		this.dataHelper = wrap.item;
	}

	now()
	{
		return Date.now();
	}

	async start()
	{
		this.startServerTime = this.now();
		// TODO если не делать округление, то почему-то жестко жрет CPU.
		this.stepWorld = Math.floor(1000/this.config.stepWorld);
		setTimeout(this.serverTick.bind(this), this.config.stepWorld);
		this.log("Установлен тик сервера:", this.stepWorld, 'мс');


		this.httpServer.get('/', this.onServerMessage.bind(this));
		this.httpServer.setNotFoundHandler(this.onServerMessage404.bind(this));

		this.httpServer.register(fa_static.default, {
			root: path.join(path.resolve("."), '/dist'),
			prefix: '/',
		});

		this.httpServer.register(fastifyCookie);
		this.httpServer.register(fastifySession, {secret: this.secretSession, cookie:{secure:false, httpOnly:false}});

		this.httpServer.addHook('preHandler', (request, reply, next) => {
			if (request.session.sessionData === undefined)
			{
				request.session.sessionData = {};
				this.log("Создали сессию");
			}
			next();
		})

		try
		{
			await this.httpServer.listen(this.config.appPort, '0.0.0.0');
			this.log('Запущен сервер приложения:', this.httpServer.server.address());
		}
		catch (e)
		{
			this.error('Ошибка севера:', e);
		}
	}

	async onServerMessage404(req:FastifyRequest, reply:FastifyReply)
	{
		this.log('404');
		return this.onServerMessage(req, reply);
	}

	async onServerMessage(req:FastifyRequest, reply:FastifyReply)
	{
		const stream = fs.createReadStream(path.join(path.resolve("."), '/dist/index.html'))
		reply.type('text/html').send(stream);
	}

	getOffsetTime()
	{
		return Date.now() - this.startServerTime;
	}

	getRoomId(id:number)
	{
		var room = this.rooms[id];
		if (room)
			return room;
		this.dispatchEvent({type:"getRoom", id, rooms:this.rooms});
		var room = this.rooms[id];
		if (!room)
		{
			return false;
		}
		else
			return room;
	}

	onConnection(e:Event)
	{
		//const uid = req.url.substr(2);
	}

	onDisconnect(e:Event)
	{
		var socket = e.socket as ExtWebSocket;
		if (socket.idUser !== undefined && socket.roomId !== undefined) // просто проверка socket.idUser без условий при значении 0 выдаст ложь !
		{
			var rid = socket.roomId;
			var room = this.rooms[rid];
			if (room)
				room.onLeave(socket);
		}
	}

	onPack(e:Event)
	{
		var socket = e.socket as ExtWebSocket;
		var data = e.data as ArrayBuffer;
		try
		{
			var packs = this.messagesHelper.UnPackMessages(this.dataHelper, new Uint8Array(data));
			if (packs.length == 0)
				return;
			for (var i = 0; i < packs.length; i++)
				this.onMessage(socket, packs[i].typ, packs[i].message);
		}
		catch(e:any)
		{
			this.error("Ошибка в пакете|idUser=", socket.idUser, 'данные:', data, '\nстек:', e.stack);
		}
	}

	async decodeSession(idSession:string)
	{
		return new Promise(resolve => {
			const request:any = {};
			(this.httpServer as any).decryptSession(idSession, request, () => {
				resolve(request.session);
			})
		});
	}

	async onMessage(socket:ExtWebSocket, typ:number, srcMessage:protocol.IMessage)
	{
		if (typ == protocol.MessageCsConnect.GetType())
		{
			var message = srcMessage as protocol.ICsConnect;
			if (message.idSession == '')
			{
				this.warn("Сессия не передана:", message);
				return;
			}
			var data:any = await this.decodeSession(message.idSession);
			if (data.sessionData === undefined)
			{
				this.warn("Сессия не считана:", message);
				return;
			}
			if (data.sessionData.idUser === undefined)
			{
				data.sessionData.idUser = this.lastUid++;
				console.log("Выдаем idUser:", data.sessionData.idUser);
			}
			const idUser = data.sessionData.idUser;
			const roomId = 0;
			const info = {roomId, idUser, sessionData:data.sessionData};

			// уже закреплена эта комната
			if (socket.roomId !== undefined && socket.roomId == roomId)
				return;

			// уже был подключен к какой-то другой комнате
			if (socket.roomId !== undefined)
			{
				let room = this.getRoomId(socket.roomId);
				if (room)
					room.onLeaveRoom(socket);
			}

			// ищем комнату в которую просится
			let room = this.getRoomId(roomId);
			if (room)
			{
				socket.idUser = idUser;
				socket.roomId = roomId;
				// другой сокет подключен с таким idUser, надо разорвать
				if (room.connectedUsers[idUser] && room.connectedUsers[idUser].socket)
					room.onReconnect(room.connectedUsers[idUser].socket);
				const is_join = room.onJoin(socket, info);
				if (!is_join)
					this.warn("Не удалось войти в комнату", idUser, roomId);
			}
			else
				this.warn('Комната еще не создана, попробуйте позднее', idUser, roomId);
			return;
		}

		if (socket.idUser === undefined)
			return this.warn("Сокет не имеет idUser");

		if (socket.roomId === undefined)
			return this.warn("Сокет не закреплен за комнатой");

		let room = this.rooms[socket.roomId];
		if (!room)
			return this.warn('Пакет cs -> комната не существует:', socket.roomId);
		room.onMessage(socket, typ, srcMessage);
	}

	serverTick()
	{
		const now = this.now();
		var dt = now - this.lastTickTime;
		if (this.lastTickTime === 0)
			var dt = 1;
		this.lastTickTime = now;
		this.ticks++;
		if (now > this.lastDebugTime)
		{
			this.lastDebugTime = now + 300;
			//console.log(dt);
		}
		try
		{
			for (var rid in this.rooms)
			{
				var room = this.rooms[rid];
				room.onUpdate(dt);
			}

			if (this.ticks % this.config.rateSocket === 0)
			{
				for (var rid in this.rooms)
				{
					var room = this.rooms[rid];
					room.onSocketUpdate();
				}
			}
		}
		catch(e:any)
		{
			this.error("Ошибка в обработке комнат:", e.stack);
		}

		setTimeout(this.serverTick.bind(this), this.stepWorld);
	}

}