import React from "react";
import { Space, Tag, Tooltip } from "antd";

import Link from "./Link";
import type { ResolvedModPack } from "../util/instance";

export default function InstanceModPack(props: { resolved: ResolvedModPack }) {
	const { id, modPack, isDefault } = props.resolved;
	if (id === undefined) {
		return <em>Controller default</em>;
	}
	return <Space size="small">
		<Link to={`/mods/mod-packs/${id}/view`} onClick={e => e.stopPropagation()}>
			{modPack?.name ?? id}
		</Link>
		{isDefault && <Tooltip title="Not set on this instance, the controller default mod pack is used">
			<Tag>Default</Tag>
		</Tooltip>}
	</Space>;
}
