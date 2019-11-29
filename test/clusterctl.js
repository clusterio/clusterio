const assert = require('assert').strict;
const chalk = require('chalk');

const errors = require('lib/errors');
const { testLines } = require('./lib/factorio/lines');
const clusterctl = require('../clusterctl.js');
const mock = require('./mock');


describe("clusterctl", function() {
	describe("formatOutputColored()", function() {
		it("should pass the test lines", function() {
			// Ensure tests get uncoloured output.
			let old = chalk.level;
			chalk.level = 0;

			for (let [reference, output] of testLines) {
				let line = clusterctl._formatOutputColored(output);
				assert.deepEqual(line, reference);
			}

			chalk.level = old;
		});
	});
	describe("formatOutput()", function() {
		it("should pass the test lines", function() {
			for (let [reference, output] of testLines) {
				let line = clusterctl._formatOutput(output);
				assert.deepEqual(line, reference);
			}
		});
	});

	let mockConnector = new mock.MockConnector();
	mockConnector.on('send', function(message) {
		if (message.type === 'list_instances_request') {
			this.emit('message', {
				seq: 1, type: 'list_instances_response',
				data: {
					seq: message.seq,
					list: [{ id: 57, slave_id: 4, name: 'Test Instance' }],
				},
			});
		}
	});
	let testControl = new clusterctl._Control(mockConnector);

	describe("resolveInstance", function() {
		it("should pass an integer like string back", async function() {
			assert.equal(await clusterctl._resolveInstance(null, "123"), 123);
		});
		it("should resolve an instance name with the master server", async function() {
			assert.equal(await clusterctl._resolveInstance(testControl, "Test Instance"), 57);
		});
		it("should throw if instance is not found", async function() {
			await assert.rejects(
				clusterctl._resolveInstance(testControl, "invalid"),
				new errors.CommandError("No instance named invalid")
			);
		});
	});
});
