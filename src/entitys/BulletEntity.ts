import {Vector2} from 'three';
import {BaseEntity} from './BaseEntity';
import {utils} from '2d-client-network';
import {protocol} from '2d-client-network';

export interface BulletData{
	speed:number;
	damage:number;
	velocityShip?:Vector2;
	timeLife:number;
}

export class BulletEntity extends BaseEntity{

	public params:BulletData;
	private startPos:Vector2 = new Vector2();
	private startTime:number;

	constructor(params:BulletData)
	{
		super();
		this.params = params;
	}

	onAdded()
	{
		super.onAdded();
		this.velocity.set(Math.sin(this.getRotationRad()), Math.cos(this.getRotationRad())).multiplyScalar(this.params.speed);
		if (this.params.velocityShip)
			this.velocity.add(this.params.velocityShip);
		this.startPos.copy(this.get2dPosition());
		this.startTime = Date.now();
	}

	doUpdate(_deltaTime:number)
	{
		if (!this.isAlive)
			return;
		var deltaTime = Date.now() - this.startTime;
		if (deltaTime > this.params.timeLife)
			this.isAlive = false;
		var vel = this.velocity.clone().multiplyScalar(deltaTime * 1);
		var newPos = this.startPos.clone().add(vel);
		this.setPosition(newPos);
		
		if (this.wrapConfig.worldWrap)
		{
			var pos = new Vector2(this.position.x, this.position.y);
			utils.vectorToRange(pos, this.wrapConfig.worldSize);
			this.setPosition(pos);
			//console.log('Wrap', deltaTime, vel);
		}
	}

	idProtocol()
	{
		return protocol.MessageEntityBullet.GetType();
	}

	// состояние объекта
	getState():protocol.IEntityBullet
	{
		return {id:this.idEntity, position:this.startPos, velocity:this.velocity, angle:this.getRotationDeg(), offsetTime:this.addTime};
	}


}