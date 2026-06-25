import React, { Fragment, useContext, useEffect, useState } from "react";
import { Route, Routes, useNavigate } from "react-router-dom";
import { Button, Drawer, Dropdown, Flex, Grid, Layout, Menu, MenuProps, Tooltip, Typography } from "antd";
import { UserOutlined, DownloadOutlined, MenuOutlined } from "@ant-design/icons";

import ErrorBoundary from "./ErrorBoundary";
import ErrorPage from "./ErrorPage";
import ControlContext from "./ControlContext";
import ChangeLogModal from "./ChangeLogModal";
import AboutModal from "./AboutModal";
import Link from "./Link";

import { pages } from "../pages";
import { saveJson } from "../util/save_file";
import { useAccount } from "../model/account";
import { DraggingContext } from "../model/is_dragging";
import webUiPackage from "../../package.json";
import logo from "../images/logo.png";

import { ControlConfig } from "@clusterio/lib";

type MenuItem = Required<MenuProps>["items"][number];

const { Sider, Header } = Layout;

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
	const screens = Grid.useBreakpoint();
	// On phone screens the sidebar becomes an overlay drawer instead of a fixed sider.
	// `md` matches the previous Sider breakpoint; `screens.md` is undefined until measured,
	// so treat the initial render as desktop to avoid flashing the hamburger.
	const isMobile = screens.md === false;
	const [drawerOpen, setDrawerOpen] = useState(false);
	const [collapsed, setCollapsed] = useState(false);
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

	// Navigate and dismiss the mobile drawer, matching hamburger menu conventions.
	function navigateAndClose(key: string) {
		navigate(key);
		setDrawerOpen(false);
	}

	// The header trigger collapses the sider on desktop and toggles the overlay drawer on phones.
	function toggleSidebar() {
		if (isMobile) {
			setDrawerOpen(value => !value);
		} else {
			setCollapsed(value => !value);
		}
	}

	let sidebarContent = <Menu
		theme="dark"
		mode="inline"
		defaultOpenKeys={[...menuGroups.keys()]}
		selectedKeys={currentSidebarPath ? [currentSidebarPath] : []}
		style={{ height: "100%", overflow: "auto", borderInlineEnd: 0 }}
		onClick={({ key }) => navigateAndClose(key)}
		items={menuItems}
	/>;

	let accountMenu = <Dropdown menu={accountMenuProps} trigger={["click"]} placement="bottomRight">
		<Button type="text" icon={<UserOutlined />} style={{ marginInlineStart: "auto" }}>
			{account.name}
		</Button>
	</Dropdown>;

	return <Layout
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
		<Header className="site-layout-header">
			<Button
				type="text"
				icon={<MenuOutlined />}
				onClick={toggleSidebar}
				aria-label="Toggle navigation menu"
			/>
			<Link to="/" style={{ display: "flex", alignItems: "center" }}>
				<img src={logo} width={32} height={32} alt="Clusterio logo" />
			</Link>
			<Flex vertical justify="center">
				<Typography.Title level={4} style={{ margin: 0, lineHeight: 1.2 }}>Clusterio</Typography.Title>
				<Tooltip title="View changelog" placement="right">
					<Typography.Text
						type="danger"
						style={{ cursor: "pointer", lineHeight: 1.2 }}
						onClick={() => setChangeLogOpen(true)}
					>
						{webUiPackage.version}
					</Typography.Text>
				</Tooltip>
			</Flex>
			{accountMenu}
		</Header>
		<DraggingContext.Provider value={dragging > 0}>
			<Layout hasSider={!isMobile}>
				{isMobile
					? <Drawer
						placement="left"
						open={drawerOpen}
						onClose={() => setDrawerOpen(false)}
						width={250}
						closable={false}
						// Start below the sticky 64px header so it stays visible and usable.
						rootStyle={{ top: 64 }}
						styles={{ body: { padding: 0, background: "#001529" } }}
					>
						{sidebarContent}
					</Drawer>
					: <Sider
						width={250}
						collapsible
						collapsed={collapsed}
						collapsedWidth={0}
						trigger={null}
						className="site-layout-sider"
					>
						{sidebarContent}
					</Sider>
				}
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
			</Layout>
		</DraggingContext.Provider>
	</Layout>;
}
