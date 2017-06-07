const needle = require("needle");
const isJson = require("./isJson.js");
const pluginConfig = require("./config.js");

const functions = require("./interfacingFunctions");

console.log("/silent-command game.print('InventoryImports enabled')\n");

var config = {};
process.stdin.setEncoding('utf8');
process.stdin.on('readable', () => {
	var chunk = process.stdin.read();
	if (chunk !== null && isNaN(chunk) && config && !isJson(chunk)&& !chunk.includes("[")){
		// returns JS object, throws if there are syntax errors in input string
		let inventory = functions.parseJsString(chunk);
		console.log(inventory);
		// process inventory of players and ask master for more stuff
		functions.handleInventory(inventory, config);
	} else if(isJson(chunk) && JSON.parse(chunk).factorioPort){
		config = JSON.parse(chunk);
		// if its a LUA table message returning with the exports send em off to master
	} else if(!isJson(chunk) && !!chunk && config){
		let thing = functions.parseJsString(chunk.replace(/=/g, ":"));
		Object.keys(thing).forEach(function(playerName){
			Object.keys(thing[playerName]).forEach(function(itemName){
				needle.post(config.masterIP + ":" + config.masterPort + '/api/place', {
					name: itemName,
					count: thing[playerName][itemName]
				}, function (err, resp, body) {
					// console.log(body);
				});
			});
		});
	}
});
process.stdin.on('end', () => {
	process.stdout.write('end');
});

// poll inventories
setInterval(function(){
	console.log("Polling inventories")
	console.log(functions.pollInventories(pluginConfig.scriptOutputFileSubscription));
}, 10000);
