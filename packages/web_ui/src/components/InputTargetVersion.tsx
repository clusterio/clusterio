import React from "react";
import { Select } from "antd";

import { InputComponentProps } from "../BaseWebPlugin";
import * as lib from "@clusterio/lib";

// Hardcoded list for step 1
const FACTORIO_VERSIONS = [
	"2.0",
	"1.1",
	"1.0",
	"0.18",
	"0.17",
	"0.16",
	"0.15",
	"0.14",
	"0.13",
] as const;

const defaultFieldDefinition: lib.FieldDefinition = {
	type: "string",
	optional: false,
};

export default function InputTargetVersion(
	props: Omit<InputComponentProps, "fieldDefinition"> & { fieldDefinition?: lib.FieldDefinition; className?: string }
) {
	const fieldDefinition = props.fieldDefinition || defaultFieldDefinition;

	const options = FACTORIO_VERSIONS.map(version => ({
		label: version,
		value: version,
	}));

	// Add "latest" option for TargetVersion
	options.unshift({ label: "latest", value: "latest" });

	return <Select
		showSearch
		optionFilterProp="label"
		style={{ minWidth: 175 }}
		className={props.className}
		onChange={(value) => props.onChange(value ?? null)}
		value={props.value}
		options={options}
		allowClear={fieldDefinition.optional}
		disabled={props.disabled}
		placeholder="Select Factorio version"
	/>;
}
