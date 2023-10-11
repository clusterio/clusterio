import React, { Fragment } from "react";
import { Descriptions, Grid, Typography } from "antd";
import ExclamationCircleOutlined from "@ant-design/icons/ExclamationCircleOutlined";

import * as lib from "@clusterio/lib";

const { useBreakpoint } = Grid;

type ModDetailsProps = {
	mod: lib.ModInfo|lib.ModRecord;
	actions: (mod: lib.ModInfo|lib.ModRecord) => React.JSX.Element;
};
export default function ModDetails(props: ModDetailsProps) {
	let screens = useBreakpoint();
	const mod = props.mod;

	return <Descriptions className="borderless" bordered size="small" column={{ xs: 1, sm: 1, md: 1, lg: 2 }}>
		{!(mod instanceof lib.ModInfo) && mod.error && <Descriptions.Item label={<><ExclamationCircleOutlined/> Error</>} span={2}>
			{mod.error === "missing" && "The given version of this mod is missing from the controller storage."}
			{mod.error === "bad_checksum"
				&& "Checksum of the mod in the controller storage does not match the checksum provided " +
				"by this mod pack."
			}
		</Descriptions.Item>}
		{props.actions && !screens.lg
			&& <Descriptions.Item label="Action">{props.actions(mod)}</Descriptions.Item>
		}

		{ (mod instanceof lib.ModInfo) && <>
			{mod.title && <Descriptions.Item label="Title">{mod.title}</Descriptions.Item>}
			{mod.version && <Descriptions.Item label="Version" span={mod.title ? 1 : 2}>{mod.version}</Descriptions.Item>}
			{mod.description && <Descriptions.Item label="Description" span={2}>{mod.description}</Descriptions.Item> }
			{mod.author && <Descriptions.Item label="Author" span={2}>{mod.author}</Descriptions.Item>}
		</>}

		<Descriptions.Item label="Mod&nbsp;Portal" span={2}>
			<Typography.Link href={`https://mods.factorio.com/mod/${mod.name}`}>
				{`https://mods.factorio.com/mod/${mod.name}`}
			</Typography.Link>
		</Descriptions.Item>

		{ (mod instanceof lib.ModInfo) && <>
			{mod.contact && <Descriptions.Item label="Contact" span={2}>{mod.contact}</Descriptions.Item>}
			{mod.homepage && <Descriptions.Item label="Homepage" span={2}>{mod.homepage}</Descriptions.Item>}
			<Descriptions.Item label="Internal&nbsp;Name" span={mod.factorioVersion ? 1 : 2}>{mod.name}</Descriptions.Item>
			{mod.factorioVersion
				&& <Descriptions.Item label="Factorio&nbsp;Version">{mod.factorioVersion}</Descriptions.Item>
			}
			{mod.filename && <Descriptions.Item label="Filename">{mod.filename}</Descriptions.Item>}
			{mod.size !== undefined
				&& <Descriptions.Item label="Size">{lib.formatBytes(mod.size)}</Descriptions.Item>
			}
			{mod.sha1 && <Descriptions.Item label="SHA1" span={2}>{mod.sha1}</Descriptions.Item>}
			{mod.dependencies && mod.dependencies.length
				&& <Descriptions.Item label="Dependencies" span={2}>
					{mod.dependencies
						.filter(e => !e.startsWith("(?)"))
						.map((e, i) => <Fragment key={i}>{e}<br/></Fragment>)
					}
				</Descriptions.Item>
			}
		</>}
	</Descriptions>;
}
