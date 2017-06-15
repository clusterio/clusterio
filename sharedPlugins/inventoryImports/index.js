const needle = require("needle");
const isJson = require("./isJson.js");
const pluginConfig = require("./config.js");

const functions = require("./interfacingFunctions");

console.log("/silent-command game.print('InventoryImports enabled')");

var config = {};
process.stdin.setEncoding('utf8');
process.stdin.on('readable', () => {
	var chunk = process.stdin.read();
	// console.log(chunk)
	if (chunk !== null && isNaN(chunk) && config && isJson(chunk) && !JSON.parse(chunk).factorioPort){
		
		let inventory = JSON.parse(chunk)
		// process inventory of players and ask master for more stuff
		functions.handleInventory(inventory, config);
	} else if(isJson(chunk) && JSON.parse(chunk).factorioPort){
		config = JSON.parse(chunk);
	}
});
process.stdin.on('end', () => {
	process.stdout.write('end');
});

// poll inventories
setInterval(function(){
	// console.log("Polling inventories\n")
	console.log(functions.pollInventories(pluginConfig.scriptOutputFileSubscription));
}, 10000);
