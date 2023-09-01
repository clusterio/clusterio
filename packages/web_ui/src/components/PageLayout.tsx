import React from "react";
import { Link } from "react-router-dom";
import { Layout, Breadcrumb } from "antd";

const { Content } = Layout;

type PageLayoutProps = {
	nav: {
		path?: string;
		name: string;
	}[];
	children?: any;
};
export default function PageLayout(props: PageLayoutProps) {
	return <>
		<Breadcrumb className="site-breadcrumb">
			{props.nav.map((part, index) => <Breadcrumb.Item key={index}>
				{part.path ? <Link to={part.path}>{part.name}</Link> : part.name}
			</Breadcrumb.Item>)}
		</Breadcrumb>
		<Content className="site-layout-content" >
			{props.children}
		</Content>
	</>;
}
