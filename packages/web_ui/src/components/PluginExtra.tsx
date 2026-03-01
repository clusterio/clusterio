import React, { useContext } from "react";

import * as lib from "@clusterio/lib";

import ControlContext from "./ControlContext";
import BaseWebPlugin from "../BaseWebPlugin";


type PluginExtraProps = {
	component: string;
	instance?: lib.InstanceDetails;
	user?: lib.UserDetails;
	host?: lib.HostDetails;
	role?: lib.Role;
};
export default function PluginExtra(props: PluginExtraProps) {
	let control = useContext(ControlContext);

	let components = [];
	for (let [name, plugin] of control.plugins) {
		if (Object.prototype.hasOwnProperty.call(plugin.componentExtra, props.component)) {
			type ComponentExtra = {[key: string]: React.ComponentType<PluginExtraProps & {plugin:BaseWebPlugin}>};
			let ComponentExtra = (plugin.componentExtra as ComponentExtra)[props.component];
			components.push(<ComponentExtra key={name} plugin={plugin} {...props}/>);
		}
	}
	return components;
}
