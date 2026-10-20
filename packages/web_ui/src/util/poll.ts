/**
 * Run a task now and again intervalMs after each run finishes, so runs never overlap.
 * The task handles its own errors.
 *
 * @returns Function that stops polling, a run in progress still finishes
 */
export function poll(task: () => Promise<void>, intervalMs: number) {
	let stopped = false;
	let timeout: ReturnType<typeof setTimeout> | undefined;
	async function run() {
		await task();
		if (!stopped) {
			timeout = setTimeout(run, intervalMs);
		}
	}
	run();
	return () => {
		stopped = true;
		clearTimeout(timeout);
	};
}
