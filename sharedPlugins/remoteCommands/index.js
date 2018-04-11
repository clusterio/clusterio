module.exports.main = class remoteCommands {
	constructor(mergedConfig, messageInterface, extras){
		console.log = messageInterface;
		this.messageInterface = messageInterface;
		this.config = mergedConfig;
		this.socket = extras.socket;
		
		if(this.config.allowRemoteCommandExecution){
			this.socket.on("runCommand", data => {
				let {commandID} = data;
				this.messageInterface(data.command);
				if(commandID){
					this.socket.emit("runCommandReturnValue", {
						commandID,
						body: {
							info: "Command was sent to factorio",
						},
					});
				}
			});
		}
	}
}