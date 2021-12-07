import React from "react";
import { Select } from "antd";
import { useFactorioVersion } from "../model/factorioVersion";

export default function FactorioVersionSelector(props) {
	let [factorioVersions] = useFactorioVersion();

	return <Select
		showSearch
		style={{ width: 200 }}
		optionFilterProp="children"
		defaultValue="latest"
		loading={factorioVersions.loading}
		{...props}
	>
		{factorioVersions.versions.map(version => <Select.Option
			key={version}
			value={version}
		>
			{version}
		</Select.Option>)}
	</Select>;
}
