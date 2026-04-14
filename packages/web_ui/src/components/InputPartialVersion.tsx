import React, { useContext, useEffect, useState, useRef } from "react";
import { Button, Divider, Input, InputRef, RefSelectProps, TreeSelect } from "antd";

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
	const [customVersion, setCustomVersion] = useState("");
	const [open, setOpen] = useState(false);
	const inputRef = useRef<InputRef>(null);
	const selectRef = useRef<RefSelectProps>(null);
	const control = useContext(ControlContext);
	const account = useAccount();

	useEffect(() => {
		(async () => {
			if (account.hasPermission("core.external.get_factorio_versions")) {
				const res = await control.factorioVersions.get(5 * 60 * 1000);
				setVersions(res.map(v => v.version));
			}
		})();
	}, [control]);

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
	const tree = [...groups.entries()].map(([majorMinor, patchVersions]) => (
		{
			title: majorMinor,
			value: majorMinor,
			key: majorMinor,
			children: patchVersions.map((v) => ({
				title: v,
				value: v,
				key: v,
			})),
		}
	));

	return <TreeSelect
		showSearch
		ref={selectRef}
		style={{ minWidth: 175 }}
		onChange={(value) => props.onChange(value ?? null)}
		value={props.value}
		treeData={tree}
		allowClear={fieldDefinition.optional}
		className={props.className}
		disabled={props.disabled}
		open={open}
		onOpenChange={newOpen => {
			setOpen(newOpen);
			if (newOpen && typeof props.value === "string") {
				setCustomVersion(props.value);
			}
		}}
		onKeyDown={e => {
			if (open && e.key === "Tab") {
				e.preventDefault();
				inputRef.current?.focus();
			}
		}}
		popupRender={(menu) => {
			const isValid = lib.isPartialVersion(customVersion);

			const submit = () => {
				if (customVersion && isValid) {
					setTimeout(() => selectRef.current?.focus(), 0);
					props.onChange(customVersion);
					setOpen(false);
				}
			};

			return (
				<>
					{menu}
					<Divider style={{ margin: "8px 0" }} />
					<div style={{ display: "flex", gap: 8, padding: "0 8px 4px" }}>
						<Input
							ref={inputRef}
							style={{ flex: 1 }}
							placeholder="Custom X.Y.Z"
							value={customVersion}
							status={customVersion && !isValid ? "error" : undefined}
							onChange={(e) => setCustomVersion(e.target.value)}
							onPressEnter={submit}
						/>
						<Button
							type="primary"
							disabled={!customVersion || !isValid}
							onClick={submit}
						>
							Use
						</Button>
					</div>
				</>
			);
		}}
	/>;
}
