const needle = require("needle");


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
				// I have no idea why I need to do JSON.stringify before passing it to needle.post,
				// but if you do forceData: force.data, it doesn't work...
				let request = {
					instanceID: this.config.unique,
					force: force.forceName,
					forceData: JSON.stringify(force.data),
				};
				needle.post(`${mergedConfig.masterURL}/api/logStats`, 
					request, 
					needleOptionsWithTokenAuthHeader, (err, resp) => {
						if(!err && resp.body && resp.body.ok == false) console.log("Error calling /api/logStats: " + resp.body);
					}
				);
			});
		}, 15000);
	}

	async getStats() {
		let string = await this.messageInterface('/sc remote.call("statisticsExporter", "export")');
		return JSON.parse(string);
	}
}
