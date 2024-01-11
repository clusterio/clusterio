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
		<Breadcrumb
			className="site-breadcrumb"
			itemRender={(route, params, routes, paths) => (
				route.href ? <Link to={route.href}>{route.title}</Link> : route.title
			)}
			items={props.nav.map(
				(part, index) => ({ href: part.path, title: part.name }))
			}
		/>
		<Content className="site-layout-content" >
			{props.children}
		</Content>
	</>;
}
