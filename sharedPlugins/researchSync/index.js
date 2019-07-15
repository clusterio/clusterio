const fs = require('fs');
const needle = require("needle");

function format_tech(tech) {
    return `${!!tech.researched} at level ${tech.level}`
}


class ResearchSync {
    constructor(slaveConfig, messageInterface, extras = {}){
        this.config = slaveConfig;
        this.messageInterface = messageInterface;
        this.functions = {
            dumpResearch: this.loadFunc("dumpResearch.lua"),
			enableResearch: this.loadFunc("enableResearch.lua"),
            updateProgress: this.loadFunc("updateProgress.lua")
        }

        this.research = {};
        this.prev_research = {};
        this.initial_request_own_data(
            () => this.setup_sync_task(extras)
        )
    }

    initial_request_own_data(callback) {
        const url = `${this.config.masterIP}:${this.config.masterPort}/api/getSlaveMeta`
        const data = {
            instanceID: this.config.unique,
            password: this.config.clientPassword,
        }
        const options = {
            headers: {'x-access-token': this.config.masterAuthToken},
            json: true
        }
        needle.post(url, data, options, (err, res, techs) => {
            if (err) {
                console.log(`Can't get own slave data:`)
                console.error(err)
                return
            }
            if (res.statusCode !== 200) {
                console.log(`Can't get own slave data:`)
                console.error(`status code ${res.statusCode}, ${res.body}`)
                return
            }
            techs = JSON.parse(techs)
            if (typeof techs.research === 'object')
                this.research = techs.research
            callback()
        })
    }

    setup_sync_task(extras) {
        const timeout = extras.researchSyncPollInterval || 5000
        setInterval(() => this.sync_task(), timeout);
    }

    sync_task() {
        this.messageInterface(this.functions.dumpResearch);
        setTimeout(this.request_cluster_data.bind(this), 2000);
    }

    request_cluster_data() {
        const slaves_data_url = `${this.config.masterIP}:${this.config.masterPort}/api/slaves`
        needle.get(slaves_data_url, this.sync_researches.bind(this))
    }

    sync_researches(err, resp, slaves_data) {
        if (err) {
            this.messageInterface("Unable to post JSON master/api/slaves, master might be unreachable");
            return false;
        }
        if (resp.statusCode !== 200) {
            this.messageInterface("got error when calling slaves", resp.statusCode, resp.body);
            return;
        }

        slaves_data = Object.values(slaves_data)
        slaves_data = slaves_data.filter(
            slave_data => slave_data.unique !== this.config.unique.toString()
                && slave_data.meta && slave_data.meta.research
        )

        let cluster_techs = this.get_cluster_techs(slaves_data)
        this.recount_cluster_research_progress(slaves_data, cluster_techs)

        let to_research = this.filter_researched_techs(cluster_techs)
        let to_update_progress = this.filter_updated_techs(cluster_techs, to_research)

        this.research_technologies(to_research)
        this.update_technologies_progress(to_update_progress)

        this.print_own_contribution()

        needle.post(this.config.masterIP + ':' + this.config.masterPort + '/api/editSlaveMeta', {
            instanceID: this.config.unique,
            password: this.config.clientPassword,
            meta: {research: this.research}
        }, {headers: {'x-access-token': this.config.masterAuthToken}, json: true}, function (err, resp) {
            if (err)
                console.error(err)
            else
                console.log('sent')
        });
    }

    get_cluster_techs(slavesData) {
        let researches = {}
        for (let slave_data of slavesData) {
            let node_researches = slave_data.meta.research
            for (let [name, research] of Object.entries(node_researches)) {
                if (isNaN(research.researched) || isNaN(research.level))
                    continue

                if (researches[name]) {
                    if (researches[name].researched === 0) {
                        researches[name].researched = research.researched
                    }
                    if (researches[name].level < research.level) {
                        researches[name].level = research.level
                    }
                } else {
                    researches[name] = research
                }
            }
        }
        return researches
    }

    recount_cluster_research_progress(slaves_data, cluster_researches) {
        for (let [name, research] of Object.entries(cluster_researches))
            research.progress = this.research[name].contribution

        for (let slave_data of slaves_data)
            for (let [name, research] of Object.entries(slave_data.meta.research))
                if (!isNaN(cluster_researches[name].progress) && !isNaN(research.contribution))
                    cluster_researches[name].progress += research.contribution

        for (let [name, research] of Object.entries(cluster_researches)) {
            if (research.progress > 1) {
                research.progress = null
                research.researched = 1
                this.research[name].contribution = 0
                research.contribution = 0
                if (this.research[name].level >= research.level)
                    research.level = this.research[name].level + 1
            }
        }
    }

