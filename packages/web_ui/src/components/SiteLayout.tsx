import React, { Fragment, useContext, useEffect, useState } from "react";
import { Route, Routes, useNavigate } from "react-router-dom";
import { Button, Flex, Layout, Menu, MenuProps, Tooltip, Typography } from "antd";
import { UserOutlined, DownloadOutlined } from "@ant-design/icons";

import ErrorBoundary from "./ErrorBoundary";
import ErrorPage from "./ErrorPage";
import ControlContext from "./ControlContext";
import ChangeLogModal from "./ChangeLogModal";
import AboutModal from "./AboutModal";

import { pages } from "../pages";
import { saveJson } from "../util/save_file";
import { useAccount } from "../model/account";
import { DraggingContext } from "../model/is_dragging";
import webUiPackage from "../../package.json";
import logo from "../images/logo.png";

import { ControlConfig } from "@clusterio/lib";

type MenuItem = Required<MenuProps>["items"][number];

const { Sider } = Layout;

function isActiveDropzone(element: HTMLElement | null): boolean {
	if (!element) {
		return false;
	}
	const checkDepth = 5;
	let depth = 0;
	while (element && depth < checkDepth) {
		if (element.classList.contains("dropzone")) {
			return element.classList.contains("enabled");
		} else if (element.classList.contains("ant-upload-drag")) {
			return !element.classList.contains("disabled");
		}
		element = element.parentElement;
		depth += 1;
	}
	return false;
}

export default function SiteLayout() {
	let navigate = useNavigate();
	let [currentSidebarPath, setCurrentSidebarPath] = useState<string | null>(null);
	let account = useAccount();
	let plugins = useContext(ControlContext).plugins;
	const control = useContext(ControlContext);
	const [dragging, setDragging] = useState(0);
	const [aboutOpen, setAboutOpen] = useState(false);
	const [wasAboutOpen, setWasAboutOpen] = useState(false);
	const [changeLogOpen, setChangeLogOpen] = useState(false);

	function SetSidebar(props: { path: string | null }) {
		useEffect(() => {
			setCurrentSidebarPath(props.path);
		});
		return null;
	}

	let accountMenuProps: MenuProps = {
		onClick: ({ key }: { key: string }) => {
			if (key === "user") {
				navigate(`/users/${account.name}/view`);
			} else if (key === "ctlConfig") {
				const config = new ControlConfig("control", {
					"control.controller_token": control.connector.token,
					"control.controller_url": (new URL(webRoot, document.location.href)).href,
				});
				saveJson("config-control.json", config.toJSON());
			} else if (key === "about") {
				setAboutOpen(true);
			} else if (key === "logOut") {
				account.logOut();
			}
		},
		items: [
			{ label: account.name, key: "user" },
			{
				label: <Tooltip title="Download credentials and configuration file for cli interface">
					Ctl Config <Button size="small" icon={<DownloadOutlined />} />
				</Tooltip>,
				key: "ctlConfig",
			},
			{ label: "About", key: "about" },
			{ type: "divider" },
			{ label: "Log out", danger: true, key: "logOut" },
		],
	};

	let combinedPages = [...pages];
	for (let plugin of plugins.values()) {
		combinedPages.push(...plugin.pages);
	}

	let menuItems: MenuItem[] = [];
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

	// Prevent issues with event ordering
	let dragChange = 0;
	function setDraggingProxy(value: number) {
		dragChange += value;
		setDragging(dragging + dragChange);
	}

	return <Layout
		hasSider
		className="site-layout"
		style={{ minHeight: "100vh" }}
		onDragEnter={() => setDraggingProxy(1)}
		onDragLeave={() => setDraggingProxy(-1)}
		// Reset dragging state when dropped
		onDrop={(e) => {
			setDragging(0);
			// Prevent dropping outside of dropzone
			if (!isActiveDropzone(e.target as HTMLElement)) {
				e.preventDefault();
				e.stopPropagation();
			}
		}}
		// Allow entire document to be a drag target
		onDragOver={(e) => {
			e.preventDefault();
			// Change cursor
			if (isActiveDropzone(e.target as HTMLElement)) {
				e.dataTransfer.dropEffect = "copy";
			} else {
				e.dataTransfer.dropEffect = "none";
			}
		}}
	>
		<AboutModal
			open={aboutOpen}
			onClose={() => {
				setAboutOpen(false);
				setWasAboutOpen(false);
			}}
			onOpenChangelog={() => {
				setChangeLogOpen(true);
				setWasAboutOpen(aboutOpen);
				setAboutOpen(false);
			}}
		/>
		<ChangeLogModal
			open={changeLogOpen}
			onClose={() => {
				setChangeLogOpen(false);
				setAboutOpen(wasAboutOpen);
			}}
		/>
		<DraggingContext.Provider value={dragging > 0}>
			<Sider
				collapsible
				collapsedWidth={0}
				breakpoint="md"
				zeroWidthTriggerStyle={{ top: 6, zIndex: -1 }}
				width={250}
				className="site-layout-sider"
			>
				<Flex vertical style={{ height: "100%" }}>
					<Flex align="center" gap="middle" style={{ padding: 16 }}>
						<img src={logo} width={48} height={48} alt="Clusterio logo" />
						<Flex vertical>
							<Typography.Title level={4} style={{ margin: 0 }}>Clusterio</Typography.Title>
							<Tooltip title="View changelog" placement="right">
								<Typography.Text
									type="danger"
									style={{ cursor: "pointer" }}
									onClick={() => setChangeLogOpen(true)}
								>
									{webUiPackage.version}
								</Typography.Text>
							</Tooltip>
						</Flex>
					</Flex>
					<Menu
						theme="dark"
						mode="inline"
						defaultOpenKeys={[...menuGroups.keys()]}
						selectedKeys={currentSidebarPath ? [currentSidebarPath] : []}
						style={{ flex: 1, overflow: "auto", borderInlineEnd: 0 }}
						onClick={({ key }) => navigate(key)}
						items={menuItems}
					/>
					<Menu
						theme="dark"
						mode="vertical"
						selectable={false}
						style={{ borderInlineEnd: 0 }}
						onClick={accountMenuProps.onClick}
						items={[{
							key: "account",
							icon: <UserOutlined />,
							label: account.name,
							children: accountMenuProps.items,
						}]}
					/>
				</Flex>
			</Sider>
			<Layout className="site-layout-content-container">
				<Routes>
					{combinedPages.map(({ path, sidebarPath, content }) => <Route
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
		</DraggingContext.Provider>
	</Layout>;
}
