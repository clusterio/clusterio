import React from "react";

import MasterPage from "./components/MasterPage";
import SlavesPage from "./components/SlavesPage";
import SlaveViewPage from "./components/SlaveViewPage";
import InstancesPage from "./components/InstancesPage";
import InstanceViewPage from "./components/InstanceViewPage";
import UsersPage from "./components/UsersPage";
import UserViewPage from "./components/UserViewPage";
import RolesPage from "./components/RolesPage";
import RoleViewPage from "./components/RoleViewPage";
import PluginsPage from "./components/PluginsPage";
import PluginViewPage from "./components/PluginViewPage";


export const pages = [
	{
		path: "/master",
		sidebarName: "Master",
		content: <MasterPage />,
	},
	{
		path: "/slaves",
		sidebarName: "Slaves",
		permission: "core.slave.list",
		content: <SlavesPage />,
	},
	{
		path: "/slaves/:id/view",
		sidebarPath: "/slaves",
		content: <SlaveViewPage />,
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
