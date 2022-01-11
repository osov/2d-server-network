import {Vector2, Vector3} from 'three';
import {WebSocket} from 'ws';
import {BaseSystem, NumberPool} from 'ecs-threejs';
import {ServerApp} from '../network/ServerApp';
import {ExtWebSocket} from '../network/WsServer';
import {MessagesHelper, DataHelper, protocol, utils, netUtils} from '2d-client-network';
import {BaseEntity, keyboardState} from '../entitys/BaseEntity';
import {DataHelperPool} from '../network/DataHelperPool';

interface ConnectionData{
	idEntity:number;
	idUser:number;
	keyboard:keyboardState;
	socket:ExtWebSocket;
}

export class BaseRoom extends BaseSystem{

	public connectedUsers:{[k:number]:ConnectionData} = {};
	protected startTime:number;
	protected app:ServerApp;
	protected dataHelperPool:DataHelperPool;
	protected dataHelper:DataHelper;
	protected entitys:{[k:number]:BaseEntity} = {};
	protected dynamicEntitys:{[k:number]:BaseEntity} = {};
	protected numPool:NumberPool = new NumberPool(65535);
	protected timeLock:number = 500;
	protected typMessages:typeof protocol.TypMessages;

	constructor(app:ServerApp, typMessages:typeof protocol.TypMessages)
	{
		super();
		this.startTime = this.now();
		this.app = app;
		this.typMessages = typMessages;
		this.dataHelperPool = app.dataHelperPool;
		var wrap = this.dataHelperPool.get();
		this.dataHelper = wrap.item;
	}

	now()
	{
		return Date.now();
	}

	getOffsetTime()
	{
		return this.now() - this.startTime;
	}

	wrapPosition(entity:BaseEntity)
	{
		const w = this.app.config.worldWidth * 0.5;
		const h = this.app.config.worldHeight * 0.5;
		entity.updateState();
		if (entity.position.x >= w)
			entity.position.x -= 2*w;
		else if (entity.position.x <= -w)
			entity.position.x += 2*w;

		if (entity.position.y >= h)
			entity.position.y -= 2*h;
		else if (entity.position.y <= -h)
			entity.position.y += 2*h;
		entity.applyParams();
	}

// -----------------------------------------------------------------------
// network
// -----------------------------------------------------------------------
	packMessage(idMessage:number, message:protocol.IMessage, view:DataHelper)
	{
		if (idMessage < 0)
			return console.error("Сообщение не определено", idMessage, message);
		var messagePacker:any = this.typMessages[idMessage as keyof protocol.IMessage];
		messagePacker.Pack(view, message);
		return view;
	}

	makeMessage(idMessage:number, message:protocol.IMessage)
	{
		var wrap = this.dataHelperPool.get();
		var view = wrap.item;
		this.packMessage(idMessage, message, view);
		var arr = view.toArray();
		this.dataHelperPool.put(wrap);
		return arr;
	}

	sendSocketBuffer(socket:ExtWebSocket, buffer:Uint8Array)
	{
		if (socket && socket.readyState === WebSocket.OPEN)
		{
			socket.send(buffer);
		}
	}

	sendSocket(socket:ExtWebSocket, idMessage:number, message:protocol.IMessage)
	{
		var pack = this.makeMessage(idMessage, message);
		this.sendSocketBuffer(socket, pack);
	}

	sendTo(user:ConnectionData, idMessage:number, message:protocol.IMessage)
	{
		if (user && user.socket)
			this.sendSocket(user.socket, idMessage, message);
	}

	setToUid(idUser:number, idMessage:number, message:protocol.IMessage)
	{
		var user = this.connectedUsers[idUser];
		if (!user)
			return console.warn("setToUid не найден юзер:", idUser, idMessage);
		return this.sendTo(user, idMessage, message);
	}

