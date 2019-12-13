const needle = require("needle");
const fs = require("fs-extra");

const objectOps = require("lib/objectOps");
const fileOps = require("lib/fileOps");

const pluginConfig = require("./config");


function ensureFileSync(path) {
	if (!fs.existsSync(path)) {
		fs.outputFileSync(path, "");
	}
}

module.exports = class remoteCommands {
	constructor(mergedConfig, messageInterface, extras){
		// Ugly global
		global.confirmedOrders = [];

		this.messageInterface = messageInterface;
		this.config = mergedConfig;
		this.socket = extras.socket;
		const that = this;
		const instance = process.argv[3];
		const instancedirectory = this.config.instanceDirectory + '/' + instance;
		
		const needleOptionsWithTokenAuthHeader = {
			headers: {
				'x-access-token': this.config.masterAuthToken
			},
		};

		ensureFileSync(instancedirectory + "/script-output/output.txt");
		ensureFileSync(instancedirectory + "/script-output/orders.txt");

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
					needle.post(that.config.masterURL + '/api/place', {
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
					function callback(err, response, body) {
						if (response && response.body && typeof response.body == "object") {
							// buffer confirmed orders
							confirmedOrders[confirmedOrders.length] = {name:response.body.name,count:response.body.count}
							if(that.config.logItemTransfers){
								console.log(`Imported ${response.body.count} ${response.body.name} from master`);
							}
						}
					}
					needle.post(
						that.config.masterURL + '/api/remove',
						preparedPackage[Object.keys(preparedPackage)[i]],
						needleOptionsWithTokenAuthHeader,
						callback
					);
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
			needle.get(that.config.masterURL + '/api/inventory', function (err, response, body) {
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
	}
	async factorioOutput(data){
		
	}
}
async function sleep(s){
	return new Promise((resolve, reject) => {
		setTimeout(resolve, s*1000);
	});
}
