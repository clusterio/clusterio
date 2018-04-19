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
        needle.get(this.config.masterIP + ':' + this.config.masterPort + '/api/slaves', (err, resp, slaveData) => {
            if (err){
				this.messageInterface("Unable to post JSON master/api/slaves, master might be unreachable");
				return false;
			}
            if (resp.statusCode !== 200){
                this.messageInterface("got error when calling slaves", resp.statusCode, resp.body);
                return;
            }

            let needResearch = {};

            Object.keys(slaveData).forEach(instanceKey => {
                if (slaveData[instanceKey].unique === this.config.unique.toString()) {
                    return;
                }
                if (!slaveData[instanceKey].hasOwnProperty('meta') || !slaveData[instanceKey].meta.hasOwnProperty('research')) {
                    return;
                }
                let researchList = slaveData[instanceKey].meta.research;
				if(researchList){
                    Object.keys(researchList).forEach(researchName => {
                        if (isNaN(researchList[researchName].researched) || isNaN(researchList[researchName].level)) {
                            return;
                        }
                        if (needResearch.hasOwnProperty(researchName)) {
                            if (needResearch[researchName].researched === 0) {
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
			});

            let difference = this.filterResearchDiff(this.research, needResearch);

            Object.keys(difference).forEach((key) => {
                if (this.research[key]) {
                    let command = this.functions.enableResearch;
                    while(command.includes("{tech_name}")){
                        command = command.replace("{tech_name}", key);
                        command = command.replace("{tech_researched}", difference[key].researched);
                        command = command.replace("{tech_level}", difference[key].level);
                    }
                    this.messageInterface(command);
                    console.log('Unlocking '+ key + ': ' + (difference[key].researched === 0 ? 'false' : 'true') + ' and level ' + difference[key].level + ', was '+ (this.research[key].researched === 0 ? 'false' : 'true') + ' at level ' + this.research[key].level);
                    this.messageInterface("Unlocking research: " + key + " at research state = " + (difference[key].researched === 0 ? 'false' : 'true') + ' and level ' + difference[key].level);
                    this.research[key] = difference[key];
                }
            });

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
                if ((localResearch[key].researched === 0 && localResearch[key].researched !== remoteResearch[key].researched) || localResearch[key].level < remoteResearch[key].level) {
                    if (!isNaN(remoteResearch[key].researched) && !isNaN(remoteResearch[key].level)) {
                        diff[key] = {researched: remoteResearch[key].researched, level: remoteResearch[key].level};
                    }
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
        let kv              = data.split(":");
        let name            = kv[0];
        let researched      = ('true' !== kv[1]
            ? 0
            : 1);
        let level           = parseInt(kv[2]);
        if (!isNaN(level) && !isNaN(researched)) {
            this.research[name] = {researched: researched, level: level};
        }
    }
}

module.exports = ResearchSync;
