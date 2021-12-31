import * as ECS from 'ecs-threejs';
import {protocol} from '2d-client-network';

export interface keyboardState{
	keys:{[k:string]:boolean};
	mouseAngle:number;
}

export class BaseEntity extends ECS.BaseEntity{

	protected addTime:number;
	protected isAlive:boolean = true;

	constructor()
	{
		super();
		this.addTime = Date.now();
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