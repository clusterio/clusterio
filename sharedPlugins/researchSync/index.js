var fs = require('fs');
const nodelua = require('node-lua');
const needle = require("needle");


class ResearchSync {

    constructor(slaveConfig, messageInterface){
        this.functions = this.loadFunctions();
        this.config = slaveConfig;
        this.messageInterface = messageInterface;

        this.research = {};
        this.lua = new nodelua.LuaState();
        this.isMaster = this.config.master == this.config.unique;

        messageInterface("ResearchSync enabled");
        setInterval(function () {
            this.pollResearch.call(this);
            setTimeout(this.doSync.bind(this), 2)
        }.bind(this), 2000);

    }

    pollResearch() {
        this.messageInterface("Polling Research\n")
        this.messageInterface(this.functions.dumpResearch);

    }

    doSync() {
        if (this.isMaster) {
            needle.post(this.config.masterIP + ':' + this.config.masterPort + '/api/editSlaveMeta', {
                instanceID: this.config.unique,
                password: this.config.clientPassword,
                meta: {research: this.research}
            }, function (err, resp) {
                // success?
            });
        } else {
            console.log(this.config.masterIP, this.config.masterPort, this.config.master)
            needle.post(this.config.masterIP + ':' + this.config.masterPort + '/api/getSlaveMeta', {
                instanceID: this.config.master,
                password: this.config.clientPassword,
            }, function (err, resp, body) {
                if (err) {
                    throw err;
                }

                if (resp.statusCode != 200){
                    console.log("got error when calling getSlaveMeta", resp.statusCode, resp.body);
                    return;
                }
                var mastermeta = JSON.parse(resp.body);

                var difference = this.diff(this.research, mastermeta.research);

                Object.keys(difference).forEach((key) => {
                    this.messageInterface("/c game.forces['player'].technologies['"+key+"'].researched="+ (difference[key] == 1? "true": "false"));

                })

                console.log("difference from master", difference);
                // success?
            }.bind(this));
        }
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
            dumpResearch: this.loadFunc("dumpResearch.lua")
        };
    }

    loadFunc(path) {
        return fs.readFileSync("sharedPlugins/researchSync/" + path,'utf-8').replace(/\r\n/g,' ');
    }
    scriptOutput(data){
        try {
            this.lua.DoString("a = " + data);
            this.lua.GetGlobal("a");
            let currentResearch = this.lua.ToValue(-1);
            this.research = Object.assign(this.research, currentResearch);
            this.lua.Pop();
        } catch (e) {
        }
    }
}

module.exports = ResearchSync;