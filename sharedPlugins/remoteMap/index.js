const needle = require("needle");
const ioClient = require("socket.io-client");

const chunkStore = require("./../../lib/chunkStore.js");

const moduleConfig = require("./config"); // not to be confused with clusterio config. This config is private to this plugin.

class remoteMap {
	constructor(slaveConfig, messageInterface){
		this.config = slaveConfig;
		this.messageInterface = messageInterface;
		
		
		// initialize chunk database
		this.chunkMap = new chunkStore(this.config.unique, 64, "./database/chunkStore/");
		
		// set up websocket communication and handle requests from web interface users (which are going through master)
		// socket should be a global
		this.socket = ioClient("http://"+this.config.masterIP+":"+this.config.masterPort);
		this.socket.on("hello", data => {
			this.socket.emit("registerSlaveMapper", {instanceID: this.config.unique});
		});
		this.socket.on("getChunk", req => {
			this.chunkMap.getChunk(req.x, req.y).then(chunk => {
				chunk.requesterID = req.requesterID;
				this.socket.emit("sendChunk", chunk);
			});
		});
		
		this.messageInterface("/silent-command game.print('"+moduleConfig.name+" version "+moduleConfig.version+" enabled')");
	}
	scriptOutput(data){
		if(data){
			this.messageInterface(data);
			// express-transport-belt -35.5 -14.5
			
			data = data.split(" ");
			if(data && data[0] == undefined){
				// this position is now empty, delete whatever was there from DB
				console.log("empty: ");
				console.log(data);
				return
			}
			let name = data[0];
			let xPos = data[1];
			let yPos = data[2];
			if(xPos && yPos && name){
				if(name == "deleted"){
					this.chunkMap.setEntity(xPos, yPos, "delete this entity").then(data => {
						this.messageInterface("Deleted data "+data.position.x+", "+data.position.y);
					}).catch((err)=>this.messageInterface(err));
				} else {
					this.chunkMap.setEntity(xPos, yPos, {name}).then(data => {
						this.messageInterface("Added "+name+" to data "+data.position.x+", "+data.position.y);
					}).catch((err)=>this.messageInterface(err));
				}
			}
			
		}
	}
}
module.exports = remoteMap;
