declare module '*.png' {
	const value: import('react-native').ImageSourcePropType;
	export default value;
}

declare interface Window {
	webRoot: string;
	staticRoot: string;
}

declare const __webpack_init_sharing__: (shareScope: string) => Promise<void>;
declare const __webpack_share_scopes__: { default: any };