    filter_researched_techs(cluster_researches) {
        let local_researches = this.research
        let result = {};
        for (let key in local_researches) {
            if (!cluster_researches[key])
                continue
            if (isNaN(cluster_researches[key].researched) || isNaN(cluster_researches[key].level))
                continue

            if (cluster_researches[key].researched > local_researches[key].researched
                || cluster_researches[key].level > local_researches[key].level) {
                result[key] = cluster_researches[key]
            }
        }
        return result;
    }

    filter_updated_techs(cluster_techs, to_research) {
        let local_techs = this.research
        let result = {}
        for (let name in local_techs) {
            if (name in to_research || !cluster_techs[name])
                continue
            if (isNaN(cluster_techs[name].progress))
                continue
            if (local_techs[name].progress < cluster_techs[name].progress)
                result[name] = cluster_techs[name]
        }
        return result
    }

    research_technologies(to_research) {
        for (let [name, tech] of Object.entries(to_research)) {
            if (!this.research[name])
                continue
            this.research[name].contribution = 0
            this.research[name].progress = null
            let command = this.functions.enableResearch;
            command = command.replace(/{tech_name}/g, name);
            command = command.replace(/{tech_researched}/g, tech.researched);
            command = command.replace(/{tech_level}/g, tech.level);
            this.messageInterface(command);
            console.log(
                `Unlocking ${name}: ${format_tech(tech)}, was ${format_tech(this.research[name])}`
            );
            this.messageInterface(
                `Unlocking research: ${name} with research state ${format_tech(tech)}`
            );
            this.research[name] = tech;
        }
    }

    update_technologies_progress(to_update) {
        for (let [name, tech] of Object.entries(to_update)) {
            if (!this.research[name])
                continue
            let progress = this.research[name].progress
            if (progress === null)
                progress = 'nil'
            let command = this.functions.updateProgress
            command = command.replace(/{tech_name}/g, name)

            command = command.replace(/{last_check_progress}/g, progress)
            command = command.replace(/{new_progress}/g, tech.progress)
            this.messageInterface(command);
            console.log(
                `Updating ${name}: ${this.research[name].progress} += ${tech.progress - this.research[name].progress}`
            );
            this.research[name].progress = tech.progress
        }
    }

    print_own_contribution() {
        if (!this.prev_research)
            return
        for (let [name, tech] of Object.entries(this.research)) {
            if (!this.prev_research[name])
                continue
            let diff = this.research[name].contribution - this.prev_research[name].contribution
            if (Math.abs(diff) > Number.EPSILON * 1000)
                console.log(`Own research ${name}: ${this.research[name].progress} += ${diff}`)
        }
    }

    loadFunc(path, silent=true) {
        let command = fs.readFileSync("sharedPlugins/researchSync/" + path,'utf-8')
        command = command.replace(/\r?\n|\r/g,' ')
        command = (silent ? '/silent-command ' : '/c ') + command
        return command;
    }
    scriptOutput(data) {
        let [name, researched, level, progress] = data.split(":")
        researched = +(researched === 'true');
        level = parseInt(level);
        if (progress === 'nil')
            progress = null
        else
            progress = parseFloat(progress)

        if (isNaN(level) || isNaN(researched))
            return
        this.prev_research[name] = this.research[name]
        if (!this.prev_research[name]) {
            this.prev_research[name] = {
                researched: null,
                level: null,
                progress: null,
                contribution: 0,
            }
        }
        this.research[name] = {
            researched,
            level,
            progress,
            contribution: this.prev_research[name].contribution
        }
        if (this.prev_research[name].progress && this.research[name].progress) {
            // this.prev_research[name].progress gets updated to overall cluster progress
            // therefore contribution should be own research progress change over sync interval
            let contribution = this.research[name].progress - this.prev_research[name].progress
            this.research[name].contribution += contribution
        }
        if (Math.abs(this.research[name].contribution) < Number.EPSILON * 1000) {
            // if contribution should be 0 but because of floating-point precision is e.g. 2.2564e-18
            this.research[name].contribution = 0
        }
    }
}

module.exports = ResearchSync;
