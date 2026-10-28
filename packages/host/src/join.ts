// Implementation of the join command
import type { Argv } from "yargs";

import * as lib from "@clusterio/lib";
import { logger } from "@clusterio/lib";

export function joinCommand(yargs: Argv) {
	yargs.positional("invite-url", { describe: "Invite URL from the controller", type: "string" });
	yargs.option("force", {
		type: "boolean", nargs: 0, default: false, describe: "Replace an existing controller token",
	});
}

/**
 * Claim a host invite and store the host id, controller URL and token in
 * the host config.
 *
 * @param inviteUrl - Invite URL of the form `<controller url>invite/<code>`.
 * @param hostConfig - Host config to update.
 * @param force - Replace an existing controller token.
 */
export async function joinCluster(inviteUrl: string, hostConfig: lib.HostConfig, force = false) {
	const invite = lib.HostInvite.parseUrl(inviteUrl);
	if (!invite) {
		throw new lib.CommandError("Invalid invite URL, expected <controller url>/invite/<code>");
	}
	if (!force && hostConfig.get("host.controller_token") !== "enter token here") {
		throw new lib.CommandError("Host already has a controller token, pass --force to replace it");
	}

	const url = new URL(`invite/${invite.code}`, invite.controllerUrl);
	logger.info(`Joining cluster at ${invite.controllerUrl}`);
	let response;
	try {
		response = await fetch(url, { method: "POST" });
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
	if (!response.ok) {
		throw new lib.CommandError(`Controller responded with ${response.status} ${response.statusText}`);
	}

	const { hostId, token } = await response.json() as { hostId: number, token: string };
	hostConfig.set("host.id", hostId);
	hostConfig.set("host.controller_url", invite.controllerUrl);
	hostConfig.set("host.controller_token", token);
	await hostConfig.save();
	logger.info(`Joined cluster as host ${hostId}`);
}
