import { HostEcho, HostEchoReceived } from "./messages.js";

// Uses the default export entrypoint, the controller and ctl parts of this
// plugin use the deprecated class export so both paths are exercised.
export default async function(context) {
	const { host, logger } = context;
	logger.info("test_plugin host loaded");
	const receivedEchoes = new Set();

	host.handle(HostEcho, async (event) => {
		logger.info(`test_plugin host echo ${event.text}`);
		receivedEchoes.add(event.text);
	});

	host.handle(HostEchoReceived, async (request) => receivedEchoes.has(request.text));
}
