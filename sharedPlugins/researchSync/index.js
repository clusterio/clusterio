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



        needle.post(this.config.masterIP + ':' + this.config.masterPort + '/api/getSlavesMeta', {
            password: this.config.clientPassword,
        }, function (err, resp, body) {
            if (err) {
                throw err;
            }

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
                    this.messageInterface("/c game.forces['player'].technologies['" + key + "'].researched=true");
                }
            })

            console.log("difference from other servers", difference);
            needle.post(this.config.masterIP + ':' + this.config.masterPort + '/api/editSlaveMeta', {
                instanceID: this.config.unique,
                password: this.config.clientPassword,
                meta: {research: this.research}
            }, function (err, resp) {
                // success?
            });
        }.bind(this));

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