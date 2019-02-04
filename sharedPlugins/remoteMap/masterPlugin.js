const fs = require("fs-extra");
const path = require("path");
const sanitizer = require('sanitizer');

const editorSockets = [];

class masterPlugin {
	constructor({ config, pluginConfig, pluginPath, socketio, express }) {
		this.config = config;
		this.pluginConfig = pluginConfig;
		this.pluginPath = pluginPath;
		this.io = socketio;
		this.app = express;
		
		this.clients = {};
		this.slaves = {};
		
		// initialize token auth module
		this.authenticate = require("./../../lib/authenticate.js")(config);

		// expose UI elements embedded in the master
		//this.ui = require("./js/ui.js").ui;

		// handle websocket connections
		this.io.on("connection", socket => {
			let instanceID = "unknown";
			socket.on("registerSlave", data => {
				if (data.instanceID && !isNaN(Number(data.instanceID))) {
					instanceID = data.instanceID;
					this.slaves[instanceID] = socket;
				}
				socket.on("updateEntities", data => {
					console.log(data)
					if(data){
						// transform from weirdly deliminated string to entity object
						let entities = data
						.split("\n")
						.filter(str => str.length > 0)
						.map(ent => ent.replace(/[-]/g, "_"))											// replace - with _
						.map(str => str
							.split(",")
							.filter(x => x.length > 0)
							.map(prop => ({
								k: prop.split("=")[0],
								v: prop.split("=")[1]})
							)
						)
						.map(arr => {
							let obj = {}
							arr.forEach(property => obj[property.k] = property.v)
							return obj
						})
						console.log(entities)
						editorSockets.forEach(sock => sock.emit("updateEntity", {entities}))
					}
				})
			});
			socket.on("registerMapEditor", () => {
				console.log("Registered mapEditor socket")
				editorSockets.push(socket);
				
				setTimeout(()=>socket.emit("createEntity", {entity:{
					name:"fast_inserter",
					position: {x:30,y:30},
					direction: 2,
				}}),10000)
				
				socket.on("createEntity", data => {
					this.slaves[Object.keys(this.slaves)[0]].emit("createEntity", data.entity)
				})
				socket.on("deleteEntity", data => {
					this.slaves[Object.keys(this.slaves)[0]].emit("deleteEntity", data.entity)
				})
				socket.on("getChunk", (data, callback) => {
					this.slaves[Object.keys(this.slaves)[0]].emit("getChunk", data, resp => {
						// parse response
						// |name:transport-belt,direction:2,x:99,y:1231|name:assembly-machine,direction:6,x:939,y:88
						console.log(resp)
						callback(resp
							.split("|")																	// split into entities
							.map(str => str.replace("\n",""))											// remove newlines that happen at the end of the last entity (maybe more as well???)
							.filter(str => str.length > 0)												// remove blank entities
							.filter(str => !str.includes("tree") &&										// don't send entities that can't be rendered anyways
							!str.includes("dead") &&
							!str.includes("rock") &&
							!str.includes("crude-oil") &&
							!str.includes("remnants") &&
							!str.includes("cliff") &&
							!str.includes("player") &&
							!str.includes("ore"))
							.map(ent => ent.replace(/[-]/g, "_"))										// replace - with _
							.map(ent => ent.split(",")													// split entity into properties
								.map(prop => [prop.split(":")[0], prop.split(":")[1]])					// split properties into KV pairs
							)
							.map(entity => {															// turn entities into objects
								let entityObj = {}
								entity.forEach(property => entityObj[property[0]] = property[1])
								return entityObj
							})
							.filter(entity => Object.keys(entity).length > 1)
						)
					})
				})
				
				socket.on("disconnect", function () {
					let i = editorSockets.indexOf(socket);
					console.log("editorSocket " + (i + 1) + " disconnected, " + (editorSockets.length - 1) + " left");
					editorSockets.splice(i, 1);
				});
			});
			socket.on("gameChat", async data => {
				let chatLine = data.data.replace(/(\r\n\t|\n|\r\t)/gm, "").replace("\r", "");
				//if (typeof chatLine == "string") this.handleChatLine(chatLine, instanceID);
			});
		});

	}
	async onExit() {
		return;
	}
	async onLoadFinish({ plugins }) {
		this.masterPlugins = plugins;
	}
	parseData(data, sharedData = {}) {
		let parsedData = [];
		data = data.split("|");
		data.forEach(player => {
			if (player) {
				let playerData = {};
				player = player.split(`~`);
				player.forEach(kv => {
					kv = kv.split(":");
					if (kv[1] === undefined || kv[0] === undefined) {
						console.log(new Error(`Something is wrong! Key:${kv[0]} Value:${kv[1]}`));
					} else {
						playerData[kv[0]] = kv[1].trim();
					}
				});
				for (let k in sharedData) {
					playerData[k] = sharedData[k];
				}
				parsedData.push(playerData);
			}
		});
		return parsedData;
	}
}
module.exports = masterPlugin;

function getDatabaseSync(path) {
	let db;
	try {
		db = JSON.parse(fs.readFileSync(path, "utf8"));
	} catch (e) {
		db = {};
	}
	return db;
}
async function saveDatabase(path, database) {
	if (!path) {
		throw new Error("No path provided!");
	} else if (!database) {
		throw new Error("No database provided!");
	} else {
		try {
			await fs.writeFile(path, JSON.stringify(database, null, 4));
		} catch (e) {
			throw new Error("Unable to write to database! " + path);
		}
	}
}
