const assert = require('assert').strict;

const mock = require('./mock');
const master = require('../master');


describe('Master testing', function() {
	describe("class WebSocketServerConnector", function() {
		let testConnector = new master._WebSocketServerConnector(new mock.MockSocket());
		describe(".disconnect()", function() {
			it("should call disconnect on the socket", function() {
				testConnector._socket.terminateCalled = false;
				testConnector.disconnect();
				assert(testConnector._socket.terminateCalled, "Terminate was not called");
			});
		});
	});
});
