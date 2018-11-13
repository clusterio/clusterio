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
				let scenarioDir = "scenarios";
				await fs.ensureDir(scenarioDir)
				let scenarios = await fs.readdir(scenarioDir);
				for(let i = 0; i < scenarios.length; i++){
					let scenPath = path.join(scenarioDir, scenarios[i]);
					let stat = await fs.stat(scenPath);
					if(stat.isDirectory){
						// let scenario = await fs.readdir(scenPath, {withFileTypes: true});
						
						// this function is bad in terms of scope since it relies on a global for return values, should be refactored.
						filesCollection = [];
						readDirectorySynchronously(scenPath);
						let scenario = filesCollection;
						let files = {};
						for(let o = 0; o < scenario.length; o++){
							let fileName = scenario[o];
							if(fileName.split(".")[1] && fileName.split(".")[1].toLowerCase() == "lua"){
								messageInterface(`Loading `/*${scenarios[i]}*/+`${fileName}`);
								let code = await clusterTools.getLua(/*path.join(scenPath, */fileName/*)*/, false);
								// trim away external path from filenames
								fileName = fileName.replace("scenarios\\factoriommoscenarios\\", "");
								files[fileName.split(".")[0]] = code;
							}
						}
						let fileImportString = `\{`;
						for(let k in files){
							let name = k.replace(/\\/g, '/');
							name = name.replace(/ /g, '');
							fileImportString += `["${name}"] = '${files[k]}', `;
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

// this function is bad in terms of scope since it relies on a global for return values, should be refactored.
var filesCollection = [];
const directoriesToSkip = ['bower_components', 'node_modules', 'www', 'platforms', '.git'];

function readDirectorySynchronously(directory) {
    var currentDirectorypath = /*path.join(__dirname + */directory//);

    var currentDirectory = fs.readdirSync(currentDirectorypath, 'utf8');

    currentDirectory.forEach(file => {
        var fileShouldBeSkipped = directoriesToSkip.indexOf(file) > -1;
        var pathOfCurrentItem = path.join(/*__dirname + */directory + '/' + file);
        if (!fileShouldBeSkipped && fs.statSync(pathOfCurrentItem).isFile()) {
            filesCollection.push(pathOfCurrentItem);
        }
        else if (!fileShouldBeSkipped) {
            var directorypath = path.join(directory, file);
            readDirectorySynchronously(directorypath);
        }
    });
}
