const needle = require("needle");
const cli = require("cli");
const config = require("./../config.json");

let options = cli.parse()
cli.setUsage(`node cluster_rcon /c game.player.force = "player"`)
if(process.argv.length < 3){
	cli.getUsage()
	process.exit(1)
}

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
	needle.post(config.masterURL+"/api/runCommand", {
		broadcast:true,
		command,
	}, needleOptionsWithTokenAuthHeader, (err, resp) => {
		console.log(resp.body)
	});
	// setInterval(()=>{
		// needle.post(config.masterURL+"/api/runCommand", {
		// broadcast:true,
		// command: killBiters,
	// }, needleOptionsWithTokenAuthHeader, (err, resp) => {
		// console.log(resp.body)
	// });
	// }, 1000*60*5);
})();
