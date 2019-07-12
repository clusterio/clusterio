const fs = require('fs');
const needle = require("needle");

function format_tech(tech) {
    return `${!!tech.researched} at level ${tech.level}`
}


function log_tech_unlocking(key, current, prev) {
    console.log(
        `Unlocking ${key}: ${format_tech(current)}, was ${format_tech(prev)}`
    );
}


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
        const slaves_data_url = `${this.config.masterIP}:${this.config.masterPort}/api/slaves`
        needle.get(slaves_data_url, (err, resp, slavesData) => {
            if (err) {
				this.messageInterface("Unable to post JSON master/api/slaves, master might be unreachable");
				return false;
			}
            if (resp.statusCode !== 200) {
                this.messageInterface("got error when calling slaves", resp.statusCode, resp.body);
                return;
            }

            let needResearch = {};
            for (let slave_data of Object.values(slavesData)) {
                if (slave_data.unique === this.config.unique.toString())
                    continue;

                if (!slave_data.meta || !slave_data.meta.research)
                    continue;

                let researchList = slave_data.meta.research;
                for (let [researchName, research] of Object.entries(researchList)) {
                    if (isNaN(research.researched) || isNaN(research.level))
                        continue;

                    if (needResearch[researchName]) {
                        if (needResearch[researchName].researched === 0) {
                            needResearch[researchName].researched = parseInt(research.researched);
                        }
                        if (needResearch[researchName].level < parseInt(research.level)) {
                            needResearch[researchName].level = parseInt(research.level);
                        }
                    }
                    else {
                        needResearch[researchName] = {
                            researched: parseInt(researchList[researchName].researched),
                            level: parseInt(researchList[researchName].level)
                        };
                    }
                }
			}

            let difference = this.filterResearchDiff(this.research, needResearch);

            Object.keys(difference).forEach((key) => {
                if (!this.research[key])
                    return
                let command = this.functions.enableResearch;
                command = command.replace(/{tech_name}/g, key);
                command = command.replace(/{tech_researched}/g, difference[key].researched);
                command = command.replace(/{tech_level}/g, difference[key].level);
                this.messageInterface(command);
                log_tech_unlocking(key, difference[key], this.research[key])
                this.messageInterface(
                    `Unlocking research: ${key} with research state ${format_tech(difference[key])}`
                );
                this.research[key] = difference[key];
            });

            needle.post(this.config.masterIP + ':' + this.config.masterPort + '/api/editSlaveMeta', {
                instanceID: this.config.unique,
                password: this.config.clientPassword,
                meta: {research: this.research}
            }, {headers: {'x-access-token': this.config.masterAuthToken}}, function (err, resp) {
                // success?
            });
        });
    }

    filterResearchDiff(localResearch, remoteResearch) {
        let diff = {};
        for (let key in localResearch) {
            if (!remoteResearch[key])
                continue
            if (isNaN(remoteResearch[key].researched) || isNaN(remoteResearch[key].level))
                continue

            if (remoteResearch[key].researched > localResearch[key].researched
                || remoteResearch[key].level > localResearch[key].level) {
                diff[key] = {
                    researched: remoteResearch[key].researched,
                    level: remoteResearch[key].level
                };
            }
        }
        return diff;
    }

    loadFunctions() {
        return {
            dumpResearch: this.loadFunc("dumpResearch.lua"),
			enableResearch: this.loadFunc("enableResearch.lua"),
        };
    }

    loadFunc(path) {
        let command = fs.readFileSync("sharedPlugins/researchSync/" + path,'utf-8')
        command = command.replace(/\r?\n|\r/g,' ')
        command = '/silent-command ' + command
        return command;
    }
    scriptOutput(data) {
        let [name, researched, level] = data.split(":")
        researched = +(researched === 'true');
        level = parseInt(level);
        if (!isNaN(level) && !isNaN(researched)) {
            this.research[name] = {researched: researched, level: level};
        }
    }
}

module.exports = ResearchSync;
