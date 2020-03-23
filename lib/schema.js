const ajv = new (require('ajv'))({
	verbose: true,
	format: "full",
	extendRefs: "fail",
	strictDefaluts: true,
	strictKeywords: true,
})


const closeSchema = {
	$schema: "http://json-schema.org/draft-07/schema#",
	title: "Close Message",
	description: "Format for a close messages on a link",
	properties: {
		"type": { const: "close" },
		"data": {
			additionalProperties: false,
			required: ["reason"],
			properties: {
				"reason": { type: "string" },
			}
		},
	},
}

const close = ajv.compile(closeSchema);

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
		"seq": { type: "integer" },
		"type": { type: "string" },
		"data": { type: "object" },
	},
}

const message = ajv.compile(messageSchema);

const serverActions = [
	{},
];

const actionResponse = {
	additionalProperties: false,
	required: ["action", "id", "status", "message"],
	properties: {
		"action": { enum: ["TODO"] },
		"id": { type: "integer" },
		"status": { enum: ["started", "done", "error"] },
		"message": { type: "string" },
	},
};

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
					required: ["version"],
					properties: {
						"version": { type: "string" },
					}
				},
			},
		},
		{
			properties: {
				"type": { const: "ready" },
				"data": {
					additionalProperties: false,
					/* XXX anything here?
					required: ["version"],
					properties: {
						"version": { type: "string" },
					}*/
				},
			},
		},
		closeSchema,
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
					required: ["token", "agent", "version", "name", "id"],
					properties: {
						"token": { type: "string" },
						"agent": { type: "string" },
						"version": { type: "string" },
						"name": { type: "string" },
						"id": { type: "integer" },
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
		closeSchema,
	],
});


module.exports = {
	compile: ajv.compile.bind(ajv),

	message,
	close,

	serverHandshake,
	clientHandshake,
}
