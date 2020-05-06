const ajv = new (require('ajv'))({
	verbose: true,
	format: "full",
	extendRefs: "fail",
	strictDefaluts: true,
	strictKeywords: true,
});


/**
 * The base format for any message sent over the link
 */
const messageSchema = {
	$schema: "http://json-schema.org/draft-07/schema#",
	title: "Message",
	description: "Format for messages on a link",
	type: "object",
	additionalProperties: false,
	required: ["seq", "type", "data"],
	properties: {
		"seq": { type: ["integer", "null"] },
		"type": { type: "string" },
		"data": { type: "object" },
	},
};

const message = ajv.compile(messageSchema);

const heartbeat = ajv.compile({
	$schema: "http://json-schema.org/draft-07/schema#",
	title: "Heartbeat",
	description: "Heartbeat sent over link",
	type: "object",
	additionalProperties: false,
	required: ["seq", "type", "data"],
	properties: {
		"seq": { const: null },
		"type": { const: "heartbeat" },
		"data": {
			type: "object",
			additionalProperties: false,
			required: ["seq"],
			properties: {
				"seq": { type: ["integer", "null"] },
			},
		},
	},
});

const serverHandshake = ajv.compile({
	$schema: "http://json-schema.org/draft-07/schema#",
	title: "Server Handshake",
	description: "Message sent from the server to a client during the handshake",
	allOf: [ messageSchema ],
	anyOf: [
		{
			properties: {
				"type": { const: "hello" },
				"data": {
					additionalProperties: false,
					required: ["version", "plugins"],
					properties: {
						"version": { type: "string" },
						"plugins": {
							type: "object",
							additionalProperties: { type: "string" },
						},
					}
				},
			},
		},
		{
			properties: {
				"type": { const: "ready" },
				"data": {
					additionalProperties: false,
					required: ["session_token", "heartbeat_interval"],
					properties: {
						"session_token": { type: "string" },
						"heartbeat_interval": { type: "number" },
					},
				},
			},
		},
		{
			properties: {
				"type": { const: "continue" },
				"data": {
					additionalProperties: false,
					required: ["last_seq", "heartbeat_interval"],
					properties: {
						"last_seq": { type: ["integer", "null"] },
						"heartbeat_interval": { type: "number" },
					},
				},
			},
		},
		{
			properties: {
				"type": { const: "invalidate" },
				"data": { const: {} },
			},
		},
	],
});

const clientHandshake = ajv.compile({
	$schema: "http://json-schema.org/draft-07/schema#",
	title: "Client Message",
	description: "Message sent from a client to the server",
	allOf: [ messageSchema ],
	anyOf: [
		{
			properties: {
				"type": { const: "register_slave" },
				"data": {
					additionalProperties: false,
					required: ["token", "agent", "version", "name", "id", "plugins"],
					properties: {
						"token": { type: "string" },
						"agent": { type: "string" },
						"version": { type: "string" },
						"name": { type: "string" },
						"id": { type: "integer" },
						"plugins": {
							type: "object",
							additionalProperties: { type: "string" },
						},
					},
				},
			},
		},
		{
			properties: {
				"type": { const: "register_control" },
				"data": {
					additionalProperties: false,
					required: ["token", "agent", "version"],
					properties: {
						"token": { type: "string" },
						"agent": { type: "string" },
						"version": { type: "string" },
					}
				},
			},
		},
		{
			properties: {
				"type": { const: "resume" },
				"data": {
					additionalProperties: false,
					required: ["session_token", "last_seq"],
					properties: {
						"session_token": { type: "string" },
						"last_seq": { type: ["integer", "null"] },
					},
				},
			},
		},
	],
});


module.exports = {
	compile: ajv.compile.bind(ajv),

	message,
	heartbeat,

	serverHandshake,
	clientHandshake,
};
