var mkdirp = require("mkdirp-promise");
var mkdirpSync = require("mkdirp").sync;
var fs = require("fs");
var events = require("events");
var path = require("path");

var objectOps = require("./../../lib/objectOps");

var LinvoDB = require("linvodb3");
// LinvoDB.dbPath = "./database/linvodb/";


let allowLogging = true;
let log = string => (allowLogging)? console.log(string):""

module.exports = class chunkStore {
	constructor(name, chunkSize = 32, path = "./chunkStore/"){
		if(!name || (typeof name != "string" && typeof name != "number")) throw new Error("chunkstore requires a name string as first param");
		name = name.toString();
		this.name = name;
		this.chunkSize = chunkSize;
		this.path = (path[path.length] == "/") ? path : path+"/";
		mkdirpSync(path+name);
		LinvoDB.dbPath = this.path;
		
		this.db = new LinvoDB(name, {}, {});
		
		this.eventEmitter = new events.EventEmitter();
	}
	setEntity(x/**{number}*/, y/**{number}*/, newEntity/**{object}*/){
		return new Promise((resolve, reject) => {
			x = Math.floor(x);
			y = Math.floor(y);
			this.db.find({x, y}, (err, docs) => {
				if(typeof newEntity == "object"){
					if(err) reject(err);
					let entityDoc = {x, y, entity: newEntity};
					if(docs && docs[0] && docs[0]._id){
						entityDoc._id = docs[0]._id;
					}
					this.db.save(entityDoc, (err,docs) => {
						if(err) reject(err);
						resolve(docs);
						this.eventEmitter.emit("change", docs)
					});
				} else {
					docs.forEach(doc => {
						doc.remove(()=>{
							// removed :)
						});
					});
					resolve();
					this.eventEmitter.emit("change", {x,y});
				}
			});
		});
	}
	getEntity(x, y){
		return new Promise((resolve, reject) => {
			this.db.find({x:Math.floor(x), y:Math.floor(y)}, (err, docs) => {
				if(err) reject(err);
				resolve(docs);
			});
		});
	}
	onEntityChange(eventhandler/**function*/){
		if(typeof eventhandler == "function") {
			this.eventEmitter.on("change", eventhandler);
		}
	}
	getChunk(x, y){
		return new Promise((resolve, reject) => {
			
			/*
			// make new chunk in case we can't find an existing one
			let chunk = {
				dataObject: {},
				position:{x,y}, // fancy ES6 feature that generates to {x:x, y:y}
				chunkSize:this.chunkSize
			};
			fs.readFile(this.path+this.name+"/"+x+"/"+y, (err, chunkFile) => {
				
				if(err){
					log(err)
					resolve(chunk);
				} else {
					if(objectOps.isJSON(chunkFile)) {
						log("returned from file")
						let chunk = JSON.parse(chunkFile);
						resolve(chunk);
					} else {
						log("file failed")
						resolve(chunk);
					}
				}
			}); // add x and y values as well and we are done?
			*/
		});
	}
}