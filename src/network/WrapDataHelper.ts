import {DataHelper} from '2d-client-network';

export class WrapDataHelper{

	public item:DataHelper;

	constructor()
	{
		this.item = new DataHelper();
	}

	makeInstance()
	{
		return new WrapDataHelper();
	}

}