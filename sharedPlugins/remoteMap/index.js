const needle = require("needle");
const ioClient = require("socket.io-client");

const chunkStore = require("./chunkStore.js");

const moduleConfig = require("./config"); // not to be confused with clusterio config. This config is private to this plugin.

class remoteMap {
	constructor(slaveConfig, messageInterface){
		this.config = slaveConfig;
		this.messageInterface = messageInterface;
		
		// initialize chunk database
		this.chunkMap = new chunkStore(this.config.unique, 64, "./database/chunkStore/");
		this.chunkMap.onEntityChange(entity => {
			console.log("Entity changed: ")
			console.log(entity);
			// check valid coordinates (dunno what could go wrong, but can never be too sure)
			if(entity && entity.x !== undefined && !isNaN(Number(entity.x)) && entity.y !== undefined && !isNaN(Number(entity.y))){
				this.socket.emit("sendEntity", entity);
			}
		});
		
		// set up websocket communication and handle requests from web interface users (which are going through master)
		// socket should be a global
		this.socket = ioClient("http://"+this.config.masterIP+":"+this.config.masterPort);
		this.socket.on("hello", data => {
			this.socket.emit("registerSlaveMapper", {instanceID: this.config.unique});
			setInterval(()=>{
				this.socket.emit("heartbeat"); // send our heartbeat to prevent being assumed dead
			},10000);
		});
		this.socket.on("getChunk", req => {
			console.log("getChunk is not supported!");
			/*this.chunkMap.getChunk(req.x, req.y).then(chunk => {
				chunk.requesterID = req.requesterID;
				this.socket.emit("sendChunk", chunk);
			});*/
		});
		this.socket.on("getEntity", req => {
			// check for valid coordinates
			if(req.x !== undefined && !isNaN(Number(req.x)) && req.y !== undefined && !isNaN(Number(req.y))){
				this.chunkMap.getEntity(req.x, req.y).then(entities => {
					if(entities && entities.length > 0){
						entities.forEach(entity => {
							this.socket.emit("sendEntity", entity);
						});
					}
				});
			} else {
				this.messageInterface("socket.getEntity triggered called with invalid parameters");
			}
		});
		
		this.messageInterface("/silent-command game.print('"+moduleConfig.name+" version "+moduleConfig.version+" enabled')");
	}
	scriptOutput(data){
		if(data){
			this.messageInterface(data);
			// express-transport-belt,-35.5,-14.5,[...]
			data = data.split(",");
			if(data && data[0] == undefined){
				console.log("empty: ");
				console.log(data);
				return
			}
			let name = data[0];
			let xPos = data[1];
			let yPos = data[2];
			if(xPos && yPos && name){
				if(name == "deleted"){
					// this position is now empty, delete whatever was there from DB
					this.chunkMap.setEntity(xPos, yPos, "delete this entity").then(() => {
						this.messageInterface("Deleted data "+xPos+", "+yPos);
					}).catch((err)=>this.messageInterface(err));
				} else {
					let entity = {name};
					for(let i = 3; i < data.length; i++){
						if(data[i].includes("=")){
							let kv = data[i].split("=");
							entity[kv[0]] = kv[1];
						}
					}
					// save this entity in the database
					this.chunkMap.setEntity(xPos, yPos, entity).then(data => {
						this.messageInterface("Added "+name+" to data "+xPos+", "+yPos);
					}).catch((err)=>this.messageInterface(err));
				}
			}
			
		}
	}
}
module.exports = remoteMap;
