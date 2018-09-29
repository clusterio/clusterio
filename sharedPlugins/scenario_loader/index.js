const fs = require("fs-extra");
const path = require("path");
const clusterTools = require("_app/clusterTools")();

module.exports = class remoteCommands {
	constructor(mergedConfig, messageInterface, extras){
		this.messageInterface = messageInterface;
		this.config = mergedConfig;
		
		(async () => {
			let hotpatchInstallStatus = await this.checkHotpatchInstallation();
			messageInterface("Hotpach installation status: "+hotpatchInstallStatus);
			if(hotpatchInstallStatus){
				let scenarioDir = path.join(__dirname, "scenarios");
				await fs.ensureDir(scenarioDir)
				let scenarios = await fs.readdir(scenarioDir);
				for(let i = 0; i < scenarios.length; i++){
					let scenPath = path.join(scenarioDir, scenarios[i]);
					let stat = await fs.stat(scenPath);
					if(stat.isDirectory){
						let scenario = await fs.readdir(scenPath);
						let files = {};
						for(let o = 0; o < scenario.length; o++){
							let fileName = scenario[o];
							if(fileName.split(".")[1] && fileName.split(".")[1].toLowerCase() == "lua"){
								messageInterface(`Loading ${scenarios[i]}/${fileName}`);
								let code = await clusterTools.getLua(path.join(scenPath, fileName), false);
								files[fileName.split(".")[0]] = code;
							}
						}
						let fileImportString = `\{`;
						for(let k in files){
							fileImportString += `${k} = '${files[k]}, '`;
						}
						fileImportString += `\}`;
							
						if(files.control) var returnValue = await messageInterface(`/silent-command remote.call('hotpatch', 'update', '${scenarios[i]}', '1.0.0', '${files.control}', ${fileImportString})`);
						if(returnValue) messageInterface(returnValue);
					}
				}
			}
		})();
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
