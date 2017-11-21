var mkdirp = require("mkdirp-promise");
var mkdirpSync = require("mkdirp").sync;
var fs = require("fs");

let allowLogging = true;
let log = string => (allowLogging)? console.log(string):""

module.exports = class chunkStore {
	constructor(name, chunkSize = 32, path = "./chunkStore/"){
		this.name = name;
		this.chunkSize = chunkSize;
		this.path = (path[path.length] == "/") ? path : path+"/";
		mkdirpSync(path+name);
	}
	setEntity(x, y, newEntity){
		return new Promise((resolve, reject) => {
			localX = Math.round(x % this.chunkSize);
			x = Math.floor(Math.round(x)/this.chunkSize);
			localY = Math.round(y % this.chunkSize);
			y = Math.floor(Math.round(y)/this.chunkSize);
			
			this.getChunk(x,y).then(chunk => {
				if(!chunk.dataObject[localX]) chunk.dataObject[localX] = {};
				if(!chunk.dataObject[localX][localY]) chunk.dataObject[localX][localY] = {};
				
				let entity = chunk.dataObject[localX][localY]
				
				if(newEntity && typeof newEntity == "object"){
					log("Overwriting with new entity");
					entity.name = newEntity.name;
				} else {
					log("Deleting entry at "+localX+", "+localY);
					entity.name = undefined;
				}
				this.setChunk(x, y, chunk).then(()=>{
					log("Successfully saved chunk!");
				});
			});
		});
	}
	setChunk(x, y, chunk){
		return new Promise((resolve, reject) => {
			mkdirp(this.path+this.name+"/"+x).then(() => {
				fs.writeFile(y, JSON.stringify(chunk), function(){
					
				});
			});
		});
	}
	getChunk(x, y){
		return new Promise((resolve, reject) => {
			// make new chunk in case we can't find an existing one
			let chunk = {
				dataObject: {},
				position:{x,y}, // fancy ES6 feature that generates to {x:x, y:y}
				chunkSize:this.chunkSize,
			};
			try {
				fs.readdir(this.path+this.name, chunkFiles => {
					log(chunkFiles);
					if(chunkFiles == undefined) {
						resolve(chunk);
					} else {
						
					}
				}); // add x and y values as well and we are done?
			} catch (e){
				resolve(chunk);
			}
		});
	}
}