const fs = require('fs');
const needle = require("needle");


class ResearchSync {
    constructor(slaveConfig, messageInterface, extras = {}){
        this.config = slaveConfig;
        this.messageInterface = messageInterface;
        this.functions = this.loadFunctions();
		
        this.research = {};

        setInterval(() => {
			this.doSync();
            this.pollResearch();
        }, extras.researchSyncPollInterval || 30000);
    }

    pollResearch() {
        // this.messageInterface("Polling Research\n")
        this.messageInterface(this.functions.dumpResearch);
    }

    doSync() {
        needle.post(this.config.masterIP + ':' + this.config.masterPort + '/api/getSlavesMeta', {
            password: this.config.clientPassword,
        }, (err, resp, body) => {
            if (err) throw err;

            if (resp.statusCode != 200){
                this.messageInterface("got error when calling getSlaveMeta", resp.statusCode, resp.body);
                return;
            }
            var allmeta = JSON.parse(resp.body);

            let needResearch = {};

			allmeta.forEach(instance => {
				if(instance){
					let researchList = instance.research;
					if(researchList){
						Object.keys(researchList).forEach(researchName => {
							let researched = researchList[researchName];
							if(JSON.parse(researched)){
								needResearch[researchName] = true;
							}
						});
					}
				}
			});
            var difference = this.diff(this.research, needResearch);
            Object.keys(difference).forEach((key) => {
                if (difference[key] == 1) {
					let command = this.functions.enableResearch;
					while(command.includes("£key")){
						command = command.replace("£key", key);
					}
					this.messageInterface(command);
					this.messageInterface("Unlocking research: "+key)
                    // this.messageInterface("/c game.forces['player'].technologies['" + key + "'].researched=true");
                }
            })
			if(Object.keys(difference).length > 0){
				this.messageInterface("difference from other servers", difference);
			}
            needle.post(this.config.masterIP + ':' + this.config.masterPort + '/api/editSlaveMeta', {
                instanceID: this.config.unique,
                password: this.config.clientPassword,
                meta: {research: this.research}
            }, function (err, resp) {
                // success?
            });
        });
    }

    diff(array1, array2) {
        var diff = {};
        Object.keys(array2).forEach((element) => {
            if (array2[element] != array1[element]){
                diff[element] = array2[element];
            }
        });
        return diff;
    }

    loadFunctions() {
        return {
            dumpResearch: this.loadFunc("dumpResearch.lua"),
			enableResearch: this.loadFunc("enableResearch.lua"),
        };
    }

    loadFunc(path) {
        return fs.readFileSync("sharedPlugins/researchSync/" + path,'utf-8').replace(/\r?\n|\r/g,' ');
    }
    scriptOutput(data){
        try {
			let kv = data.split(":");
			let name = kv[0];
			let value = JSON.parse(kv[1]);
			this.research[name] = value;
        } catch (e) {
        }
    }
}

module.exports = ResearchSync;