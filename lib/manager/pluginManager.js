const fs = require("fs-extra");
const path = require("path");
const git = require("simple-git")("./sharedPlugins");


module.exports = function(config){
	if(!config) config = require("./../../config");
	
	return {
		listPlugins: async function(){
			let plugins = await this.getPlugins();
			plugins.forEach(plug => {
				console.log(`${plug.name}`.padEnd(22).substr(0,22)+` - ${plug.description}`.substr(0,80-22));
			});
		},
		getPlugins: async function(){
			let directories = await fs.readdir("./sharedPlugins");
			let returnArray = [];
			for(let i in directories){
				let dir = directories[i];
				let pluginContents = await fs.readdir(path.join("./sharedPlugins", dir));
				// console.log(pluginContents)
				if(pluginContents.includes("config.js") || pluginContents.includes("config.json")){
					try{
						var pluginConfig = require(path.join("./../../sharedPlugins", dir, "config"));
						pluginConfig.pluginPath = path.join("./sharedPlugins", dir);
					}catch(e){
						console.log(e)
					}	
					
					fs.stat(path.join(pluginConfig.pluginPath, "DISABLED"), (err, stat)=>{
						if(err){
							pluginConfig.enabled = true;
						} else {
							pluginConfig.enabled = false;
						}
					});
					returnArray.push(pluginConfig);
				}
			}
			return returnArray;
		},
		addPlugin: function(path){
			return new Promise((resolve, reject) => {
				if(path.includes("git")){ // we are decently sure this is a git repo
					git.clone(path, data => resolve(data))
				}
			});
		},
		removePlugin: async function(name){
			let plugins = await this.getPlugins();
			for(let i in plugins){
				let plug = plugins[i];
				if(plug.name.includes(name)){
					// console.log(`Removing plugin ${plug.name}`);
					await fs.remove(plug.pluginPath);
					return {
						ok:true,
						msg:`Deleted plugin ${plug.name}`
					}
				}
			}
			return {
				ok:false,
				msg:`Plugin matching "${name}" not found`,
			}
		},
		enablePlugin: async function(name, instance){
			let plugins = await this.getPlugins();
			let plugin = plugins[findInArray("name", name, plugins)[0]];
			if(plugin){
				let files = await fs.readdir(plugin.pluginPath);
				if(files.includes("DISABLED")){
					await fs.unlink(path.join(plugin.pluginPath, "DISABLED"));
					return {
						ok:true,
						msg:`Globally enabled plugin ${name}`,
					}
				} else {
					return {
						ok:true,
						msg:`Plugin ${name} already enabled`,
					}
				}
			} else {
				return {
					ok:false,
					msg:`Found no excact match for plugin ${name}`,
				}
			}
		},
		disablePlugin: async function(name, instance){
			let plugins = await this.getPlugins();
			let plugin = plugins[findInArray("name", name, plugins)[0]];
			if(plugin){
				await fs.writeFile(path.join(plugin.pluginPath, "DISABLED"), "");
				return {
					ok:true,
					msg:`Plugin ${name} is now disabled on this host`,
				}
			} else {
				return {
					ok:false,
					msg:`Found no excact match for plugin ${name}`,
				}
			}
		}
	}
}
function findInArray(key, value, array){
	let indexes = [];
	for(let i in array){
		if(array[i][key] && array[i][key] === value) indexes.push(i);
	}
	return indexes;
}
