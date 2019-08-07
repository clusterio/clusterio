/**

class factorioServer

This class has the responsiblity of :

* spawning a factorio server
* Handling input via stdin or RCON


*/

const fs = require("fs");
const child_process = require("child_process");
const path = require("path");

const mkdirp = require("mkdirp");

const fileOps = require("lib/fileOps");

module.exports = class factorioServer {
	constructor({
		factorioDirectory = "factorio",
		instanceDirectory = "instances/data",
		instanceName = "Default server name",
		factorioPort = Math.floor(Math.random() * 65535),
		serversettings = {},
		onProgress = function(type, a, b, c){
			if(type == "progress") console.log("Progress: ",a," of ",b," unit: ",c);
			if(type == "log") console.log(a);
		},
	} = {}){
		this.factorioDirectory = factorioDirectory;
		this.instanceDirectory = instanceDirectory;
		this.instanceName = instanceName;
		this.factorioPort = factorioPort;
		this.serversettings = Object.assign({
			"name": "Clusterio instance: " + this.instanceName,
			"description": "Public factorio server running clusterio",
			"tags": ["clusterio"],
			"max_players": "20",
			"visibility": "public",
			"username": "",
			"token": "",
			"game_password": "",
			"verify_user_identity": true,
			"admins": ["Danielv123"],
			"allow_commands": true,
			"autosave_interval": 10,
			"autosave_slots": 5,
			"afk_autokick_interval": 0,
			"auto_pause": false,
		}, serversettings);
		this.onProgress = (type, a, b, c) => {
			if(typeof onProgress == "function") onProgress(type, a, b, c);
		};
	}
	async initialize(){
		if(!await this.isValidInstance()){
			await this.createInstance();
		}
		return true;
	}
	async createInstance(path = this.instanceDirectory){
		if(await this.isValidInstance(path)){
			throw new Error("Instance already exists!");
		}
		
		// create folders
		let folders = [
			"/script-output/",
			"/saves/",
			"/mods/",
			"/instanceMods/",
		];
		mkdirp.sync(path);
		folders.forEach(folder => mkdirp.sync(path + folder));
		
		// create files
		let files = [
			{name: "/script-output/output.txt", content: ""},
			{name: "/script-output/orders.txt", content: ""},
			{name: "/script-output/txbuffer.txt", content: ""},
			{name: "/config.ini", content: "[path]\r\n\ read-data=__PATH__executable__/../../data\r\n\ write-data=__PATH__executable__/../../../" + this.instanceDirectory + "\r\n\ "},
			{name: "/config.json", content: JSON.stringify({
				factorioPort: this.factorioPort,
				clientPassword: Math.random().toString(36).replace(/[^a-z]+/g, '').substr(0, 8),
			}, null, 4)},
			{name: "/server-settings.json", content: JSON.stringify(this.serversettings, null, 4)},
		];
		files.forEach(file => {
			fs.writeFile(path + file.name, file.content, doneWritingHandler);
			// console.log("Created: ",path+file.name);
		});
		
		let filesToWrite = files.length;
		function doneWritingHandler(){
			if(!--filesToWrite){
				return path;
			}
		}
	}
	async deleteInstance(path = this.instanceDirectory){
		if(await this.isValidInstance(path)){
			await fileOps.deleteFolderRecursive(path);
			return true;
		} else {
			return false;
		}
	}
	isValidInstance(path = this.instanceDirectory){
		return new Promise((resolve, reject) => {
			fs.stat(path, (err, stat) => {
				if(err){
					// console.log(err)
					resolve(false);
				} else {
					// the instance folder exists, do some more checks
					fs.readdir(path, (err, files) => {
						if(files && Array.isArray(files)){
							let foldersThatShouldBeThere = [
								"script-output",
								"saves",
								"mods",
								"instanceMods",
							];
							let instanceValidity = true;
							foldersThatShouldBeThere.forEach(folder => {
								if(!files.includes(folder)){
									instanceValidity = false;
								}
							});
							resolve(instanceValidity);
						}
					});
				}
			});
		});
	}
	createMap(name = "map.zip"){
		return new Promise((resolve, reject) => {
			this.isValidInstance().then(isValid => {
				if(!isValid){
					return createInstance();
				}
			}).then(()=>{
				this.onProgress("log", "Starting map creation");
				// console.log(this.factorioDirectory + '/bin/x64/factorio')
				let proc = child_process.spawn(
					path.join(this.factorioDirectory, 'bin', 'x64', 'factorio'), [
						'-c', path.join(this.instanceDirectory,'config.ini'),
						'--create', path.join(this.instanceDirectory, 'saves',name),
						'--server-settings', path.join(this.instanceDirectory, 'server-settings.json'),
					],{
						cwd:process.cwd(),
					}
				);
				// console.log(proc.stdout.toString("utf8"));
				proc.stdout.on("data", data => this.onProgress("log", data.toString("utf8")));
				proc.on("close", code => {
					this.onProgress("log", "Map created! "+code);
					resolve();
				});
			});
		});
	}
}
