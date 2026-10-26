// Node.js globals used by lib and its dependencies when running in a browser.
import process from "process";
import { Buffer } from "buffer";

// Vite's development server may already have created process.env
if (typeof globalThis.process?.nextTick !== "function") {
	globalThis.process = Object.assign(process, globalThis.process);
}
globalThis.Buffer ??= Buffer as any;
