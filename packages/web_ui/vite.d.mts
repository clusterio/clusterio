import type { Plugin, PluginOption } from "vite";

export const sharedModules: string[];
export function devUrl(id: string): string;
export function devSharedUrl(name: string): string;
export function devPluginUrl(name: string): string;
export function clusterioApp(options: { entry: string }): PluginOption[];
export function clusterioDevPlugins(pluginDirs: Map<string, string>): Plugin;
export function clusterioPlugin(options?: { root?: string }): PluginOption[];
