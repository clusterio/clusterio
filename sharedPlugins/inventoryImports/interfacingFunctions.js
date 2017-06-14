const objectOps = require("../../lib/objectOps.js");
const needle = require("needle");
const pluginConfig = require("./config")

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
	/*console.log(string)
	console.log(inventory)*/
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
function handleInventory(json, config){
	/*
	json is one of these two samples
	{"players":{"1":{"inventory":{"stone":12,"iron-ore":120,"raw-wood":10,"iron-plate":8,"steel-plate":480},"requestSlots":{}}}}
	{"exports":{"1":[{"name":"iron-ore","count":0},{"name":"steel-plate","count":0}]}}
	
	we want to seperate players, parse their json and compare to request slots
	then ask master for the difference
	we must then prepare it all and inject it into players inventories with lua before
	the next json report arrives to avoid duplicating orders
	*/
	if(json && typeof json != "string" && typeof json == "object"){
		let exports = {};
		
		// this is an inventory report, check whats missing and request from master
		// {"players":{"1":{"inventory":{"stone":12,"iron-ore":120,"raw-wood":10,"iron-plate":8,"steel-plate":480},"requestSlots":{}}}}
		if(json.players){
			let playerNames = Object.keys(json.players);
			for(let i = 0; i < playerNames.length; i++) {
				// haha, this turned into bit of a mess didn't it?
				let playerInv = json.players[playerNames[i]];
				// create a copy of player.requestSlots
				let toRequest = objectOps.deepclone(playerInv.requestSlots);
				let inventory = playerInv.inventory;
				let itemsToConfirm = Object.keys(toRequest).length;
				// create a place to store the object we have confirmed for importing
				let confirmedItems = {};
				let collectStacks = function(stack){
					itemsToConfirm--;
					if(stack){
						if(confirmedItems[stack.name]){
							confirmedItems[stack.name] += stack.count;
						} else {
							confirmedItems[stack.name] = stack.count;
						}
					}
					if(itemsToConfirm == 0 && Object.keys(confirmedItems).length > 0){
						// make lua table
						// we gotta construct a string because I can't find any nice library for this
						let itemTable = "{";
						Object.keys(confirmedItems).forEach(function(name){
							let count = confirmedItems[name];
							itemTable += '["'+name+'"]='+count+',';
						});
						itemTable += "}";
						let outputFile = pluginConfig.scriptOutputFileSubscription;
						// a="'+players[i]+'"
						// b='+itemTable+'
						console.log('/silent-command local a="'+playerNames[i]+'"local b='+itemTable+'local c={}if game.players[a]and game.players[a].connected then local d='+"'"+'{"exports":{"'+"'"+'..a..'+"'"+'":['+"'"+'local e=false;for f,g in pairs(b)do local h=game.players[a].insert{name=f,count=g}if e then d=d..'+"'"+','+"'"+'else e=true end;d=d..'+"'"+'{"name":"'+"'"+'..f..'+"'"+'","count":'+"'"+'..g-h..'+"'"+'}'+"'"+'end;d=d..'+"'"+']}}'+"'"+'game.write_file("'+outputFile+'",d)end');
					}
				}
				// subtract items already in inventory
				Object.keys(playerInv.requestSlots).forEach(function(key){
					// if this item in inventory is also in a request slot, subtract invCount from requestCount
					if(inventory[key]){
						toRequest[key] -= inventory[key];
					}
					// if the difference is more than 0, request item from master
					if(toRequest[key] > 0){
						let request = {
							name:key,
							count:toRequest[key],
						}
						//console.log("Requesting: "+JSON.stringify(request));
						// request the difference from master
						needle.post(config.masterIP + ":" + config.masterPort + '/api/remove', request, function (err, response, body) {
							if (response && response.body && typeof response.body == "object") {
								// confirmed orders, already removed from master inventory
								//response.body.name: response.body.count
								let stack = {name:response.body.name,count:Number(response.body.count)}
								collectStacks(stack);
							} else {
								collectStacks(false);
							}
						});
					} else {
						collectStacks(false);
					}
				});
			}
		}
		// {"exports":{"1":[{"name":"iron-ore","count":0},{"name":"steel-plate","count":0}]}}
		// this is a report of stuff we didn't have space for, send back to master
		if(json.exports){
			// loop over players (normally only one, but whatever)
			Object.keys(json.exports).forEach(function(playerName){
				// loop over simpleItemStacks to export
				let stackArray = json.exports[playerName];
				for(let i = 0; i < stackArray.length; i++){
					if(stackArray[i].count > 0){
						// console.log("Returning overflow: " + JSON.stringify(stackArray[i]));
						needle.post(config.masterIP + ":" + config.masterPort + '/api/place', stackArray[i], function (err, resp, body) {
							// console.log(body);
						});
					}
				}
			});
		}
	} else return false; // inventory is falsey or a string
}
function pollInventories(outputFile){
	// console.log("/silent-command "+'local a=game.players["Danielv123"].get_inventory(defines.inventory.player_main).get_contents()local b=game.players["Danielv123"].get_quickbar().get_contents()local c={}local d="{inventory:{"for e,f in pairs(a)do d=d.."['+"'"+'"..e.."'+"'"+']:"..f..","end;for e,f in pairs(b)do d=d.."['+"'"+'"..e.."'+"'"+']:"..f..","end;d=d.."},requestSlots:{"for e,f in pairs(c)do d=d.."['+"'"+'"..e.."'+"'"+']:"..f..","end;d=d.."}}"game.write_file("'+pluginConfig.scriptOutputFileSubscription+'",d)');
	// console.log("Running inventory LUA")
	//console.log("/silent-command "+'local a=game.players["Danielv123"].get_inventory(defines.inventory.player_main).get_contents()local b=game.players["Danielv123"].get_quickbar().get_contents()local c={}for d=1,game.players["Danielv123"].force.character_logistic_slot_count do c[d]=game.players["Danielv123"].character.get_request_slot(d)end;local e="{inventory:{"for f,g in pairs(a)do e=e.."['+"'"+'"..f.."'+"'"+']:"..g..","end;for f,g in pairs(b)do e=e.."['+"'"+'"..f.."'+"'"+']:"..g..","end;e=e.."},requestSlots:{"for f,g in pairs(c)do e=e.."['+"'"+'"..g["name"].."'+"'"+']:"..g["count"]..", "end;e=e.."}}"game.write_file("'+pluginConfig.scriptOutputFileSubscription+'",e)')
	// console.log("/silent-command "+'local a="{"for b,c in pairs(game.players)do local d=game.players[b].get_inventory(defines.inventory.player_main).get_contents()local e=game.players[b].get_quickbar().get_contents()local f={}for g=1,game.players[b].force.character_logistic_slot_count do f[g]=game.players[b].character.get_request_slot(g)end;a=a..b..":{inventory:{"for h,i in pairs(d)do a=a.."['+"'"+'"..h.."'+"'"+']:"..i..","end;for h,i in pairs(e)do a=a.."['+"'"+'"..h.."'+"'"+']:"..i..","end;a=a.."},requestSlots:{"for h,i in pairs(f)do a=a.."['+"'"+'"..i["name"].."'+"'"+']:"..i["count"]..", "end;a=a.."}},"end;a=a.."}"game.write_file("'+pluginConfig.scriptOutputFileSubscription+'",a)')
	//return "/silent-command "+'local a="{"for b,c in pairs(game.players)do if c.connected then local d=game.players[b].get_inventory(defines.inventory.player_main).get_contents()local e=game.players[b].get_quickbar().get_contents()local f={}for g=1,game.players[b].force.character_logistic_slot_count do f[g]=game.players[b].character.get_request_slot(g)end;a=a..b..":{inventory:{"for h,i in pairs(d)do a=a.."['+"'"+'"..h.."'+"'"+']:"..i..","end;for h,i in pairs(e)do a=a.."['+"'"+'"..h.."'+"'"+']:"..i..","end;a=a.."},requestSlots:{"for h,i in pairs(f)do a=a.."['+"'"+'"..i["name"].."'+"'"+']:"..i["count"]..", "end;a=a.."}},"end end;a=a.."}"game.write_file("'+outputFile+'",a)'
	return '/silent-command '+'local a='+"'"+'{"players":{'+"'"+'local b=false;for c,d in pairs(game.players)do if d.connected then if b then a=a..'+"'"+','+"'"+'else b=true end;local e=game.players[c].get_inventory(defines.inventory.player_main).get_contents()local f=game.players[c].get_quickbar().get_contents()local g={}for h=1,game.players[c].force.character_logistic_slot_count do g[h]=game.players[c].character.get_request_slot(h)end;a=a..'+"'"+'"'+"'"+'..c..'+"'"+'":{"inventory":{'+"'"+'local i=false;for j,k in pairs(e)do if i then a=a..'+"'"+','+"'"+'else i=true end;a=a..'+"'"+'"'+"'"+'..j..'+"'"+'":'+"'"+'..k end;for j,k in pairs(f)do if i then a=a..'+"'"+','+"'"+'else i=true end;a=a..'+"'"+'"'+"'"+'..j..'+"'"+'":'+"'"+'..k end;a=a..'+"'"+'},"requestSlots":{'+"'"+'i=false;for j,k in pairs(g)do if i then a=a..'+"'"+','+"'"+'else i=true end;a=a..'+"'"+'"'+"'"+'..k['+"'"+'name'+"'"+']..'+"'"+'":'+"'"+'..k['+"'"+'count'+"'"+']end;a=a..'+"'"+'}}'+"'"+'end end;a=a.."}}"game.write_file("'+outputFile+'",a)'
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