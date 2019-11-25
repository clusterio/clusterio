/**
Provides tools to manage mods in a clusterio install
@module modManager
*/

const asTable = require("as-table").configure({delimiter: ' | '});
const moment = require("moment");
const syncRequest = require("sync-request");
const fs = require("fs-extra");
const https = require('follow-redirects').https;
const factorioAPI = require("node-factorio-api");
const sLog = require("single-line-log").stdout;
const query = require('cli-interact').getYesNo;
const path = require("path");

const fileOps = require("lib/fileOps");


function ellipse(str, max){
   return str.length > (max - 3) ? str.substring(0,max-3) + '...' : str;
}
// https://stackoverflow.com/questions/15900485/correct-way-to-convert-size-in-bytes-to-kb-mb-gb-in-javascript
function formatBytes(a,b){if(0==a)return"0 Bytes";var c=1024,d=b||2,e=["Bytes","KB","MB","GB","TB","PB","EB","ZB","YB"],f=Math.floor(Math.log(a)/Math.log(c));return parseFloat((a/Math.pow(c,f)).toFixed(d))+" "+e[f]};


/**
Lists mods for an instance as a table. Warning, handles printing internally.
@param {Instance} instance - Instance object, see client.js

@example
var modManager = require("modManager");
modManager.listMods(config, instance);
// console.logs table of mods installed on instance
// if instance.name is shared:
// console.logs mods located in /sharedMods as a nice table
*/
async function listMods(config, instance) {
	return new Promise((resolve, reject) => {
		if (true) {
			factorioAPI.init(false, instance.path("instanceMods"), instance.path("saves"), instance.server.version);
			factorioAPI.authenticate({
				username: config.username,
				token: config.token,
				require_ownership: false
			}).then(token => {
				console.log("* Currently installed:");
				factorioAPI.readModZips().then(list => {
					console.log(asTable(list.map(mod => {
						return {
							name:(mod.title || mod.name),
							version:mod.version,
							date:mod.date,
							factorio_ver:mod.factorio_version,
							author:mod.author,
						}
					})));
				});
				// Had issues earlier due to bug in node-factorio-api, see https://github.com/Danacus/node-factorio-api/issues/2
				// bug is resolved, thanks to @Danacus and @brotherpot
				factorioAPI.getModsFromSaves().then(list => {
					console.log("* Mods used in save:");
					console.log(asTable(list[0].mods))
				});
			}).catch(reason => {
				console.log("Failed to authenticate to factorio.com! Please check your connection and the username+token used for authentication in config.json");
				resolve();
			});
		} else {
			// list shared mods in /sharedMods/
			factorioAPI.init(false, 'sharedMods/', '', instance.server.version);
			factorioAPI.authenticate({
				username: config.username,
				token: config.token,
				require_ownership: false
			}).then(() => {
				console.log("\r\n")
				console.log("* Mods shared by all instances:")
				factorioAPI.getInstalledMods().then(mods => {
					console.log(asTable(mods));
					resolve();
				});
			}).catch(e => {
				reject(new Error(e));
			});
		}

		// get JSON data about GH releases
		/*let res = syncRequest('GET', 'https://api.github.com/repos/Danielv123/factorioClusterioMod/releases', {"headers":{"User-Agent":"factorioClusterio"}});
		let url = JSON.parse(res.getBody())[0].assets[0].browser_download_url;
		let name = JSON.parse(res.getBody())[0].assets[0].name;
		console.log(JSON.parse(res.getBody()))
		*/
	});
}

/**
Searches mods.factorio.com for mods matching a search term and prints
the results to console as a neat looking table

@param {string} searchTerm What to search for
*/
async function findMods(config, searchTerm) {
	return new Promise((resolve, reject) => {
		factorioAPI.init(false);
		factorioAPI.authenticate({
			username: config.username,
			token: config.token,
			require_ownership: false
		}).then(token => {
			factorioAPI.searchMods(searchTerm).then(mods => {
				let result = asTable(mods.reverse().map(mod => {
					return {
						title:ellipse(mod.title, 50),
						name:ellipse(mod.name, 30),
						downloads:mod.downloads_count,
						updated: moment(mod.updated_at).format("DD.MM.YY"),
						latest_version: mod.latest_release.version,
						owner:mod.owner,
						//license: mod.license_name,
					}
				}));
				resolve(result);
				// console.log(result);
			});
		}).catch(e => {
			if (e.contains("Insufficient information")) console.log("We are missing some parameters required for logging in! Make sure your factorio username and token are specified in config.json.");
			reject(new Error(e));
		});
	});
}

