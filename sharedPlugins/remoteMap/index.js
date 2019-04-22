const needle = require("needle");

const debug = true
module.exports = class remoteMap {
	constructor(mergedConfig, messageInterface, extras){
		this.messageInterface = messageInterface;
		this.config = mergedConfig;
		this.socket = extras.socket;
		this.instances = {};
		
        this.socket.on("hello", () => this.socket.emit("registerMapServer", {
			instanceID: this.config.unique, // instanceID
		}));

        this.socket.on("createEntity", req => {
			// req = {name:"", position:{x,y}, ?direction:4}
			// game.player.surface.create_entity{name="small-ship-wreck", position={game.player.position.x-2, game.player.position.y+1}, direction=..., force=...}
			this.messageInterface("placing "+JSON.stringify(req));
			if(req && req.name && typeof req.name == "string" && req.position && !isNaN(Number(req.position.x)) && !isNaN(Number(req.position.y))){
				// delete any entity in that spot first, just in case to avoid overlaps
				this.messageInterface('/silent-command local toDelete = game.surfaces[1].find_entities({{'+req.position.x+','+req.position.y+'},{'+(req.position.x+0.5)+','+(req.position.y+0.5)+'}}) for i, entity in pairs(toDelete) do entity.destroy() end');
				// build the entity
				let command = '/silent-command game.surfaces[1].create_entity{name="'+req.name+'", position={'+Number(req.position.x)+', '+Number(req.position.y)+'}, force="player"'
				if(req.direction) command += ', direction='+req.direction;
				command += '}';
				this.messageInterface(command); // execute command
			}
        })
        this.socket.on("deleteEntity", req => {
			// req: {position: {x, y}}
			this.messageInterface('/silent-command local toDelete = game.surfaces[1].find_entities({{'+req.position.x+','+req.position.y+'},{'+(req.position.x+0.5)+','+(req.position.y+0.5)+'}}) for i, entity in pairs(toDelete) do entity.destroy() end');
        })
		this.socket.on("getChunk", async (data, callback) => {
			let chunkData = await this.messageInterface(`/silent-command remote.call("remoteMap", "exportChunk", ${data.x}, ${data.y})`)
			console.log(`Sending chunk data: ${chunkData}`)
			callback(chunkData);
		})
		
		// detect new entities created/deleted on the server and update the master
		setInterval(async ()=>{
			let data = await this.messageInterface(`/silent-command remote.call("remoteMap", "exportTiles")`)
			if(data.length > 1) this.socket.emit("updateEntities", data)
		}, 2000)
	}
	getInstanceName(instanceID){
		return new Promise((resolve, reject) => {
			let instance = this.instances[instanceID];
			if(!instance){
				needle.get(this.config.masterIP+":"+this.config.masterPort+ '/api/slaves', (err, response) => {
					if(err || response.statusCode != 200) {
						console.log("Unable to get JSON master/api/slaves, master might be unaccessible");
					} else if (response && response.body) {	
						if(Buffer.isBuffer(response.body)) {console.log(response.body.toString("utf-8")); throw new Error();}
							try {
								for (let index in response.body)
									this.instances[index] = response.body[index].instanceName;
							} catch (e){
								console.log(e);
								return null;
							}
						instance = this.instances[instanceID] 							
						if (!instance) instance = instanceID;  //somehow the master doesn't know the instance	
						resolve(instance);
					}
				});
			} else {
				resolve(instance);
			}
		});
	}
}