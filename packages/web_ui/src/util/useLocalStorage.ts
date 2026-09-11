import { useState } from "react";

/**
 * Persist a JSON-serialisable value in localStorage. Behaves like useState, but
 * seeds the initial value from localStorage and writes changes back. The write
 * is deferred to a later task so it never blocks the state update / re-render.
 */
export default function useLocalStorage<T>(key: string, defaultValue: T): [T, (value: T) => void] {
	const [value, setValue] = useState<T>(() => {
		const stored = localStorage.getItem(key);
		if (stored === null) {
			return defaultValue;
		}
		try {
			return JSON.parse(stored) as T;
		} catch {
			return defaultValue;
		}
	});

	function set(next: T) {
		setValue(next);
		setTimeout(() => {
			try {
				localStorage.setItem(key, JSON.stringify(next));
			} catch {
				// Ignore storage errors (e.g. quota exceeded or storage disabled).
			}
		}, 0);
	}

	return [value, set];
}
