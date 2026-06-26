import React, { useContext, useEffect, useState, useRef } from "react";
import { Button, Divider, Input, InputRef, RefSelectProps, TreeSelect } from "antd";

import * as lib from "@clusterio/lib";
import { InputComponentProps } from "../BaseWebPlugin";
import { useAccount } from "../model/account";
import ControlContext from "./ControlContext";

const defaultFieldDefinition: lib.FieldDefinition = { type: "string", optional: false };

function InputVersion<
	Version extends lib.TargetVersion,
	IncludeLatest extends (Version extends "latest" ? boolean : false),
> (
	props: Omit<InputComponentProps, "fieldDefinition"> & {
		fieldDefinition?: lib.FieldDefinition;
		className?: string;
		version: {
			isValid: (v: string) => v is Version;
			includeLatest: IncludeLatest;
		};
	}
) {
	const fieldDefinition = props.fieldDefinition || defaultFieldDefinition;
	const [versions, setVersions] = useState<readonly string[]>(lib.ApiVersions);
	const [channels, setChannels] = useState<{ name: string, version: string }[]>([]);
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

	// Release channels (e.g. stable, experimental) only apply to target versions
	useEffect(() => {
		(async () => {
			if (props.version.includeLatest && account.hasPermission("core.external.get_latest_releases")) {
				const res = await control.latestReleases.get(5 * 60 * 1000);
				// Read the headless build's version directly rather than via a lib
				// helper: lib is a federation-shared module here and unused exports
				// can be tree-shaken out of it.
				setChannels(Object.entries(res).map(([name, builds]) => (
					{ name, version: builds.headless ?? Object.values(builds)[0] ?? "" }
				)));
			}
		})();
	}, [control]);

	// Split the versions into groups based on major minor
	const groups = new Map<string, string[]>();

	for (const version of versions) {
		const [major, minor] = version.split(".");
		const key = `${major}.${minor}`;

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

	// Add "latest" and release channel options for TargetVersion
	if (props.version.includeLatest) {
		tree.unshift(
			{ title: "latest", value: "latest", key: "latest", children: [] },
			...channels.map(({ name, version }) => ({
				title: version ? `${name} (${version})` : name,
				value: name,
				key: name,
				children: [],
			})),
		);
	}

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
			const isValid = props.version.isValid(customVersion);

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

export function InputTargetVersion (
	props: Omit<InputComponentProps, "fieldDefinition"> & {
		fieldDefinition?: lib.FieldDefinition;
		className?: string;
	}
) {
	return <InputVersion
		{...props}
		version={{
			isValid: lib.isTargetVersion,
			includeLatest: true,
		}}
	/>;
}

export function InputPartialVersion (
	props: Omit<InputComponentProps, "fieldDefinition"> & {
		fieldDefinition?: lib.FieldDefinition;
		className?: string;
	}
) {
	return <InputVersion
		{...props}
		version={{
			isValid: lib.isPartialVersion,
			includeLatest: false,
		}}
	/>;
}

export function InputFullVersion (
	props: Omit<InputComponentProps, "fieldDefinition"> & {
		fieldDefinition?: lib.FieldDefinition;
		className?: string;
	}
) {
	return <InputVersion
		{...props}
		version={{
			isValid: lib.isFullVersion,
			includeLatest: false,
		}}
	/>;
}
