const fs = require("fs-extra");
const path = require("path");
const Express = require("express");
const ejs = require("ejs");
const bcrypt = require("bcrypt-promise");
const crypto = require('crypto');
const base64url = require('base64url');
const sanitizer = require('sanitizer');


class masterPlugin {
	constructor({config, pluginConfig, pluginPath, socketio, express}){
		this.config = config;
		this.pluginConfig = pluginConfig;
		this.pluginPath = pluginPath;
		this.io = socketio;
		this.app = express;
		
		// load databases
		// const database = getDatabaseSync("database/playerManager.json");
		// this.whitelist = getDatabaseSync("database/whitelist.json").whitelist || [];
		// this.banlist = getDatabaseSync("database/banlist.json").banlist || [];
		
		// initialize web API
		require("./js/api-endpoints.js")(this);
		
		// expose UI elements embedded in the master
		this.ui = require("./js/ui.js").injectThis(this).ui;
		
		this.serverSockets = {};
		
		this.io.on("connection", socket => {
			let instanceID = "unknown";
			let isServerManager = false;
			socket.on("registerSlave", data => {
				if(data.instanceID && !isNaN(Number(data.instanceID))){
					instanceID = data.instanceID;
					if(isServerManager){
						this.serverSockets[instanceID] = {socket};
						validServerManager({server: this.serverSockets[instanceID]});
					}
				}
			});
			socket.on("registerServerManager", () => {
				isServerManager = true;
				if(instanceID !== "unknown"){
					this.serverSockets[instanceID] = {socket};
					validServerManager({server: this.serverSockets[instanceID]});
				}
				console.log("Registered serverManager socket")
				
				socket.on("disconnect", () => {
					if(this.serverSockets[instanceID]) delete this.serverSockets[instanceID];
					console.log(`serverManager ${instanceID} disconnected, ${(Object.keys(this.serverSockets).length)} left`);
				});
			});
			socket.on("gameChat", async data => {
				// let chatLine = data.data.replace(/(\r\n\t|\n|\r\t)/gm, "").replace("\r", "");
				// if(typeof chatLine == "string") this.handleChatLine(chatLine, instanceID);
			});
		});
		let validServerManager = ({server}) => {
			server.socket.emit("serverManagerGetPlugins", {}, data => {
				server.plugins = data;
			});
		}
		
		// I can't seem to get express static pages + ejs rendering to work properly, so I write my own thing.
		let pages = [
			{
				addr: "/serverManager",
				path: path.join(__dirname,"static/index.html"),
				render: ejs
			},
		]
		pages.forEach(page => {
			this.app.get(page.addr, async (req,res) => {
				if(page.render){
					if((req.query.token || req.cookies.token) && this.playerManager){
						var permissions = await this.playerManager.main.getPermissions((req.query.token || req.cookies.token));
					} else {
						var permissions = {};
					}
					page.render.renderFile(page.path, {
						permissions,
						serverManager: this,
						req: req,
					}, async (err, prom) => {
						if(err) console.log(err);
						let str = await prom;
						res.send(str);
					});
				} else {
					res.send(await fs.readFile(page.path));
				}
			});
		});
		this.app.use('/serverManager', Express.static(path.join(__dirname, 'static')));
	}
	findInArray(key, value, array){
		let indexes = [];
		for(let i in array){
			if(array[i][key] && array[i][key] === value) indexes.push(i);
		}
		return indexes;
	}
	async onExit(){
		// await saveDatabase("database/banlist.json", {banlist: this.banlist});
		return;
	}
	async onLoadFinish({plugins}){
		this.masterPlugins = plugins;
		plugins.forEach(plugin => {
			if(plugin.pluginConfig.name == "playerManager"){
				this.playerManager = plugin;
			}
		});
	}
	async onPlayerManagerGetPermissions({permissions, user}){
		if(user
		&& user.admin){
			permissions.cluster.push("addPlugin");
			permissions.cluster.push("removePlugin");
			permissions.cluster.push("enablePlugin");
			permissions.cluster.push("disablePlugin");
			permissions.cluster.push("readConfig");
			permissions.cluster.push("writeConfig");
		}
		return permissions;
	}
}
module.exports = masterPlugin;

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
