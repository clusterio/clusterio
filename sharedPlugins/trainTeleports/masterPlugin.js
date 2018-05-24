/*jslint esnext:true*/

class trainTeleporter{
	constructor({socket, instanceID, master}){
		this.socket = socket;
		this.instanceID = instanceID;
		this.master = master;
		
		(async () => {
			this.socket.on("trainstop_added", data => {
				await this.addTrainstop(data);
				console.log("trainstop_added: "+data.name);
			});
			this.socket.on("trainstop_edited", data => {
				await this.removeTrainstop(data);
				await this.addTrainstop(data);
				console.log("trainstop_edited: "+data.name);
			});
			this.socket.on("trainstop_removed", data => {
				await this.removeTrainstop(data);
				console.log("trainstop_removed: "+data.name);
			});
		})();
	}
	async addTrainstop({x, y, name}){
		let trainstops = await this.master.getTrainstops();
		if(!trainstops[name]) trainstops[name] = {name, stops:[]};
		trainstops[data.name].stops.push({x,y});
		return true;
	}
	async removeTrainstop({x, y, name}){
		let trainstops = await this.master.getTrainstops();
		if(!trainstops[name]) return true;
		
		trainstops.data.forEach(trainstop, index => {
			if(trainstop.x == x && trainstop.y == y){
				delete trainstops[index];
			}
		});
		resolve(true);
	}
}

class masterPlugin {
	constructor({config, pluginConfig, path, socketio, express}){
		this.config = config;
		this.pluginConfig = pluginConfig;
		this.pluginPath = path;
		this.io = socketio;
		this.express = express;
		
		this.clients = {};
		this.io.on("connection", socket => {
			socket.on("registerTrainTeleporter", data => {
				this.clients[data.instanceID] = new trainTeleporter({
					master:this,
					instanceID: data.instanceID,
					socket,
				});
			});
		});
	}
	getTrainstops(){
		return new Promise((resolve, reject) => {
			if(this.trainstopsDatabase){
				resolve(this.trainstopsDatabase);
			} else {
				fs.readFile("trainstopsDatabase.db", (err, data) => {
					if(err){
						resolve({});
					} else {
						this.trainstopsDatabase = JSON.parse(data);
						resolve(this.trainstopsDatabase);
					}
				});
			}
		});
	}
	saveTrainstops(){
		return new Promise((resolve, reject) => {
			if(this.trainstopsDatabase){
				fs.writeFile("trainstopsDatabase.db", JSON.stringify(this.trainstopsDatabase, null, 4), (err, data) => {
					if(err){
						reject(err);
					} else {
						resolve("Database successfully saved");
					}
				});
			} else {
				resolve("Nothing to save");
			}
		});
	}
}
module.exports = masterPlugin;
