// Implementation of the join command
import type { Argv } from "yargs";

import * as lib from "@clusterio/lib";
import { logger } from "@clusterio/lib";

export function joinCommand(yargs: Argv) {
	yargs.positional("invite-url", { describe: "Invite URL from the controller", type: "string" });
	yargs.option("name", {
		type: "string", nargs: 1, describe: "Host name, overrides the name parameter of the invite URL",
	});
	yargs.option("force", {
		type: "boolean", nargs: 0, default: false, describe: "Replace an existing controller token",
	});
}

/**
 * Claim a host invite and store the host id, controller URL, token and
 * host name if given in the host config.
 *
 * @param inviteUrl - Invite URL of the form `<controller url>invite/<code>[?name=<host name>]`.
 * @param hostConfig - Host config to update.
 * @param force - Replace an existing controller token.
 * @param name - Host name, takes precedence over the name in the invite URL.
 */
export async function joinCluster(inviteUrl: string, hostConfig: lib.HostConfig, force = false, name?: string) {
	const invite = lib.HostInvite.parseUrl(inviteUrl);
	if (!invite) {
		throw new lib.CommandError("Invalid invite URL, expected <controller url>/invite/<code>");
	}
	if (!force && hostConfig.get("host.controller_token") !== "enter token here") {
		throw new lib.CommandError("Host already has a controller token, pass --force to replace it");
	}

	const url = new URL(`invite/${invite.code}`, invite.controllerUrl);
	if (invite.name) {
		url.searchParams.set("name", invite.name);
	}
	logger.info(`Joining cluster at ${invite.controllerUrl}`);
	let response;
	try {
		response = await fetch(url, name === undefined ? { method: "POST" } : {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ name }),
		});
	} catch (err: any) {
		throw new lib.CommandError(`Failed to contact controller: ${err.cause?.message ?? err.message}`);
	}
	if (response.status === 404) {
		throw new lib.CommandError("Invite is invalid or has expired");
	}
	if (response.status === 429) {
		const minutes = Math.ceil(Number(response.headers.get("retry-after") ?? 60) / 60);
		throw new lib.CommandError(`Too many invalid invite attempts, try again in ${minutes} minutes`);
	}
	if ([400, 503].includes(response.status)) {
		const body = await response.json().catch(() => ({})) as { request_errors?: string[] };
		throw new lib.CommandError(body.request_errors?.[0] ?? `Controller responded with ${response.status}`);
	}
	if (!response.ok) {
		throw new lib.CommandError(`Controller responded with ${response.status} ${response.statusText}`);
	}

	const claim = await response.json() as { hostId: number, token: string, name: string | null };
	const { hostId, token } = claim;
	hostConfig.set("host.id", hostId);
	if (claim.name !== null) {
		hostConfig.set("host.name", claim.name);
	}
	hostConfig.set("host.controller_url", invite.controllerUrl);
	hostConfig.set("host.controller_token", token);
	await hostConfig.save();
	logger.info(`Joined cluster as host ${hostId}`);
}
