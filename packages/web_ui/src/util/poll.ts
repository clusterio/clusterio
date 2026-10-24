/**
 * Run a task now and again intervalMs after each run finishes, so runs never overlap.
 * setInterval can't be used as an async task may take longer than the interval.
 * The task handles its own errors.
 *
 * @returns Function that stops polling, a run in progress still finishes
 */
export function poll(task: () => Promise<void>, intervalMs: number) {
	let stopped = false;
	let timeout: ReturnType<typeof setTimeout> | undefined;
	async function run() {
		if (stopped) {
			return;
		}
		await task();
		// Stopping while the task ran must not schedule another run
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
