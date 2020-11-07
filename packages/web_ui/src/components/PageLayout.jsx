import React from "react";
import { Link } from "react-router-dom";
import { Layout, Menu, Breadcrumb, Typography } from "antd";

const { Content } = Layout;

export default function PageLayout(props) {
	return <>
		<Breadcrumb style={{ margin: "16px 0 16px 28px" }}>
			{props.nav.map((part, index) => <Breadcrumb.Item key={index}>
				{part.path ? <Link to={part.path}>{part.name}</Link> : part.name}
			</Breadcrumb.Item>)}
		</Breadcrumb>
		<Content className="site-layout-content" >
			{props.children}
		</Content>
	</>;
}
