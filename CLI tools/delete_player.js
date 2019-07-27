const needle = require("needle")
const config = require("./../config.json")
const cli = require("cli")

let options = cli.parse({
	name: ["n", "Name of the player to delete, case sensitive", "string"],
	token: [false, "Factorio auth token", "string", config.masterAuthToken]
})
if(!options.name){
	cli.getUsage()
	process.exit(1)
}

needle.post(config.masterIP+":"+config.masterPort+"/api/playerManager/deletePlayer", {
	name: options.name,
	token: options.token
}, (err, resp) => {
	console.log(resp.body)
});
