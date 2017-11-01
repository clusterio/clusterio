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
			console.log("authed")
			factorioAPI.getModsFromSaves().then(list => {
				console.log(list)
			});
		});
	} else {
		console.log(instance)
	}
	
	// get JSON data about GH releases
	/*let res = syncRequest('GET', 'https://api.github.com/repos/Danielv123/factorioClusterioMod/releases', {"headers":{"User-Agent":"Fuck you for requiring user agents!"}});
	let url = JSON.parse(res.getBody())[0].assets[0].browser_download_url;
	let name = JSON.parse(res.getBody())[0].assets[0].name;
	console.log(JSON.parse(res.getBody()))
	*/
}
