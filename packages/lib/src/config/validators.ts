import path from "node:path";

/** Combine multiple validators into a single one. */
export function all<V, C> (
	...validators: ((value: V, config: C) => void)[]
) {
	return function (value: V, config: C) {
		for (const validator of validators) {
			validator(value, config);
		}
	};
}

/** Skip validation of optional fields when null */
export function optional<V, C> (
	validator: (value: V, config: C) => void
) {
	return function (value: V | null, config: C) {
		if (value === null) { return; }
		validator(value, config);
	};
}

/** Value must be greater than the minimum value */
export function greaterThan(min: number) {
	return function (value: number) {
		if (value <= min) {
			throw new Error(`Value must be greater than ${min}`);
		}
	};
}

/** Value must be greater than 0 */
export const greaterThanZero = greaterThan(0);

/** Value must be greater than or equal to the minimum value */
export function greaterThanEqual(min: number) {
	return function (value: number) {
		if (value < min) {
			throw new Error(`Value must be greater than ${min}`);
		}
	};
}

/** Value must be greater than or equal to 0 */
export const greaterThanEqualZero = greaterThanEqual(0);

/** Value must be an integer value */
export function integer(value: number) {
	if (!Number.isInteger(value)) {
		throw new Error("Value must be an integer");
	}
}

/** Value must be a valid file path, it does not need to exist */
export function filePath(value: string) {
	try {
		path.resolve(value);
	} catch (err: any) {
		throw new Error(`Value must be a valid path: ${err.message}`);
	}
}
