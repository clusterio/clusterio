import React from "react";

import ControllerPage from "./components/ControllerPage";
import HostsPage from "./components/HostsPage";
import HostViewPage from "./components/HostViewPage";
import InstancesPage from "./components/InstancesPage";
import InstanceViewPage from "./components/InstanceViewPage";
import ModPackViewPage from "./components/ModPackViewPage";
import ModsPage from "./components/ModsPage";
import UsersPage from "./components/UsersPage";
import UserViewPage from "./components/UserViewPage";
import RolesPage from "./components/RolesPage";
import RoleViewPage from "./components/RoleViewPage";
import PluginsPage from "./components/PluginsPage";
import PluginViewPage from "./components/PluginViewPage";


export const pages = [
	{
		path: "/controller",
		sidebarName: "Controller",
		content: <ControllerPage />,
	},
	{
		path: "/hosts",
		sidebarName: "Hosts",
		permission: "core.host.list",
		content: <HostsPage />,
	},
	{
		path: "/hosts/:id/view",
		sidebarPath: "/hosts",
		content: <HostViewPage />,
	},
	{
		path: "/instances",
		sidebarName: "Instances",
		permission: "core.instance.list",
		content: <InstancesPage />,
	},
	{
		path: "/instances/:id/view",
		sidebarPath: "/instances",
		content: <InstanceViewPage />,
	},
	{
		path: "/mods",
		sidebarName: "Mods",
		permission: account => account.hasAnyPermission("core.mod.list", "core.mod-pack.list"),
		content: <ModsPage />,
	},
	{
		path: "/mods/mod-packs/:id/view",
		sidebarPath: "/mods",
		content: <ModPackViewPage />,
	},
	{
		path: "/users",
		sidebarName: "Users",
		permission: "core.user.list",
		content: <UsersPage />,
	},
	{
		path: "/users/:name/view",
		sidebarPath: "/users",
		content: <UserViewPage />,
	},
	{
		path: "/roles",
		sidebarName: "Roles",
		permission: "core.user.list",
		content: <RolesPage />,
	},
	{
		path: "/roles/:id/view",
		sidebarPath: "/roles",
		content: <RoleViewPage />,
	},
	{
		path: "/plugins",
		sidebarName: "Plugins",
		content: <PluginsPage />,
	},
	{
		path: "/plugins/:name/view",
		sidebarPath: "/plugins",
		content: <PluginViewPage />,
	},
];

export const sidebarPages = [
];
