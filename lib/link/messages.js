"use strict";
const schema = require("lib/schema");
const errors = require("lib/errors");

/**
 * Represents a request sent over the link
 *
 * A request-response message that can be innitated by either party of the
 * link.
 */
class Request {
	constructor({
		type, sources, targets, requestProperties = {}, responseProperties = {}
	}) {
		this.type = type;
		this.sources = sources;
		this.targets = targets;

		this.requestType = type + '_request';
		this.responseType = type + '_response';

		this._requestValidator = schema.compile({
			$schema: "http://json-schema.org/draft-07/schema#",
			properties: {
				"type": { const: this.requestType },
				"data": {
					additionalProperties: false,
					required: Object.keys(requestProperties),
					properties: requestProperties,
				},
			},
		});

		this._responseValidator = schema.compile({
			$schema: "http://json-schema.org/draft-07/schema#",
			properties: {
				"type": { const: this.responseType },
				"data": {
					anyOf: [
						{
							additionalProperties: false,
							required: ["seq", ...Object.keys(responseProperties)],
							properties: {
								"seq": { type: "integer" },
								...responseProperties,
							},
						},
						{
							additionalProperties: false,
							required: ["seq", "error"],
							properties: {
								"seq": { type: "integer" },
								"error": { type: "string" },
							},
						},
					],
				},
			}
		});
	}

	/**
	 * Attach to a link
	 *
	 * Set a the validator for the response on the given link if it's a
	 * source and sets the handler for the request if it is a target.
	 *
	 * Does nothing if the link is neither a source nor a target for this
	 * request.
	 *
	 * @param {Link} link - The link to attach to.
	 * @param {Function} handler -
	 *    Async function to invoke with link set as this to handle the
	 *    request request.  Only used on the target side.
	 * @throws {Error} if the handler is needed and not defined.
	 */
	attach(link, handler) {
		// Source side.
		if (this.sources.includes(link.source) && this.targets.includes(link.target)) {
			link.setValidator(this.responseType, this._responseValidator);
		}

		// Target side.  Note: Source and target is reversed here.
		if (this.targets.includes(link.source) && this.sources.includes(link.target)) {
			if (!handler) {
				throw new Error(`Missing handler for ${this.requestType} on ${link.target}-${link.source} link`);
			}

			link.setHandler(this.requestType, message => {
				handler.call(link, message).then(response => {
					if (response === undefined) {
						// XXX Should we allow implicit responses like this?
						response = {};
					}

					if (Object.prototype.hasOwnProperty.call(response, 'seq')) {
						throw new errors.RequestError("response contains reserved property 'seq'");
					}
					link.send(this.responseType, { seq: message.seq, ...response });

				}).catch(err => {
					if (!(err instanceof errors.RequestError)) {
						console.error(`Unexpected error while responding to ${this.requestType}`, err);
					}
					link.send(this.responseType, { seq: message.seq, error: err.message });
				});
			}, this._requestValidator);
		}
	}

	/**
	 * Send request over the given link
	 *
	 * Sends the given data over the link as the request payload and waits
	 * for the response.
	 *
	 * @returns {object} response data
	 */
	async send(link, data = {}) {
		// XXX validate link target/source?
		let seq = link.send(this.requestType, data);
		let responseMessage = await link.waitFor(this.responseType, { seq });
		if (responseMessage.data.error) {
			throw new errors.RequestError(responseMessage.data.error);
		}
		return responseMessage.data;
	}
}

/**
 * Represents a request sent to the master that is forwarded to an instance
 *
 * This is a two part request with a master part and a slave part.  The
 * master part is done by the forwardInstanceRequest method on the master
 * side of link which finds the slave the requuested instance is on and
 * forwards it there using the foward method.
 *
 * The slave part is done by the forwardInstanceRequest on the slave side of
 * the link and finds the instance and then calls the handler with it and
 * the message.
 */
class InstanceRequest {
	constructor({
		type, sources, requestProperties = {}, responseProperties = {}
	}) {
		this._masterRequest = new Request({
			type: type + '_master',
			sources,
			targets: ['master'],
			requestProperties: {
				"instance_id": { type: "integer" },
				...requestProperties,
			},
			responseProperties,
		});
		this._slaveRequest = new Request({
			type: type + '_slave',
			sources: ['master'],
			targets: ['slave'],
			requestProperties: {
				"instance_id": { type: "integer" },
				...requestProperties,
			},
			responseProperties,
		});
	}

	/**
	 * Attach to a link
	 *
	 * Attach master/slave part of the instance request.  If this is the
	 * slave side the handler argument is required.
	 *
	 * Does nothing if the link is neither a source nor a target for the
	 * slave or master request.
	 *
	 * @param {Link} link - The link to attach to.
	 * @param {Function} handler -
	 *    Async function to to handle the instance request.  It is passed on
	 *    to forwardInstanceRequest on the slave side.
	 * @throws {Error} if the handler is needed and not defined.
	 */
	attach(link, handler) {
		this._masterRequest.attach(link, async (message) => {
			return await link.forwardInstanceRequest(message, this);
		});
		this._slaveRequest.attach(link, async (message) => {
			return await link.forwardInstanceRequest(message, handler);
		});
	}

