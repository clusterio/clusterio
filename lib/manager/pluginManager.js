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
						let pluginConfig = require(path.join("./../../sharedPlugins", dir, "config"));
						pluginConfig.pluginPath = path.join("./sharedPlugins", dir);
						returnArray.push(pluginConfig);
					}catch(e){
						console.log(e)
					}
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
		enablePlugin: function(){
			
		},
		disablePlugin: function(){
			
		}
	}
}
