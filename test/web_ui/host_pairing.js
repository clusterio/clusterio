import assert from "node:assert/strict";
import events from "node:events";

import * as lib from "@clusterio/lib";
import { MockConnector, MockControl } from "../mock.js";
import "../setup_logging.js";

import { HostPairingSubscriber } from "../../packages/web_ui/src/util/host_pairing.ts";

const addr = lib.Address.fromShorthand;

describe("web_ui/util/host_pairing", function() {
	describe("class HostPairingSubscriber", function() {
		let mockControl;
		let permitted;
		let subscriber;

		beforeEach(function() {
			mockControl = new MockControl(new MockConnector(addr({ controlId: 0 }), addr("controller")));
			permitted = true;
			subscriber = new HostPairingSubscriber(mockControl, () => permitted);
		});

		function pairing(code, updatedAtMs) {
			return new lib.HostPairingDetails(code, `Host ${code}`, "192.0.2.1", "", updatedAtMs, updatedAtMs);
		}

		async function settle() {
			await new Promise(resolve => setImmediate(resolve));
		}

		function sentRequests() {
			return mockControl.connector.sentMessages.filter(message => message.name === "SubscriptionRequest");
		}

		it("should not send requests on connect or account updates without permission", async function() {
			permitted = false;
			mockControl.connector.emit("connect");
			subscriber.handleConnectionEvent("resume");
			subscriber.handleAccountEvent();
			await settle();
			assert.deepEqual(sentRequests(), []);
		});

		it("should resubscribe on connect with permission", async function() {
			subscriber.subscribe(() => {});
			await events.once(mockControl.connector, "send");
			mockControl.connector.sentMessages.length = 0;

			mockControl.connector.emit("connect");
			await settle();
			assert.equal(sentRequests().length, 1);
			assert.deepEqual(sentRequests()[0].data, new lib.SubscriptionRequest(
				lib.HostPairingUpdatesEvent.name, "replace", -1, lib.SubscriptionFilters.all()
			));
		});

		it("should resubscribe on account updates with permission", async function() {
			subscriber.subscribe(() => {});
			await events.once(mockControl.connector, "send");
			mockControl.connector.sentMessages.length = 0;

			permitted = false;
			subscriber.handleAccountEvent();
			await settle();
			assert.deepEqual(sentRequests(), []);

			permitted = true;
			subscriber.handleAccountEvent();
			await settle();
			assert.equal(sentRequests().length, 1);
		});

		it("should clear requests when a new session starts", async function() {
			await subscriber._handleEvent(new lib.HostPairingUpdatesEvent([pairing("ABC-DEF", 10)]));
			assert.equal(subscriber.values.size, 1);
			const [before] = subscriber.getSnapshot();

			mockControl.connector.emit("connect");
			assert.equal(subscriber.values.size, 0);
			assert.equal(subscriber.lastUpdatedMs, -1);
			const [after] = subscriber.getSnapshot();
			assert.notEqual(after, before);
			assert.equal(after.size, 0);
		});

		it("should keep requests when a session is resumed", async function() {
			await subscriber._handleEvent(new lib.HostPairingUpdatesEvent([pairing("ABC-DEF", 10)]));
			subscriber.handleConnectionEvent("drop");
			subscriber.handleConnectionEvent("resume");
			assert.equal(subscriber.values.size, 1);
			assert.equal(subscriber.lastUpdatedMs, 10);
		});

		it("should clear requests when subscribing again after the last unsubscribe", async function() {
			const unsubscribe = subscriber.subscribe(() => {});
			await events.once(mockControl.connector, "send");
			await subscriber._handleEvent(new lib.HostPairingUpdatesEvent([pairing("ABC-DEF", 10)]));
			unsubscribe();
			await new Promise(resolve => setTimeout(resolve));
			mockControl.connector.sentMessages.length = 0;

			subscriber.subscribe(() => {});
			assert.equal(subscriber.values.size, 0);
			await settle();
			assert.equal(sentRequests().length, 1);
			assert.equal(sentRequests()[0].data.lastRequestTimeMs, -1);
		});

		it("should keep requests when a page that subscribes replaces another", async function() {
			const unsubscribe = subscriber.subscribe(() => {});
			await events.once(mockControl.connector, "send");
			await subscriber._handleEvent(new lib.HostPairingUpdatesEvent([pairing("ABC-DEF", 10)]));
			unsubscribe();
			subscriber.subscribe(() => {});
			assert.equal(subscriber.values.size, 1);
			assert.equal(subscriber.lastUpdatedMs, 10);
		});
	});
});
