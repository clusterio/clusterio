const needle = require("needle");
const fs = require("fs-extra");
const path = require("path");

const clusterTools = require("_app/clusterTools")();
const pluginConfig = require("./config");

module.exports = class remoteCommands {
	constructor(mergedConfig, messageInterface, extras){
		this.messageInterface = messageInterface;
		this.config = mergedConfig;
		
		const needleOptionsWithTokenAuthHeader = {
			headers: {
				'x-access-token': this.config.masterAuthToken
			},
		};
		
		// Gather and submit statistics every 15 seconds
		setInterval(async () => {
			let stats = await this.getStats();
			stats.forEach(force => {
				needle.post(`${mergedConfig.masterIP}:${mergedConfig.masterPort}/api/logStats`, {
					instanceID: this.config.unique,
					force: force.forceName,
					data: force.data,
				}, needleOptionsWithTokenAuthHeader, (err, resp) => {
					if(!err && resp.body && resp.body.ok == false) console.log(resp.body);
				});
			});
		}, 15000);
	}
	async getStats(){
		let command = fs.readFileSync(path.join(__dirname, "Lua/exportStatistics.lua"), "utf8")//clusterTools.getLua(path.join(__dirname, "Lua/exportStatistics.lua"), false);
		let string = await this.messageInterface(`/silent-command ${command}`);
		var data;
		eval(`data = ${string}`);
		return data;
	}
}
