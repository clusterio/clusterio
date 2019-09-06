const needle = require("needle");

module.exports = function(config){
	const instances = [];
	
	if(config){
		return function getInstanceName(instanceID){
			return new Promise((resolve, reject) => {
				let instance = instances[instanceID];
				if(!instance){
					needle.get(config.masterURL + '/api/slaves', { compressed: true }, (err, response) => {
						if(err || response.statusCode != 200) {
							console.log("Unable to get JSON master/api/slaves, master might be unaccessible");
						} else if (response && response.body) {	
							if(Buffer.isBuffer(response.body)) {console.log(response.body.toString("utf-8")); reject(new Error())}
								try {
									for (let index in response.body)
										instances[index] = response.body[index].instanceName;
								} catch (e){
									console.log(e);
									return null;
								}
							instance = instances[instanceID] 							
							if (!instance) instance = instanceID;  //somehow the master doesn't know the instance	
							resolve(instance);
						}
					});
				} else {
					resolve(instance);
				}
			});
		}
	} else {
		return async function thisAintGonnaWork(){
			let err = new Error("getInstanceName from lib/clusterTools needs to be called with {config} to work");
			console.log(err);
			throw err;
		}
	}
}
