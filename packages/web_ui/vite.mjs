// Vite configuration shared by the controller web interface and plugins.
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import util from "node:util";
import { createRequire } from "node:module";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { normalizePath } from "vite";

/**
 * Modules the web interface provides to plugins at runtime. Plugins must not
 * bundle their own copy of these, they are imported through the import map.
 */
export const sharedModules = [
	"@clusterio/lib",
	"@clusterio/web_ui",
	"@sinclair/typebox",
	"antd",
	"react",
	"react/jsx-runtime",
	"react-dom",
	"react-dom/client",
	"react-router",
	"react-router-dom",
];

/** Our own packages, these are ESM and differ between Node.js and the browser. */
const esmSharedModules = new Set(["@clusterio/lib", "@clusterio/web_ui"]);

// Only the console transport of winston works in the browser, and the colour
// library used by it does not.
const stubbedModules = /node_modules\/(winston\/dist\/winston\/transports\/(http|file)\.js|@colors\/colors\/)/;
// Browser versions of Node.js modules, resolved from web_ui so lib and plugins
// don't need them as dependencies.
const polyfills = {
	assert: "assert/",
	buffer: "buffer/",
	events: "events/",
	os: "os-browserify/browser",
	path: "path-browserify",
	process: "process/browser.js",
	stream: "stream-browserify",
	util: "util/",
	zlib: "browserify-zlib",
};
const webUiPackage = fileURLToPath(new URL("./package.json", import.meta.url));
const libPackage = createRequire(webUiPackage).resolve("@clusterio/lib/package.json");
const sharedPrefix = "\0clusterio:shared/";
const pluginPrefix = "\0clusterio:plugin/";

/** URL of a virtual module on the Vite development server relative to its base. */
export function devUrl(id) {
	return `@id/${id.replace("\0", "__x00__")}`;
}

export function devSharedUrl(name) {
	return devUrl(sharedPrefix + name);
}
export function devPluginUrl(name) {
	return devUrl(pluginPrefix + name);
}

async function getCommitHash() {
	try {
		const { stdout } = await util.promisify(execFile)("git", ["rev-parse", "--short", "HEAD"]);
		return stdout.trim();
	} catch {
		return "unknown";
	}
}

async function findFile(dir, candidates) {
	for (const file of candidates) {
		try {
			await fs.access(path.join(dir, file));
			return file;
		} catch {
			// Try the next one
		}
	}
	return undefined;
}

// node_modules directories Node.js would search for packages imported from dir.
function nodeModulesDirs(dir) {
	const dirs = [];
	for (let current = dir; ; current = path.dirname(current)) {
		if (path.basename(current) !== "node_modules") {
			dirs.push(path.join(current, "node_modules"));
		}
		if (current === path.dirname(current)) {
			return dirs;
		}
	}
}

function chunkName(name) {
	return name.replace(/^@/, "").replace(/[/]/g, "_");
}

// Lists the named exports of a CommonJS package so they can be re-exported
// statically, export * from a CommonJS module only forwards default.
function exportNames(name, root) {
	if (esmSharedModules.has(name)) {
		return null;
	}
	const mod = createRequire(path.join(root, "package.json"))(name);
	const names = Object.keys(mod).filter(key => key !== "__esModule" && /^[A-Za-z_$][\w$]*$/.test(key));
	const isModule = Object.prototype.toString.call(mod) === "[object Module]";
	if (!isModule && !mod.__esModule && !names.includes("default")) {
		names.push("default");
	}
	return names;
}

function sharedModuleCode(name, root) {
	const names = exportNames(name, root);
	if (!names) {
		return `export * from ${JSON.stringify(name)};\n`;
	}
	return `export { ${names.join(", ")} } from ${JSON.stringify(name)};\n`;
}

async function pluginEntryCode(pluginDir) {
	const resolve = file => JSON.stringify(normalizePath(path.join(pluginDir, file)));
	const exposes = {
		"./": await findFile(pluginDir, ["index.ts", "index.js"]),
		"./package.json": "package.json",
		"./web": await findFile(pluginDir, ["web/index.tsx", "web/index.ts", "web/index.jsx", "web/index.js"]),
	};
	if (!exposes["./"]) {
		throw new Error(`No index.ts or index.js found in ${pluginDir}`);
	}
	const entries = Object.entries(exposes)
		.filter(([, file]) => file)
		.map(([key, file]) => `\t${JSON.stringify(key)}: () => import(${resolve(file)}),`);
	return [
		"const modules = {",
		...entries,
		"};",
		"export async function get(key) {",
		"\tif (!Object.hasOwn(modules, key)) {",
		"\t\tthrow new Error(\"Module \" + key + \" is not exposed by this plugin\");",
		"\t}",
		"\treturn await modules[key]();",
		"}",
		"",
	].join("\n");
}

// Replaces modules that do not work in the browser with an empty module.
// Also passed to the dependency optimizer as it does not run Vite plugins.
const stubs = {
	name: "clusterio:stubs",
	load(id) {
		if (stubbedModules.test(normalizePath(id))) {
			return "module.exports = {};\n";
		}
		return null;
	},
};

const polyfillResolver = {
	name: "clusterio:polyfills",
	resolveId(id, _importer, options) {
		const target = polyfills[id.replace(/^node:/, "")];
		if (!target) {
			return null;
		}
		return this.resolve(target, webUiPackage, { ...options, skipSelf: true });
	},
};

