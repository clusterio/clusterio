import type {
	PageActions, PageActionsHook, PageActionsSlot, PageActionsSlotProps, PluginPageAction, WebHooks,
} from "../BaseWebPlugin";

export async function pageActionsFromHooks(hooks: WebHooks) {
	const pageActions: Partial<PageActions> = {};
	for (const [source, record] of await hooks.pageActions.collectEntries()) {
		for (const [slot, useActions] of Object.entries(record) as [PageActionsSlot, PageActionsHook<any>][]) {
			if (!pageActions[slot]) {
				pageActions[slot] = new Map();
			}
			pageActions[slot].set(source, useActions);
		}
	}
	return pageActions;
}

/**
 * Call each plugin's actions hook for a page and prefix the keys with the
 * plugin name. Must be called during render, the set of plugins is fixed
 * after bootstrap so the hooks are called in the same order every time.
 */
export function callPageActions<K extends PageActionsSlot>(
	hooks: Map<string, PageActionsHook<K>> | undefined,
	props: PageActionsSlotProps[K],
) {
	const actions: PluginPageAction[] = [];
	for (const [source, useActions] of hooks ?? []) {
		for (const action of useActions(props)) {
			actions.push({ ...action, key: `${source}.${action.key}` });
		}
	}
	return actions;
}
