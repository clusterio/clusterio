import assert from "node:assert/strict";

import * as lib from "@clusterio/lib";
import { callPageActions, pageActionsFromHooks } from "../../packages/web_ui/src/util/plugin_actions.ts";

// BaseWebPlugin.ts uses parameter properties, which Node can't strip
class WebHooks extends lib.AsyncHookCollection {
	pageActions = this.newHook();
}

describe("web_ui/util/plugin_actions", function() {
	it("should prefix keys with the plugin name and keep plugin order", async function() {
		const hooks = new WebHooks(lib.logger);
		hooks.pageActions.attach("alpha", () => ({
			UserViewPage: ({ user }) => [{ key: "greet", label: `Hello ${user.name}` }],
		}));
		hooks.pageActions.attach("beta", () => ({
			UserViewPage: () => [{ key: "a", label: "A" }, { key: "b", label: "B", danger: true }],
			HostViewPage: () => [{ key: "c", label: "C" }],
		}));
		hooks.pageActions.attach("gamma", () => ({}));

		const pageActions = await pageActionsFromHooks(hooks);
		assert.deepEqual(Object.keys(pageActions).sort(), ["HostViewPage", "UserViewPage"]);
		assert.deepEqual(callPageActions(pageActions.UserViewPage, { user: { name: "bob" } }), [
			{ key: "alpha.greet", label: "Hello bob" },
			{ key: "beta.a", label: "A" },
			{ key: "beta.b", label: "B", danger: true },
		]);
		assert.deepEqual(callPageActions(pageActions.InstanceViewPage, { instance: {} }), []);
	});
});
