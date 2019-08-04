const needle = require("needle");
const fs = require("fs-extra");

const objectOps = require("./../../lib/objectOps.js");
const fileOps = require("_app/fileOps");
const stringUtils = require("./../../lib/stringUtils.js");

const pluginConfig = require("./config");
const COMPRESS_LUA = false;

module.exports = class remoteCommands {
	constructor(mergedConfig, messageInterface, extras){
		this.messageInterface = messageInterface;
		this.config = mergedConfig;
		this.socket = extras.socket;
		this.socket.on("hello", () => {
			
		});
		const that = this;
		const instance = process.argv[3];
		const instancedirectory = this.config.instanceDirectory + '/' + instance;
		
		const needleOptionsWithTokenAuthHeader = {
			headers: {
				'x-access-token': this.config.masterAuthToken
			},
		};
		
		(async ()=>{
			let hotpatchInstallStatus = await this.checkHotpatchInstallation();
			this.messageInterface("Hotpach installation status: "+hotpatchInstallStatus);
			if(hotpatchInstallStatus){
				// let mainCode = await this.getSafeLua("sharedPlugins/playerManager/lua/playerTracking.lua");
				// if(mainCode) var returnValue = await messageInterface("/silent-command remote.call('hotpatch', 'update', '"+pluginConfig.name+"', '"+pluginConfig.version+"', '"+mainCode+"')");
			}
		})().catch(e => console.log(e));
		
		// flow/production statistics ------------------------------------------------------------
		var oldFlowStats = false;
		var oldTimestamp;
		var oldFlowStats;
		setInterval(function(){
			fs.readFile(instancedirectory + "/script-output/flows.txt", {encoding: "utf8"}, function(err, data) {
				if(!err && data) {
					let timestamp = Date.now();
					data = data.split("\n");
					let flowStats = [];
					for(let i = 0; i < data.length; i++) {
						// try catch to remove any invalid json
						try{
							flowStats[flowStats.length] = JSON.parse(data[i]);
						} catch (e) {
							// console.log(" invalid json: " + i);
							// some lines of JSON are invalid but don't worry, we just filter em out
						}
					}
					// fluids
					let flowStat1 = flowStats[flowStats.length-1].flows.player.input_counts
					// items
					let flowStat2 = flowStats[flowStats.length-2].flows.player.input_counts
					// merge fluid and item flows
					let totalFlows = {};
					for(let key in flowStat1) totalFlows[key] = flowStat1[key];
					for(let key in flowStat2) totalFlows[key] = flowStat2[key];
					if(oldFlowStats && totalFlows && oldTimestamp) {
						let payload = objectOps.deepclone(totalFlows);
						// change from total reported to per time unit
						for(let key in oldFlowStats) {
							// get production per minute
							payload[key] = Math.floor((payload[key] - oldFlowStats[key])/(timestamp - oldTimestamp)*60000);
							if(payload[key] < 0) {
								payload[key] = 0;
							}
						}
						for(let key in payload) {
							if(payload[key] == '0') {
								delete payload[key];
							}
						}
						console.log("Recorded flows, copper plate since last time: " + payload["copper-plate"]);
						needle.post(that.config.masterIP + ":" + that.config.masterPort + '/api/logStats', {timestamp: timestamp, instanceID: that.config.unique, data: payload}, needleOptionsWithTokenAuthHeader, function (err, response, body) {
							// we did it, keep going
						});
					}
					oldTimestamp = timestamp;
					oldFlowStats = totalFlows;
					fs.writeFileSync(instancedirectory + "/script-output/flows.txt", "");
				}
			});
			// we don't need to update stats quickly as that could be expensive
		}, 60000*5);
		
		// provide items --------------------------------------------------------------
		// trigger when something happens to output.txt
		fs.watch(instancedirectory + "/script-output/output.txt", function (eventType, filename) {
			// get array of lines in file
			let items = fs.readFileSync(instancedirectory + "/script-output/output.txt", "utf8").split("\n");
			// if you found anything, reset the file
			if (items[0]) {
				fs.writeFileSync(instancedirectory + "/script-output/output.txt", "");
			}
			for (let i = 0; i < items.length; i++) {
				if (items[i]) {
					let g = items[i].split(" ");
					g[0] = g[0].replace("\u0000", "");
					// console.log("exporting " + JSON.stringify(g));
					// send our entity and count to the master for him to keep track of
					needle.post(that.config.masterIP + ":" + that.config.masterPort + '/api/place', {
						name: g[0],
						count: g[1],
						instanceName: instance, // name of instance
						instanceID: that.config.unique, // a hash computed from the randomly generated rcon password
					}, needleOptionsWithTokenAuthHeader, function (err, resp, body) {
						if(body == "failure") console.error("#### Export failed! Lost: "+g[1]+" "+g[0]);
						if(that.config.logItemTransfers){
							if(body == "success") console.log(`Exported ${g[1]} ${g[0]} to master`);
						}
					});
				}
			}
		});
		
		// request items --------------------------------------------------------------
		setInterval(function () {
			// get array of lines in file
			let items = fs.readFileSync(instancedirectory + "/script-output/orders.txt", "utf8").split("\n");
			// if we actually got anything from the file, proceed and reset file
			if (items[0]) {
				fs.writeFileSync(instancedirectory + "/script-output/orders.txt", "");
				// prepare a package of all our requested items in a more transfer friendly format
				var preparedPackage = {};
				for (let i = 0; i < items.length; i++) {
					(function (i) {
						if (items[i]) {
							items[i] = items[i].split(" ");
							items[i][0] = items[i][0].replace("\u0000", "");
							items[i][0] = items[i][0].replace(",", "");
							if (preparedPackage[items[i][0]]) {
								// if we have buffered some already, sum the new items
								if (typeof Number(preparedPackage[items[i][0]].count) == "number" && typeof Number(items[i][1]) == "number") {
									preparedPackage[items[i][0]] = {
										"name": items[i][0],
										"count": Number(preparedPackage[items[i][0]].count) + Number(items[i][1]),
										"instanceName":instance,
										"instanceID":that.config.unique,
									};
								// else just add em in without summing
								} else if (typeof Number(items[i][1]) == "number") {
									preparedPackage[items[i][0]] = {
										"name": items[i][0],
										"count": Number(items[i][1]),
										"instanceName":instance,
										"instanceID":that.config.unique,
									};
								}
							// this condition will NEVER be triggered but we know how that goes
							} else if (typeof Number(items[i][1]) == "number") {
								preparedPackage[items[i][0]] = {
									"name": items[i][0],
									"count": Number(items[i][1]),
									"instanceName":instance,
									"instanceID":that.config.unique,
								};
							}
						}
					})(i);
				}
				// request our items, one item at a time
				for (let i = 0; i < Object.keys(preparedPackage).length; i++) {
					// console.log(preparedPackage[Object.keys(preparedPackage)[i]]);
					needle.post(that.config.masterIP + ":" + that.config.masterPort + '/api/remove', preparedPackage[Object.keys(preparedPackage)[i]], needleOptionsWithTokenAuthHeader, function (err, response, body) {
						if (response && response.body && typeof response.body == "object") {
							// buffer confirmed orders
							confirmedOrders[confirmedOrders.length] = {name:response.body.name,count:response.body.count}
							if(that.config.logItemTransfers){
								console.log(`Imported ${response.body.count} ${response.body.name} from master`);
							}
						}
					});
				}
				// if we got some confirmed orders
				// console.log("Importing " + confirmedOrders.length + " items! " + JSON.stringify(confirmedOrders));
				//if (!(confirmedOrders.length>0)){return;}
				let cmd="local t={";
				for(let i=0;i<confirmedOrders.length;i++)
				{
					cmd+='["'+confirmedOrders[i].name+'"]='+confirmedOrders[i].count+',';
				}
				if (!(cmd==="local t={")){
					that.messageInterface("/silent-command remote.call('clusterio', 'runcode', '"+cmd.slice(0, -1)+"}"+ " for k, item in pairs(t) do GiveItemsToStorage(k, item) end')");
				}
				confirmedOrders=[];
			}
		}, 1000);
		// COMBINATOR SIGNALS ---------------------------------------------------------
		// get inventory from Master and RCON it to our slave
		setInterval(() => {
			needle.get(that.config.masterIP + ":" + that.config.masterPort + '/api/inventory', function (err, response, body) {
				if(err){
					console.error("Unable to get JSON master/api/inventory, master might be unaccessible");
				} else if (response && response.body) {
					// Take the inventory we (hopefully) got and turn it into the format LUA accepts
					if(Buffer.isBuffer(response.body)) {console.log(response.body.toString("utf-8")); throw new Error();} // We are probably contacting the wrong webserver
					try {
						var inventory = JSON.parse(response.body);
						var inventoryFrame = {};
						for (let i = 0; i < inventory.length; i++) {
							inventoryFrame[inventory[i].name] = Number(inventory[i].count);
							if(inventoryFrame[inventory[i].name] >= Math.pow(2, 31)){
								inventoryFrame[inventory[i].name] = Math.pow(2, 30); // set it waaay lower, 31 -1 would probably suffice
							}
						}
						inventoryFrame["signal-unixtime"] = Math.floor(Date.now()/1000);
						// console.log("RCONing inventory! " + JSON.stringify(inventoryFrame));
						let first = true;
						let cmd="local s={";
						for (let key in inventoryFrame)
						{
							cmd+='["'+key+'"]='+inventoryFrame[key]+",";
						}
						if (!(cmd==="local s={")){
							that.messageInterface("/silent-command remote.call('clusterio', 'runcode', '"+(first ? 'global.ticksSinceMasterPinged=0 ':'')+cmd.slice(0, -1)+"}"+ " for name,count in pairs(s) do global.invdata[name]=count end')");
						}
						that.messageInterface("/silent-command remote.call('clusterio', 'runcode', 'UpdateInvCombinators()')");
					} catch (e){
						console.log(e);
					}
				}
			});
		}, 1550);
		// Make sure world has its worldID
		setTimeout(function(){
			messageInterface("/silent-command remote.call('clusterio','setWorldID',"+that.config.unique+")")
		}, 20000);
		/* REMOTE SIGNALLING
		 * send any signals the slave has been told to send
		 * Fetch combinator signals from the server
		*/
		this.socket.on("processCombinatorSignal", circuitFrameWithMeta => {
			if(circuitFrameWithMeta && typeof circuitFrameWithMeta == "object" && circuitFrameWithMeta.frame && Array.isArray(circuitFrameWithMeta.frame)){
				messageInterface("/silent-command remote.call('clusterio', 'receiveFrame', '"+JSON.stringify(circuitFrameWithMeta.frame)+"')");
			}
		});
		// get outbound frames from file and send to master
		// get array of lines in file, each line should correspond to a JSON encoded frame
		let signals = fs.readFileSync(instancedirectory + "/script-output/txbuffer.txt", "utf8").split("\n");
		// if we actually got anything from the file, proceed and reset file
		let readingTxBufferSoon = false;
		let txBufferClearCounter = 0;
		fs.watch(instancedirectory + "/script-output/txbuffer.txt", "utf-8", (eventType, filename) => {
			if(!readingTxBufferSoon){ // use a 100ms delay to avoid messing with rapid sequential writes from factorio (I think that might be a problem maybe?)
				readingTxBufferSoon = true;
				setTimeout(()=>{
					txBufferClearCounter++;
					fs.readFile(instancedirectory + "/script-output/txbuffer.txt", "utf-8", (err, signals) => {
						signals = signals.split("\n");
						if (signals[0]) {
							//if(txBufferClearCounter > 500){
								fs.writeFileSync(instancedirectory + "/script-output/txbuffer.txt", "");
							//	txBufferClearCounter = 0;
							//}
							
							// loop through all our frames
							for (let i = 0; i < signals.length; i++) {
								if (signals[i] && objectOps.isJSON(signals[i])) {
									// signals[i] is a JSON array called a "frame" of signals. We timestamp it for storage on master
									// then we unpack and RCON in this.frame to the game later.
									let framepart = JSON.parse(signals[i]);
									let doneframe = {
										time: Date.now(),
										frame: framepart, // thats our array of objects(single signals);
									}
									// send to master using socket.io, opened at the top of instanceManagement()
									this.socket.emit("combinatorSignal", doneframe);
								} else {
									// console.log("Invalid jsony: "+typeof signals[i])
								}
							}
						}
					});
					readingTxBufferSoon = false;
				},100);
			}
		});
	}
	async getCommand(file){
		this.commandCache = this.commandCache || {};
		if(!this.commandCache[file]){
			try{
				let command = (await fs.readFile(file)).toString();
				this.commandCache[file] = command.replace(/(\r\n\t|\n|\r\t)/gm, " "); // remove newlines
				return this.commandCache[file];
			} catch(e){
				console.log("Unable to get command from file!");
				console.log(e)
			}
		} else if(typeof this.commandCache[file] == "string"){
			return this.commandCache[file];
		} else {
			throw new Error("Command not found");
		}
	}
	async factorioOutput(data){
		
	}
	getInstanceName(instanceID){
		return new Promise((resolve, reject) => {
			let instance = this.instances[instanceID];
			if(!instance){
				needle.get(this.config.masterIP+":"+this.config.masterPort+ '/api/slaves', { compressed: true }, (err, response) => {
					if(err || response.statusCode != 200) {
						console.log("Unable to get JSON master/api/slaves, master might be unaccessible");
					} else if (response && response.body) {	
						if(Buffer.isBuffer(response.body)) {console.log(response.body.toString("utf-8")); throw new Error();}
							try {
								for (let index in response.body)
									this.instances[index] = response.body[index].instanceName;
							} catch (e){
								console.log(e);
								return null;
							}
						instance = this.instances[instanceID] 							
						if (!instance) instance = instanceID;  //somehow the master doesn't know the instance	
						resolve(instance);
					}
				});
			} else {
				resolve(instance);
			}
		});
	}
	async getSafeLua(filePath){
		return new Promise((resolve, reject) => {
			fs.readFile(filePath, "utf8", (err, contents) => {
				if(err){
					reject(err);
				} else {
                    // split content into lines
					contents = contents.split(/\r?\n/);

					// join those lines after making them safe again
					contents = contents.reduce((acc, val) => {
                        val = val.replace(/\\/g ,'\\\\');
                        // remove leading and trailing spaces
					    val = val.trim();
                        // escape single quotes
					    val = val.replace(/'/g ,'\\\'');

					    // remove single line comments
                        let singleLineCommentPosition = val.indexOf("--");
                        let multiLineCommentPosition = val.indexOf("--[[");

						if(multiLineCommentPosition === -1 && singleLineCommentPosition !== -1) {
							val = val.substr(0, singleLineCommentPosition);
						}

                        return acc + val + '\\n';
					}, ""); // need the "" or it will not process the first row, potentially leaving a single line comment in that disables the whole code

					// console.log(contents);

					// this takes about 46 ms to minify train_stop_tracking.lua in my tests on an i3
					if(COMPRESS_LUA) contents = require("luamin").minify(contents);
					
					resolve(contents);
				}
			});
		});
	}
	async checkHotpatchInstallation(){
		let yn = await this.messageInterface("/silent-command if remote.interfaces['hotpatch'] then rcon.print('true') else rcon.print('false') end");
		yn = yn.replace(/(\r\n\t|\n|\r\t)/gm, "");
		if(yn == "true"){
			return true;
		} else if(yn == "false"){
			return false;
		}
	}
}
async function sleep(s){
	return new Promise((resolve, reject) => {
		setTimeout(resolve, s*1000);
	});
}
