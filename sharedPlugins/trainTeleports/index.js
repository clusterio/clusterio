module.exports = class remoteCommands {
	constructor(mergedConfig, messageInterface, extras){
		this.messageInterface = messageInterface;
		this.config = mergedConfig;
		this.socket = extras.socket;
		setInterval(()=>{
			messageInterface("/c rcon.print('Rcon return data works :D')", data => messageInterface(data));
		},1000);
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
	async scriptOutput(data){
		if(data !== null){
			this.messageInterface(data);
			let parsedData = {};
			data = data.split("|");
			data.forEach(kv => {
				kv = kv.split(":");
				parsedData[kv[0]] = kv[1];
			});
			this.messageInterface(JSON.stringify(parsedData));
			
			let trainstops = await this.getTrainstops();
			if(!trainstops.data) trainstops.data = [];
			if(parsedData.event == "trainstop_added"){
				this.messageInterface(`Adding trainstop ${parsedData.name} at x:${parsedData.x} y:${parsedData.y}`);
				trainstops.data.push(parsedData);
			} else if(parsedData.event == "trainstop_edited"){
				trainstops.data.forEach(trainstop, index => {
					if(trainstop.x == parsedData.x && trainstop.y == parsedData.y){
						this.messageInterface("Renaming trainstop from "+trainstop.name+" to "+parsedData.name);
						trainstop.name = parsedData.name;
					}
				});
			} else if(parsedData.event == "trainstop_removed"){
				trainstops.data.forEach(trainstop, index => {
					if(trainstop.x == parsedData.x && trainstop.y == parsedData.y){
						delete trainstops[index];
					}
				});
			}
		}
	}
	factorioOutput(data){
		console.log(data.replace(/(\r\n\t|\n|\r\t)/gm,""));
	}
}
