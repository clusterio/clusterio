import { Select } from "antd";

import { InputComponentProps } from "../BaseWebPlugin";
import { useRoles } from "../model/roles";

export default function InputRole(props: InputComponentProps) {
	const [roles] = useRoles();

	return <Select
		showSearch
		optionFilterProp="label"
		style={{ minWidth: 175 }}
		onChange={(value) => props.onChange(value ?? null)}
		value={props.value}
		options={[...roles.values()].map(role => ({
			label: role.name,
			value: role.id,
		}))}
		allowClear={props.fieldDefinition.optional}
		disabled={props.disabled}
	/>;
}
