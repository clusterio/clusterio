const pluginConfig = require("./config");
const clusterUtil = require("./lib/clusterUtil.js");
const fs = require("fs");

const COMPRESS_LUA = false;

module.exports = class remoteCommands {
	constructor(mergedConfig, messageInterface, extras){
		this.messageInterface = messageInterface;
		this.config = mergedConfig;
		this.socket = extras.socket;
		
		let socketRegister = () => {
			this.socket.emit("registerTrainTeleporter", {
				instanceID: this.config.unique,
			});
		}
		
		this.socket.on("hello", () => setTimeout(socketRegister,1000));
		
		
		// initialize mod with Hotpatch
		(async () => {
			let startTime = Date.now();
			let hotpatchInstallStatus = await this.checkHotpatchInstallation();
			this.messageInterface("Hotpach installation status: "+hotpatchInstallStatus);
			if(hotpatchInstallStatus){
				var returnValue
				var luaCode = await this.getSafeLua("sharedPlugins/trainTeleports/lua/train_stop_tracking.lua");
				if(luaCode) returnValue = await messageInterface("/silent-command remote.call('hotpatch', 'update', '"+pluginConfig.name+"', '"+pluginConfig.version+"', '"+luaCode+"')");
				if(returnValue) console.log(returnValue)
				var guiCode = await this.getSafeLua("sharedPlugins/trainTeleports/lua/gui.lua");
				if(guiCode) returnValue = await messageInterface("/silent-command remote.call('hotpatch', 'update', '"+pluginConfig.name+"Gui', '"+pluginConfig.version+"', '"+guiCode+"')");
				if(returnValue) console.log(returnValue)
				var trainCode = await this.getSafeLua("sharedPlugins/trainTeleports/lua/train_tracking.lua");
				if(trainCode) returnValue = await messageInterface("/silent-command remote.call('hotpatch', 'update', '"+pluginConfig.name+"_train_tracking', '"+pluginConfig.version+"', '"+trainCode+"')");
				if(returnValue) console.log(returnValue)
				this.messageInterface("trainTeleports installed in "+(Date.now() - startTime)+"ms");
			} else {
				this.messageInterface("Hotpatch isn't installed! Please generate a new map with the hotpatch scenario to use trainTeleports.");
			}
		})().catch(e => console.log(e));
		
		this.socket.on("trainstopsDatabase", async trainstopsDB => {
			// convert database to LUA table
			// for an example of intended output, see exampleTable_1.lua
			let command = 'remote.call("trainTeleportsGui", "runCode", \'global.trainstopsData = {';
			for(let instanceID in trainstopsDB){
				command += '{id='+instanceID+',';
				command += 'name="'+await clusterUtil.getInstanceName(instanceID, this.config)+'",';
				command += 'stations={';
				for(let trainstop in trainstopsDB[instanceID]){
					command += '"'+trainstop+'",';
				}
				command += '},},';
			}
			command += '}\')';
			this.messageInterface("/silent-command "+command);
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
			
			if(parsedData.event == "trainstop_added"){
				this.messageInterface(`Adding trainstop ${parsedData.name} at x:${parsedData.x} y:${parsedData.y}`);
				this.socket.emit("trainstop_added", parsedData);
			} else if(parsedData.event == "trainstop_edited"){
				this.messageInterface(`Editing trainstop ${parsedData.name} at x:${parsedData.x} y:${parsedData.y}`);
				this.socket.emit("trainstop_edited", parsedData);
			} else if(parsedData.event == "trainstop_removed"){
				this.messageInterface(`Removing trainstop ${parsedData.name} at x:${parsedData.x} y:${parsedData.y}`);
				this.socket.emit("trainstop_removed", parsedData);
			}
		}
	}
	async getSafeLua(filePath){
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
							return acc += " " + val.substr(0, val.indexOf("--"));
						} else {
							return acc += " " + val;
						}
					});
					// this takes about 46 ms to minify train_stop_tracking.lua in my tests on an i3
					if(COMPRESS_LUA) contents = require("luamin").minify(contents);
					
					resolve(contents);
				}
			});
		});
	}
	async checkHotpatchInstallation(){
		let yn = await this.messageInterface("/silent-command if remote.interfaces['hotpatch'] then rcon.print('true') else rcon.print('false') end");
		yn = yn.replace(/(\r\n\t|\n|\r\t)/gm, "");
		if(yn == "true"){
			return true;
		} else if(yn == "false"){
			return false;
		}
	}
}
