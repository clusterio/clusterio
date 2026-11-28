// browser_polyfills sets Node.js globals for the web interface. Each test loads a
// fresh copy with t.mockImport, with "process" and "buffer" replaced by stand-ins
// for the browser packages, and puts the real globals back afterwards.
import t from "tap";

const modulePath = "@clusterio/lib/dist/browser/src/browser_polyfills.js";

const realProcess = globalThis.process;
const realBuffer = globalThis.Buffer;

function restoreGlobals() {
	globalThis.process = realProcess;
	globalThis.Buffer = realBuffer;
}

function makePolyfills() {
	const process = { nextTick() {}, env: { NODE_ENV: "production" } };
	class Buffer {}
	return { process, Buffer, mocks: { process: { default: process }, buffer: { Buffer } } };
}

t.test("process", async t1 => {
	t1.test("installs the polyfill when process is missing", async t2 => {
		const { process, mocks } = makePolyfills();
		t2.teardown(restoreGlobals);
		(globalThis as any).process = undefined;
		await t2.mockImport(modulePath, mocks);
		const installed = globalThis.process;
		restoreGlobals();
		t2.equal(installed, process);
		t2.same(process.env, { NODE_ENV: "production" });
	});
	t1.test("keeps properties of a process without nextTick", async t2 => {
		const { process, mocks } = makePolyfills();
		t2.teardown(restoreGlobals);
		// Vite's dev server defines process.env only.
		(globalThis as any).process = { env: { APP_ENV: "browser" } };
		await t2.mockImport(modulePath, mocks);
		const installed = globalThis.process;
		restoreGlobals();
		t2.equal(installed, process);
		t2.same(process.env, { APP_ENV: "browser" });
		t2.type(process.nextTick, "function");
	});
	t1.test("leaves a complete process alone", async t2 => {
		const { process, mocks } = makePolyfills();
		await t2.mockImport(modulePath, mocks);
		t2.equal(globalThis.process, realProcess);
		t2.same(process.env, { NODE_ENV: "production" });
	});
});

t.test("Buffer", async t1 => {
	t1.test("installs the polyfill when Buffer is missing", async t2 => {
		const { Buffer, mocks } = makePolyfills();
		t2.teardown(restoreGlobals);
		(globalThis as any).Buffer = undefined;
		await t2.mockImport(modulePath, mocks);
		const installed = globalThis.Buffer;
		restoreGlobals();
		t2.equal(installed, Buffer);
	});
	t1.test("leaves an existing Buffer alone", async t2 => {
		const { mocks } = makePolyfills();
		await t2.mockImport(modulePath, mocks);
		t2.equal(globalThis.Buffer, realBuffer);
	});
});
