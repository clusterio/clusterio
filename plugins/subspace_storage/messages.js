"use strict";
const { libData } = require("@clusterio/lib");

class Item {
	/** @type {string} */
	name;
	/** @type {number} */
	count;

	constructor(name, count) {
		this.name = name;
		this.count = count;
	}

	static jsonSchema = {
		type: "array",
		minItems: 2,
		maxItems: 2,
		items: [
			{ type: "string" },
			{ type: "integer" },
		],
	};

	toJSON() {
		return [this.name, this.count];
	}

	static fromJSON(json) {
		return new this(json[0], json[1]);
	}
}

// XXX this should be a request to be reliable
class PlaceEvent {
	static type = "event";
	static src = "instance";
	static dst = "controller";
	static plugin = "subspace_storage";

	/** @type {Array<Item>} */
	items;

	constructor(items) {
		this.items = items;
	}

	static jsonSchema = {
		required: ["items"],
		properties: {
			"items": {
				type: "array",
				items: Item.jsonSchema,
			},
		},
	};

	static fromJSON(json) {
		return new this(json.items);
	}
}

class RemoveRequest {
	static type = "request";
	static src = "instance";
	static dst = "controller";
	static plugin = "subspace_storage";

	/** @type {Array<Item>} */
	items;

	constructor(items) {
		this.items = items;
	}

	static jsonSchema = {
		required: ["items"],
		properties: {
			"items": {
				type: "array",
				items: Item.jsonSchema,
			},
		},
	};

	static fromJSON(json) {
		return new this(json.items);
	}

	static Response = libData.jsonArray(Item);
}

class GetStorageRequest {
	static type = "request";
	static src = ["instance", "control"];
	static dst = "controller";
	static plugin = "subspace_storage";
	static permission = "subspace_storage.storage.view";
	static Response = libData.jsonArray(Item);
}

class UpdateStorageEvent {
	static type = "request";
	static src = "controller";
	static dst = ["instance", "control"];
	static plugin = "subspace_storage";

	/** @type {Array<Item>} */
	items;

	constructor(items) {
		this.items = items;
	}

	static jsonSchema = {
		required: ["items"],
		properties: {
			"items": {
				type: "array",
				items: Item.jsonSchema,
			},
		},
	};

	static fromJSON(json) {
		return new this(json.items);
	}
}

class SetStorageSubscriptionRequest {
	static type = "request";
	static src = "control";
	static dst = "controller";
	static plugin = "subspace_storage";
	static permission = "subspace_storage.storage.view";

	/** @type {boolean} */
	storage;

	constructor(storage) {
		this.storage = storage;
	}

	static jsonSchema = {
		required: ["storage"],
		properties: {
			"storage": { type: "boolean" },
		},
	};

	static fromJSON(json) {
		return new this(json.storage);
	}
}

module.exports = {
	Item,
	PlaceEvent,
	RemoveRequest,
	GetStorageRequest,
	UpdateStorageEvent,
	SetStorageSubscriptionRequest,
};
