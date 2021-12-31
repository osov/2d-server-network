import {BasePool} from 'ecs-threejs';
import {WrapDataHelper} from './WrapDataHelper';

export class DataHelperPool extends BasePool<WrapDataHelper>{

	constructor()
	{
		super(new WrapDataHelper(),0);
	}


	get()
	{
		var v = super.get();
		v.item.startWriting();
		return v;
	}
}