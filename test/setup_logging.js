import { ConsoleTransport, TerminalFormat, logger } from "@clusterio/lib";

// Some integration tests may cause log events, import this file for such tests
// to avoid getting the "Attempt to write logs with no transports" warning when
// running tests individually.

before(function() {
	const silent = process.env.SILENT_TEST;

	logger.add(new ConsoleTransport({
		level: "info",
		format: new TerminalFormat(),
		filter: () => !silent,
	}));
});
