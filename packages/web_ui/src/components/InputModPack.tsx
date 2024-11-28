import React from "react";
import { Select } from "antd";

import { useModPacks } from "../model/mod_pack";
import { InputComponentProps } from "../BaseWebPlugin";

export default function InputModPack(props: InputComponentProps) {
	const [modPacks] = useModPacks();
	return <Select
		showSearch
		optionFilterProp="label"
		style={{ minWidth: 175 }}
		onChange={(value) => props.onChange(value ?? null)}
		value={props.value}
		options={[...modPacks.values()].map(modPack => ({
			label: modPack.name,
			value: modPack.id,
		}))}
		allowClear={props.fieldDefinition.optional}
		disabled={props.disabled}
	/>;
}