async function addMod(config, term, instance) {
	return new Promise((resolve, reject) => {
		if (instance.name == "shared") {
			var modDirectory = "sharedMods";
		} else {
			var modDirectory = instance.path("instanceMods");
		}
		if (term && term.length > 0) {
			if (term.includes("mods.factorio.com/mods/")) { // https://mods.factorio.com/mods/Danielv123/ChooChoo
				// treat it as a link download
				factorioAPI.init(false, modDirectory, "", instance.server.version);
				factorioAPI.authenticate({
					username: config.username,
					token: config.token,
					require_ownership: false
				}).then(() => {
					factorioAPI.searchMods(term.split("/")[term.split("/").length-1]).then(body => {
						console.log("Im gonna download: "+body[0].name + " in version: " + body[0].latest_release.version);
						factorioAPI.downloadMod( {name: body[0].name, version: body[0].latest_release.version}).then(()=>{
							console.log("Mod downloaded");
							resolve();
						});
					});
				});
			} else if (term.includes("github.com")) { // https://github.com/Danielv123/factorioClusterioMod
				// treat it as a github releases download
				let apiURL = "https://api.github.com/repos/" + term.split("/")[3] + "/" + term.split("/")[4] + "/releases"; // https://api.github.com/repos/Danielv123/factorioClusterioMod/releases

				let res = syncRequest('GET', apiURL, {"headers":{"User-Agent":"factorioClusterio"}});
				let url = JSON.parse(res.getBody())[0].assets[0].browser_download_url;
				let name = JSON.parse(res.getBody())[0].assets[0].name;
				if (url) {
					console.log("Downloading " + url);
					let file = fs.createWriteStream(path.join(modDirectory, name));
					let bytesDownloaded = 0;
					let downloadStartTime = Date.now();
					https.get(url, function(response) {
						let bytesToDownload = response.headers['content-length'];
						response.pipe(file);
						response.on("data", chunk => {
							bytesDownloaded += chunk.length;
							let downloadTimeElapsed = Date.now() - downloadStartTime;
							let bytesPerSecond = bytesDownloaded / (downloadTimeElapsed/1000);
							let timeToComplete = Math.floor((bytesToDownload - bytesDownloaded)/bytesPerSecond);
							sLog("Downloading "+name+" "+(bytesDownloaded/bytesToDownload*100).toPrecision(3)+"% ("+formatBytes(bytesDownloaded)+" / "+formatBytes(bytesToDownload)+")\r\n"+
							"about "+timeToComplete+" seconds remaining ("+formatBytes(bytesPerSecond)+"/s)");
						}).on("end", x => {
							sLog.clear();
							console.log(" Downloaded in "+moment.utc(moment.duration(Date.now()-downloadStartTime).as('milliseconds')).format('mm:ss')); // because sLog.clear() doesn't seem to do the job of ending the line properly
							resolve();
						});
					});
				}
			} else {
				// treat it as a search and download the top result
				factorioAPI.init(false, modDirectory, "", instance.server.version);
				factorioAPI.authenticate({
					username: config.username,
					token: config.token,
					require_ownership: false
				}).then(() => {
					factorioAPI.searchMods(term).then(body => {
						console.log(body)
						console.log("Im gonna download: "+body[0].name + " in version: " + body[0].latest_release.version);
						factorioAPI.downloadMod( {name: body[0].name, version: body[0].latest_release.version}).then(()=>{
							console.log("Mod downloaded");
							resolve();
						});
					});
				});
			}
		} else {
			reject(new Error("Invalid search term"));
		}
	});
}

async function removeMod(config, term, instance, force = false) {
	return new Promise((resolve, reject) => {
		if (instance.name == "shared") {
			var modDirectory = "sharedMods";
		} else {
			var modDirectory = instance.path("instanceMods");
		}
		if (term && typeof term == "string" && term.length > 0) {
			let mods = fs.readdirSync(modDirectory);
			let modsMatchingFilter = mods.filter(mod => mod.toLowerCase().includes(term.toLowerCase()));
			if (modsMatchingFilter.length < 1) {
				console.log("No mods found matching search");
			} else if (modsMatchingFilter.length == 1) {
				console.log("Deleting "+modsMatchingFilter[0]);
				fs.unlinkSync(path.join(modDirectory, modsMatchingFilter[0]));
				console.log("Deleted.");
			} else if (modsMatchingFilter.length > 1) {
				console.log("Found multiple mods");
				modsMatchingFilter.forEach(mod => console.log(mod));
				if (query("Delete all mods matching filter?")) {
					let modsToDelete = modsMatchingFilter.length;
					for (let i = 0; i < modsToDelete; i++) {
						fs.unlinkSync(path.join(modDirectory, modsMatchingFilter[i]));
						console.log("Deleted "+modsMatchingFilter[i]);
					}
				} else console.log("Did not delete mods.")
			}
			resolve();
		} else {
			reject(new Error("Invalid search term"));
		}
	});
}

// 'https://api.github.com/repos/Danielv123/factorioClusterioMod/releases'
/**
Download mod from github repo by looking for the first binary download in
the latest release, saving it to /sharedMods

@param {string} url a github repo  URL, for example https://api.github.com/repos/Danielv123/factorioClusterioMod/releases. Must link to /releases
*/
function downloadFromGitURL(url) {
	console.log("Downloading mod from "+url);
	// get JSON data about releases
	let res = syncRequest('GET', url, {"headers":{"User-Agent":"factorioClusterio"}});
	let downloadUrl = JSON.parse(res.getBody())[0].assets[0].browser_download_url;
	let name = JSON.parse(res.getBody())[0].assets[0].name;
	console.log(JSON.parse(res.getBody()))
	if (downloadUrl) {
		console.log(downloadUrl);
		let file = fs.createWriteStream("sharedMods/"+name);
		https.get(downloadUrl, function(response) {
			response.pipe(file);
			console.log("Downloaded "+name);
		});
	}
}

/*
function findUpdates() {
	console.log("Downloading mods...");
	// get JSON data about releases
	let res = syncRequest('GET', 'https://api.github.com/repos/Danielv123/factorioClusterioMod/releases', {"headers":{"User-Agent":"factorioClusterio"}});
	let url = JSON.parse(res.getBody())[0].assets[0].browser_download_url;
	let name = JSON.parse(res.getBody())[0].assets[0].name;
	console.log(JSON.parse(res.getBody()))
}*/

module.exports = {
	listMods,
	findMods,
	addMod,
	removeMod,
	downloadFromGitURL,
}
