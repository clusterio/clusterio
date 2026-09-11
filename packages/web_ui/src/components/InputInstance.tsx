import { Select } from "antd";

import { InputComponentProps } from "../BaseWebPlugin";
import { useInstances } from "../model/instance";

interface BaseInputInstanceProps extends InputComponentProps {
	includeAll?: boolean;
}

function BaseInputInstance(props: BaseInputInstanceProps) {
	const [instances, synced] = useInstances();

	const options = [
		...(props.includeAll ? [{ label: "All instances", value: null }] : []),
		...[...instances.values()].map(instance => ({
			label: instance.name ?? `Instance ${instance.id}`,
			value: instance.id,
		})),
	];

	return (
		<Select
			showSearch
			optionFilterProp="label"
			style={{ minWidth: 175 }}
			onChange={value => props.onChange(value ?? null)}
			value={props.value}
			options={options}
			allowClear={props.fieldDefinition.optional}
			disabled={!synced || props.disabled}
			loading={!synced}
		/>
	);
}

export function InputInstanceWithAll(props: InputComponentProps) {
	return <BaseInputInstance {...props} includeAll />;
}

export function InputInstance(props: InputComponentProps) {
	return <BaseInputInstance {...props} />;
}
