module.exports = async function checkHotpatchInstallation(messageInterface){
	let yn = await messageInterface("/silent-command if remote.interfaces['hotpatch'] then rcon.print('true') else rcon.print('false') end");
	yn = yn.replace(/(\r\n\t|\n|\r\t)/gm, "");
	if(yn == "true"){
		return true;
	} else if(yn == "false"){
		return false;
	}
}
