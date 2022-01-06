import fs from 'fs';
import http from 'http';
import https from 'https';

import WebSocket, { WebSocketServer } from 'ws';
import {BaseSystem} from 'ecs-threejs';

export interface NetConfig{
	ssl:boolean;
	sslKey:string;
	sslCert:string;
	wsPort:number;
}

export interface ExtWebSocket extends WebSocket {
	idUser: number;
	roomId:number;
}

var processRequest = function(req:any, res:any){try{res.writeHead(200);}catch(e){}};

export class WsServer extends BaseSystem{

	private app:http.Server|https.Server;
	private server:WebSocketServer;

	constructor(config:NetConfig)
	{
		super();
		var httpServ = (config.ssl) ? https : http;
		if (config.ssl)
		{
			this.app = httpServ.createServer({
				key: fs.readFileSync(config.sslKey),
				cert: fs.readFileSync(config.sslCert)
			},
				processRequest).listen(config.wsPort);
		}
		else
		{
			this.app = httpServ.createServer(processRequest).listen(config.wsPort);
		}
		this.server = new WebSocketServer({server: this.app, perMessageDeflate:false});
		this.server.on('connection', this.onConnect.bind(this));
		this.server.on('error', (error:Error) =>
		{
			console.error('Server Error: ', error);
		});
	}

	private onConnect(socket:ExtWebSocket, request:http.IncomingMessage)
	{
		this.dispatchEvent({type:"connection", socket, request});

		socket.on('error', (error:Error) =>
		{
			console.error('Socket Error: ', error);
			this.dispatchEvent({type:"error", socket, error});
		});

		socket.on('message', (data:WebSocket.RawData) =>
		{
			this.dispatchEvent({type:"message", socket, data});
		});

		socket.on('close', (code:number, reason:Buffer) =>
		{
			this.dispatchEvent({type:"close", socket});
		});
	}

	getSocketUid(idUser:number)
	{

		for(var client of (this.server.clients as Set<ExtWebSocket>).values())
		{
			if (client.readyState === WebSocket.OPEN && client.idUser && client.idUser == idUser)
				return client;
		}
		return false;
	}

	broadcast(data:WebSocket.RawData, exceptClient:ExtWebSocket)
	{
		(this.server.clients as Set<ExtWebSocket>).forEach(function each(client)
		{
			if (client.readyState === WebSocket.OPEN && client != exceptClient)
				client.send(data, {binary:true});
		});
	}

	sendTo(idUser:number, data:WebSocket.RawData)
	{
		var socket = this.getSocketUid(idUser);
		if (socket != false && socket.readyState === WebSocket.OPEN)
			return socket.send(data, {binary:true});
		else
			return false;
	}



}

