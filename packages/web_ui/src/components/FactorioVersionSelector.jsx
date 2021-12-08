import React from "react";
import { Select, Tag } from "antd";
import { useFactorioVersion } from "../model/factorioVersion";

export default function FactorioVersionSelector(props) {
	let [factorioVersions] = useFactorioVersion(props.slave_id);

	return <Select
		showSearch
		style={{ width: 200 }}
		optionFilterProp="children"
		defaultValue="latest"
		loading={factorioVersions.loading}
		{...props}
	>
		{factorioVersions.versions.map(version => <Select.Option
			key={version.version}
			value={version.version}
		>
			<Tag key="1" color={version.downloaded? "green" : ""}>{version.version}</Tag>
		</Select.Option>)}
	</Select>;
}
