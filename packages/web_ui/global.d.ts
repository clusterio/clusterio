declare module "*.png" {
	const value: string;
	export default value;
}

declare const webRoot: string;
declare const staticRoot: string;

declare const __webpack_init_sharing__: (shareScope: string) => Promise<void>;
declare const __webpack_share_scopes__: { default: any };
