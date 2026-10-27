import assert from "node:assert/strict";

import { ExclusiveRunner } from "../../packages/web_ui/src/util/exclusive.ts";

describe("web_ui/util/exclusive", function() {
	describe("class ExclusiveRunner", function() {
		it("should refuse a restart while an install is running", async function() {
			const states = [];
			const runner = new ExclusiveRunner(state => states.push(state));
			let finishInstall;
			const install = runner.run("installing", () => new Promise(resolve => { finishInstall = resolve; }));
			let restarted = false;
			assert.equal(await runner.run("restarting", async () => { restarted = true; }), false);
			assert.equal(restarted, false);
			finishInstall();
			assert.equal(await install, true);
			assert.deepEqual(states, ["installing", undefined]);
		});
		it("should refuse an install while a restart is running", async function() {
			const runner = new ExclusiveRunner(() => {});
			let finishRestart;
			const restart = runner.run("restarting", () => new Promise(resolve => { finishRestart = resolve; }));
			assert.equal(await runner.run("installing", async () => {}), false);
			finishRestart();
			await restart;
			assert.equal(await runner.run("installing", async () => {}), true);
		});
		it("should accept a task after one that failed", async function() {
			const runner = new ExclusiveRunner(() => {});
			await assert.rejects(runner.run("installing", async () => { throw new Error("failed"); }), /failed/);
			assert.equal(runner.current, undefined);
			assert.equal(await runner.run("restarting", async () => {}), true);
		});
	});
});
