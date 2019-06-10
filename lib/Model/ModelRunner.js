"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
console.log("Started.");
const ClusterioMasterProxy_1 = require("./ClusterioMasterProxy");
const ClusterManager_1 = require("./ClusterManager");
const argv = require('minimist')(process.argv.slice(2));
// arg: configPath
// description: should point to the clusterio config.json file.
let configPath = argv['configPath'];
if (configPath === undefined || configPath === null || configPath === "") {
    configPath = "../../config.json";
}
;
let config = require(configPath);
// arg: mode
// description: should be GenerateBasicGridOfNodes for now. Can extend in future.
let mode = argv['mode'];
if (mode === undefined || mode === null || mode === "") {
    throw new Error("mode is null. mode must be 'GenerateBasicGridOfNodes' (for now).");
}
;
// arg: serviceHostType
// description: what program to use to host the client.js instances.
let serviceHostType = argv['serviceHostType'];
if (serviceHostType === undefined || serviceHostType === null || serviceHostType === "") {
    throw new Error("serviceHostType is null. serviceHostType must be either 'pm2' or 'screen'.");
}
;
if (serviceHostType != "pm2" && serviceHostType != "screen") {
    throw new Error("serviceHostType must be either 'pm2' or 'screen'.");
}
// arg: width
// description: width of node grid
let width = argv['width'];
if (width === undefined || width === null || width === "") {
    throw new Error("width is null. width must be an int > 0.");
}
;
// arg: height
// description: height of node grid
let height = argv['height'];
if (height === undefined || height === null || height === "") {
    throw new Error("height is null. height must be an int > 0.");
}
;
// arg: namePrefix
// description: namePrefix of node grid
let namePrefix = argv['namePrefix'];
if (namePrefix === undefined || namePrefix === null || namePrefix === "") {
    throw new Error("namePrefix is null.");
}
;
let proxy = new ClusterioMasterProxy_1.ClusterioMasterProxy(config.masterIP, config.masterPort, config.masterAuthToken, serviceHostType);
// main
(async () => {
    let manager = new ClusterManager_1.ClusterManager();
    manager.GenerateBasicGridOfNodes(width, height, namePrefix);
    await proxy.CreateNodeInstancesOnLocalServer(manager.Grid.GetNodes());
    return;
})();
//# sourceMappingURL=ModelRunner.js.map