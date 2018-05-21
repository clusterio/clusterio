const pluginConfig = require("./config");

const fs = require("fs");

module.exports = class remoteCommands {
	constructor(mergedConfig, messageInterface, extras){
		this.messageInterface = messageInterface;
		this.config = mergedConfig;
		this.socket = extras.socket;
		setInterval(()=>{
			// messageInterface("/c rcon.print('Rcon return data works :D')", data => messageInterface(data));
		},1000);
		
		// initialize mod with Hotpatch
		this.checkHotpatchInstallation().then(status => {
			console.log(status)
		});
		this.getSafeLua("sharedPlugins/trainTeleports/lua/train_stop_tracking.lua").then(code => {
			messageInterface("/c remote.call('hotpatch', 'update', '"+pluginConfig.name+"', '"+pluginConfig.version+"', '"+code+"')");
		});
	}
	async scriptOutput(data){
		if(data !== null){
			this.messageInterface(data);
			let parsedData = {};
			data = data.split("|");
			data.forEach(kv => {
				kv = kv.split(":");
				parsedData[kv[0]] = kv[1];
			});
			this.messageInterface(JSON.stringify(parsedData));
			
			let trainstops = await this.getTrainstops();
			if(!trainstops.data) trainstops.data = [];
			if(parsedData.event == "trainstop_added"){
				this.messageInterface(`Adding trainstop ${parsedData.name} at x:${parsedData.x} y:${parsedData.y}`);
				trainstops.data.push(parsedData);
			} else if(parsedData.event == "trainstop_edited"){
				trainstops.data.forEach(trainstop, index => {
					if(trainstop.x == parsedData.x && trainstop.y == parsedData.y){
						this.messageInterface("Renaming trainstop from "+trainstop.name+" to "+parsedData.name);
						trainstop.name = parsedData.name;
					}
				});
			} else if(parsedData.event == "trainstop_removed"){
				trainstops.data.forEach(trainstop, index => {
					if(trainstop.x == parsedData.x && trainstop.y == parsedData.y){
						delete trainstops[index];
					}
				});
			}
		}
	}
	getSafeLua(filePath){
		return new Promise((resolve, reject) => {
			fs.readFile(filePath, "utf8", (err, contents) => {
				if(err){
					reject(err);
				} else {
					// remove newlines
					contents = contents.split(/\r?\n/);
					// strip away single line comments
					contents = contents.reduce((acc, val) => {
						if(val.indexOf("--") && val.indexOf("--") != val.indexOf("--[[")){
							acc += val.substr(0, val.indexOf("--"));
						} else {
							acc += val;
						}
					});
					resolve(contents);
				}
			});
		});
	}
	checkHotpatchInstallation(){
		return new Promise((resolve, reject) => {
			this.messageInterface("/silent-command if remote.interfaces['hotpatch'] then rcon.print('true') else rcon.print('false') end", yn => {
				if(yn == "true"){
					resolve(true);
				} else if(yn == "false"){
					resolve(false);
				}
			});
		});
	}
}
