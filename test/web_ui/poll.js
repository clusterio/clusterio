import assert from "node:assert/strict";
import { setTimeout as sleep } from "node:timers/promises";

import { poll } from "../../packages/web_ui/src/util/poll.ts";

describe("web_ui/util/poll", function() {
	describe("poll()", function() {
		it("should keep every result of a task slower than the interval", async function() {
			let running = 0;
			let maxRunning = 0;
			const applied = [];
			let count = 0;
			const stop = poll(async () => {
				count += 1;
				const run = count;
				running += 1;
				maxRunning = Math.max(maxRunning, running);
				await sleep(20);
				running -= 1;
				applied.push(run);
			}, 1);
			await sleep(150);
			stop();
			await sleep(40);
			assert.equal(maxRunning, 1);
			assert.ok(applied.length >= 3, `only ${applied.length} runs finished`);
			assert.deepEqual(applied, applied.slice().sort((a, b) => a - b));
			assert.equal(applied.length, count);
		});

		it("should not run again once stopped", async function() {
			let count = 0;
			const stop = poll(async () => { count += 1; }, 1);
			stop();
			await sleep(20);
			assert.equal(count, 1);
		});
	});
});
