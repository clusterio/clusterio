const link = require("./../lib/link");
const plugin = require("./../lib/plugin");
const errors = require("./../lib/errors");
const chalk = require("chalk");
/**
 * Format a parsed Factorio output message with colors
 *
 * Formats a parsed Factorio output from lib/factorio into a readable
 * colorized output using terminal escape codes that can be printed.
 *
 * @param {Object} output - Factorio server output.
 * @returns {string} terminal colorized message.
 * @private
 */
function formatOutputColored(output) {
	let time = "";
	if (output.format === "seconds") {
		time = chalk.yellow(output.time.padStart(8)) + " ";
	} else if (output.format === "date") {
		time = chalk.yellow(output.time) + " ";
	}

	let info = "";
	if (output.type === "log") {
		let level = output.level;
		if (level === "Info") {
			level = chalk.bold.blueBright(level);
		} else if (output.level === "Warning") {
			level = chalk.bold.yellowBright(level);
		} else if (output.level === "Error") {
			level = chalk.bold.redBright(level);
		}

		info = level + " " + chalk.gray(output.file) + ": ";

	} else if (output.type === "action") {
		info = "[" + chalk.yellow(output.action) + "] ";
	}

	return time + info + output.message;
}
/**
 * Connector for control connection to master server
 * @private
 */
class ControlConnector extends link.WebSocketClientConnector {
    constructor(url, reconnectDelay, token) {
        super(url, reconnectDelay);
        this._token = token;
    }

    register() {
        console.log("SOCKET | registering control");
        this.sendHandshake("register_control", {
            token: this._token,
            agent: "clusterctl",
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
class Control extends link.Link {

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
        console.log(formatOutputColored(output));
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

export {
    ControlConnector,
    Control
}
