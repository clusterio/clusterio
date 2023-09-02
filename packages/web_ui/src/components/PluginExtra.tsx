import React, { useContext } from "react";

import * as lib from "@clusterio/lib";

import ControlContext from "./ControlContext";
import { RawUserState } from "../model/user";
import { HostState } from "../model/host";
import { InstanceState } from "../model/instance";
import { RawRoleState } from "./RoleViewPage";


type PluginExtraProps = {
	component: string;
	instance?: InstanceState;
	user?: RawUserState;
	host?: HostState;
	role?: RawRoleState;
};
export default function PluginExtra(props: PluginExtraProps) {
	let control = useContext(ControlContext);

	let components = [];
	for (let [name, plugin] of control.plugins) {
		if (Object.prototype.hasOwnProperty.call(plugin.componentExtra, props.component)) {
			type ComponentExtra = {[key: string]: React.ComponentType<PluginExtraProps & {plugin:lib.BaseWebPlugin}>};
			let ComponentExtra = (plugin.componentExtra as ComponentExtra)[props.component];
			components.push(<ComponentExtra key={name} plugin={plugin} {...props}/>);
		}
	}
	return components;
}
