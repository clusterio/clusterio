module.exports = class remoteCommands {
	constructor(mergedConfig, messageInterface, extras){
		this.messageInterface = messageInterface;
		this.config = mergedConfig;
		this.socket = extras.socket;
		this.instances = {};
		this.socket.emit("registerChatReciever");
		this.socket.on("gameChat", data => {
			if(data.instanceID && data.instanceID != this.config.unique.toString()){
				if(data.data.includes("[CHAT]") && (data.data.toLowerCase().includes("/shout") || data.data.toLowerCase().includes("!shout"))){
					let words = data.data.trim().split(" ");
					words.shift();
					words.shift();
					words.shift();
					let message = words.join(" ").replace(/[";]/g, " ").replace(/[']/g,"").replace("/shout ", "").replace("!shout", "");
					let instance = this.instances[data.instanceID];
					if (!instance) {
						let me = this; //to pass 'this' down to the callback
						require('needle').get(this.config.masterIP +  '/api/slaves', function (err, response) {
							if(err || response.statusCode != 200) {
								console.log("Unable to get JSON master/api/slaves, master might be unaccessible");
							} else if (response && response.body) {	
								if(Buffer.isBuffer(response.body)) {console.log(response.body.toString("utf-8")); throw new Error();}
									try {
										for (let index in response.body)
											me.instances[index] = response.body[index]["instanceName"];
									} catch (e){
										console.log(e);
										return null;
									}
								instance = me.instances[data.instanceID] 							
								if (!instance)
									instance = data.instanceID;  //somehow the master doesn't know the instance	
								me.messageInterface("/silent-command game.print('[" + instance + "] " + message +"')");
							}
						});
					} else {	
						this.messageInterface("/silent-command game.print('[" + instance + "] " + message + "')");
					}
				}
			}
		});
	}
	factorioOutput(data){
		this.socket.emit("gameChat", {
			instanceID: this.config.unique.toString(),
			data,
		});
	}
}
