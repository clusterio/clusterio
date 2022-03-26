import React, { useContext } from "react";

import ControlContext from "./ControlContext";


export default function PluginExtra(params) {
	let control = useContext(ControlContext);

	let components = [];
	for (let [name, plugin] of control.plugins) {
		if (Object.prototype.hasOwnProperty.call(plugin.componentExtra, params.component)) {
			let ComponentExtra = plugin.componentExtra[params.component];
			components.push(<ComponentExtra key={name} plugin={plugin} {...params}/>);
		}
	}
	return components;
}
