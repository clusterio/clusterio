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
let manager = new ClusterManager_1.ClusterManager();
manager.GenerateBasicGridOfNodes(2, 2, 'GridLockTest_');
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
// async function test() {
//     await asyncForEach([1,2,3], async (v, i, a) => {
//         console.log("test" + i);
//         await sleep(5000);
//     });
// }
// test();
proxy.CreateNodeInstancesOnLocalServer(manager.Grid.GetNodes());
//# sourceMappingURL=ModelController.js.map