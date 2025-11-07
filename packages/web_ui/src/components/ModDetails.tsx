import React, { Fragment } from "react";
import { Descriptions, Grid, Tooltip, Typography, Space } from "antd";
import ExclamationCircleOutlined from "@ant-design/icons/ExclamationCircleOutlined";
import FileUnknownOutlined from "@ant-design/icons/FileUnknownOutlined";
import FileExclamationOutlined from "@ant-design/icons/FileExclamationOutlined";
import FileSyncOutlined from "@ant-design/icons/FileSyncOutlined";

import * as lib from "@clusterio/lib";

const { useBreakpoint } = Grid;

type ModDetailsProps<T> = {
	mod: T;
	mods?: lib.ModRecord[];
	actions?: (mod: T) => React.JSX.Element;
};

export default function ModDetails<T extends lib.ModInfo | lib.ModRecord>(props: ModDetailsProps<T>) {
	let screens = useBreakpoint();
	let mod: Partial<lib.ModInfo> & Partial<lib.ModRecord> = props.mod;

	if ("info" in mod) {
		// Add the mod info if present in a mod record
		mod = { ...mod, ...mod.info };
	}

	const depWarnings = new Map<string, lib.ModRecord["warning"]>();
	if (mod.dependencies && props.mods) {
		for (const dependency of mod.dependencies) {
			depWarnings.set(dependency.name, dependency.checkUnsatisfiedReason(props.mods));
		}
	}

	return <Descriptions
		className="borderless"
		bordered size="small"
		column={{ xs: 1, sm: 1, md: 1, lg: 2, xl: 2, xxl: 2 }}
	>
		{mod.error && <Descriptions.Item
			label={<><ExclamationCircleOutlined/> Error</>}
			span={2}
		>
			{mod.error === "missing" && "The given version of this mod is missing from the controller storage."}
			{mod.error === "bad_checksum"
				&& "Checksum of the mod in the controller storage does not match the checksum provided " +
				"by this mod pack."
			}
		</Descriptions.Item>}
		{props.actions && !screens.lg
			&& <Descriptions.Item label="Action">{props.actions(props.mod)}</Descriptions.Item>
		}

		{Boolean(mod.title) && <Descriptions.Item label="Title">{mod.title}</Descriptions.Item>}
		{Boolean(mod.version)
			&& <Descriptions.Item label="Version" span={mod.title ? 1 : 2}>{mod.version}</Descriptions.Item>
		}
		{Boolean(mod.description)
			&& <Descriptions.Item label="Description" span={2}>{mod.description}</Descriptions.Item>
		}
		{Boolean(mod.author) && <Descriptions.Item label="Author" span={2}>{mod.author}</Descriptions.Item>}

		<Descriptions.Item label="Mod&nbsp;Portal" span={2}>
			<Typography.Link href={`https://mods.factorio.com/mod/${mod.name}`}>
				{`https://mods.factorio.com/mod/${mod.name}`}
			</Typography.Link>
		</Descriptions.Item>

		{Boolean(mod.contact) && <Descriptions.Item label="Contact" span={2}>{mod.contact}</Descriptions.Item>}
		{Boolean(mod.homepage) && <Descriptions.Item label="Homepage" span={2}>{mod.homepage}</Descriptions.Item>}
		<Descriptions.Item label="Internal&nbsp;Name" span={mod.factorioVersion ? 1 : 2}>{mod.name}</Descriptions.Item>
		{Boolean(mod.factorioVersion)
			&& <Descriptions.Item label="Factorio&nbsp;Version">
				<Space>
					{mod.warning === "wrong_factorio_version" && <Tooltip title="Wrong factorio version.">
						<FileSyncOutlined style={{ color: "#dd5e14" }} />{" "}
					</Tooltip>}
					{mod.factorioVersion}
				</Space>
			</Descriptions.Item>
		}
		{Boolean(mod.filename) && <Descriptions.Item label="Filename">{mod.filename}</Descriptions.Item>}
		{mod.size !== undefined
			&& <Descriptions.Item label="Size">{lib.formatBytes(mod.size)}</Descriptions.Item>
		}
		{Boolean(mod.sha1) && <Descriptions.Item label="SHA1" span={2}>{mod.sha1}</Descriptions.Item>}
		{mod.dependencies && mod.dependencies.length
			&& <Descriptions.Item label="Dependencies" span={2}>
				{mod.dependencies
					.filter(e => e.type !== "hidden")
					.map((e, i) => <Fragment key={i}>
						<Space>
							{depWarnings.get(e.name) === "incompatible" && <Tooltip title="Incompatible mod added.">
								<FileExclamationOutlined style={{ color: "#dd5e14" }} />{" "}
							</Tooltip>}
							{depWarnings.get(e.name) === "missing_dependency" && <Tooltip title="Dependency missing.">
								<FileUnknownOutlined style={{ color: "#dd5e14" }} />{" "}
							</Tooltip>}
							{depWarnings.get(e.name) === "wrong_version" && <Tooltip title="Wrong version added.">
								<FileSyncOutlined style={{ color: "#dd5e14" }} />{" "}
							</Tooltip>}
							{e.specification}
						</Space>
						<br/>
					</Fragment>)
				}
			</Descriptions.Item>
		}
	</Descriptions>;
}
