import {Vector2} from 'three';
import {ServerEntity} from './ServerEntity';
import {protocol} from '2d-client-network';

export class SimpleEntity extends ServerEntity{

	protected maxSpeed:number;
	private tmpVec:Vector2 = new Vector2();

	constructor(maxSpeed:number)
	{
		super();
		this.maxSpeed = maxSpeed;
	}

	doUpdate(deltaTime:number)
	{
		var velMagnitude = this.velocity.length();
		if (velMagnitude > this.maxSpeed)
			this.velocity.multiplyScalar(this.maxSpeed / velMagnitude);
		this.position.x += this.velocity.x * deltaTime;
		this.position.y += this.velocity.y * deltaTime;
	}

	turnRight(deltaAngle:number)
	{
		this.setRotationDeg(this.getRotationDeg() - deltaAngle);
	}

	turnLeft(deltaAngle:number)
	{
		this.turnRight(-deltaAngle);
	}

	accelerate(acceleration:number)
	{
		var rad = 2*Math.PI - this.getRotationRad();
		this.tmpVec.set(Math.sin(rad), Math.cos(rad));
		this.tmpVec.multiplyScalar(acceleration);
		this.velocity.add(this.tmpVec);
	}

	idProtocol()
	{
		return protocol.MessageEntityBase.GetType();
	}

	// состояние объекта
	getState():protocol.IEntityBase
	{
		return {id:this.idEntity, position:this.getPosition()};
	}


}