module.exports = that => {
	/**
	 - Enable a plugin by deleting the DISABLED file
	 - Use socket.io to update masters list of plugins for this server
	
	Give standard JSON object response
	*/
	that.app.post("/api/serverManager/enablePlugin", async (req, res) => {
		if((req.body.token || req.cookies.token)
		&& req.body.instanceID
		&& typeof req.body.instanceID == "string"
		&& req.body.pluginName
		&& typeof req.body.pluginName == "string"
		&& that.playerManager){
			let perms = await that.playerManager.main.getPermissions((req.body.token || req.cookies.token));
			if(perms.cluster.includes("enablePlugin")
			|| (perms.instance[req.body.instanceID]
			&& perms.instance[req.body.instanceID].includes("enablePlugin"))){
				that.serverSockets[req.body.instanceID].socket.emit("serverManagerEnablePlugin", {
					name: req.body.pluginName,
					instanceID: req.body.instanceID,
				}, async resp => {
					if(resp.ok){
						await updateData("plugins", req.body.instanceID);
					}
					res.send(resp);
				});
			} else {
				res.send({
					ok:false,
					msg:"Insufficient permissions",
				});
			}
		} else {
			res.send({
				ok:false,
				msg:"Invalid request body",
			});
		}
	});
	/**
	 - Disable a plugin by adding an empty file named DISABLED to the plugins install pathname
	 - Use socket.io to update masters lost of plugins for this server
	 
	Give standard JSON object response
	*/
	that.app.post("/api/serverManager/disablePlugin", async (req, res) => {
		if((req.body.token || req.cookies.token)
		&& req.body.instanceID
		&& typeof req.body.instanceID == "string"
		&& req.body.pluginName
		&& typeof req.body.pluginName == "string"
		&& that.playerManager){
			let perms = await that.playerManager.main.getPermissions((req.body.token || req.cookies.token));
			if(perms.cluster.includes("disablePlugin")
			|| (perms.instance[req.body.instanceID]
			&& perms.instance[req.body.instanceID].includes("disablePlugin"))){
				that.serverSockets[req.body.instanceID].socket.emit("serverManagerDisablePlugin", {
					name: req.body.pluginName,
					instanceID: req.body.instanceID,
				}, async resp => {
					if(resp.ok){
						await updateData("plugins", req.body.instanceID);
					}
					res.send(resp);
				});
			} else {
				res.send({
					ok:false,
					msg:"Insufficient permissions",
				});
			}
		} else {
			res.send({
				ok:false,
				msg:"Invalid request body",
			});
		}
	});
	async function updateData(type, instanceID){
		// Retrieve the latest ${type} from the server and store it
		if(type == "plugins"){
			that.serverSockets[instanceID].socket.emit("serverManagerGetPlugins", {}, data => {
				that.serverSockets[instanceID].plugins = data;
			});
		}
	}
}
