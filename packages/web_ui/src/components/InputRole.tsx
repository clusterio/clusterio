import React, { useContext, useEffect, useState } from "react";
import { Select } from "antd";

import * as lib from "@clusterio/lib";

import ControlContext from "./ControlContext";
import { notifyErrorHandler } from "../util/notify";
import { InputComponentProps } from "../BaseWebPlugin";

export default function InputRole(props: InputComponentProps) {
	let control = useContext(ControlContext);
	let [roles, setRoles] = useState<lib.Role[]>([]);

	useEffect(() => {
		control.send(new lib.RoleListRequest()).then(newRoles => {
			setRoles(newRoles);
		}).catch(notifyErrorHandler("Error fetching role list"));
	}, []);

	return <Select
		style={{ minWidth: 175 }}
		onChange={(value) => props.onChange(value ?? null)}
		value={props.value}
		options={[...roles.values()].map(role => ({
			label: role.name,
			value: role.id,
		}))}
		allowClear={props.fieldDefinition.optional}
	/>;
}
