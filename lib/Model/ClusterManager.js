"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const NodeInstance_1 = require("./NodeInstance");
const Point_1 = require("./Point");
const Grid_1 = require("./Grid");
/**
 * Manages all nodes within the cluster
 */
class ClusterManager {
    constructor() {
        this.Grid = new Grid_1.Grid();
    }
    /**
     * Generates a x*y grid of 1x1 nodes
     * @param width How wide to make the node grid
     * @param height How high to make the node grid
     * @param nodeNamePrefix The prefix used for the initial node names. The name will be in the format <prefix>_x_y.
     */
    GenerateBasicGridOfNodes(width, height, nodeNamePrefix) {
        for (let x = 0; x < width; x++) {
            for (let y = 0; y < height; y++) {
                let newNode = new NodeInstance_1.NodeInstance(nodeNamePrefix + "-" + (x + 1) + "-" + (y + 1), new Point_1.Point(x, y), 1, 1);
                this.Grid.AddNodeToGrid(newNode);
            }
        }
    }
    /**
     * Assigns all nodes that currently do not have a server assigned to the given server
     * @param server Server to assign all unassigned nodes to
     */
    AssignAllUnassignedNodesToServer(server) {
        this.CheckServerArray(server);
        this.Grid.GetNodes()
            .filter(node => { node.Server === null; })
            .forEach(node => {
            server.AddNodeInstance(node);
            node.Server = server;
        });
    }
    /**
     * Assigns a node to a server
     * @param x x co-ordinate of the node
     * @param y y co-ordinate of the node
     * @param serverName server name
     */
    AssignNodeToServer(x, y, server) {
        this._nodeArray[x][y].Server = server;
    }
    CheckServerArray(server) {
        let s = this._servers[server.Name];
        if (s == null) {
            this._servers[server.Name] = server;
        }
    }
}
exports.ClusterManager = ClusterManager;
//# sourceMappingURL=ClusterManager.js.map