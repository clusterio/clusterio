var mkdirp = require("mkdirp-promise");
var mkdirpSync = require("mkdirp").sync;
var fs = require("fs");
var objectOps = require("./objectOps");

let allowLogging = true;
let log = string => (allowLogging)? console.log(string):""

module.exports = class chunkStore {
	constructor(name, chunkSize = 32, path = "./chunkStore/"){
		this.name = name;
		this.chunkSize = chunkSize;
		this.path = (path[path.length] == "/") ? path : path+"/";
		mkdirpSync(path+name);
		
		this.entityWriteQueue = [];
		this.chunkWritesInProgress = {};
		this.entityWriteInProgress = false;
	}
	checkChunkWrite(x, y){
		if(!this.chunkWritesInProgress[x]) this.chunkWritesInProgress[x] = {};
		if(!this.chunkWritesInProgress[x][y]){
			return false
		} else {
			return true
		}
	}
	setChunkWrite(x,y, bool){
		if(!this.chunkWritesInProgress[x]) this.chunkWritesInProgress[x] = {};
		if(!this.chunkWritesInProgress[x][y]) this.chunkWritesInProgress[x][y] = bool;
	}
	setEntity(x/**{number}*/, y/**{number}*/, newEntity/**{object}*/){
		return new Promise((resolve, reject) => {
			var localX = x > 0 ? Math.round(x % this.chunkSize) : Math.round(x % this.chunkSize)+64;
			x = Math.floor(Math.round(x)/this.chunkSize);
			var localY = y > 0 ? Math.round(y % this.chunkSize) : Math.round(y % this.chunkSize)+64;
			y = Math.floor(Math.round(y)/this.chunkSize);
			console.log("localX"+localX)
			console.log("localY"+localY)
			console.log(x+ " "+y)
			this.entityWriteQueue.push({x, y, localX, localY, newEntity});
			if(this.checkChunkWrite(x,y)){
				// we don't need to initiate another request for a chunk because there is one running already which should take care of it
			} else {
				this.setChunkWrite(x, y, true);
				this.getChunk(x,y).then(chunk => {
					log("Setting "+this.entityWriteQueue.length+" entities in chunk X: "+x+" Y: "+y);
					
					// add each queued entity to the chunk
					this.entityWriteQueue.forEach(queuedEntity => {
						if(queuedEntity.x == x && queuedEntity.y == y){
							let localX = queuedEntity.localX;
							let localY = queuedEntity.localY;
							let newEntity = queuedEntity.newEntity;
							
							if(!chunk.dataObject[localX]) chunk.dataObject[localX] = {};
							if(!chunk.dataObject[localX][localY]) chunk.dataObject[localX][localY] = {};
							
							if(newEntity && typeof newEntity == "object"){
								log("Overwriting with new entity at "+localX+", "+localY);
								chunk.dataObject[localX][localY] = newEntity;
							} else {
								log("Deleting entry at "+localX+", "+localY);
								chunk.dataObject[localX][localY] = undefined;
							}
						}
					});
					// clear the now processed queue
					this.entityWriteQueue = this.entityWriteQueue.filter(entity => {
						if(entity.x != x && entity.y != y) return true
					});
					// save the chunk and resolve the promise
					this.setChunk(x, y, chunk).then(()=>{
						log("Successfully saved chunk!");
						//this.entityWriteInProgress = false;
						this.setChunkWrite(x,y,false);
						resolve(chunk);
					});
				});
			}
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
				/*get: function(x, y){
					if(this.dataObject[Math.round(x)] && this.dataObject[Math.round(x)][Math.round(y)]){
						return this.dataObject[Math.round(x)][Math.round(y)];
					} else {
						return undefined;
					}
				},*/
			};
			fs.readFile(this.path+this.name+"/"+x+"/"+y, (err, chunkFile) => {
				
				if(err){
					log(err)
					resolve(chunk);
				} else {
					if(objectOps.isJSON(chunkFile)) {
						log("returned from file")
						let chunk = JSON.parse(chunkFile);
						/*chunk.get = function(x, y){
							if(this.dataObject[Math.round(x)] && this.dataObject[Math.round(x)][Math.round(y)]){
								return this.dataObject[Math.round(x)][Math.round(y)];
							} else {
								return undefined;
							}
						}*/
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