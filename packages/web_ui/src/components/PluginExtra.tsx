import React, { useContext } from "react";

import ControlContext from "./ControlContext";
import { PluginExtensionSlot, ExtensionSlotProps } from "../BaseWebPlugin";


export default function PluginExtra<
	C extends PluginExtensionSlot
> (
	props: { component: C } & ExtensionSlotProps[C]
) {
	const control = useContext(ControlContext);
	const components = control.extensionComponents[props.component];
	return components && [...components].map(([source, Component]) => (
		<Component key={source} {...props} />
	));
}