/** Base config needed to build code that imports @clusterio/lib for the browser. */
function browserCompat() {
	return {
		name: "clusterio:browser-compat",
		enforce: "pre",
		async config(_config, { command }) {
			const buildEnv = process.env.NODE_ENV ?? (command === "build" ? "production" : "dev");
			return {
				base: command === "build" ? "./" : undefined,
				define: {
					"global": "globalThis",
					"process.env.APP_ENV": JSON.stringify("browser"),
					"process.env.COMMIT_HASH": JSON.stringify(await getCommitHash()),
					"process.env.BUILD_DATE": JSON.stringify(new Date().toISOString()),
					"process.env.BUILD_ENV": JSON.stringify(buildEnv),
					"process.env.BUILD_OS": JSON.stringify(os.platform()),
				},
				optimizeDeps: {
					rolldownOptions: { plugins: [polyfillResolver, stubs] },
				},
				resolve: {
					alias: [{ find: /^node:(.*)$/, replacement: "$1" }],
				},
				build: {
					target: "es2022",
					sourcemap: true,
					assetsDir: "static",
					chunkSizeWarningLimit: 2048,
					rolldownOptions: {
						// Message and permission registration relies on class names.
						output: {
							minify: {
								compress: { keepNames: { class: true, function: false } },
								mangle: { keepNames: { class: true, function: false } },
							},
						},
					},
				},
			};
		},
		resolveId: polyfillResolver.resolveId,
		load: stubs.load,
		transform(code, id) {
			if (id.endsWith(".md")) {
				return { code: `export default ${JSON.stringify(code)};\n`, map: null };
			}
			return null;
		},
	};
}

function writeManifest(manifest) {
	return {
		type: "asset",
		fileName: "manifest.json",
		source: `${JSON.stringify(manifest, null, "\t")}\n`,
	};
}

/**
 * Vite plugins for building the web interface served by the controller.
 *
 * Builds `entry` together with one entry per shared module and writes
 * manifest.json listing the main bundle and the import map for plugins.
 */
export function clusterioApp({ entry }) {
	let root;
	return [
		browserCompat(),
		react(),
		{
			name: "clusterio:app",
			api: { entry },
			config(config) {
				root = normalizePath(path.resolve(config.root ?? process.cwd()));
				return {
					optimizeDeps: {
						entries: [entry],
						include: sharedModules.filter(name => !esmSharedModules.has(name)),
					},
					build: {
						outDir: "dist/web",
						emptyOutDir: true,
						rolldownOptions: {
							input: {
								main: path.posix.join(root, entry),
								...Object.fromEntries(sharedModules.map(name => [
									`shared-${chunkName(name)}`, sharedPrefix + name,
								])),
							},
							preserveEntrySignatures: "strict",
						},
					},
				};
			},
			resolveId(id) {
				if (id.startsWith(sharedPrefix)) {
					return id;
				}
				return null;
			},
			load(id) {
				if (id.startsWith(sharedPrefix)) {
					return sharedModuleCode(id.slice(sharedPrefix.length), root);
				}
				return null;
			},
			generateBundle(_options, bundle) {
				const entries = new Map();
				for (const chunk of Object.values(bundle)) {
					if (chunk.type === "chunk" && chunk.isEntry) {
						entries.set(chunk.facadeModuleId, chunk.fileName);
					}
				}
				this.emitFile(writeManifest({
					main: entries.get(path.posix.join(root, entry)),
					imports: Object.fromEntries(sharedModules.map(
						name => [name, entries.get(sharedPrefix + name)]
					)),
				}));
			},
		},
	];
}

/**
 * Vite plugin serving plugins from source on the controller's development
 * server, given as a map of plugin name to plugin directory.
 */
export function clusterioDevPlugins(pluginDirs) {
	return {
		name: "clusterio:dev-plugins",
		config(config) {
			const root = path.resolve(config.root ?? process.cwd());
			const sources = [root, path.dirname(webUiPackage), path.dirname(libPackage), ...pluginDirs.values()];
			return {
				server: {
					// Vite's default is the workspace root, which may be the data directory.
					fs: { allow: [...sources, ...sources.flatMap(nodeModulesDirs)] },
				},
				optimizeDeps: {
					entries: [...pluginDirs.values()].flatMap(
						dir => [`${dir}/index.{ts,js}`, `${dir}/web/**/*.{ts,tsx,js,jsx}`]
					),
				},
			};
		},
		resolveId(id) {
			if (id.startsWith(pluginPrefix)) {
				return id;
			}
			return null;
		},
		load(id) {
			if (id.startsWith(pluginPrefix)) {
				const dir = pluginDirs.get(id.slice(pluginPrefix.length));
				return dir ? pluginEntryCode(dir) : null;
			}
			return null;
		},
	};
}

/**
 * Vite plugins for building the web bundle of a Clusterio plugin.
 *
 * The bundle exposes index, package.json and web/index from the plugin
 * directory. Modules in sharedModules are left as bare imports and resolved
 * by the web interface's import map at runtime.
 */
export function clusterioPlugin({ root = process.cwd() } = {}) {
	const entryId = "\0clusterio:plugin-entry";
	return [
		browserCompat(),
		react(),
		{
			name: "clusterio:plugin",
			async config() {
				const pkg = JSON.parse(await fs.readFile(path.join(root, "package.json"), "utf8"));
				const name = pkg.name.replace(/^@[^/]+\/(plugin-)?/, "");
				return {
					build: {
						outDir: "dist/web",
						emptyOutDir: true,
						rolldownOptions: {
							input: { [name]: entryId },
							external: sharedModules,
							preserveEntrySignatures: "strict",
						},
					},
				};
			},
			resolveId(id) {
				if (id === entryId) {
					return id;
				}
				return null;
			},
			load(id) {
				if (id === entryId) {
					return pluginEntryCode(root);
				}
				return null;
			},
			generateBundle(_options, bundle) {
				const chunk = Object.values(bundle).find(c => c.type === "chunk" && c.facadeModuleId === entryId);
				this.emitFile(writeManifest({ main: chunk.fileName }));
			},
		},
	];
}
