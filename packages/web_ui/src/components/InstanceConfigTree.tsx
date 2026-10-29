import React, { useContext } from "react";
import { Alert } from "antd";

import * as lib from "@clusterio/lib";

import BaseConfigTree, { ConfigInheritance } from "./BaseConfigTree";
import ControlContext from "./ControlContext";
import Link from "./Link";
import { useInstance } from "../model/instance";


type InstanceConfigTreeProps = {
	id: number;
};

function TemplateNotice(props: { templateId: number }) {
	const [template] = useInstance(props.templateId);
	return <Alert
		type="info"
		showIcon
		style={{ marginBottom: 8 }}
		message={<>
			Locked values are inherited from the template{" "}
			<Link to={`/instances/${props.templateId}/view`}>{template?.name ?? props.templateId}</Link>.
			Unlock a value to override it on this instance.
		</>}
	/>;
}

export default function InstanceConfigTree(props: InstanceConfigTreeProps) {
	let control = useContext(ControlContext);

	async function retrieveConfig() {
		return await control.send(new lib.InstanceConfigGetRequest(props.id));
	}

	async function setConfig(fields: Record<string, string | Record<string, string>>) {
		await control.send(new lib.InstanceConfigSetRequest(props.id, fields));
	}

	const inheritance: ConfigInheritance = {
		canInherit: (config, field) => (
			(config as lib.InstanceConfig).get("instance.template_id") !== null
			&& lib.InstanceConfig.isInheritable(field)
		),
		isInherited: (config, field, prop) => (config as lib.InstanceConfig).isInherited(field, prop),
		inherit: async (field, prop) => {
			await control.send(new lib.InstanceConfigInheritFieldRequest(props.id, field, prop));
		},
		notice: (config) => {
			const templateId = (config as lib.InstanceConfig).get("instance.template_id");
			return templateId !== null ? <TemplateNotice templateId={templateId} /> : null;
		},
	};

	return <BaseConfigTree
		ConfigClass={lib.InstanceConfig}
		retrieveConfig={retrieveConfig}
		setConfig={setConfig}
		inheritance={inheritance}
		id={props.id}
	/>;
}
