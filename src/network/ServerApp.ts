import fs from 'fs';
import http from 'http';
import https from 'https';
import {fastify, FastifyRequest,FastifyReply} from 'fastify';
import * as fa_static from 'fastify-static';
import path from 'path';
import {Event} from 'three';
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
}

type CustomRequest = FastifyRequest<{
	Body: {
		action: string
	};
}>


export class ServerApp extends BaseSystem{

	public messagesHelper:typeof MessagesHelper;
	public dataHelperPool:DataHelperPool = new DataHelperPool();
	private dataHelper:DataHelper;
	private httpServer = fastify({ logger: !true });
	private wsServer:WsServer;
	public rooms:BaseRoom[] = [];
	private startServerTime:number;
	private lastTickTime:number;
	private updateTime:number;
	private socketTime:number;
	private stepWorld:number;
	private ticks:number;
	private config:ServerConfig;


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
		console.log("Установлен тик сервера:", this.stepWorld, 'мс');


		this.httpServer.setNotFoundHandler(this.onServerMessage.bind(this));
		//this.httpServer.get('/', this.onServerMessage.bind(this));

		this.httpServer.register(fa_static.default, {
			root: path.join(path.resolve("."), '/dist'),
			prefix: '/',
		});

		try
		{
			await this.httpServer.listen(this.config.appPort, '0.0.0.0');
			console.log('Запущен сервер приложения:', this.httpServer.server.address());
		}
		catch (e)
		{
			console.error('Ошибка севера:', e);
		}
	}

	async onServerMessage(req:FastifyRequest, reply:FastifyReply)
	{
		return reply.sendFile(path.join(path.resolve("."), '/dist/index.html'))
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
		if (socket.idUser && socket.roomId)
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
			console.error("Ошибка в пакете|id_user=", socket.idUser, 'данные:', data, '\nстек:', e.stack);
		}
	}

	onMessage(socket:ExtWebSocket, typ:number, srcMessage:protocol.IMessage)
	{
		if (typ == protocol.MessageCsConnect.GetType())
		{
			var message = srcMessage as protocol.ICsConnect;
			const idUser = Number(message.idSession);
			const roomId = 0;
			const info = {roomId:roomId, idUser:idUser};

			// уже закреплена эта комната
			if (socket.roomId && socket.roomId == roomId)
				return;

			// уже был подключен к какой-то другой комнате
			if (socket.roomId)
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
					console.warn("Не удалось войти в комнату", idUser, roomId);
			}
			else
				console.warn('Комната еще не создана, попробуйте позднее', idUser, roomId);
			return;
		}

		if (socket.idUser === undefined)
			return console.warn("Сокет не имеет idUser");

		if (socket.roomId === undefined)
			return console.warn("Сокет не закреплен за комнатой");

		let room = this.rooms[socket.roomId];
		if (!room)
			return console.warn('Пакет cs -> комната не существует:', socket.roomId);
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
		this.socketTime += dt;

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
			console.error("Ошибка в обработке комнат:", e.stack);
		}

		setTimeout(this.serverTick.bind(this), this.stepWorld);
	}

}