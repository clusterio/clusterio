"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * A server. Can contain multiple nodes (Factorio server instances).
 */
class Server {
    constructor(name) {
        this.Nodes = new Array();
        this.Name = name;
    }
    AddNodeInstance(node) {
        this.Nodes.push(node);
    }
}
exports.Server = Server;
//# sourceMappingURL=Server.js.map