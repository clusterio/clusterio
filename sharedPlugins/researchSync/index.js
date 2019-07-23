const fs = require('fs');
const path = require('path')
const needle = require("needle");


function time() {
    let d = new Date()
    return `${d.getUTCHours()}:${d.getUTCMinutes()}:${d.getUTCSeconds()}.${d.getUTCMilliseconds()}`
}

class ResearchSync {
    constructor(slaveConfig, messageInterface, extras = {}){
        this.config = slaveConfig
        this.messageInterface = messageInterface

        this.functions = {
            dumpResearch: this.loadFunc("dumpResearch.lua"),
			enableResearch: this.loadFunc("enableResearch.lua"),
            updateProgress: this.loadFunc("updateProgress.lua")
        }

        this.log_folder = './logs'
        if (!fs.existsSync(this.log_folder))
            fs.mkdirSync(this.log_folder);
        this.log_file = path.join(this.log_folder, `${this.config.unique}-research.log`)
        this.get_node_name_and_move_log()

        this.research = {}
        this.prev_research = {}
        this.initial_request_own_data(
            () => this.setup_sync_task(extras)
        )
    }

    log(data) {
        try {
            console.log(`researchSync: ${data}`)
            fs.appendFileSync(this.log_file, `${time()}: ${data}\n`);
        } catch (e) {
            console.error(e)
        }
    }

    error(data) {
        try {
            console.error(`researchSync: ${data}`)
            fs.appendFileSync(this.log_file, `${time()}: ${data}\n`);
        } catch (e) {
            console.error(e)
        }
    }

    get_node_name_and_move_log() {
        const url = `${this.config.masterIP}:${this.config.masterPort}/api/slaves`
        needle.get(url, (err, res, slaves_data) => {
            if (err)
                return this.error(err)

            slaves_data = Object.values(slaves_data)
            let node_data = slaves_data.find(
                slave_data => slave_data.unique === this.config.unique.toString()
            )
            if (node_data === undefined)
                return this.error('slave was not found')
            let node_name = node_data.instanceName
            let log_file = path.join(this.log_folder, `${node_name}-research.log`)
            if (fs.existsSync(log_file)) {
                fs.appendFileSync(log_file, fs.readFileSync(this.log_file));
                fs.unlinkSync(this.log_file)
            } else {
                fs.renameSync(this.log_file, log_file)
            }
            this.log_file = log_file
        })
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
                this.log(`Can't get own slave data:`)
                this.error(err)
                return
            }
            if (res.statusCode === 404) {
                this.log('slave is not registered yet. Delaying for 5 secs')
                setTimeout(
                    () => this.initial_request_own_data(callback),
                    5000
                )
                return
            }
            if (res.statusCode !== 200) {
                this.log(`Can't get own slave data:`)
                this.error(`status code ${res.statusCode}, ${res.body}`)
                return
            }
            techs = JSON.parse(techs)
            if (typeof techs.research === 'object')
                this.research = techs.research
            this.log('techs imported from master')
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

        this.clear_contribution_to_researched_techs()
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
        }, {headers: {'x-access-token': this.config.masterAuthToken}, json: true}, (err, resp) => {
            if (err)
                this.error(err)
        })
    }

    clear_contribution_to_researched_techs() {
        // if between updates tech was researched
        if (!this.prev_research)
            return
        for (let [name, research] of Object.entries(this.research)) {
            let researched
            if (research.infinite)
                researched = this.prev_research[name].level < research.level
            else
                researched = this.prev_research[name].researched < research.researched

            if (researched)
                research.contribution = 0
        }
    }

    get_cluster_techs(slavesData) {
        let cluster_techs = {}
        for (let slave_data of slavesData) {
            let node_researches = slave_data.meta.research
            for (let [name, node_tech] of Object.entries(node_researches)) {
                if (isNaN(node_tech.researched) || isNaN(node_tech.level) || isNaN(node_tech.infinite))
                    continue

                if (cluster_techs[name]) {
                    if (cluster_techs[name].infinite === 1 && cluster_techs[name].level < node_tech.level) {
                        cluster_techs[name].level = node_tech.level
                    } else if (node_tech.researched > cluster_techs[name].researched) {
                        cluster_techs[name].researched = 1
                    }
                } else {
                    cluster_techs[name] = node_tech
                }
            }
        }
        return cluster_techs
    }

    recount_cluster_research_progress(slaves_data, cluster_researches) {
        for (let [name, research] of Object.entries(cluster_researches))
            research.progress = this.research[name].contribution

        for (let slave_data of slaves_data) {
            for (let [name, research] of Object.entries(slave_data.meta.research)) {
                if (!cluster_researches[name])
                    continue
                if (isNaN(cluster_researches[name].progress)
                    || isNaN(research.contribution)
                    || isNaN(research.level)
                    || isNaN(cluster_researches[name].level))
                    continue
                if (cluster_researches[name].level === research.level)
                    cluster_researches[name].progress += research.contribution
            }
        }

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

            let researched
            if (local_researches[key].infinite)
                researched = local_researches[key].level < cluster_researches[key].level
            else
                researched = local_researches[key].researched < cluster_researches[key].researched

            if (researched)
                result[key] = cluster_researches[key]
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
        for (let name of Object.keys(to_research))
            if (!this.research[name])
                delete to_research[name]

        const notify = Object.keys(to_research).length === 1
        for (let [name, tech] of Object.entries(to_research)) {
            this.research[name].contribution = 0
            this.research[name].progress = null
            let command = this.functions.enableResearch;
            command = command.replace(/{tech_name}/g, name);
            command = command.replace(/{tech_researched}/g, tech.researched);
            command = command.replace(/{tech_level}/g, tech.level);
            command = command.replace(/{tech_infinite}/g, tech.infinite);
            command = command.replace(/{notify}/g, notify);
            this.messageInterface(command);
            let log_message = tech.infinite
                ? `Unlocking infinite research ${name} at level ${this.research[name].level}`
                : `Unlocking research ${name}`
            this.log(log_message);
            this.messageInterface(log_message);
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
            this.log(
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
                this.log(`Own research ${name}: ${this.research[name].progress} += ${diff}`)
        }
    }

    loadFunc(path, silent=true) {
        let command = fs.readFileSync("sharedPlugins/researchSync/" + path,'utf-8')
        command = command.replace(/\r?\n|\r/g,' ')
        command = (silent ? '/silent-command ' : '/c ') + command
        return command;
    }
    scriptOutput(data) {
        let [name, researched, level, progress, infinite] = data.split(":")
        researched = +(researched === 'true')
        infinite = +(infinite === 'true')
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
                infinite,
            }
        }
        this.research[name] = {
            researched,
            level,
            progress,
            contribution: this.prev_research[name].contribution,
            infinite
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
