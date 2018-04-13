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

            Object.entries(allmeta).map((instance) => {
                if (instance[1] == null || instance[1].research == null) return;
                Object.entries(instance[1].research).map((research) => {
                    if (research[1] == 1) {
                        needResearch[research[0]] = 1;
                    }
                });
            })

            var difference = this.diff(this.research, needResearch);

            Object.keys(difference).forEach((key) => {
                if (difference[key] == 1) {
					let command = this.functions.enableResearch;
					while(command.includes("£key")){
						command = command.replace("£key", key);
					}
					this.messageInterface(command);
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
			// remove Lua table junk
			let currentResearch = data.replace("=",":").replace("[","").replace("]","").replace('"', "").replace('"', "");
			// add first " before key
			currentResearch = '{"' + currentResearch.slice(1);
			// add second " after the key to make it a string
			currentResearch = currentResearch.split(" ")[0] + '"' + currentResearch.slice(currentResearch.split(" ")[0].length);
			// turn our constructed JSON string into an object
			currentResearch = JSON.parse(currentResearch);
			// console.log(currentResearch)
            this.research = Object.assign(this.research, currentResearch);
        } catch (e) {
        }
    }
}

module.exports = ResearchSync;