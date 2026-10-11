declare module "*.png" {
	const value: string;
	export default value;
}

declare module "*.css" {
	const value: string;
	export default value;
}

declare module "*.svg" {
	const value: string;
	export default value;
}

declare module "*.md" {
	const value: string;
	export default value;
}

/** Path the web interface is served under, ends with a slash. */
declare const webRoot: string;
/** Path static assets are served under, ends with a slash. */
declare const staticRoot: string;

declare const __webpack_init_sharing__: (shareScope: string) => Promise<void>;
declare const __webpack_share_scopes__: { default: any };
