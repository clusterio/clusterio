import { useContext, useEffect, useState } from "react";
import { Alert, Typography } from "antd";

import * as lib from "@clusterio/lib";

import { useAccount } from "../model/account";
import { useHosts } from "../model/host";
import notify, { notifyErrorHandler } from "../util/notify";
import ControlContext from "./ControlContext";

const { Text } = Typography;

export type InstallTarget = { name: string, address: lib.AddressShorthand };
export type PackageOperation = { kind: "install" | "update", target: InstallTarget, packageSpec: string };
export type RemoteAccess = {
	canInstall: (address: lib.AddressShorthand) => boolean,
	canUpdate: (address: lib.AddressShorthand) => boolean,
};
export type PluginInstaller = {
	access: RemoteAccess,
	installing: boolean,
	/** Install a package, optionally pinned as name@version, on every target */
	install: (packageSpec: string, targets: InstallTarget[]) => Promise<void>,
	/** Run package operations one at a time, a standalone controller and host share one installation */
	run: (operations: PackageOperation[]) => Promise<void>,
};

type MachineAccess = { install: boolean, update: boolean };
const defaultAccess: MachineAccess = { install: true, update: true };

export function addressKey(address: lib.AddressShorthand) {
	return address === "controller" ? "controller" : String((address as { hostId: number }).hostId);
}

// Which machines accept remote plugin installs and updates, assumed true when the config can't be read.
function useRemoteAccess(): RemoteAccess {
	const control = useContext(ControlContext);
	const account = useAccount();
	const [hosts] = useHosts();
	const [controllerAccess, setControllerAccess] = useState(defaultAccess);
	const [hostsAccess, setHostsAccess] = useState(new Map<number, MachineAccess>());
	const connectedHostIds = [...hosts.values()].filter(host => host.connected).map(host => host.id);

	useEffect(() => {
		if (!account.hasPermission("core.controller.get_config")) {
			return;
		}
		control.send(new lib.ControllerConfigGetRequest()).then(serializedConfig => {
			const config = lib.ControllerConfig.fromJSON(serializedConfig, "control");
			setControllerAccess({
				install: config.get("controller.allow_plugin_install"),
				update: config.get("controller.allow_plugin_updates"),
			});
		}).catch(notifyErrorHandler("Failed to fetch controller config"));
	}, []);

	useEffect(() => {
		if (!account.hasPermission("core.host.get_config")) {
			return;
		}
		Promise.all(connectedHostIds.map(async hostId => {
			try {
				const serializedConfig = await control.sendTo({ hostId }, new lib.HostConfigGetRequest());
				const config = lib.HostConfig.fromJSON(serializedConfig, "control");
				return [hostId, {
					install: config.get("host.allow_plugin_install"),
					update: config.get("host.allow_plugin_updates"),
				}] as const;
			} catch (err) {
				return [hostId, defaultAccess] as const;
			}
		})).then(entries => { setHostsAccess(new Map(entries)); });
	}, [connectedHostIds.join(",")]);

	const accessOf = (address: lib.AddressShorthand) => (address === "controller"
		? controllerAccess
		: hostsAccess.get((address as { hostId: number }).hostId) ?? defaultAccess
	);
	return {
		canInstall: address => accessOf(address).install,
		canUpdate: address => accessOf(address).update,
	};
}

/**
 * Installs and updates plugins and reports the outcome. Owned by the plugins page so the busy
 * state is shared between the browser and update actions and survives browsing.
 */
export function usePluginInstaller(onDone?: () => void): PluginInstaller {
	const control = useContext(ControlContext);
	const access = useRemoteAccess();
	const [installing, setInstalling] = useState(false);

	async function run(operations: PackageOperation[]) {
		setInstalling(true);
		const done: string[] = [];
		try {
			for (const { kind, target, packageSpec } of operations) {
				const request = kind === "install"
					? new lib.PluginInstallRequest(packageSpec)
					: new lib.PluginUpdateRequest(packageSpec);
				try {
					await control.sendTo(target.address, request);
					done.push(`${kind === "install" ? "Installed" : "Updated"} ${packageSpec} on ${target.name}`);
				} catch (err: any) {
					notifyErrorHandler(`Failed to ${kind} ${packageSpec} on ${target.name}`)(err);
				}
			}
			if (done.length) {
				notify(
					done.length === 1 ? done[0] : `Completed ${done.length} plugin changes`, "success",
					<>
						{done.length > 1 && done.map(line => <div key={line}>{line}</div>)}
						<div>A restart is required to apply the changes.</div>
					</>,
				);
			}
		} finally {
			setInstalling(false);
			onDone?.();
		}
	}

	async function install(packageSpec: string, targets: InstallTarget[]) {
		await run(targets.map(target => ({ kind: "install", target, packageSpec })));
	}

	return { access, installing, install, run };
}

// Remote installs can only be enabled locally on each machine, so tell the user how.
export function RemoteInstallDisabledNotice(props: { controller: boolean, hosts: string[] }) {
	const names = [...(props.controller ? ["the controller"] : []), ...props.hosts];
	return <Alert
		type="info"
		showIcon
		message={`Remote plugin installs are disabled on ${names.join(", ")}`}
		description={<>
			For security reasons this can't be changed from the web UI. To allow installs, stop the machine
			and run the following in its installation directory, then start it again:
			{props.controller && <div>
				<Text type="secondary">Controller: </Text>
				<Text code copyable>npx clusteriocontroller config set controller.allow_plugin_install true</Text>
			</div>}
			{props.hosts.length > 0 && <div>
				<Text type="secondary">Host: </Text>
				<Text code copyable>npx clusteriohost config set host.allow_plugin_install true</Text>
			</div>}
		</>}
	/>;
}