	/**
	 * Forward the message over the link
	 *
	 * This method is expected to be called by forwardInstanceRequest on the
	 * master with the slave link that the instance is on.
	 */
	async forward(link, message) {
		let response = await this._slaveRequest.send(link, message.data);
		delete response.seq;
		return response;
	}

	/**
	 * Send request over the given link
	 *
	 * Sends the given data over the link to the master and waits for it to
	 * forward the request to the slave with the instance on and return the
	 * result of it.
	 *
	 * @returns {object} response data
	 */
	async send(link, data = {}) {
		return await this._masterRequest.send(link, data);
	}
}

let requests = {}

// Management requests
requests.listSlaves = new Request({
	type: 'list_slaves',
	sources: ['control'],
	targets: ['master'],
	responseProperties: {
		"list": {
			type: "array",
			items: {
				additionalProperties: false,
				required: ["agent", "version", "name", "id", "connected"],
				properties: {
					"agent": { type: "string" },
					"version": { type: "string" },
					"name": { type: "string" },
					"id": { type: "integer" },
					"connected": { type: "boolean" },
				},
			},
		},
	},
});

requests.listInstances = new Request({
	type: 'list_instances',
	sources: ['control'],
	targets: ['master'],
	responseProperties: {
		"list": {
			type: "array",
			items: {
				additionalProperties: false,
				required: ["name", "id", "slave_id"],
				properties: {
					"name": { type: "string" },
					"id": { type: "integer" },
					"slave_id": { type: "integer" },
				},
			},
		},
	},
});

requests.createInstanceCommand = new Request({
	type: 'create_instance',
	sources: ['control'],
	targets: ['master'],
	requestProperties: {
		"name": { type: "string" },
		"slave_id": { type: "integer" },
	},
});

requests.createInstance = new Request({
	type: 'create_instance',
	sources: ['master'],
	targets: ['slave'],
	requestProperties: {
		"id": { type: "integer" },
		"options": {
			additionalProperties: false,
			required: [
				"name", "description", "visibility", "username", "token", "game_password",
				"verify_user_identity", "allow_commands", "auto_pause",
			],
			properties: {
				"name": { type: "string" },
				"description": { type: "string" },
				"visibility": { type: "object" },
				"username": { type: "string" },
				"token": { type: "string" },
				"game_password": { type: "string" },
				"verify_user_identity": { type: "boolean" },
				"allow_commands": { type: "string" },
				"auto_pause": { type: "boolean" },
			},
		},
	},
});


requests.createSave = new InstanceRequest({
	type: 'create_save',
	sources: ['control'],
});

requests.startInstance = new InstanceRequest({
	type: 'start_instance',
	sources: ['control'],
});

requests.stopInstance = new InstanceRequest({
	type: 'stop_instance',
	sources: ['control'],
});

requests.deleteInstance = new InstanceRequest({
	type: 'delete_instance',
	sources: ['control'],
});

requests.sendRcon = new InstanceRequest({
	type: 'send_rcon',
	sources: ['control'],
	requestProperties: {
		"command": { type: "string" },
	},
	responseProperties: {
		"result": { type: "string" },
	}
});


class Event {
	constructor({ type, sources, targets, eventProperties = {} }) {
		this.type = type;
		this.sources = sources;
		this.targets = targets;

		this.eventType = type + '_event';
		this._eventValidator = schema.compile({
			$schema: "http://json-schema.org/draft-07/schema#",
			properties: {
				"type": { const: this.eventType },
				"data": {
					additionalProperties: false,
					required: Object.keys(eventProperties),
					properties: eventProperties,
				},
			},
		});
	}

	attach(link, handler) {
		// Target side.  Note: Source and target is reversed here.
		if (this.targets.includes(link.source) && this.sources.includes(link.target)) {
			if (!handler) {
				throw new Error(`Missing handler for ${this.eventType} on ${link.target}-${link.source} link`);
			}

			link.setHandler(this.eventType, message => {
				// XXX Should event handlers even be allowed to be async?
				handler.call(link, message).catch(err => {
					console.error(`Unexpected error while handling ${this.eventType}`, err);
				});
			}, this._eventValidator);
		}
	}

	/**
	 * Send event over the given link
	 *
	 * Sends the given event data over the link.
	 */
	send(link, data = {}) {
		link.send(this.eventType, data);
	}
}

let events = {};
events.updateInstances = new Event({
	type: 'update_instances',
	sources: ['slave'],
	targets: ['master'],
	eventProperties: {
		"instances": {
			type: "array",
			items: {
				type: "object",
				additionalProperties: false,
				required: ["id", "name"],
				properties: {
					"id": { type: "integer" },
					"name": { type: "string" },
				},
			},
		},
	},
});


/**
 * Attaches all requests and events to the given link
 *
 * Loops through all requests and events defined and attaches all of
 * them to the link.  For requests the handler used is looked up on the
 * link instance as the name of the request + 'RequestHandler'.  For
 * events the the handler used is looked up on the link instance as the
 * name of the event + 'EventHandler'.
 */
function attachAllMessages(link) {
	for (let [name, request] of Object.entries(requests)) {
		request.attach(link, link[name + 'RequestHandler']);
	}

	for (let [name, event] of Object.entries(events)) {
		event.attach(link, link[name + 'EventHandler']);
	}
}

module.exports = {
	Request,
	InstanceRequest,
	Event,

	attachAllMessages,

	requests,
	events,
}
