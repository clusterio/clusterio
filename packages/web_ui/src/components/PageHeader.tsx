import React from "react";
import { Space, Typography } from "antd";
const { Text } = Typography;

type PageHeaderProps = {
	title: string | React.ReactElement;
	subTitle?: string | React.ReactElement;
	status?: React.JSX.Element;
	extra?: React.JSX.Element;
};

export default function PageHeader(props: PageHeaderProps): React.JSX.Element {
	return <div className="page-header">
		<Space>
			<h2 className="page-header-title">{props.title}</h2>
			{props.subTitle && <Text type="secondary">{props.subTitle}</Text>}
			{props.status ?? null}
		</Space>
		{props.extra && <div className="page-header-extra">{props.extra}</div>}
	</div>;
}
