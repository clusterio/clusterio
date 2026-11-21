import React, { useEffect } from "react";
import { Layout, Breadcrumb } from "antd";
import Link from "./Link";

const { Content } = Layout;

type PageLayoutProps = {
	nav: {
		path?: string;
		name: string;
	}[];
	children?: any;
};
function clusterName() {
	const meta = document.querySelector<HTMLMetaElement>("meta[name=application-name]");
	return meta?.content || "Clusterio";
}

export default function PageLayout(props: PageLayoutProps) {
	const page = props.nav.at(-1)?.name;
	useEffect(() => {
		const name = clusterName();
		document.title = page ? `${page} - ${name}` : name;
		return () => { document.title = name; };
	}, [page]);

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
