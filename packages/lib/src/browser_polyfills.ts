// Node.js globals used by lib and its dependencies when running in a browser.
// @ts-expect-error process has no type declarations
import process from "process/browser.js";
import { Buffer } from "buffer/";

// Vite's development server may already have created process.env
if (typeof globalThis.process?.nextTick !== "function") {
	globalThis.process = Object.assign(process, globalThis.process);
}
globalThis.Buffer ??= Buffer as any;
