const needle = require("needle");
const config = require("./config.json");

const masterIP = `${config.masterIP}:${config.masterPort}`;
const token = config.masterAuthToken
let commandArray = process.argv;
commandArray.shift();
commandArray.shift();
const needleOptionsWithTokenAuthHeader = {
	headers: {
		'x-access-token': token,
	},
};

let command = commandArray.join(" ");
let killBiters = `/silent-command local surface=game.surfaces[1] for key, entity in pairs(surface.find_entities_filtered({force="enemy"})) do entity.destroy() end`;

(async ()=>{
	needle.post(masterIP+"/api/runCommand", {
		broadcast:true,
		command,
	}, needleOptionsWithTokenAuthHeader, (err, resp) => {
		console.log(resp.body)
	});
	// setInterval(()=>{
		// needle.post(masterIP+"/api/runCommand", {
		// broadcast:true,
		// command: killBiters,
	// }, needleOptionsWithTokenAuthHeader, (err, resp) => {
		// console.log(resp.body)
	// });
	// }, 1000*60*5);
})();