import * as lib from "@clusterio/lib";

/**
 * Subscriber for the requests from host installers waiting to be approved
 *
 * Only accounts that may approve hosts can subscribe to the requests, so
 * this does not resubscribe on connect or account changes for other
 * accounts, which would fail with a permission error.  The requests only
 * live in the controller's memory and it does not tell a new session about
 * requests removed before it started, so the requests are cleared when a
 * new session starts and fetched again.  The same applies to requests removed
 * while nothing was subscribed, so they are also cleared when subscribing
 * again after the last handler unsubscribed.
 */
export class HostPairingSubscriber extends lib.MapSubscriber<lib.HostPairingUpdatesEvent> {
	private _permitted: () => boolean;
	private _handlers = 0;

	/**
	 * @param control - Link to the controller.
	 * @param permitted - Returns true if the account may approve hosts.
	 */
	constructor(control: lib.Link, permitted: () => boolean) {
		super(lib.HostPairingUpdatesEvent, control);
		this._permitted = permitted;
	}

	override handleConnectionEvent(event: "connect" | "drop" | "resume" | "close") {
		if (event === "connect") {
			this.values.clear();
			this.lastUpdatedMs = -1;
		}
		if (event === "connect" || event === "resume") {
			// The account of a new session is reported after the connect event.
			queueMicrotask(() => {
				if (this._permitted()) {
					super.handleConnectionEvent(event);
				}
			});
			return;
		}
		super.handleConnectionEvent(event);
	}

	override handleAccountEvent() {
		if (this._permitted()) {
			super.handleAccountEvent();
		}
	}

	override subscribe(handler: lib.EventSubscriberCallback<lib.HostPairingUpdatesEvent>) {
		if (this._handlers === 0) {
			this.values.clear();
			this.lastUpdatedMs = -1;
		}
		this._handlers += 1;
		const unsubscribe = super.subscribe(handler);
		let unsubscribed = false;
		return () => {
			if (unsubscribed) {
				return;
			}
			unsubscribed = true;
			unsubscribe();
			// Deferred like the unsubscribe in EventSubscriber, so moving between pages
			// that both subscribe keeps the requests.
			setTimeout(() => {
				this._handlers -= 1;
			});
		};
	}
}
