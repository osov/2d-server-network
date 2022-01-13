import {DataHelper} from '2d-client-network';

// Wrapper для DataHelper, т.к. нужен метод makeInstance чтобы базовый пул мог делать клонов

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