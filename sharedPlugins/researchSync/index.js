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
                                if (needResearch[researchName].researched !== 0) {
                                    needResearch[researchName].researched = parseInt(researchList[researchName].researched);
                                }
                                if (needResearch[researchName].level < parseInt(researchList[researchName].level)) {
                                    needResearch[researchName].level = parseInt(researchList[researchName].level);
                                }
                            }
                             else {
                                needResearch[researchName] = {researched: parseInt(researchList[researchName].researched), level: parseInt(researchList[researchName].level)};
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
                    command = command.replace("{tech_researched}", difference[key].researched);
                    command = command.replace("{tech_level}", difference[key].level);
                }
                this.messageInterface(command);
                this.messageInterface("Unlocking research: " + key + " at research state = " + (difference[key].researched === 0 ? 'false' : 'true') + ' and level ' + difference[key].level);
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
                if (localResearch[key].researched !== remoteResearch[key].researched || localResearch[key].level !== remoteResearch[key].level) {
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
            let kv              = data.split(":");
            let name            = kv[0];
            let researched      = ('true' !== kv[1]
                ? 0
                : 1);
            let level           = parseInt(kv[2]);
            this.research[name] = {researched: researched, level: level};
        } catch (e) {
        }
    }
}

module.exports = ResearchSync;
