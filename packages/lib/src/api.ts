export type PluginWebApi = {
	name: string;
	version: string;
	enabled: boolean;
	loaded: boolean;
	web: {
		main: string;
		error?: string;
	};
	requirePath: string;
}
