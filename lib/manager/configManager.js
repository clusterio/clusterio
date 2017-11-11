/**
Provides tools for managing both masters and slaves config files.
@module configManager
*/
// require modules
const asTable = require("as-table").configure({delimiter: ' | '});

// internal requires
var config = require("./../../config");
const objectOps = require("./../objectOps.js");
/**
console.log()s each entry in the config

@param {string} instance Either undefined, "shared" or the instance to show the config for.
*/
module.exports.displayConfig = function(instance){
	if(!instance || instance == "shared"){
		let configArray = [];
		Object.keys(config).forEach(key=>{
			if(key != "__comment"){
				if(typeof config[key] == "object"){
					configArray.push({entry: key, value: JSON.stringify(config[key])});
				} else configArray.push({entry: key, value: config[key]});
			}
		});
		console.log(asTable(configArray));
	}
}
module.exports.editConfig = function(instance, entry, newValue){
	if(!instance || instance == "shared"){
		if(config[entry] && newValue){
			if(objectOps.isJSON(newValue)){
				console.log("Changing config entry "+entry+" from "+JSON.stringify(config[entry])+" to "+JSON.stringify(newValue));
				config[entry] = JSON.parse(newValue);
			} else {
				console.log("Changing config entry "+entry+" from "+config[entry]+" to '"+newValue+"'");
				config[entry] = newValue;
			}
		}
	}
};