	sendAll(idMessage:number, message:protocol.IMessage, exceptSocket:ExtWebSocket|null = null)
	{
		var pack = this.makeMessage(idMessage, message);
		for (var idUser in this.connectedUsers)
		{
			const user = this.connectedUsers[idUser];
			if (user && user.socket && user.socket != exceptSocket && user.socket.readyState === WebSocket.OPEN)
			{
				user.socket.send(pack);
			}
		}
	}

	sendAllBuffer(buffer:Uint8Array, exceptSocket:ExtWebSocket|null = null)
	{
		for (var idUser in this.connectedUsers)
		{
			const user = this.connectedUsers[idUser];
			if (user && user.socket && user.socket != exceptSocket && user.socket.readyState === WebSocket.OPEN)
			{
				user.socket.send(buffer);
			}
		}
	}

	sendFullBuffer()
	{
		const buffer = this.dataHelper.toArray();
		this.sendAllBuffer(buffer);
		this.dataHelper.startWriting();
	}

	addPack(idMessage:number, message:protocol.IMessage)
	{
		this.packMessage(idMessage, message, this.dataHelper);
	}

	addBuffer(buffer:Uint8Array)
	{
		this.dataHelper.writeRawBytes(buffer);
	}

	InsertFirstPack(idMessage:number, message:protocol.IMessage)
	{
		var curBuffer = utils.copyBuffer(this.dataHelper.toArray()); // просто .toArray() вернет новый массив, но с указателем на старые элементы
		this.dataHelper.startWriting(); // соответственно при изменении его, будет меняться исходный, т.е. по факту не копия старого.
		this.addPack(idMessage, message);
		this.addBuffer(curBuffer);
	}

	getWorldState()
	{
		var list = [];
		for (var id in this.dynamicEntitys)
		{
			var e = this.dynamicEntitys[id];
			if (!e.isSyncNetwork())
				continue;
			var info:protocol.IEntityInfo = {
				id:Number(id),
				position:netUtils.vec2FloatToInt(e.getPosition()),
				velocity:netUtils.toRangeVec2(e.getVelocity(), 'uint8', -0.5, 0.5),
				angle:netUtils.degToByte(e.getRotationDeg())
			};
			list.push(info);
		}
		return list;
	}

	getWorldInfo()
	{
		var wrap = this.dataHelperPool.get();
		var view = wrap.item;

		var msgTimestamp:protocol.IScTimestamp = {offsetTime:this.getOffsetTime()};
		this.packMessage(protocol.MessageScTimestamp.GetType(), msgTimestamp, view);

		for (var id in this.entitys)
		{
			var e = this.entitys[id];
			// todo опасно если будет угол не целым числом или позиция
			var state:any = e.getState() as any;
			if (state.angle !== undefined)
				state.angle = netUtils.degToByte(state.angle);
			if (state.position !== undefined)
				state.position = netUtils.vec2FloatToInt(state.position);
			if (state.velocity !== undefined)
				state.velocity = netUtils.toRangeVec2(state.velocity, 'uint8', -0.5, 0.5);
			this.packMessage(e.idProtocol(), state, view);
		}
		var buffer = view.toArray();
		this.dataHelperPool.put(wrap);
		return buffer;
	}

	onSocketUpdate()
	{
		var msgTimestamp:protocol.IScTimestamp = {offsetTime:this.getOffsetTime()};
		this.InsertFirstPack(protocol.MessageScTimestamp.GetType(), msgTimestamp);

		var msgWorldState:protocol.IScWorldStateUpdate = {list:this.getWorldState()};
		this.addPack(protocol.MessageScWorldStateUpdate.GetType(), msgWorldState);

		this.sendFullBuffer();
	}

	onMessageInput(socket:ExtWebSocket, message:protocol.ICsInput)
	{
		const user = this.connectedUsers[socket.idUser];
		if (!user)
			return;
		var key = String.fromCharCode(message.key);
		var state = message.state === 1;
		user.keyboard.keys[key] = state;
	}


	onMessageCursor(socket:ExtWebSocket, message:protocol.ICsMouseAngle)
	{
		const user = this.connectedUsers[socket.idUser];
		if (!user)
			return;
		var angle = netUtils.byteToDeg(message.angle);
		user.keyboard.mouseAngle = angle;
	}

