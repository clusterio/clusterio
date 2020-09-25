const link = require("@clusterio/lib/link");
const plugin = require("@clusterio/lib/plugin");
const errors = require("@clusterio/lib/errors");

/**
 * Format a parsed Factorio output message
 *
 * Formats a parsed Factorio output from lib/factorio back into the
 * text string it was parsed from.
 *
 * @param {Object} output - Factorio server output.
 * @returns {string} origial output text.
 * @private
 */
function formatOutput(output) {
	let time = "";
	if (output.format === "seconds") {
		time = `${output.time.padStart(8)} `;
	} else if (output.format === "date") {
		time = `${output.time} `;
	}

	let info = "";
	if (output.type === "log") {
		info = `${output.level} ${output.file}: `;

	} else if (output.type === "action") {
		info = `[${output.action}] `;
	}

	return `${time}${info}${output.message}`;
}

/**
 * Connector for control connection to master server
 * @private
 */
export class ControlConnector extends link.WebSocketClientConnector {
    constructor(url, reconnectDelay, token) {
        super(url, reconnectDelay);
        this._token = token;
    }

    register() {
        console.log("SOCKET | registering control");
        this.sendHandshake("register_control", {
            token: this._token,
            agent: "web",
            version: "2.0.0-alpha",
        });
    }
}

/**
 * Handles running the control
 *
 * Connects to the master server over WebSocket and sends commands to it.
 * @static
 */
export class Control extends link.Link {
    constructor(connector, controlPlugins) {
        super("control", "master", connector);
        link.attachAllMessages(this);

        /**
         * Mapping of plugin names to their instance for loaded plugins.
         * @type {Map<string, module:lib/plugin.BaseControlPlugin>}
         */
        this.plugins = controlPlugins;
        for (let controlPlugin of controlPlugins.values()) {
            plugin.attachPluginMessages(this, controlPlugin.info, controlPlugin);
        }
    }

    async instanceOutputEventHandler(message) {
        let { instance_id, output } = message.data;
        console.log(formatOutput(output));
        window.instanceOutputEventHandler && window.instanceOutputEventHandler({instance_id, output})
    }

    async debugWsMessageEventHandler(message) {
        console.log("WS", message.data.direction, message.data.content);
    }

    async shutdown() {
        this.connector.setTimeout(30);

        try {
            await link.messages.prepareDisconnect.send(this);
        } catch (err) {
            if (!(err instanceof errors.SessionLost)) {
                throw err;
            }
        }

        await this.connector.close(1001, "Control Quit");
    }
}
