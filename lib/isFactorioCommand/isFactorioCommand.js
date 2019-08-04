const luamin = require("luamin");
function isFactorioCommand(command){
	if(typeof command != "string"){
		return false;
	} else if(!command.includes("/silent-command ") && !command.includes("/c ")){
		return false;
	} else if(command[0] != "/"){
		return false;
	} else {
		// check that what follows /c is valid LUA
		let x = command.replace("/silent-command ", "").replace("/c ","");
		let y
		try{
			y = luamin.minify(x);
		} catch (e) {
			return false;
		}
		
		// by this point it is surely a LUA command
		return true;
	}
}
module.exports = isFactorioCommand;