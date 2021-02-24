import React, { useEffect, useState } from "react";
import { Switch, Route, useHistory } from "react-router-dom";
import { Layout, Menu } from "antd";
import webUiPackage from "../../package.json";

import ErrorBoundary from "./ErrorBoundary";
import ErrorPage from "./ErrorPage";

const { Header, Sider } = Layout;


import SlavesPage from "./SlavesPage";
import InstancesPage from "./InstancesPage";
import InstanceViewPage from "./InstanceViewPage";
import UsersPage from "./UsersPage";
import UserViewPage from "./UserViewPage";
import RolesPage from "./RolesPage";
import RoleViewPage from "./RoleViewPage";

const pages = [
	{ path: "/instances/:id/view", sidebarPath: "/instances", content: <InstanceViewPage /> },
	{ path: "/users/:name/view", sidebarPath: "/users", content: <UserViewPage /> },
	{ path: "/roles/:id/view", sidebarPath: "/roles", content: <RoleViewPage /> },
];

const sidebar = [
	{ name: "Slaves", path: "/slaves", content: <SlavesPage /> },
	{ name: "Instances", path: "/instances", content: <InstancesPage />},
	{ name: "Users", path: "/users", content: <UsersPage /> },
	{ name: "Roles", path: "/roles", content: <RolesPage /> },
];


export default function SiteLayout(props) {
	let history = useHistory();
	let [sidebarPath, setSidebarPath] = useState(null);

	function SetSidebar(setSidebarProps) {
		useEffect(() => {
			setSidebarPath(setSidebarProps.path);
		});
		return null;
	}

	return <Layout style={{ minHeight: "100vh" }}>
		<Header className="header">
			<div className="site-logo" />
			<span className="site-name" style={{ top: -10 }}>Clusterio</span>
			<span style={{ position: "absolute", top: 10, left: 120, color: "#f00" }}>{ webUiPackage.version }</span>
			<Menu theme="dark" mode="horizontal" defaultSelectedKeys={["1"]}>
				<Menu.Item key="1">Dashboard</Menu.Item>
			</Menu>
		</Header>
		<Layout className="site-layout">
			<Sider
				collapsible
				collapsedWidth={0}
				breakpoint="md"
				zeroWidthTriggerStyle={{ top: 6, zIndex: -1 }}
				width={250}
				className="site-layout-sider"
			>
				<Menu
					mode="inline"
					selectedKeys={[sidebarPath]}
					style={{ height: "100%", borderRight: 0 }}
					onClick={({ key }) => history.push(key)}
				>
					{sidebar.map(({name, path}) => <Menu.Item key={path}>{name}</Menu.Item>)}
				</Menu>
			</Sider>
			<Layout className="site-layout-content-container">
				<Switch>
					{sidebar.map(({path, content}) => <Route exact path={path} key={path}>
						<SetSidebar path={path} />
						{content}
					</Route>)}
					{pages.map(page => <Route exact path={page.path} key={page.path}>
						<SetSidebar path={page.sidebarPath} />
						<ErrorBoundary Component={ErrorPage}>
							{page.content}
						</ErrorBoundary>
					</Route>)}
					<Route>
						<SetSidebar path={null} />
					</Route>
				</Switch>
			</Layout>
		</Layout>
	</Layout>;
}
