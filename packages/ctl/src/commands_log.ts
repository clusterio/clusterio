import winston from "winston";

import * as lib from "@clusterio/lib";
import { ConsoleTransport, levels, logger } from "@clusterio/lib";
import type { Control } from "../ctl";

export const logCommands = new lib.CommandTree({ name: "log", description: "Log inspection" });
logCommands.add(new lib.Command({
	definition: ["follow", "follow cluster log", (yargs) => {
		yargs.options({
			"all": { describe: "Follow the whole cluster log", nargs: 0, type: "boolean", default: false },
			"controller": { describe: "Follow log of the controller", nargs: 0, type: "boolean", default: false },
			"host": { describe: "Follow log of given host", nargs: 1, type: "string", default: null },
			"instance": { describe: "Follow log of given instance", nargs: 1, type: "string", default: null },
		});
	}],
	handler: async function(
		args: { all: boolean, controller: boolean, host: string | null, instance: string | null },
		control: Control
	) {
		if (!args.all && !args.controller && !args.host && !args.instance) {
			logger.error("At least one of --all, --controller, --host and --instance must be passed");
			process.exitCode = 1;
			return;
		}
		let instanceIds = args.instance ? [await lib.resolveInstance(control, args.instance)] : [];
		let hostIds = args.host ? [await lib.resolveHost(control, args.host)] : [];
		await control.setLogSubscriptions({ all: args.all, controller: args.controller, hostIds, instanceIds });
		control.keepOpen = true;
	},
}));

logCommands.add(new lib.Command({
	definition: ["query", "Query cluster log", (yargs) => {
		yargs.options({
			"all": { describe: "Query the whole cluster log", nargs: 0, type: "boolean", default: false },
			"controller": { describe: "Query log of the controller", nargs: 0, type: "boolean", default: false },
			"host": { describe: "Query log of given host", nargs: 1, type: "string", default: null },
			"instance": { describe: "Query log of given instance", nargs: 1, type: "string", default: null },
			"max-level": { describe: "Maximum log level to return", nargs: 1, type: "string", default: undefined },
			"limit": { describe: "Max number of entries to return", nargs: 1, type: "number", default: 1000 },
			"start": { describe: "Limit from the start instead of the end", nargs: 0, type: "boolean", default: false },
		});
	}],
	handler: async function(
		args: {
			all: boolean,
			controller: boolean,
			host: string | null,
			instance: string | null,
			maxLevel?: string,
			limit: number,
			start: boolean,
		},
		control: Control
	) {
		if (!args.all && !args.controller && !args.host && !args.instance) {
			logger.error("At least one of --all, --controller, --host and --instance must be passed");
			process.exitCode = 1;
			return;
		}
		let instanceIds = args.instance ? [await lib.resolveInstance(control, args.instance)] : [];
		let hostIds = args.host ? [await lib.resolveHost(control, args.host)] : [];
		let result = await control.send(new lib.LogQueryRequest(
			args.all,
			args.controller,
			hostIds,
			instanceIds,
			args.maxLevel as keyof typeof levels,
			args.limit,
			args.start ? "asc" : "desc",
		));

		if (!args.start) {
			result.log.reverse();
		}

		let stdoutLogger = winston.createLogger({
			level: "verbose",
			levels,
			format: new lib.TerminalFormat({ showTimestamp: true }),
			transports: [
				new ConsoleTransport({ errorLevels: [], warnLevels: [] }),
			],
		});
		for (let info of result.log) {
			stdoutLogger.log(info as any);
		}
	},
}));
