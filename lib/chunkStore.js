var mkdirp = require("mkdirp-promise");
var mkdirpSync = require("mkdirp").sync;
var fs = require("fs");
var objectOps = require("./objectOps");

let allowLogging = false;
let log = string => (allowLogging)? console.log(string):""

module.exports = class chunkStore {
	constructor(name, chunkSize = 32, path = "./chunkStore/"){
		this.name = name;
		this.chunkSize = chunkSize;
		this.path = (path[path.length] == "/") ? path : path+"/";
		mkdirpSync(path+name);
	}
	setEntity(x/**{number}*/, y/**{number}*/, newEntity/**{object}*/){
		return new Promise((resolve, reject) => {
			var localX = x > 0 ? Math.round(x % this.chunkSize) : Math.round(x % this.chunkSize)-64;
			x = Math.floor(Math.round(x)/this.chunkSize);
			var localY = y > 0 ? Math.round(y % this.chunkSize) : Math.round(x % this.chunkSize)-64;
			y = Math.floor(Math.round(y)/this.chunkSize);
			
			this.getChunk(x,y).then(chunk => {
				log("Setentity");
				if(!chunk.dataObject[localX]) chunk.dataObject[localX] = {};
				if(!chunk.dataObject[localX][localY]) chunk.dataObject[localX][localY] = {};
				
				
				if(newEntity && typeof newEntity == "object"){
					log("Overwriting with new entity at "+localX+", "+localY);
					chunk.dataObject[localX][localY] = newEntity;
				} else {
					log("Deleting entry at "+localX+", "+localY);
					chunk.dataObject[localX][localY] = undefined;
				}
				this.setChunk(x, y, chunk).then(()=>{
					log("Successfully saved chunk!");
					this.getChunk(x,y).then(chunk => resolve(chunk));
				});
			});
		});
	}
	setChunk(x, y, chunk){
		return new Promise((resolve, reject) => {
			mkdirp(this.path+this.name+"/"+x).then(() => {
				fs.writeFile(this.path+this.name+"/"+x+"/"+y, JSON.stringify(chunk, null, 4), function(err){
					if(err) {
						reject(err);
					} else resolve();
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
				get: function(x, y){
					if(this.dataObject[Math.round(x)] && this.dataObject[Math.round(x)][Math.round(y)]){
						return this.dataObject[Math.round(x)][Math.round(y)];
					} else {
						return undefined;
					}
				},
			};
			fs.readFile(this.path+this.name+"/"+x+"/"+y, (err, chunkFile) => {
				
				if(err){
					log(err)
					resolve(chunk);
				} else {
					if(objectOps.isJSON(chunkFile)) {
						log("returned from file")
						let chunk = JSON.parse(chunkFile);
						chunk.get = function(x, y){
							if(this.dataObject[Math.round(x)] && this.dataObject[Math.round(x)][Math.round(y)]){
								return this.dataObject[Math.round(x)][Math.round(y)];
							} else {
								return undefined;
							}
						}
						resolve(chunk);
					} else {
						log("file failed")
						resolve(chunk);
					}
				}
			}); // add x and y values as well and we are done?
		});
	}
}