import { useContext } from "react";

import ControlContext from "../components/ControlContext";
import type { PageActionsSlot, PageActionsSlotProps, PluginPageAction } from "../BaseWebPlugin";
import { callPageActions } from "./plugin_actions";

/** Actions plugins add to the dropdown of a page. */
export default function usePluginActions<K extends PageActionsSlot>(
	slot: K,
	props: PageActionsSlotProps[K],
): PluginPageAction[] {
	const control = useContext(ControlContext);
	return callPageActions(control.pageActions[slot], props);
}
