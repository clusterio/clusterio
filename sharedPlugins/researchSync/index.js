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
        if (this.isMaster) {
            setInterval(function () {
                this.pollResearch.call(this);
            }.bind(this), 3000);
        }
    }

    pollResearch() {
        this.messageInterface("Polling Research\n")
        this.messageInterface(this.functions.dumpResearch);
        console.log(this.config.master, this.config.unique, this.isMaster);
        needle.post(this.config.masterIP + ':' + this.config.masterPort + '/api/editSlaveMeta', {
            instanceID: this.config.unique,
            password: this.config.clientPassword,
            meta: {research: this.research}
        }, function (err, resp) {
            // success?
        });
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
            console.log(e);
        }
    }
}

module.exports = ResearchSync;