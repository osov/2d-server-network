import {BasePool} from 'ecs-threejs';
import {WrapDataHelper} from './WrapDataHelper';

// Pool для враперов DataHelper

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