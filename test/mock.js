const events = require("events");


class MockSocket {
	constructor() {
		this.sentMessages = [];
		this.events = new Map();
		this.handshake = { address: "socket.test" };
	}

	send(message) {
		this.sentMessages.push(message);
	}

	on(event, fn) {
		this.events.set(event, fn);
	}

	disconnect() {
		this.disconnectCalled = true;
	}

	close() {
		this.closeCalled = true;
	}
};

class MockConnector extends events.EventEmitter {
	constructor() {
		super();

		this._seq = 1;
		this.sentMessages = [];
		this.events = new Map();
		this.handshake = { address: "socket.test" };
	}

	send(type, data) {
		this.sentMessages.push({ seq: this._seq, type, data });
		return this._seq++;
	}

	disconnect() {
		this.disconnectCalled = true;
	}
};

module.exports = {
	MockSocket,
	MockConnector,
};
