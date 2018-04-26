module.exports = class remoteCommands {
	constructor(mergedConfig, messageInterface, extras){
		this.messageInterface = messageInterface;
		this.config = mergedConfig;
		this.socket = extras.socket;
		
		this.socket.emit("registerChatReciever");
		this.socket.on("gameChat", data => {
			if(data.instanceID && data.instanceID != this.config.unique.toString()){
				if(data.data.includes("[CHAT]") && data.data.toLowerCase().includes("!shout")){
					let chatMessage = "["+data.instanceID+"]"+ data.data.trim().split(" ").shift().shift().shift().join(" ");
					this.messageInterface("/c game.print('"+chatMessage+"')");
				}
			}
		});
	}
	factorioOutput(data){
		// console.log("GOT CHAT!"+data)
		this.socket.emit("gameChat", {
			instanceID: this.config.unique.toString(),
			data,
		});
	}
}
