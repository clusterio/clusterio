const objectOps = require("../../lib/objectOps.js");
const needle = require("needle");

// returns JS object, throws if there are syntax errors in input string
function parseJsString(string){
	// eval because my lua is writing a JS object instead of traditional JSON
	// this was done because I hate escaping strings and there are more quotes
	// in JSON than JS objects.
	
	// since eval is unsafe, maybe use https://www.npmjs.com/package/eval-sanitizer
	if(string.includes("require") || string.includes(";") || string.includes("eval")){
		throw "parseJsString might have gotten something that could be a xss attempt";
	}
	let inventory = "";
	eval("inventory = " + string);
	console.log(string)
	console.log(inventory)
	return inventory;
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
}
function handleInventory(inventory, config){
	// we want to seperate players, parse their inventory and compare to request slots
	// then ask master for the difference
	// we must then prepare it all and inject it into players inventories with lua before
	// the next inventory report arrives to avoid duplicating orders
	if(inventory && typeof inventory != "string" && typeof inventory == "object"){
		let exports = {};
		let players = Object.keys(inventory);
		for(let i = 0; i < players.length; i++) {
			let pinv = inventory[players[i]];
			// create a copy of player.requestSlots
			let toRequest = objectOps.deepclone(pinv.requestSlots);
			// create a place to store the object we have confirmed for importing
			let confirmedItems = {};
			let itemsToConfirm = Object.keys(pinv.inventory).length;
			
			// subtract items already in inventory
			Object.keys(pinv.inventory).forEach(function(key){
				let itemCount = pinv.inventory[key];
				if(toRequest[key]){
					toRequest[key] -= itemCount;
				}
				if(toRequest[key] > 0){
					let request = {
						name:key,
						count:toRequest[key],
					}
					// request the difference from master
					needle.post(config.masterIP + ":" + config.masterPort + '/api/remove', request, function (err, response, body) {
						if (response && response.body && typeof response.body == "object") {
							// confirmed orders, already removed from master inventory
							//response.body.name: response.body.count
							let stack = {name:response.body.name,count:response.body.count}
							collectStacks(stack);
						} else {
							collectStacks(false);
						}
					});
				}
			});
			function collectStacks(stack){
				itemsToConfirm--;
				if(stack){
					if(confirmedItems[stack.name]){
						confirmedItems[stack.name] += stack.count;
					} else {
						confirmedItems[stack.name] = stack.count;
					}
				}
				if(itemsToConfirm <= 0){
					// make lua table
					// we gotta construct a string because I can't find any nice library for this
					let itemTable = "{";
					Object.keys(confirmedItems).forEach(function(name){
						let count = confirmedItems[name];
						itemTable += '["'+name+'"]='+count+',';
					});
					itemTable += "}";
					
					console.log('/c local a="'+players[i]+'"local b='+itemTable+'local c={}if game.players[a]and game.players[a].connected then for d,e in pairs(b)do local f=game.players[a].insert{name=d,count=e}if not c[a]then c[a]={}end;if c[a][d]then c[a][d]=c[a][d]+e-f else c[a][d]=e-f end end;game.write_file("'+outputFile+'",serpent.line(c,{["comment"]=false,["compact"]=true}))end');
				}
			}
			
			// handle exports (why would they be there? I don't know!)
			if(pinv.exports){
				Object.keys(pinv.exports).forEach(function(name){
					if(exports[name]){
						exports[name] += pinv.exports[name];
					} else {
						exports[name] = pinv.exports[name];
					}
				});
			}
		}
		
		// keep handling exports here, now we send em off
		Object.keys(exports).forEach(function(name){
			needle.post(config.masterIP + ":" + config.masterPort + '/api/place', {
				name: name,
				count: exports[name]
			}, function (err, resp, body) {
				// console.log(body);
			});
		});
	} else return false; // inventory is falsey or a string
}
function pollInventories(outputFile){
	// console.log("/silent-command "+'local a=game.players["Danielv123"].get_inventory(defines.inventory.player_main).get_contents()local b=game.players["Danielv123"].get_quickbar().get_contents()local c={}local d="{inventory:{"for e,f in pairs(a)do d=d.."['+"'"+'"..e.."'+"'"+']:"..f..","end;for e,f in pairs(b)do d=d.."['+"'"+'"..e.."'+"'"+']:"..f..","end;d=d.."},requestSlots:{"for e,f in pairs(c)do d=d.."['+"'"+'"..e.."'+"'"+']:"..f..","end;d=d.."}}"game.write_file("'+pluginConfig.scriptOutputFileSubscription+'",d)');
	// console.log("Running inventory LUA")
	//console.log("/silent-command "+'local a=game.players["Danielv123"].get_inventory(defines.inventory.player_main).get_contents()local b=game.players["Danielv123"].get_quickbar().get_contents()local c={}for d=1,game.players["Danielv123"].force.character_logistic_slot_count do c[d]=game.players["Danielv123"].character.get_request_slot(d)end;local e="{inventory:{"for f,g in pairs(a)do e=e.."['+"'"+'"..f.."'+"'"+']:"..g..","end;for f,g in pairs(b)do e=e.."['+"'"+'"..f.."'+"'"+']:"..g..","end;e=e.."},requestSlots:{"for f,g in pairs(c)do e=e.."['+"'"+'"..g["name"].."'+"'"+']:"..g["count"]..", "end;e=e.."}}"game.write_file("'+pluginConfig.scriptOutputFileSubscription+'",e)')
	// console.log("/silent-command "+'local a="{"for b,c in pairs(game.players)do local d=game.players[b].get_inventory(defines.inventory.player_main).get_contents()local e=game.players[b].get_quickbar().get_contents()local f={}for g=1,game.players[b].force.character_logistic_slot_count do f[g]=game.players[b].character.get_request_slot(g)end;a=a..b..":{inventory:{"for h,i in pairs(d)do a=a.."['+"'"+'"..h.."'+"'"+']:"..i..","end;for h,i in pairs(e)do a=a.."['+"'"+'"..h.."'+"'"+']:"..i..","end;a=a.."},requestSlots:{"for h,i in pairs(f)do a=a.."['+"'"+'"..i["name"].."'+"'"+']:"..i["count"]..", "end;a=a.."}},"end;a=a.."}"game.write_file("'+pluginConfig.scriptOutputFileSubscription+'",a)')
	return "/silent-command "+'local a="{"for b,c in pairs(game.players)do if c.connected then local d=game.players[b].get_inventory(defines.inventory.player_main).get_contents()local e=game.players[b].get_quickbar().get_contents()local f={}for g=1,game.players[b].force.character_logistic_slot_count do f[g]=game.players[b].character.get_request_slot(g)end;a=a..b..":{inventory:{"for h,i in pairs(d)do a=a.."['+"'"+'"..h.."'+"'"+']:"..i..","end;for h,i in pairs(e)do a=a.."['+"'"+'"..h.."'+"'"+']:"..i..","end;a=a.."},requestSlots:{"for h,i in pairs(f)do a=a.."['+"'"+'"..i["name"].."'+"'"+']:"..i["count"]..", "end;a=a.."}},"end end;a=a.."}"game.write_file("'+outputFile+'",a)'
	/*
	needle.post(config.masterIP+':'+config.masterPort+'/api/editSlaveMeta', {slaveID: config.unique, password: config.clientPassword, meta: {UPS:UPS}}, function(err, resp) {
		// success?
	});
	*/
}

module.exports = {
	handleInventory: handleInventory,
	parseJsString: parseJsString,
	pollInventories: pollInventories,
}