import { useEffect, useState } from "react";
import { EventEmitter } from "events";

type PermissionEvents = {
	"change": [ status: string ]
};

class Permission extends EventEmitter<PermissionEvents> {
	status!: { state: string };

	constructor(name: PermissionName) {
		super();
		navigator.permissions.query({ name }).then(
			status => {
				this.status = status;
				this.emit("change", this.status.state);
				status.addEventListener("change", () => {
					this.emit("change", this.status.state);
				});
			},
			// Pretend the clipboard will work if this query fails.
			() => {
				this.status = { state: "prompt" };
				this.emit("change", "prompt");
			}
		);
	}

	get state() {
		return this.status.state || "prompt";
	}
}

let readPermission = new Permission("clipboard-read" as PermissionName);
let writePermission = new Permission("clipboard-write" as PermissionName);

// Wrapper for navigator.clipboard suitable for use in React
export function useClipboard() {
	let [readPermissionState, setReadPermissionState] = useState(readPermission.state);
	let [writePermissionState, setWritePermissionState] = useState(writePermission.state);

	useEffect(() => {
		readPermission.on("change", setReadPermissionState);
		writePermission.on("change", setWritePermissionState);
		return () => {
			readPermission.off("change", setReadPermissionState);
			writePermission.off("change", setWritePermissionState);
		};
	}, []);

	return {
		readPermissionState: readPermissionState,
		read: async () => await navigator.clipboard.read(),
		readText: async () => await navigator.clipboard.readText(),
		writePermissionState: writePermissionState,
		write: async (data: ClipboardItems) => await navigator.clipboard.write(data),
		writeText: async (text: string) => await navigator.clipboard.writeText(text),

		// Give a possible reason for why the clipboard is not available
		deniedReason: () => {
			if (window.isSecureContext === false) {
				if (window.location.protocol !== "https:") {
					return "Clipboard interaction is blocked due this page not being served over https.";
				}
				return "Clipboard interaction is blocked due this page not being a secure context.";
			}
			return "Clipboard interaction is blocked by the browser.";
		},
	};
}
