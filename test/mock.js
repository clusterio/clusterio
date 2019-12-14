const events = require("events");

const link = require("lib/link");


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
}

class MockConnector extends events.EventEmitter {
	constructor() {
		super();

		this._seq = 1;
		this.sentMessages = [];
		this.events = new Map();
		this.handshake = { address: "socket.test" };
	}

	send(type, data) {
		let message = { seq: this._seq, type, data };
		this.sentMessages.push(message);
		setImmediate(() => this.emit('send', message));
		return this._seq++;
	}

	close(reason) {
		this.send('close', { reason });
		this.disconnect();
	}

	disconnect() {
		this.disconnectCalled = true;
	}
}

class MockServer {
	constructor() {
		this.rconCommands = [];
	}

	async sendRcon(command) {
		this.rconCommands.push(command);
	}
}

class MockInstance extends link.Link {
	constructor() {
		super('instance', 'slave', new MockConnector());
		this.server = new MockServer();
		this.name = "test";
	}
}


module.exports = {
	MockSocket,
	MockConnector,
	MockInstance,
};
