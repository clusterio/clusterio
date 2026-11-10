import * as lib from "@clusterio/lib";

/**
 * Subscriber for the requests from hosts waiting to be approved
 *
 * The requests only live in the controller's memory and it does not tell
 * subscribers about requests removed while nothing was subscribed, so they
 * are cleared when subscribing again after the last handler unsubscribed.
 */
export class HostPairingSubscriber extends lib.MapSubscriber<lib.HostPairingUpdatesEvent> {
	private _handlers = 0;

	/**
	 * @param control - Link to the controller.
	 * @param permitted - Returns true if the account may approve hosts.
	 */
	constructor(control: lib.Link, permitted: () => boolean) {
		super(lib.HostPairingUpdatesEvent, control, undefined, permitted);
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
