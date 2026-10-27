/** Runs one task at a time, refusing tasks started while another is running */
export class ExclusiveRunner<State> {
	current?: State;
	onChange: (state?: State) => void;

	constructor(onChange: (state?: State) => void) {
		this.onChange = onChange;
	}

	/** Run the task unless another is running, returns false if it was refused */
	async run(state: State, task: () => Promise<void>) {
		if (this.current !== undefined) {
			return false;
		}
		this.current = state;
		this.onChange(state);
		try {
			await task();
		} finally {
			this.current = undefined;
			this.onChange(undefined);
		}
		return true;
	}
}
