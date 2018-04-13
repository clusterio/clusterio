const fs = require('fs');
const needle = require("needle");


class ResearchSync {
    constructor(slaveConfig, messageInterface){
        this.functions = this.loadFunctions();
        this.config = slaveConfig;
        this.messageInterface = messageInterface;
		
        this.research = {};

        messageInterface("ResearchSync enabled");
        setInterval(() => {
			this.doSync();
            this.pollResearch();
        }, 30000);
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
                console.log("got error when calling getSlaveMeta", resp.statusCode, resp.body);
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
        return fs.readFileSync("sharedPlugins/researchSync/" + path,'utf-8').replace(/\r\n/g,' ');
    }
    scriptOutput(data){
        try {
			let research = JSON.parse(data.replace("=",":").replace("[","").replace("]",""));
            this.research = Object.assign(this.research, currentResearch);
        } catch (e) {
        }
    }
}

module.exports = ResearchSync;