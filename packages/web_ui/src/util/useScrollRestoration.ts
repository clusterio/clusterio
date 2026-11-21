import { useEffect, useLayoutEffect, useRef } from "react";
import { type Location, useLocation, useNavigationType } from "react-router-dom";

const storageKey = "scroll_positions";
const maxEntries = 100;
const restoreTimeoutMs = 5000;

/** Read saved scroll positions, oldest first. */
export function loadScrollPositions(storage: Pick<Storage, "getItem">): Map<string, number> {
	try {
		const stored = JSON.parse(storage.getItem(storageKey) ?? "[]");
		if (Array.isArray(stored)) {
			return new Map(stored.filter(
				(entry): entry is [string, number] => typeof entry[0] === "string" && typeof entry[1] === "number"
			));
		}
	} catch {
		// Fall through to an empty map on corrupt data.
	}
	return new Map();
}

/** Record a position as the newest entry, dropping the oldest past the limit. */
export function setScrollPosition(positions: Map<string, number>, key: string, y: number) {
	positions.delete(key);
	positions.set(key, y);
	for (const oldest of positions.keys()) {
		if (positions.size <= maxEntries) {
			break;
		}
		positions.delete(oldest);
	}
}

export function saveScrollPositions(storage: Pick<Storage, "setItem">, positions: Map<string, number>) {
	try {
		storage.setItem(storageKey, JSON.stringify([...positions]));
	} catch {
		// Ignore storage errors (e.g. quota exceeded or storage disabled).
	}
}

/** History entries created outside the router all share the key "default". */
export function scrollKey(location: Pick<Location, "key" | "pathname" | "search">) {
	return location.key === "default" ? `${location.pathname}${location.search}` : location.key;
}

/**
 * Scroll to y, retrying as the page grows while its data loads. Gives up after
 * a timeout or when the user scrolls.
 */
function restoreScroll(y: number, onDone: () => void) {
	const inputEvents = ["wheel", "touchstart", "keydown", "pointerdown"];
	const observer = new ResizeObserver(attempt);
	const timeout = setTimeout(stop, restoreTimeoutMs);
	let stopped = false;

	function stop() {
		if (stopped) {
			return;
		}
		stopped = true;
		observer.disconnect();
		clearTimeout(timeout);
		for (const event of inputEvents) {
			window.removeEventListener(event, stop, true);
		}
		onDone();
	}

	function attempt() {
		window.scrollTo(0, y);
		if (window.scrollY >= y - 1) {
			stop();
		}
	}

	for (const event of inputEvents) {
		window.addEventListener(event, stop, { capture: true, passive: true });
	}
	observer.observe(document.body);
	attempt();
	return stop;
}

/**
 * Restore the window scroll position on back/forward and page reload, and
 * scroll to the top when navigating to another page.
 */
export default function useScrollRestoration() {
	const location = useLocation();
	const navigationType = useNavigationType();
	const key = scrollKey(location);
	const positions = useRef<Map<string, number> | null>(null);
	const currentKey = useRef(key);
	const restoring = useRef(false);
	const pathname = useRef(location.pathname);
	if (!positions.current) {
		positions.current = loadScrollPositions(sessionStorage);
	}

	useEffect(() => {
		window.history.scrollRestoration = "manual";
		function onScroll() {
			if (!restoring.current) {
				setScrollPosition(positions.current!, currentKey.current, window.scrollY);
			}
		}
		function persist() {
			saveScrollPositions(sessionStorage, positions.current!);
		}
		window.addEventListener("scroll", onScroll, { passive: true });
		window.addEventListener("pagehide", persist);
		return () => {
			window.removeEventListener("scroll", onScroll);
			window.removeEventListener("pagehide", persist);
			persist();
		};
	}, []);

	useLayoutEffect(() => {
		currentKey.current = key;
		saveScrollPositions(sessionStorage, positions.current!);
		const pathChanged = pathname.current !== location.pathname;
		pathname.current = location.pathname;
		// Table sort, filter and page changes only change the query
		if (navigationType === "PUSH" && pathChanged) {
			window.scrollTo(0, 0);
			return undefined;
		}
		if (navigationType !== "POP") {
			setScrollPosition(positions.current!, key, window.scrollY);
			return undefined;
		}
		restoring.current = true;
		return restoreScroll(positions.current!.get(key) ?? 0, () => { restoring.current = false; });
	}, [key]);
}
