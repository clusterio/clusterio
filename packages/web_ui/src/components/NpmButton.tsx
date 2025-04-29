import { useContext, useEffect, useState } from "react";
import { Button, Checkbox, Form, FormInstance, Input, Modal, Radio, Select } from "antd";

import * as lib from "@clusterio/lib";

import { useAccount } from "../model/account";
import { notifyErrorHandler } from "../util/notify";
import ControlContext from "./ControlContext";

type NpmActionProps = {
	setApplyAction(func: () => Promise<void>): void,
	form: FormInstance,
	target: lib.AddressShorthand,
}

function NpmRemoteUpdate({ setApplyAction, form, target }: NpmActionProps) {
	const control = useContext(ControlContext);

	setApplyAction(async () => {
		if (target === "controller") {
			return await control.send(new lib.ControllerUpdateRequest());
		}
		return await control.sendTo(target, new lib.HostUpdateRequest());
	});

	return <>
	</>;
}

function NpmPluginUpdate({ setApplyAction, form, target }: NpmActionProps) {
	const control = useContext(ControlContext);
	const [plugins, setPlugins] = useState<lib.PluginDetails[]>([]);

	setApplyAction(async () => {
		const values = form.getFieldsValue();
		if (!values.plugin || values.plugin === "") {
			throw new Error("Plugin not provided");
		}
		await control.sendTo(target, new lib.PluginUpdateRequest(values.plugin));
	});

	useEffect(() => {
		control.sendTo(target, new lib.PluginListRequest()).then(newPlugins => {
			setPlugins(newPlugins);
		}).catch(notifyErrorHandler("Error fetching role list"));
	}, [target]);

	return <>
		<Form.Item label="Plugin" name="plugin">
			<Select
				showSearch
				placeholder="Select a plugin"
				optionLabelProp="label"
				options={plugins
					.filter(p => p.npmPackage !== undefined)
					.map(plugin => ({
						value: plugin.npmPackage,
						label: `${plugin.title} (v${plugin.version})`,
					}))
				}
			/>
		</Form.Item>
	</>;
}

function NpmPluginInstall({ setApplyAction, form, target }: NpmActionProps) {
	const control = useContext(ControlContext);

	setApplyAction(async () => {
		const values = form.getFieldsValue();
		if (!values.newPlugin || values.newPlugin === "") {
			throw new Error("Plugin not provided");
		}
		await control.sendTo(target, new lib.PluginInstallRequest(values.newPlugin));
	});

	// TODO custom npm search based on tags
	return <>
		<Form.Item label="Plugin" name="newPlugin">
			<Input />
		</Form.Item>
	</>;
}

export function NpmButton(props: { target: lib.AddressShorthand, canRestart?: boolean, disabled?: boolean }) {
	const control = useContext(ControlContext);
	const account = useAccount();
	const [open, setOpen] = useState(false);
	const [formAction, setFormAction] = useState<string | undefined>(undefined);
	const [form] = Form.useForm();

	function onValuesChange({ action } : { action?: string }) {
		if (action) {
			setFormAction(action);
		}
	}

	let applyAction: () => Promise<void>;
	const setApplyAction = (func: () => Promise<void>) => { applyAction = func; };
	async function onOk() {
		if (!applyAction) {
			form.setFields([{ name: "action", errors: ["Action is required"] }]);
			return;
		}
		await applyAction();

		const values = form.getFieldsValue();
		if (values.restart) {
			// Ternary not used because TS disliked it
			if (props.target === "controller") {
				await control.sendTo(props.target, new lib.ControllerRestartRequest());
			} else {
				await control.sendTo(props.target, new lib.HostRestartRequest());
			}
		}

		setFormAction(undefined);
		setOpen(false);
	}

	// TODO retrieve config so options can be disabled rather than using the error messages
	return <>
		<Button
			type="default"
			disabled={props.disabled}
			onClick={() => { setOpen(true); }}
		>Updates</Button>
		<Modal
			title="Updates"
			okText="Apply"
			open={open}
			okButtonProps={{disabled: formAction === undefined}}
			onOk={() => { onOk().catch(notifyErrorHandler(`Error running ${formAction}`)); }}
			onCancel={() => { setOpen(false); }}
			destroyOnClose
		>
			<Form form={form} onValuesChange={onValuesChange} clearOnDestroy>
				<Form.Item label="Action" name="action">
					<Radio.Group value={formAction}>
						{account.hasPermission(`core.${props.target === "controller" ? "controller" : "host"}.update`)
							? <Radio.Button value="remote_update">Update Clusterio</Radio.Button> : undefined}
						{account.hasPermission("core.plugin.update")
							? <Radio.Button value="plugin_update">Update Plugin</Radio.Button> : undefined}
						{account.hasPermission("core.plugin.install")
							? <Radio.Button value="plugin_install">Install Plugin</Radio.Button> : undefined}
					</Radio.Group>
				</Form.Item>
				{
					formAction !== undefined
					&& account.hasPermission(`core.${props.target === "controller" ? "controller" : "host"}.restart`)
					&& <Form.Item label="Restart on completion" name="restart">
						<Checkbox disabled={props.canRestart === false}/>
					</Form.Item>
				}
				{formAction === "remote_update"
					? <NpmRemoteUpdate {...{setApplyAction, form, target: props.target}}/> : undefined}
				{formAction === "plugin_update"
					? <NpmPluginUpdate {...{setApplyAction, form, target: props.target}}/> : undefined}
				{formAction === "plugin_install"
					? <NpmPluginInstall {...{setApplyAction, form, target: props.target}}/> : undefined}
			</Form>
		</Modal>
	</>;
}

export function hasNpmButtonPermission(controller: boolean) {
	const account = useAccount();
	return account.hasAnyPermission(
		controller ? "core.controller.update" : "core.host.update",
		"core.plugin.update", "core.plugin.install"
	);
}
