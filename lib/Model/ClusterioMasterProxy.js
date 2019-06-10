"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const child_process = require("child_process");
const needle = require("needle");
const Helpers_1 = require("./Helpers");
const fs = require("fs");
const util = require("util");
/**
 * Contains all interactions between the cluster model, the
 * Clusterio master.js/client.js infrastructure and the operating system.
 */
class ClusterioMasterProxy {
    constructor(masterIP, masterPort, masterAuthToken, serviceHostType) {
        this._masterIP = `${masterIP}:${masterPort}`;
        this._needleOptionsWithTokenAuthHeader = {
            headers: {
                'x-access-token': masterAuthToken,
            },
        };
    }
    async RunRconCommand(instanceId, command, logDescription) {
        console.log("Running command: " + logDescription);
        let request = { instanceID: instanceId, command };
        let response = await needle("post", this._masterIP + "/api/runCommand", request, this._needleOptionsWithTokenAuthHeader);
    }
    async GetSlaves() {
        let response = await needle("get", this._masterIP + "/api/slaves", this._needleOptionsWithTokenAuthHeader);
        let body = response.body;
        let slaves = new Array();
        Object.entries(body).forEach((keyValuePair, index, array) => {
            let slave = keyValuePair[1];
            slave.id = keyValuePair[0];
            slaves.push(slave);
        });
        return slaves;
    }
    async CreateNodeInstancesOnLocalServer(nodes) {
        await Helpers_1.asyncForEach(nodes, async (node) => {
            await this.CreateNodeInstanceOnLocalServer(node);
        });
        await Helpers_1.asyncForEach(nodes, async (node) => {
            await this.CreateTeleportZonesForANodeInstance(node);
        });
        await this.sleep(1000);
        await Helpers_1.asyncForEach(nodes, async (node) => {
            await this.CreateTeleportRestrictionsForANodeInstance(node);
            await this.sleep(100);
        });
    }
    async CreateNodeInstanceOnLocalServer(node) {
        console.log(`Creating instance ${node.Name}...`);
        await this.CreateNodeInstanceOnLocalServerUsingPm2(node);
        console.log("Waiting for node to connect to cluster master...");
        while (true) {
            await this.sleep(1000);
            //TODO: Use /api/getSlaveMeta/
            let slaves = await this.GetSlaves();
            let slave = slaves.find((slave, index, array) => slave.instanceName === node.Name);
            if (slave != null) {
                node.ClusterioWorldId = slave.id;
                break;
            }
        }
    }
    async CreateNodeInstanceOnLocalServerUsingPm2(node) {
        let proc = child_process.spawn("pm2", ['start', '--name', node.Name, 'client.js', '--', 'start', node.Name]);
        proc.stdout.on('data', (data) => { console.log(`stdout: ${data}`); });
        proc.stderr.on('data', data => { console.log(`stderr: ${data}`); });
        proc.on('error', error => { console.log(`error: ${error}`); });
    }
    async CreateNodeInstanceOnLocalServerUsingScreen(node) {
        // first call of client.js start for a new node creates map from HotPatch scenario then exits.
        let proc = child_process.spawn("screen", ['-dmS', node.Name, '-L', '-Logfile', node.Name + '.log', 'node', 'client.js', 'start', node.Name]);
        proc.stdout.on('data', (data) => { console.log(`stdout: ${data}`); });
        proc.stderr.on('data', data => { console.log(`stderr: ${data}`); });
        proc.on('error', error => { console.log(`error: ${error}`); });
        console.log("Waiting for creation of new map...");
        // create awaiter for fs.readFile
        const readFile = util.promisify(fs.readFile);
        while (true) {
            await this.sleep(1000);
            let fileData = await readFile(node.Name + '.log');
            if (fileData.includes('Instance created')) {
                break;
            }
        }
        // start node
        proc = child_process.spawn("screen", ['-dmS', node.Name, '-L', '-Logfile', node.Name + '.log', 'node', 'client.js', 'start', node.Name]);
        proc.stdout.on('data', data => { console.log(`stdout: ${data}`); });
        proc.stderr.on('data', data => { console.log(`stderr: ${data}`); });
        proc.on('error', error => { console.log(`error: ${error}`); });
    }
    async CreateTeleportZonesForANodeInstance(nodeInstance) {
        await Helpers_1.asyncForEach(nodeInstance.TeleportZones.values(), async (zone) => {
            let o = zone.GenerateTeleportZoneInFactorioCoordinates();
            let cmd = `CreateZone('${o[0]}',${o[1]},${o[2]},${o[3]},${o[4]},${o[5]},true)`;
            await this.RunRconCommand(nodeInstance.ClusterioWorldId, `/c remote.call('trainTeleports','runCode',\"${cmd}\")`, cmd);
        });
    }
    async CreateTeleportRestrictionsForANodeInstance(nodeInstance) {
        await Helpers_1.asyncForEach(nodeInstance.TeleportZones.values(), async (zone) => {
            let o = zone.GenerateZoneRestriction();
            let cmd = `CreateZoneRestriction(${o[0]},'${o[1]}','${o[2]}')`;
            await this.RunRconCommand(nodeInstance.ClusterioWorldId, `/c remote.call('trainTeleports','runCode',\"${cmd}\")`, cmd);
        });
    }
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}
exports.ClusterioMasterProxy = ClusterioMasterProxy;
//# sourceMappingURL=ClusterioMasterProxy.js.map