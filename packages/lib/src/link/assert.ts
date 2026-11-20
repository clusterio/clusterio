/** Throws if condition is falsy, node:assert is not available in the browser. */
export function assert(condition: unknown): asserts condition {
	if (!condition) {
		throw new Error("Assertion failed");
	}
}
