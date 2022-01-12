import * as ECS from 'ecs-threejs';
import {protocol} from '2d-client-network';

export interface keyboardState{
	keys:{[k:string]:boolean};
	mouseAngle:number;
}

export class BaseEntity extends ECS.BaseEntity{

	public healht:number = 100;
	public isAlive:boolean = true;
	public idUser:number = -1;
	public radius:number = 10;

	constructor()
	{
		super();
	}

	onAdded()
	{
		super.onAdded();
	}

	doDamage(damage:number, damager?:BaseEntity)
	{
		var oldHealht = this.healht;
		this.healht -= damage;
		if (this.healht < 0)
			this.healht = 0;
		this.isAlive = this.healht > 0;
		if (oldHealht > 0 && this.healht == 0)
			this.dispatchEvent({type:'destroy', killer:damager});
	}

	doReset()
	{
		super.doReset();
		this.isAlive = true;
	}


	// применяем ввод клавиш
	apllyInput(keys:keyboardState, deltaTime:number)
	{

	}

	// применяем какие-то данные к текущим значениям(обычно для обновления данных физики)
	applyParams()
	{

	}

	// пересчитываем данные
	doUpdate(deltaTime:number)
	{
		super.doUpdate(deltaTime);
	}

	// сохраняем состояние(обычно после физики) для дальнейшей сериализации
	updateState()
	{

	}

	// событие удаления сущности
	onRemove()
	{
		super.onRemove();
	}

	// синхронизировать ли по сети
	isSyncNetwork()
	{
		return true;
	}

	idProtocol()
	{
		console.error("idProtocol", this);
		return -1;
	}

	// состояние объекта
	getState():protocol.IMessage
	{
		console.error("getState", this);
		return {};
	}

}