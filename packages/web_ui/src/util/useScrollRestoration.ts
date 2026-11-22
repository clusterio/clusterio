import { useEffect, useLayoutEffect, useState } from "react";
import { type Location, type NavigationType, useLocation, useNavigationType } from "react-router-dom";

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
export function restoreScroll(y: number, onDone: () => void) {
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

export class ScrollRestorer {
	positions = loadScrollPositions(sessionStorage);
	restoring = false;

	key: string;
	pathname: string;

	constructor(key: string, pathname: string) {
		this.key = key;
		this.pathname = pathname;
	}

	/** Start recording scroll positions, returns a function that stops it. */
	attach() {
		window.history.scrollRestoration = "manual";
		const onScroll = () => {
			if (!this.restoring) {
				setScrollPosition(this.positions, this.key, window.scrollY);
			}
		};
		const persist = () => saveScrollPositions(sessionStorage, this.positions);
		window.addEventListener("scroll", onScroll, { passive: true });
		window.addEventListener("pagehide", persist);
		return () => {
			window.removeEventListener("scroll", onScroll);
			window.removeEventListener("pagehide", persist);
			persist();
		};
	}

	/** Handle a location change, returns a function that cancels a pending restore. */
	navigate(key: string, pathname: string, navigationType: NavigationType) {
		this.key = key;
		saveScrollPositions(sessionStorage, this.positions);
		const pathChanged = this.pathname !== pathname;
		this.pathname = pathname;
		// Table sort, filter and page changes only change the query
		if (navigationType === "PUSH" && pathChanged) {
			window.scrollTo(0, 0);
			return undefined;
		}
		if (navigationType !== "POP") {
			setScrollPosition(this.positions, key, window.scrollY);
			return undefined;
		}
		this.restoring = true;
		return restoreScroll(this.positions.get(key) ?? 0, () => { this.restoring = false; });
	}
}

/**
 * Restore the window scroll position on back/forward and page reload, and
 * scroll to the top when navigating to another page.
 */
export default function useScrollRestoration() {
	const location = useLocation();
	const navigationType = useNavigationType();
	const key = scrollKey(location);
	const [restorer] = useState(() => new ScrollRestorer(key, location.pathname));
	useEffect(() => restorer.attach(), []);
	useLayoutEffect(() => restorer.navigate(key, location.pathname, navigationType), [key]);
}
