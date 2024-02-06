import React, { Fragment, useContext, useEffect, useState } from "react";
import { Route, Routes, useNavigate } from "react-router-dom";
import { Dropdown, Layout, Menu, MenuProps } from "antd";
import UserOutlined from "@ant-design/icons/UserOutlined";
import webUiPackage from "../../package.json";

import { useAccount } from "../model/account";
import ErrorBoundary from "./ErrorBoundary";
import ErrorPage from "./ErrorPage";
import ControlContext from "./ControlContext";
import { pages } from "../pages";

const { Header, Sider } = Layout;

export default function SiteLayout() {
	let navigate = useNavigate();
	let [currentSidebarPath, setCurrentSidebarPath] = useState<string|null>(null);
	let account = useAccount();
	let plugins = useContext(ControlContext).plugins;

	function SetSidebar(props: { path: string|null }) {
		useEffect(() => {
			setCurrentSidebarPath(props.path);
		});
		return null;
	}

	let accountMenuProps: MenuProps = {
		onClick: ({ key }: {key:string}) => {
			if (key === "user") {
				navigate(`/users/${account.name}/view`);
			} else if (key === "logOut") {
				account.logOut();
			}
		},
		items: [
			{ label: account.name, key: "user" },
			{ type: "divider" },
			{ label: "Log out", danger: true, key: "logOut" },
		],
	};

	let combinedPages = [...pages];
	for (let plugin of plugins.values()) {
		combinedPages.push(...plugin.pages);
	}

	let menuItems = [];
	let menuGroups = new Map();
	for (let { sidebarName, sidebarGroup, permission, path } of combinedPages) {
		if (
			!sidebarName || permission && (
				typeof permission === "function"
					? !permission(account)
					: !account.hasPermission(permission)
			)
		) {
			continue;
		}
		if (sidebarGroup) {
			let group = menuGroups.get(sidebarGroup);
			if (!group) {
				group = [];
				menuGroups.set(sidebarGroup, group);
			}
			group.push({ label: sidebarName, key: path });
		} else {
			menuItems.push({ label: sidebarName, key: path });
		}
	}
	for (let [name, group] of menuGroups) {
		menuItems.push({ type: "group", label: name, children: group, key: name });
	}

	return <Layout style={{ minHeight: "100vh" }}>
		<Header className="header">
			<div className="site-logo" />
			<span className="site-name">Clusterio</span>
			<span className="site-version">{ webUiPackage.version }</span>
			<Menu
				theme="dark"
				mode="horizontal"
				defaultSelectedKeys={["1"]}
				items={[{ label: "Dashboard", key: "1" }]}
			/>
			<Dropdown
				className="account-dropdown-header"
				placement="bottomRight"
				trigger={["click"]}
				menu={accountMenuProps}
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
					defaultOpenKeys={[...menuGroups.keys()]}
					selectedKeys={currentSidebarPath ? [currentSidebarPath] : []}
					style={{ height: "100%", borderRight: 0 }}
					onClick={({ key }) => navigate(key)}
					items={menuItems}
				/>
			</Sider>
			<Layout className="site-layout-content-container">
				<Routes>
					{combinedPages.map(({path, sidebarPath, content}) => <Route
						path={path}
						key={path}
						element={<Fragment key={path}>
							<SetSidebar path={sidebarPath ? sidebarPath : path} />
							<ErrorBoundary Component={ErrorPage}>
								{content}
							</ErrorBoundary>
						</Fragment>}
					/>)}
					<Route element={<SetSidebar path={null} />} />
				</Routes>
			</Layout>
		</Layout>
	</Layout>;
}
