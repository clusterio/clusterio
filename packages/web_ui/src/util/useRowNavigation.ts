import type React from "react";
import { useNavigate } from "react-router-dom";

/** Resolve an in-app path to a full path including the router basename. */
function resolvePath(to: string): string {
	const base = webRoot.replace(/\/$/, "");
	return base + to;
}

function isInsideLink(target: EventTarget | null): boolean {
	return target instanceof HTMLElement && target.closest("a") !== null;
}

/**
 * Navigation handlers for a whole table row that also support "open in new
 * tab": left-click navigates in place, middle-click or ctrl/cmd-click opens the
 * target in a new tab. Spread the result into the object returned from antd's
 * `onRow`, e.g. `onRow={record => rowNav(`/hosts/${record.id}/view`)}`. Clicks
 * that land on a real link inside the row are ignored so the anchor handles
 * them (and shows the native context menu / new-tab affordances itself).
 */
export default function useRowNavigation() {
	const navigate = useNavigate();
	return function rowNavigation(to: string): React.HTMLAttributes<HTMLElement> {
		return {
			style: { cursor: "pointer" },
			onClick: (event) => {
				if (event.defaultPrevented || isInsideLink(event.target)) {
					return;
				}
				if (event.ctrlKey || event.metaKey || event.shiftKey) {
					window.open(resolvePath(to), "_blank", "noopener");
				} else {
					navigate(to);
				}
			},
			onAuxClick: (event) => {
				// Middle click opens the row in a new tab.
				if (event.button === 1 && !isInsideLink(event.target)) {
					event.preventDefault();
					window.open(resolvePath(to), "_blank", "noopener");
				}
			},
			onMouseDown: (event) => {
				// Suppress the middle-click autoscroll cursor.
				if (event.button === 1) {
					event.preventDefault();
				}
			},
		};
	};
}
