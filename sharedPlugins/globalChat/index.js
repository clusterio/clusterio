const needle = require("needle");

module.exports = class remoteCommands {
	constructor(mergedConfig, messageInterface, extras){
		this.messageInterface = messageInterface;
		this.config = mergedConfig;
		this.socket = extras.socket;
		this.instances = {};
		
		this.socket.on("hello", () => this.socket.emit("registerChatReciever"));
	
		this.socket.on("gameChat", async data => {
			if(data.instanceID && data.instanceID != this.config.unique.toString()){
				if(data.data.includes("[CHAT]")
				// if this isn't used as an info command or something (reduce spam)
				&& !data.data.includes("!info")
				// check if we are allowed to cross chat at all, default to true
				&& (mergedConfig.enableCrossServerShout == undefined || mergedConfig.enableCrossServerShout)
				// check if we are supposed to relay this message
				&& (mergedConfig.mirrorAllChat || data.data.toLowerCase().includes("/shout") || data.data.toLowerCase().includes("!shout"))){
					let words = data.data.trim().split(" ");
					words.shift();
					words.shift();
					words.shift();
					                let message = words.join(" ").replace(/[";]/g, " ").replace(/[']/g,"").replace("/shout ", "").replace("!shout ","").replace(/\[gps=.*?\]/g, "").replace(/\[train=.*?\]/g, "");
					
                    let instance = await this.getInstanceName(data.instanceID);
                    if(data.data.includes("[gps=")){
                    	//Nothing
                    }else{
                    	this.messageInterface("/silent-command game.print('[" + instance + "] " + message + "')");
                    }
                }
			}
		});
	}
	async factorioOutput(data){
		try{
		this.socket.emit("gameChat", {
			instanceID: this.config.unique.toString(),
			data,
		});
		if(data.includes("[CHAT]") && data.includes("!info")){
			let infoMessage = [
				"=== Server info ===",
				"Name: "+await this.getInstanceName(this.config.unique)+" ("+this.config.unique+")",
			];
			infoMessage.forEach((line, i) => {
				setTimeout(()=>this.messageInterface("/silent-command game.print('"+line+"')"),i*200);
			});
		}
		}catch(e){console.log(e)}
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
