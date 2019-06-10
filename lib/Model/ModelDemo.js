"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
console.log("started.");
const ClusterioMasterProxy_1 = require("./ClusterioMasterProxy");
const ClusterManager_1 = require("./ClusterManager");
const argv = require('minimist')(process.argv.slice(2));
let configPath = argv['configPath'];
if (configPath === undefined || configPath === null || configPath === "") {
    throw new Error("configPath is null.");
}
;
let config = require(configPath);
let proxy = new ClusterioMasterProxy_1.ClusterioMasterProxy(config.masterIP, config.masterPort, config.masterAuthToken);
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
// main
(async () => {
    let manager = new ClusterManager_1.ClusterManager();
    manager.GenerateBasicGridOfNodes(2, 2, 'GridLockTest');
    await proxy.CreateNodeInstancesOnLocalServer(manager.Grid.GetNodes());
    return;
})();
//# sourceMappingURL=ModelDemo.js.map