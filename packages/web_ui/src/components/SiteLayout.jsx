import React, { useContext, useEffect, useState } from "react";
import { Switch, Route, useHistory } from "react-router-dom";
import { Dropdown, Layout, Menu } from "antd";
import UserOutlined from "@ant-design/icons/UserOutlined";
import webUiPackage from "../../package.json";

import { useAccount } from "../model/account";
import ErrorBoundary from "./ErrorBoundary";
import ErrorPage from "./ErrorPage";
import ControlContext from "./ControlContext";
import { pages } from "../pages";

const { Header, Sider } = Layout;


export default function SiteLayout(props) {
	let history = useHistory();
	let [currentSidebarPath, setCurrentSidebarPath] = useState(null);
	let account = useAccount();
	let plugins = useContext(ControlContext).plugins;

	function SetSidebar(setSidebarProps) {
		useEffect(() => {
			setCurrentSidebarPath(setSidebarProps.path);
		});
		return null;
	}

	let accountMenu = <Menu>
		<Menu.ItemGroup title={account.name}/>
		<Menu.Divider/>
		<Menu.Item danger onClick={() => { account.logOut(); }}>Log out</Menu.Item>
	</Menu>;

	let combinedPages = [...pages];
	for (let plugin of plugins.values()) {
		combinedPages.push(...plugin.pages);
	}

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
					selectedKeys={[currentSidebarPath]}
					style={{ height: "100%", borderRight: 0 }}
					onClick={({ key }) => history.push(key)}
				>
					{combinedPages.map(({sidebarName, path}) => (
						sidebarName ? <Menu.Item key={path}>{sidebarName}</Menu.Item> : null)
					)}
				</Menu>
			</Sider>
			<Layout className="site-layout-content-container">
				<Switch>
					{combinedPages.map(({path, sidebarPath, content}) => <Route exact path={path} key={path}>
						<SetSidebar path={sidebarPath ? sidebarPath : path} />
						<ErrorBoundary Component={ErrorPage}>
							{content}
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
