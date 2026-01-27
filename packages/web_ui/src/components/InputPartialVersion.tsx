import React, { useContext, useEffect, useState } from "react";
import { TreeSelect } from "antd";

import * as lib from "@clusterio/lib";
import { InputComponentProps } from "../BaseWebPlugin";
import { useAccount } from "../model/account";
import ControlContext from "./ControlContext";

const defaultFieldDefinition: lib.FieldDefinition = { type: "string", optional: false };

export default function InputPartialVersion (
	props: Omit<InputComponentProps, "fieldDefinition"> & {
		fieldDefinition?: lib.FieldDefinition;
		className?: string;
	}
) {
	const fieldDefinition = props.fieldDefinition || defaultFieldDefinition;
	const [versions, setVersions] = useState<readonly lib.PartialVersion[]>(lib.ApiVersions);
	const control = useContext(ControlContext);
	const account = useAccount();
	const hasPermission = account.hasPermission("core.external.get_factorio_versions");

	useEffect(() => {
		(async () => {
			if (hasPermission) {
				const res = await control.factorioVersions.get(5 * 60 * 1000);
				setVersions(res.map(v => v.version));
			}
		})();
	}, [control, hasPermission]);

	// Split the versions into groups based on major minor
	const groups = new Map<lib.PartialVersion, lib.PartialVersion[]>();

	for (const version of versions) {
		const [major, minor] = version.split(".");
		const key = `${major}.${minor}` as lib.PartialVersion;

		if (!groups.has(key)) {
			groups.set(key, []);
		}
		groups.get(key)!.push(version);
	}

	// Construct the tree to be disabled
	const tree = [...groups.entries()].map(([majorMinor, patchVersions]) => {
		const groupKey = `group-${majorMinor}`;

		return {
			title: majorMinor,
			value: groupKey,
			key: groupKey,
			children: patchVersions.map((v) => ({
				title: v,
				value: v,
				key: v,
			})),
		};
	});

	return <TreeSelect
		showSearch
		style={{ minWidth: 175 }}
		onChange={(value) => props.onChange(value ?? null)}
		value={props.value}
		treeData={tree}
		allowClear={fieldDefinition.optional}
		className={props.className}
		disabled={props.disabled}
	/>;
}
