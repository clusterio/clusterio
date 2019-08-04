const fs = require("fs-extra");

const getLua = require("./getLua.js");

let commandCache;
module.exports = async function getCommand(file, COMPRESS = true){
	commandCache = commandCache || {};
	if(!commandCache[file]){
		commandCache[file] = await getLua(file);
		return commandCache[file];
	} else if(typeof commandCache[file] == "string"){
		return commandCache[file];
	} else {
		throw new Error("Command not found");
	}
}
