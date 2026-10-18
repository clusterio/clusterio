import net from "node:net";

// Give test fixtures distinct ports from a dedicated range rather than relying
// on the application's random RCON selection. Probe each candidate before use.
let nextPort = 20000;

export async function getTestRconPort() {
	while (nextPort < 30000) {
		const port = nextPort;
		nextPort += 1;
		const probe = net.createServer(socket => socket.destroy());
		const listen = host => new Promise((resolve, reject) => {
			probe.once("error", reject);
			probe.listen({ host, port }, () => {
				probe.removeListener("error", reject);
				resolve();
			});
		});
		try {
			try {
				await listen("::");
			} catch (err) {
				if (err.code !== "EAFNOSUPPORT" && err.code !== "EADDRNOTAVAIL") {
					throw err;
				}
				await listen("0.0.0.0");
			}
			return port;
		} catch (err) {
			if (err.code !== "EADDRINUSE") {
				throw err;
			}
		} finally {
			if (probe.listening) {
				await new Promise((resolve, reject) => {
					probe.close(err => (err ? reject(err) : resolve()));
				});
			}
		}
	}
	throw new Error("No available RCON port in the test fixture range 20000-29999");
}
