const needle = require("needle");
const isJson = require("./isJson.js");
const pluginConfig = require("./config.js");

const functions = require("./interfacingFunctions");

// poll inventories

class inventoryImports {
	constructor(slaveConfig, messageInterface){
		this.config = slaveConfig;
		this.messageInterface = messageInterface;
		messageInterface("/silent-command game.print('InventoryImports enabled')");
		setInterval(function(){
			messageInterface("Polling inventories\n")
			messageInterface(functions.pollInventories(pluginConfig.scriptOutputFileSubscription));
		}, 10000);
	}
	scriptOutput(data){
		if(data !== null && isJson(data)){
			let inventory = JSON.parse(data);
			// process inventory of players and ask master for more stuff
			functions.handleInventory(inventory, this.config, this.messageInterface);
		}
	}
}
module.exports = inventoryImports;