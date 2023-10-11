import { Type, Static } from "@sinclair/typebox";
import * as lib from "@clusterio/lib";
import { type } from "os";

export class Item {
	constructor(
		public name: string,
		public count: number
	) {
	}

	static jsonSchema = Type.Tuple([
		Type.String(),
		Type.Number(),
	]);

	toJSON() {
		return [this.name, this.count];
	}

	static fromJSON(json: Static<typeof Item.jsonSchema>): Item {
		return new this(json[0], json[1]);
	}
}

// XXX this should be a request to be reliable
export class PlaceEvent {
	declare ["constructor"]: typeof PlaceEvent;
	static type = "event" as const;
	static src = "instance" as const;
	static dst = "controller" as const;
	static plugin = "subspace_storage" as const;

	constructor(
		public items: Item[]
	) {
	}

	static jsonSchema = Type.Object({
		"items": Type.Array(Item.jsonSchema),
	});

	static fromJSON(json: Static<typeof PlaceEvent.jsonSchema>): PlaceEvent {
		return new this(json.items.map(item => Item.fromJSON(item)));
	}
}

export class RemoveRequest {
	declare ["constructor"]: typeof RemoveRequest;
	static type = "request" as const;
	static src = "instance" as const;
	static dst = "controller" as const;
	static plugin = "subspace_storage" as const;

	constructor(
		public items: Item[]
	) {
	}

	static jsonSchema = Type.Object({
		"items": Type.Array(Item.jsonSchema),
	});

	static fromJSON(json: Static<typeof RemoveRequest.jsonSchema>): RemoveRequest {
		return new this(json.items.map(item => Item.fromJSON(item)));
	}

	static Response = lib.jsonArray(Item);
}

export class GetStorageRequest {
	declare ["constructor"]: typeof GetStorageRequest;
	static type = "request" as const;
	static src = ["instance", "control"] as const;
	static dst = "controller" as const;
	static plugin = "subspace_storage" as const;
	static permission = "subspace_storage.storage.view" as const;
	static Response = lib.jsonArray(Item);
}

export class UpdateStorageEvent {
	declare ["constructor"]: typeof UpdateStorageEvent;
	static type = "event" as const;
	static src = "controller" as const;
	static dst = ["instance", "control"] as const;
	static plugin = "subspace_storage" as const;

	constructor(
		public items: Item[]
	) {
	}

	static jsonSchema = Type.Object({
		"items": Type.Array(Item.jsonSchema),
	});

	static fromJSON(json: Static<typeof UpdateStorageEvent.jsonSchema>): UpdateStorageEvent {
		return new this(json.items.map(item => Item.fromJSON(item)));
	}
}

export class SetStorageSubscriptionRequest {
	declare ["constructor"]: typeof SetStorageSubscriptionRequest;
	static type = "request" as const;
	static src = "control" as const;
	static dst = "controller" as const;
	static plugin = "subspace_storage" as const;
	static permission = "subspace_storage.storage.view" as const;

	constructor(
		public storage: boolean
	) {
	}

	static jsonSchema = Type.Object({
		"storage": Type.Boolean(),
	});

	static fromJSON(json: Static<typeof SetStorageSubscriptionRequest.jsonSchema>): SetStorageSubscriptionRequest {
		return new this(json.storage);
	}
}
