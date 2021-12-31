import {Vector2} from 'three';
import {BaseEntity} from './BaseEntity';
import {utils} from '2d-client-network';
import {protocol} from '2d-client-network';

export interface BulletData{
	speed:number;
	damage:number;
	velocityShip?:Vector2;
	timeLife:number;
	idOwner:number;
}

export class BulletEntity extends BaseEntity{

	private params:BulletData;
	private startPos:Vector2 = new Vector2();

	constructor(params:BulletData)
	{
		super();
		this.params = params;
	}

	onAdd()
	{
		this.velocity.set(Math.sin(this.getRotationRad()), Math.cos(this.getRotationRad())).multiplyScalar(this.params.speed);
		if (this.params.velocityShip)
			this.velocity.add(this.params.velocityShip);
		this.startPos.copy(this.get2dPosition());
	}

	doUpdate(deltaTime:number)
	{
		if (!this.isAlive)
			return;
		var now = Date.now();
		var d = now - this.addTime;
		if (d > this.params.timeLife)
			this.isAlive = false;
		var vel = this.velocity.clone().multiplyScalar(1/1000 * d);
		var newPos = this.startPos.clone().add(vel);
		this.setPosition(newPos);
		if (this.config.worldWrap)
		{
			var pos = new Vector2(this.position.x, this.position.y);
			utils.vectorToRange(pos, this.config.worldSize);
			this.setPosition(pos);
		}
	}

	idProtocol()
	{
		return protocol.MessageEntityBullet.GetType();
	}

	// состояние объекта
	getState():protocol.IEntityBullet
	{
		return {id:this.idEntity, position:this.getPosition(), velocity:this.velocity, angle:this.getRotationDeg()};
	}


}