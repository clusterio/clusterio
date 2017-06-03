const needle = require("needle");
const isJson = require("./isJson.js");
const pluginConfig = require("./config.js");

console.log("/silent-command game.print('UPSdisplay enabled')\n");

setInterval(function(){
	console.log("/silent-command game.write_file('UPSdisplay.txt', game.tick, true, 0)\n");
},1000);
var config = {};
process.stdin.setEncoding('utf8');
let historicalTicks = [];
process.stdin.on('readable', () => {
	var chunk = process.stdin.read();
	if (chunk !== null && isNaN(chunk)){
		// eval because my lua is writing a JS object instead of traditional JSON
		// this was done because I hate escaping strings and there are more quotes
		// in JSON than JS objects.
		let inventory = "";
		eval("inventory = " + chunk);
		console.log(inventory);
	} else if(isJson(chunk) && JSON.parse(chunk).factorioPort){
		config = JSON.parse(chunk);
	}
});
process.stdin.on('end', () => {
	process.stdout.write('end');
});

// poll inventories
setInterval(function(){
	// TODO: Make it work for players other than myself, don't error when inventory does not exist, check logistic request slots
	// console.log("/silent-command "+'local a=game.players["Danielv123"].get_inventory(defines.inventory.player_main).get_contents()local b=game.players["Danielv123"].get_quickbar().get_contents()local c={}local d="{inventory:{"for e,f in pairs(a)do d=d.."['+"'"+'"..e.."'+"'"+']:"..f..","end;for e,f in pairs(b)do d=d.."['+"'"+'"..e.."'+"'"+']:"..f..","end;d=d.."},requestSlots:{"for e,f in pairs(c)do d=d.."['+"'"+'"..e.."'+"'"+']:"..f..","end;d=d.."}}"game.write_file("'+pluginConfig.scriptOutputFileSubscription+'",d)');
	// console.log("Running inventory LUA")
	console.log("/silent-command "+'local a=game.players["Danielv123"].get_inventory(defines.inventory.player_main).get_contents()local b=game.players["Danielv123"].get_quickbar().get_contents()local c={}for d=1,game.players["Danielv123"].force.character_logistic_slot_count do c[d]=game.players["Danielv123"].character.get_request_slot(d)end;local e="{inventory:{"for f,g in pairs(a)do e=e.."['+"'"+'"..f.."'+"'"+']:"..g..","end;for f,g in pairs(b)do e=e.."['+"'"+'"..f.."'+"'"+']:"..g..","end;e=e.."},requestSlots:{"for f,g in pairs(c)do e=e.."['+"'"+'"..g["name"].."'+"'"+']:"..g["count"]..", "end;e=e.."}}"game.write_file("'+pluginConfig.scriptOutputFileSubscription+'",e)')
	/*
	needle.post(config.masterIP+':'+config.masterPort+'/api/editSlaveMeta', {slaveID: config.unique, password: config.clientPassword, meta: {UPS:UPS}}, function(err, resp) {
		// success?
	});
		*/
}, 10000);
