const fs = require('fs');
const needle = require("needle");


class ResearchSync {
    constructor(slaveConfig, messageInterface, extras = {}){
        this.config = slaveConfig;
        this.messageInterface = messageInterface;
        this.functions = this.loadFunctions();
		
        this.research = {};

        setInterval(() => {
            this.pollResearch();
			setTimeout(this.doSync.bind(this), 2000);
        }, extras.researchSyncPollInterval || 5000);
    }

    pollResearch() {
        // this.messageInterface("Polling Research\n")
        this.messageInterface(this.functions.dumpResearch);
    }

    doSync() {
        needle.post(this.config.masterIP + ':' + this.config.masterPort + '/api/getSlavesMeta', {
            password: this.config.clientPassword,
        }, (err, resp, body) => {
            if (err){
				this.messageInterface("Unable to post JSON master/api/getSlavesMeta, master might be unaccessible");
				return false;
			}
            if (resp.statusCode != 200){
                this.messageInterface("got error when calling getSlaveMeta", resp.statusCode, resp.body);
                return;
            }
            let allmeta = JSON.parse(resp.body);

            let needResearch = {};

			allmeta.forEach(instance => {
				if(instance){
					let researchList = instance.research;
					if(researchList){
						Object.keys(researchList).forEach(researchName => {
                            if (needResearch.hasOwnProperty(researchName)) {
                                if (needResearch[researchName][0] !== 0) {
                                    needResearch[researchName][0] = researchList[researchName][0];
                                }
                                if (needResearch[researchName][1] < researchList[researchName][1]) {
                                    needResearch[researchName][1] = researchList[researchName][1];
                                }
                            }
                             else {
                                needResearch[researchName] = researchList[researchName];
                            }
						});
					}
				}
			});
            let difference = this.filterResearchDiff(this.research, needResearch);
            Object.keys(difference).forEach((key) => {
                let command = this.functions.enableResearch;
                while(command.includes("{tech_name}")){
                    command = command.replace("{tech_name}", key);
                    command = command.replace("{tech_researched}", difference[key][0]);
                    command = command.replace("{tech_level}", difference[key][1]);
                }
                this.messageInterface(command);
                this.messageInterface("Unlocking research: "+key+" at state "+difference[key][0]+' and level '+difference[key][1]);
                // this.messageInterface("/c game.forces['player'].technologies['" + key + "'].researched=true");
            });
            if(Object.keys(difference).length > 0){
				this.messageInterface("difference from other servers", JSON.stringify(difference));
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

    filterResearchDiff(localResearch, remoteResearch) {
        let diff = {};
        Object.keys(localResearch).forEach((key) => {
            if (remoteResearch.hasOwnProperty(key)) {
                if (localResearch[key][0] != remoteResearch[key][0] || localResearch[key][1] != remoteResearch[key][1]) {
                    diff[key] = remoteResearch[key];
                }
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
			let researched = JSON.parse(kv[1]) === 'true' ? 1 : 0;
			let level = parseInt(kv[2]);
			this.research[name] = [researched, level];
        } catch (e) {
        }
    }
}

module.exports = ResearchSync;
