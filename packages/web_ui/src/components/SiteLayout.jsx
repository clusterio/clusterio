import React, { useEffect, useState } from "react";
import { Switch, Route, useHistory } from "react-router-dom";
import { Dropdown, Layout, Menu } from "antd";
import UserOutlined from "@ant-design/icons/UserOutlined";
import webUiPackage from "../../package.json";

import { useAccount } from "../model/account";
import ErrorBoundary from "./ErrorBoundary";
import ErrorPage from "./ErrorPage";

const { Header, Sider } = Layout;


import MasterPage from "./MasterPage";
import SlavesPage from "./SlavesPage";
import InstancesPage from "./InstancesPage";
import InstanceViewPage from "./InstanceViewPage";
import UsersPage from "./UsersPage";
import UserViewPage from "./UserViewPage";
import RolesPage from "./RolesPage";
import RoleViewPage from "./RoleViewPage";
import PluginsPage from "./PluginsPage";
import PluginViewPage from "./PluginViewPage";

const pages = [
	{ path: "/instances/:id/view", sidebarPath: "/instances", content: <InstanceViewPage /> },
	{ path: "/users/:name/view", sidebarPath: "/users", content: <UserViewPage /> },
	{ path: "/roles/:id/view", sidebarPath: "/roles", content: <RoleViewPage /> },
	{ path: "/plugins/:name/view", sidebarPath: "/plugins", content: <PluginViewPage /> },
];

const sidebar = [
	{ name: "Master", path: "/master", content: <MasterPage /> },
	{ name: "Slaves", path: "/slaves", content: <SlavesPage /> },
	{ name: "Instances", path: "/instances", content: <InstancesPage />},
	{ name: "Users", path: "/users", content: <UsersPage /> },
	{ name: "Roles", path: "/roles", content: <RolesPage /> },
	{ name: "Plugins", path: "/plugins", content: <PluginsPage /> },
];


export default function SiteLayout(props) {
	let history = useHistory();
	let [sidebarPath, setSidebarPath] = useState(null);
	let account = useAccount();

	function SetSidebar(setSidebarProps) {
		useEffect(() => {
			setSidebarPath(setSidebarProps.path);
		});
		return null;
	}

	let accountMenu = <Menu>
		<Menu.ItemGroup title={account.name}/>
		<Menu.Divider/>
		<Menu.Item danger onClick={() => { account.logOut(); }}>Log out</Menu.Item>
	</Menu>;


	return <Layout style={{ minHeight: "100vh" }}>
		<Header className="header">
			<div className="site-logo" />
			<span className="site-name">Clusterio</span>
			<span className="site-version">{ webUiPackage.version }</span>
			<Menu theme="dark" mode="horizontal" defaultSelectedKeys={["1"]}>
				<Menu.Item key="1">Dashboard</Menu.Item>
			</Menu>
			<Dropdown
				className="account-dropdown-header"
				placement="bottomRight"
				trigger="click"
				overlay={accountMenu}
			>
				<UserOutlined/>
			</Dropdown>
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
						<ErrorBoundary Component={ErrorPage}>
							{content}
						</ErrorBoundary>
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
