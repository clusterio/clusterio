export type PluginWebApi = {
	name: string;
	version: string;
	enabled: boolean;
	loaded: boolean;
	web: {
		main: string;
		error?: string;
	};
	/**
	 * NPM package this plugin is published as. Not present if the package
	 * is private or the path used to load it does not match the name of the
	 * package.
	 */
	npmPackage?: string;
}
