module.exports = class remoteCommands {
	constructor(mergedConfig, messageInterface, extras){
		this.messageInterface = messageInterface;
		this.config = mergedConfig;
		this.socket = extras.socket;
		
		this.socket.emit("registerChatReciever");
		this.socket.on("gameChat", data => {
			if(data.instanceID && data.instanceID != this.config.unique.toString()){
				if(data.data.includes("[CHAT]") && data.data.toLowerCase().includes("!shout")){
					let message = data.data.trim().split(" ");
					message.shift();
					message.shift();
					message.shift();
					let chatMessage = "["+data.instanceID+"]"+ message.join(" ");
					chatMessage = chatMessage.replace(/[^a-zA-Z0-9]+/g, " ");
					this.messageInterface("/silent-command game.print('"+chatMessage.replace("!shout ","")+"')");
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
