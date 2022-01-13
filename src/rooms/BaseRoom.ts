import {WebSocket} from 'ws';
import {BaseSystem, NumberPool} from 'ecs-threejs';
import {ServerApp} from '../network/ServerApp';
import {ExtWebSocket} from '../network/WsServer';
import {DataHelper, protocol, utils, netUtils, MessagesPackerList} from '2d-client-network';
import {BaseEntity, keyboardState} from '../entitys/BaseEntity';
import {DataHelperPool} from '../network/DataHelperPool';

interface ConnectionData{
	idEntity:number;
	idUser:number;
	keyboard:keyboardState;
	socket:ExtWebSocket;
}

// type IdsMessage = (keyof typeof protocol.TypMessages);
type IdsMessage = number;

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
	protected listPacker:MessagesPackerList;

	constructor(app:ServerApp, listPacker:MessagesPackerList)
	{
		super();
		this.startTime = this.now();
		this.app = app;
		this.listPacker = listPacker;
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


	// -----------------------------------------------------------------------
	// network
	// -----------------------------------------------------------------------

	packMessage(idMessage:IdsMessage, message:protocol.IMessage, view:DataHelper)
	{
		if (idMessage < 0)
			return this.error("Сообщение не определено", idMessage, message);
		var messagePacker = this.listPacker[idMessage];
		if (messagePacker === undefined)
			return this.error("Упаковщик для сообщения не найден:", idMessage);
		messagePacker.Pack(view, message);
		return view;
	}

	makeMessage(idMessage:IdsMessage, message:protocol.IMessage)
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

	sendSocket(socket:ExtWebSocket, idMessage:IdsMessage, message:protocol.IMessage)
	{
		var pack = this.makeMessage(idMessage, message);
		this.sendSocketBuffer(socket, pack);
	}

	sendTo(user:ConnectionData, idMessage:IdsMessage, message:protocol.IMessage)
	{
		if (user && user.socket)
			this.sendSocket(user.socket, idMessage, message);
	}

	setToUid(idUser:number, idMessage:IdsMessage, message:protocol.IMessage)
	{
		var user = this.connectedUsers[idUser];
		if (!user)
			return this.warn("setToUid не найден юзер:", idUser, idMessage);
		return this.sendTo(user, idMessage, message);
	}

	sendAll(idMessage:IdsMessage, message:protocol.IMessage, exceptSocket:ExtWebSocket|null = null)
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

	addPack(idMessage:IdsMessage, message:protocol.IMessage)
	{
		this.packMessage(idMessage, message, this.dataHelper);
	}

	addBuffer(buffer:Uint8Array)
	{
		this.dataHelper.writeRawBytes(buffer);
	}

	InsertFirstPack(idMessage:IdsMessage, message:protocol.IMessage)
	{
		var curBuffer = utils.copyBuffer(this.dataHelper.toArray()); // просто .toArray() вернет новый массив, но с указателем на старые элементы
		this.dataHelper.startWriting(); // соответственно при изменении его, будет меняться исходный, т.е. по факту не копия старого.
		this.addPack(idMessage, message);
		this.addBuffer(curBuffer);
	}

	// -----------------------------------------------------------------------
	// Room methods
	// -----------------------------------------------------------------------
	
	wrapPosition(entity:BaseEntity)
	{
		const w = this.app.config.worldSize.x * 0.5;
		const h = this.app.config.worldSize.y * 0.5;
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

	encodeEntityState(state:any, velocityType = 'uint8')
	{
		if (state.angle !== undefined)
			state.angle = netUtils.degToByte(state.angle);
		if (state.position !== undefined)
			state.position = netUtils.vec2FloatToInt(state.position);
		// очень часто для velocity не хватает точности uint8 поэтому тут используем порой uint16, 
		// но можно и uint8 если цифры не будут с большим расхождением
		// например можно 0.01, но число 0.001 может вызвать ошибку т.к. на клиенте оно будет восстановлено в 0,
		// поэтому крайне важно случайную скорость не задавать, а только с шагом например randInt(0, 100) / 100 * 0.5
		// также важно не забыть на клиенте привести к нужной точности знаков после запятой.
		if (state.velocity !== undefined)
			state.velocity = netUtils.toRangeVec2(state.velocity, velocityType, -0.5, 0.5);
		return state;
	}

	encodeWorldState(state:any)
	{
		return this.encodeEntityState(state, 'uint8');
	}

	// апдейт каждые N мс
	getWorldState()
	{
		var list = [];
		for (var id in this.dynamicEntitys)
		{
			var e = this.dynamicEntitys[id];
			if (!e.isSyncNetwork())
				continue;

			var state:protocol.IEntityInfo = {
				id:Number(id),
				position:e.getPosition(),
				velocity:e.getVelocity(),
				angle:e.getRotationDeg()
			};
			state = this.encodeWorldState(state);
			//console.log("WorldState", info);
			list.push(state);
		}
		return list;
	}

	// инфа при подключении
	getWorldInfo()
	{
		var wrap = this.dataHelperPool.get();
		var view = wrap.item;

		var msgTimestamp:protocol.IScTimestamp = {offsetTime:this.getOffsetTime()};
		this.packMessage(protocol.IdMessages.IScTimestamp, msgTimestamp, view);

		for (var id in this.entitys)
		{
			var e = this.entitys[id];
			// todo опасно если будет угол не целым числом или позиция
			var state = this.encodeEntityState(e.getState() as any, 'uint16');
			//console.log("WorldInfo", info);
			this.packMessage(e.idProtocol(), state, view);
		}
		var buffer = view.toArray();
		this.dataHelperPool.put(wrap);
		return buffer;
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
			this.warn("Сущность уже существует:", id, this.entitys[id].constructor.name, entity.constructor.name);
		entity.onAdd(this.app.config); // здесь метка времени
		entity.addTime = this.getOffsetTime(); // а тут перебиваем время на смещенное, т.к. клиент считать будет по нему
		entity.idEntity = id;
		this.entitys[id] = entity;
		entity.onAdded();
		if (Object.keys(this.connectedUsers).length == 0)
			return this.log("Некому слать инфу о создании сущности", id);
		var state = this.encodeEntityState(entity.getState() as any, 'uint16');
		//console.log("Add", entity.id, state);
		this.addPack(entity.idProtocol(), state);
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

		var msg:protocol.IScRemoveE = {idEntity:id};
		this.addPack(protocol.IdMessages.IScRemoveE, msg);
	}

	// -----------------------------------------------------------------------
	// Room events
	// -----------------------------------------------------------------------
	
	// отправка накопившихся сообщений всем
	onSocketUpdate()
	{
		var msgTimestamp:protocol.IScTimestamp = {offsetTime:this.getOffsetTime()};
		this.InsertFirstPack(protocol.IdMessages.IScTimestamp, msgTimestamp);

		var msgWorldState:protocol.IScWorldStateUpdate = {list:this.getWorldState()};
		this.addPack(protocol.IdMessages.IScWorldStateUpdate, msgWorldState);

		this.sendFullBuffer();
	}

	// сообщение ввода
	onMessageInput(socket:ExtWebSocket, message:protocol.ICsInput)
	{
		const user = this.connectedUsers[socket.idUser];
		if (!user)
			return;
		var key = String.fromCharCode(message.key);
		var state = message.state === 1;
		user.keyboard.keys[key] = state;
	}

	// сообщение позиции мышки/джостика
	onMessageCursor(socket:ExtWebSocket, message:protocol.ICsMouseAngle)
	{
		const user = this.connectedUsers[socket.idUser];
		if (!user)
			return;
		var angle = netUtils.byteToDeg(message.angle);
		user.keyboard.mouseAngle = angle;
	}

	// переподключился
	onReconnect(socket:ExtWebSocket)
	{
		const idUser = socket.idUser;
		this.log("Переподключение idUser:", idUser);

		this.sendSocket(socket, protocol.IdMessages.IScClose, {});

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
		this.sendSocket(socket, protocol.IdMessages.IScInit, msg);
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
		this.log("Отключился idUser/idEntity:", socket.idUser, id);

		var msg:protocol.IScLeave = {idUser:socket.idUser, id:id};
		this.addPack(protocol.IdMessages.IScLeave, msg);
	}

	// покидание комнаты
	onLeaveRoom(socket:ExtWebSocket)
	{
		this.log("Покинул комнату idUser:", socket.idUser);
	}

	// обработка сообщения
	onMessage(socket:ExtWebSocket, typ:number, srcMessage:protocol.IMessage)
	{
		if (typ == protocol.IdMessages.ICsInput)
		{
			this.onMessageInput(socket, srcMessage as protocol.ICsInput);
		}

		if (typ == protocol.IdMessages.ICsMouseAngle)
		{
			this.onMessageCursor(socket, srcMessage as protocol.ICsMouseAngle);
		}

		if (typ == protocol.IdMessages.ICsPing)
		{
			var message = srcMessage as protocol.ICsPing;
			var msg:protocol.IScPong = {clientTime:message.clientTime, offsetTime:this.getOffsetTime()};
			this.sendSocket(socket, protocol.IdMessages.IScPong, msg);
		}
	}

	// тик обновления мира
	onUpdate(deltaTime:number)
	{
		// важно зафиксировать время последнего пересчета и отправить его в рассчет интерполяции(если апдейт происходит в другом времени),
		// т.к. если сокет отправит сообщение о текущем времени,
		// то по факту позиция объектов будет старая, а времени будет больше, ведь обновление происходит именно в этот момент
	}


}