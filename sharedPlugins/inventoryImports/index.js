const needle = require("needle");
const isJson = require("./isJson.js");
const pluginConfig = require("./config.js");
const objectOps = require("../../lib/objectOps.js");

console.log("/silent-command game.print('InventoryImports enabled')\n");

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
		/* Example output: 
		{'1':{
			inventory: {
				'raw-wood': 4
			},
			requestSlots:{
				'underground-belt': 50,
				'fast-transport-belt': 50,
				'express-underground-belt': 50
		}}}
		*/
		console.log(inventory);
		// we want to seperate players, parse their inventory and compare to request slots
		// then ask master for the difference
		// we must then prepare it all and inject it into players inventories with lua before
		// the next inventory report arrives to avoid duplicating orders
		if(inventory && typeof inventory != "string"){
			let players = Object.keys(inventory);
			for(let i = 0; i < players.length; i++) {
				let pinv = inventory[players[i]];
				// create a copy of player.requestSlots
				let toRequest = objectOps.deepclone(pinv.requestSlots);
				// subtract items already in inventory
				Object.keys(pinv.inventory).forEach(function(key){
					let itemCount = pinv.inventory[key];
					if(toRequest[key]){
						toRequest[key] -= itemCount;
					}
					let request = {
						name:key,
						count:toRequest[key],
					}
					// request the difference from master
					needle.post(config.masterIP + ":" + config.masterPort + '/api/remove', request, function (err, response, body) {
						if (response && response.body && typeof response.body == "object") {
							// confirmed orders, already removed from master inventory
							//response.body.name: response.body.count
							
						}
					});
				});
				
			}
		}
		
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
	//console.log("/silent-command "+'local a=game.players["Danielv123"].get_inventory(defines.inventory.player_main).get_contents()local b=game.players["Danielv123"].get_quickbar().get_contents()local c={}for d=1,game.players["Danielv123"].force.character_logistic_slot_count do c[d]=game.players["Danielv123"].character.get_request_slot(d)end;local e="{inventory:{"for f,g in pairs(a)do e=e.."['+"'"+'"..f.."'+"'"+']:"..g..","end;for f,g in pairs(b)do e=e.."['+"'"+'"..f.."'+"'"+']:"..g..","end;e=e.."},requestSlots:{"for f,g in pairs(c)do e=e.."['+"'"+'"..g["name"].."'+"'"+']:"..g["count"]..", "end;e=e.."}}"game.write_file("'+pluginConfig.scriptOutputFileSubscription+'",e)')
	// console.log("/silent-command "+'local a="{"for b,c in pairs(game.players)do local d=game.players[b].get_inventory(defines.inventory.player_main).get_contents()local e=game.players[b].get_quickbar().get_contents()local f={}for g=1,game.players[b].force.character_logistic_slot_count do f[g]=game.players[b].character.get_request_slot(g)end;a=a..b..":{inventory:{"for h,i in pairs(d)do a=a.."['+"'"+'"..h.."'+"'"+']:"..i..","end;for h,i in pairs(e)do a=a.."['+"'"+'"..h.."'+"'"+']:"..i..","end;a=a.."},requestSlots:{"for h,i in pairs(f)do a=a.."['+"'"+'"..i["name"].."'+"'"+']:"..i["count"]..", "end;a=a.."}},"end;a=a.."}"game.write_file("'+pluginConfig.scriptOutputFileSubscription+'",a)')
	console.log("/silent-command "+'local a="{"for b,c in pairs(game.players)do if c.connected then local d=game.players[b].get_inventory(defines.inventory.player_main).get_contents()local e=game.players[b].get_quickbar().get_contents()local f={}for g=1,game.players[b].force.character_logistic_slot_count do f[g]=game.players[b].character.get_request_slot(g)end;a=a..b..":{inventory:{"for h,i in pairs(d)do a=a.."['+"'"+'"..h.."'+"'"+']:"..i..","end;for h,i in pairs(e)do a=a.."['+"'"+'"..h.."'+"'"+']:"..i..","end;a=a.."},requestSlots:{"for h,i in pairs(f)do a=a.."['+"'"+'"..i["name"].."'+"'"+']:"..i["count"]..", "end;a=a.."}},"end end;a=a.."}"game.write_file("'+pluginConfig.scriptOutputFileSubscription+'",a)')
	/*
	needle.post(config.masterIP+':'+config.masterPort+'/api/editSlaveMeta', {slaveID: config.unique, password: config.clientPassword, meta: {UPS:UPS}}, function(err, resp) {
		// success?
	});
		*/
}, 10000);
