/**
 * Memoize a function with a timeout. Calling the function again after the timeout will erase the cache.
 * @param fn Function to memoize
 * @param time Time in ms to cache results
 * @returns Memoized function
 */
// eslint-disable-next-line @typescript-eslint/ban-types
export function memoizeTimeout(fn: Function, time: number): Function {
	let cache = new Map();
	let expiryTimers = new Map() as Map<string, NodeJS.Timeout>;

	return (...args: any) => {
		// Create hash.
		const hash = JSON.stringify(args);

		// Erase cache.
		if (!expiryTimers.has(hash)) {
			expiryTimers.set(hash, setTimeout(() => {
				cache.delete(hash);
				const interval = expiryTimers.get(hash);
				clearInterval(interval);
				expiryTimers.delete(hash);
			}, time));
		}

		// Find in cache or store new values.
		if (cache.has(hash)) {
			return cache.get(hash);
		}
		let result = fn(...args);
		// Handle async functions
		if (result instanceof Promise) {
			// Add a Promise for the result to the cache to prevent duplicate calls
			cache.set(hash, result);
			return new Promise((resolve, reject) => {
				result.then((res: any) => {
					cache.set(hash, res);
					resolve(res);
				}).catch((err: any) => {
					reject(err);
				});
			});
		}
		// Handle synchronous functions
		cache.set(hash, result);
		return result;
	};
}
