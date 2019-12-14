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

	/**
	 * Creates a request
	 *
	 * @param {string} type -
	 *     message type used.  Will have suffix '_request' for the request
	 *     message and suffix '_response' for the response message.
	 * @param {Array<string>} links -
	 *     Links this request is valid on.  Takes an array of strings
	 *     containing "<source>-<target>" specifications.
	 * @param {?string} forwardTo -
	 *     Optional target to forward this request to.  Only 'instance' is
	 *     currently supported and adds instance_id into the
	 *     requestProperties.
	 * @param {Object<string, Object>} requestProperties -
	 *     Mapping of property values to JSON schema specifications for the
	 *     properties that are valid in the data payload of this requst.
	 * @param {Object<string, Object>} responseProperties -
	 *     Mapping of property values to JSON schema specifications for the
	 *     properties that are valid in the data payload of the response to
	 *     this requst.
	 */
	constructor({
		type, links, forwardTo = null, requestProperties = {}, responseProperties = {}
	}) {
		this.type = type;
		this.links = links;
		this.forwardTo = forwardTo;

		this.requestType = type + '_request';
		this.responseType = type + '_response';

		if (forwardTo === 'instance') {
			requestProperties = Object.assign(
				{"instance_id": { type: "integer" }}, requestProperties
			);

		} else if (forwardTo !== null) {
			throw new Error(`Invalid forwardTo value ${forwardTo}`);
		}

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
	 * If forwardTo was set to 'instance' the `forwardRequestToInstance`
	 * method on the link is used as the default handler.
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
		if (this.links.includes(`${link.source}-${link.target}`)) {
			link.setValidator(this.responseType, this._responseValidator);
		}

		// Target side.  Note: Source and target is reversed here.
		if (this.links.includes(`${link.target}-${link.source}`)) {

			// Use forwarder if handler is not present.
			if (!handler) {
				if (this.forwardTo === 'instance') {
					handler = link.forwardRequestToInstance;
				}
			}

			if (!handler) {
				throw new Error(`Missing handler for ${this.requestType} on ${link.source}-${link.target} link`);
			}

			link.setHandler(this.requestType, message => {
				handler.call(link, message, this).then(response => {
					if (response === undefined) {
						// XXX Should we allow implicit responses like this?
						response = {};
					}

					link.connector.send(this.responseType, { ...response, seq: message.seq });

				}).catch(err => {
					if (!(err instanceof errors.RequestError)) {
						console.error(`Unexpected error while responding to ${this.requestType}`, err);
					}
					link.connector.send(this.responseType, { seq: message.seq, error: err.message });
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
		let seq = link.connector.send(this.requestType, data);
		let responseMessage = await link.waitFor(this.responseType, { seq });
		if (responseMessage.data.error) {
			throw new errors.RequestError(responseMessage.data.error);
		}
		return responseMessage.data;
	}
}


let messages = {}

// Management requests
messages.listSlaves = new Request({
	type: 'list_slaves',
	links: ['control-master'],
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

messages.listInstances = new Request({
	type: 'list_instances',
	links: ['control-master'],
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

messages.setInstanceOutputSubscriptions = new Request({
	type: 'set_instance_output_subscriptions',
	links: ['control-master'],
	requestProperties: {
		"instance_ids": {
			type: "array",
			items: { type: "integer" },
		},
	},
});

messages.createInstanceCommand = new Request({
	type: 'create_instance',
	links: ['control-master'],
	requestProperties: {
		"name": { type: "string" },
		"slave_id": { type: "integer" },
	},
});

messages.createInstance = new Request({
	type: 'create_instance',
	links: ['master-slave'],
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

messages.startInstance = new Request({
	type: 'start_instance',
	links: ['control-master', 'master-slave', 'slave-instance'],
	forwardTo: 'instance',
});

messages.createSave = new Request({
	type: 'create_save',
	links: ['control-master', 'master-slave', 'slave-instance'],
	forwardTo: 'instance',
});

messages.stopInstance = new Request({
	type: 'stop_instance',
	links: ['control-master', 'master-slave', 'slave-instance'],
	forwardTo: 'instance',
});

messages.deleteInstance = new Request({
	type: 'delete_instance',
	links: ['control-master', 'master-slave'],
	forwardTo: 'instance',
});

messages.sendRcon = new Request({
	type: 'send_rcon',
	links: ['control-master', 'master-slave', 'slave-instance'],
	forwardTo: 'instance',
	requestProperties: {
		"command": { type: "string" },
	},
	responseProperties: {
		"result": { type: "string" },
	}
});


/**
 * Represents an event sent over the link
 *
 * A one way message without any response or recipt confirmation that
 * can be innitiated by either party of the link.
 */
class Event {

	/**
	 * Creates an event
	 *
	 * @param {string} type -
	 *     message type used.  Will have suffix '_event' appended to it for
	 *     the messages sent through this event.
	 * @param {Array<string>} links -
	 *     Links this event is valid on.  Takes an array of strings
	 *     containing "<source>-<target>" specifications.
	 * @param {?string} forwardTo -
	 *     Optional target to forward this request to.  Supported values are
	 *     'master' and 'instance'.  If set to 'instance' an instance_id
	 *     property is implicity added to eventProperties.
	 * @param {?string} broadcastTo -
	 *     Optional target to broadcast this event to.  Only 'instance' is
	 *     currently supported.  An event will only be broadcast towards
	 *     links that are downstream, so sending an event set to instance
	 *     broadcast that's sent to a slave will only be broadcast to that
	 *     slave's instances.
	 * @param {Object<string, Object>} eventProperties -
	 *     Mapping of property values to JSON schema specifications for the
	 *     properties that are valid in the data payload of this event.
	 */
	constructor({ type, links, forwardTo = null, broadcastTo = null, eventProperties = {} }) {
		this.type = type;
		this.links = links;
		this.forwardTo = forwardTo;
		this.broadcastTo = broadcastTo;

		if (forwardTo === 'instance') {
			eventProperties = Object.assign(
				{"instance_id": { type: "integer" }}, eventProperties
			);

		} else if (forwardTo !== 'master' && forwardTo !== null) {
			throw new Error(`Invalid forwardTo value ${forwardTo}`);
		}

		if (broadcastTo !== 'instance' && broadcastTo !== null) {
			throw new Error(`Invalid broadcastTo value ${broadcastTo}`);
		}

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

	/**
	 * Attach to a link
	 *
	 * Set a the handler for the event on the given link if it's a target
	 * for the event.
	 *
	 * If forwardTo was set to 'master' the `forwardEventToMaster` method on
	 * the link is used as the default handler.  If it was set to 'instance'
	 * the `forwardEventToInstance` method on the link is used by default.
	 *
	 * If broadcastTo was set to 'instance' the `broadcastEventToInstance`
	 * method on the link is invoked before the handler.
	 *
	 * Does nothing if the link is not a target for this event.
	 *
	 * @param {Link} link - The link to attach to.
	 * @param {Function} handler -
	 *    Async function to invoke with link set as this to handle the
	 *    event.  Only used on the target side.
	 * @throws {Error} if the handler is needed and not defined.
	 */
	attach(link, handler) {
		// Target side.  Note: Source and target is reversed here.
		if (this.links.includes(`${link.target}-${link.source}`)) {
			// Use forwarder if handler is not present.
			if (!handler) {
				if (this.forwardTo === 'instance') {
					handler = link.forwardEventToInstance;
				} else if (this.forwardTo === 'master') {
					handler = link.forwardEventToMaster;
				}
			}

			if (
				this.broadcastTo === 'instance'
				&& [
					'instance-slave', 'slave-master', 'control-master', 'master-slave'
				].includes(`${link.target}-${link.source}`)
			) {
				if (!handler) {
					handler = link.broadcastEventToInstance;
				} else {
					let originalHandler = handler;
					handler = async (message, event) => {
						await link.broadcastEventToInstance(message, event);
						await originalHandler.call(link, message, event);
					}
				}
			}

			if (!handler) {
				throw new Error(`Missing handler for ${this.eventType} on ${link.source}-${link.target} link`);
			}

			link.setHandler(this.eventType, message => {
				// XXX Should event handlers even be allowed to be async?
				handler.call(link, message, this).catch(err => {
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
		link.connector.send(this.eventType, data);
	}
}

messages.updateInstances = new Event({
	type: 'update_instances',
	links: ['slave-master'],
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

messages.instanceOutput = new Event({
	type: 'instance_output',
	links: ['instance-slave', 'slave-master', 'master-control'],
	forwardTo: 'master',
	eventProperties: {
		"instance_id": { type: "integer" },
		"output": {
			type: "object",
			additionalProperties: false,
			required: ["source", "received", "format", "type", "message"],
			properties: {
				"source": { type: "string" },
				"received": { type: "number" },
				"format": { type: "string" },
				"time": { type: "string" },
				"level": { type: "string" },
				"file": { type: "string" },
				"type": { type: "string" },
				"action": { type: "string" },
				"message": { type: "string" },
			},
		},
	},
});


/**
 * Attaches all requests and events to the given link
 *
 * Loops through all builtin messages defined and attaches all of them
 * to the link.  The handler used for the messageis looked up on the
 * link instance as the concatenation of the name of the message, the
 * name of message class, and 'Handler'.
 */
function attachAllMessages(link) {
	for (let [name, message] of Object.entries(messages)) {
		message.attach(link, link[name + message.constructor.name + 'Handler']);
	}
}


module.exports = {
	Request,
	Event,

	attachAllMessages,

	messages,
}
