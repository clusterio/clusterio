const fs = require("fs-extra");
const path = require("path");
const Express = require("express");
const ejs = require("ejs");

class masterPlugin {
	constructor({config, pluginConfig, pluginPath, socketio, express}){
		this.config = config;
		this.pluginConfig = pluginConfig;
		this.pluginPath = pluginPath;
		this.io = socketio;
		this.app = express;
		
		// load databases
		this.items = getDatabaseSync("database/items.json");
		
		this.clients = {};
		this.slaves = {};
		
		// initialize web API
		// require("./js/api-endpoints.js")(this);
		
		// expose UI elements embedded in the master
		// this.ui = require("./js/ui.js").ui;
		
		this.io.on("connection", socket => {
			
		});
	}
	async broadcastCommand(command){
		let returnValues = [];
		for(let instanceID in this.slaves){
			let slave = this.slaves[instanceID];
			slave.emit("runCommand", {
				// commandID:Math.random(),
				command,
			});
		};
		return returnValues;
	}
	findInArray(key, value, array){
		let indexes = [];
		for(let i in array){
			if(array[i][key] && array[i][key] === value) indexes.push(i);
		}
		return indexes;
	}
	async onExit(){
		// await saveDatabase("database/items.json", this.items);
		return;
	}
}
module.exports = masterPlugin;

function arrayRemoveDuplicates(array){
	let newArray = [];
	array.forEach(value => {
		if(!newArray.includes(value)) newArray.push(value);
	});
	return newArray;
}
function getDatabaseSync(path){
	let db;
	try {
		db = JSON.parse(fs.readFileSync(path, "utf8"));
	} catch(e){
		db = {};
	}
	return db;
}
async function saveDatabase(path, database){
	if(!path){
		throw new Error("No path provided!");
	} else if(!database){
		throw new Error("No database provided!");
	} else {
		try {
			await fs.writeFile(path, JSON.stringify(database, null, 4));
		} catch(e){
			throw new Error("Unable to write to database! "+path);
		}
	}
}
