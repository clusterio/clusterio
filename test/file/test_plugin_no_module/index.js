// Instance plugin without a module/ folder, for tests that need one.
export const plugin = {
	name: "test_plugin_no_module",
	title: "Test Plugin Without Module",
	description: "Plugin used to test handling of plugins without a module.",

	instanceEntrypoint: "instance.js",
};
