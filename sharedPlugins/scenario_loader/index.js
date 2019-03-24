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
				await this.loadScenariosFromFolder("scenarios") // located in project root folder (with sharedMods, sharedPlugins etc)
			}
		})();
	}
	async loadScenariosFromFolder(scenarioDir){
		await fs.ensureDir(scenarioDir)
		let scenarios = await fs.readdir(scenarioDir);
		for(let i = 0; i < scenarios.length; i++){
			this.messageInterface(`Loading scenario ${scenarios[i]}`)
			let startTime = Date.now();
			let scenPath = path.join(scenarioDir, scenarios[i]);
			let stat = await fs.stat(scenPath);
			if(stat.isDirectory){
				async function loadFiles(dir, rootdir){
					let returnFiles = [];
					let entries = await fs.readdir(path.join(rootdir, dir));
					for(let o = 0; o < entries.length; o++){
						let stat = await fs.stat(path.join(rootdir, dir, entries[o]));
						if(stat.isDirectory()){
							// recurse
							let subFolder = await loadFiles(path.join(dir, entries[o]), rootdir);
							returnFiles = returnFiles.concat(subFolder);
						} else if(entries[o].split(".")[entries[o].split(".").length-1].toLowerCase() == "lua"){
							// if it is a Lua file, read its contents
							// let data = await fs.readFile(path.join(rootdir, dir, entries[o]));
							let data = await clusterTools.getLua(path.join(rootdir, dir, entries[o]), false);
							returnFiles.push({
								name: path.join(dir, entries[o].split(".")[0]),
								data,
							});
						}
						let fileMap = await loadFiles("", scenPath);
						let files = {};
						fileMap.forEach(map => {
							files[map.name] = map.data;
							console.log(map.name);
						});
						
						let fileImportString = `\{`;
						for(let k in files){
							let name = k.replace(/\\/g, '/');
							name = name.replace(/ /g, '');
							// make sure *not* to include control.lua as it is provided as a seperate argument
							if(name != "control") fileImportString += `["${name}"] = '${files[k]}', `;
						}
						fileImportString += `\}`;
						if(files.control) var returnValue = await messageInterface(`/silent-command remote.call('hotpatch', 'update', '${scenarios[i]}', '1.0.0', '${files.control}', ${fileImportString})`);
						if(returnValue) messageInterface(returnValue);
						messageInterface(`Loaded scenario ${scenarios[i]} in ${Math.floor(Date.now()-startTime)}ms`);
					}
				}
				let fileMap = await loadFiles("", scenPath);
				let files = {};
				fileMap.forEach(map => {
					files[map.name] = map.data;
					console.log(map.name);
				});
				
				let fileImportString = `\{`;
				for(let k in files){
					let name = k.replace(/\\/g, '/');
					name = name.replace(/ /g, '');
					// make sure *not* to include control.lua as it is provided as a seperate argument
					if(name != "control") fileImportString += `["${name}"] = '${files[k]}', `;
				}
				fileImportString += `\}`;
				if(files.control) var returnValue = await this.messageInterface(`/silent-command remote.call('hotpatch', 'update', '${scenarios[i]}', '1.0.0', '${files.control}', ${fileImportString})`);
				if(returnValue) this.messageInterface(returnValue);
				this.messageInterface(`Loaded scenario ${scenarios[i]} in ${Math.floor(Date.now()-startTime)}ms`);
			}
		}
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
class AsyncArray extends Array {
	constructor(arr) {
		super(arr)
		this.data = arr; // In place of Array subclassing
	}