	getNewId()
	{
		return this.numPool.get();
	}

	addEntity(entity:BaseEntity, isDynamic = false, id = -1)
	{
		if (id == -1)
			var id = this.getNewId();
		if (isDynamic)
			this.dynamicEntitys[id] = entity;
		if (this.entitys[id])
			console.warn("Сущность уже существует:", id, this.entitys[id].constructor.name, entity.constructor.name);
		entity.idEntity = id;
		entity.addTime = this.getOffsetTime();
		this.entitys[id] = entity;
		if (Object.keys(this.connectedUsers).length == 0)
			return console.log("Некому слать инфу о создании сущности", id);
		this.addPack(entity.idProtocol(), entity.getState());
		return id;
	}

	getEntity(id:number)
	{
		return this.entitys[id];
	}

	removeEntity(id:number)
	{
		this.numPool.put(id, this.timeLock)
		if (this.entitys[id])
			this.entitys[id].onRemove();
		delete this.entitys[id];
		delete this.dynamicEntitys[id];

		var msg:protocol.IScRemoveE = {id:id};
		this.addPack(protocol.MessageScRemoveE.GetType(), msg);
	}

	onReconnect(socket:ExtWebSocket)
	{
		const idUser = socket.idUser;
		console.log("Переподключение id_user:", idUser);

		this.sendSocket(socket, protocol.MessageScClose.GetType(), {});

		if (this.connectedUsers[idUser])
			this.onLeave(socket);
	}

	// подключился, авторизован
	onJoin(socket:ExtWebSocket, info = {})
	{
		const idUser = socket.idUser;
		this.connectedUsers[idUser] = {
			idEntity:0,
			idUser:idUser,
			socket:socket,
			keyboard:{keys:{}, mouseAngle:0},
		};
		// Юзеру - инфу о соедиении
		var msg:protocol.IScInit = {serverStartTime:BigInt(this.startTime), offsetTime:this.getOffsetTime(), idUser:idUser, data:JSON.stringify(info)};
		this.sendSocket(socket, protocol.MessageScInit.GetType(), msg);
		return true;
	}

	// отключился
	onLeave(socket:ExtWebSocket)
	{
		if (this.connectedUsers[socket.idUser])
			var id = this.connectedUsers[socket.idUser].idEntity;
		else
			var id = 0;
		delete this.connectedUsers[socket.idUser];
		console.log("Отключился idUser/idEntity:", socket.idUser, id);

		var msg:protocol.IScLeave = {idUser:socket.idUser, id:id};
		this.addPack(protocol.MessageScLeave.GetType(), msg);
	}

	// покидание комнаты
	onLeaveRoom(socket:ExtWebSocket)
	{
		console.log("Покинул комнату id_user:", socket.idUser);
	}

	// обработка сообщения
	onMessage(socket:ExtWebSocket, typ:number, srcMessage:protocol.IMessage)
	{
		if (typ == protocol.MessageCsInput.GetType())
		{
			this.onMessageInput(socket, srcMessage as protocol.ICsInput);
		}

		if (typ == protocol.MessageCsMouseAngle.GetType())
		{
			this.onMessageCursor(socket, srcMessage as protocol.ICsMouseAngle);
		}

		if (typ == protocol.MessageCsPing.GetType())
		{
			var message = srcMessage as protocol.ICsPing;
			var msg:protocol.IScPong = {clientTime:message.clientTime, offsetTime:this.getOffsetTime()};
			this.sendSocket(socket, protocol.MessageScPong.GetType(), msg);
		}
	}

	onUpdate(deltaTime:number)
	{
		// важно зафиксировать время последнего пересчета и отправить его в рассчет интерполяции(если апдейт происходит в другом времени),
		// т.к. если сокет отправит сообщение о текущем времени,
		// то по факту позиция объектов будет старая, а времени будет больше, ведь обновление происходит именно в этот момент
	}


}