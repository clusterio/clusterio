const rightpad = require("right-pad");
const asTable = require("as-table").configure({delimiter: ' | '});

const factorioAPI = require("node-factorio-api");
const fileOps = require("./../fileOps.js");

const instances = fileOps.getDirectoriesSync("./instances/");

module.exports.listMods = function(instance){
	if(instance && instances.includes(instance)){
		factorioAPI.init(false, 'instances/'+instance+'/mods', 'instances/'+instance+'/saves', '0.15.37');
		console.log("Authenticating to factorio.com...")
		factorioAPI.authenticate({
			username: 'Danielv123',
			token: '53faebce0a608b1195f01dcfd95ee1',
			require_ownership: false
		}).then(token => {
			console.log("Currently installed:");
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
			// Deactivated due to bug in node-factorio-api, see https://github.com/Danacus/node-factorio-api/issues/2
			
			/*factorioAPI.getModsFromSaves().then(list => {
				console.log("Mods used in save:");
				console.log(JSON.stringify(list))
				console.log(asTable(list[0].mods))
			});*/
		});
	} else {
		// list shared mods in /sharedMods/
		factorioAPI.init(false, 'sharedMods/', '', '0.15.37');
		console.log("Authenticating to factorio.com...")
		factorioAPI.authenticate({
			username: 'Danielv123',
			token: '53faebce0a608b1195f01dcfd95ee1',
			require_ownership: false
		}).then(() => {
			factorioAPI.getInstalledMods().then(mods => {
				console.log(asTable(mods));
			});
		});
	}
	
	// get JSON data about GH releases
	/*let res = syncRequest('GET', 'https://api.github.com/repos/Danielv123/factorioClusterioMod/releases', {"headers":{"User-Agent":"Fuck you for requiring user agents!"}});
	let url = JSON.parse(res.getBody())[0].assets[0].browser_download_url;
	let name = JSON.parse(res.getBody())[0].assets[0].name;
	console.log(JSON.parse(res.getBody()))
	*/
}

// 'https://api.github.com/repos/Danielv123/factorioClusterioMod/releases'
module.exports.downloadFromGitURL = function(url){
	console.log("Downloading mod from "+url);
	// get JSON data about releases
	let res = syncRequest('GET', url, {"headers":{"User-Agent":"Please don't require setting a user agent"}});
	let downloadUrl = JSON.parse(res.getBody())[0].assets[0].browser_download_url;
	let name = JSON.parse(res.getBody())[0].assets[0].name;
	console.log(JSON.parse(res.getBody()))
	if(downloadUrl) {
		console.log(downloadUrl);
		var file = fs.createWriteStream("sharedMods/"+name);
		var request = https.get(downloadUrl, function(response) {
			response.pipe(file);
			console.log("Downloaded "+name);
		});
	}
}
