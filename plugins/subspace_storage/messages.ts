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
	static type = "event";
	static src = "instance";
	static dst = "controller";
	static plugin = "subspace_storage";

	constructor(
		public items: Item[]
	) {
	}

	static jsonSchema = Type.Object({
		"items": Type.Array(Item.jsonSchema)
	})

	static fromJSON(json: Static<typeof PlaceEvent.jsonSchema>): PlaceEvent {
		return new this(json.items.map(item => Item.fromJSON(item)));
	}
}

export class RemoveRequest {
	static type = "request";
	static src = "instance";
	static dst = "controller";
	static plugin = "subspace_storage";

	constructor(
		public items: Item[]
	) {
	}

	static jsonSchema = Type.Object({
		"items": Type.Array(Item.jsonSchema)
	})

	static fromJSON(json: Static<typeof RemoveRequest.jsonSchema>): RemoveRequest {
		return new this(json.items.map(item => Item.fromJSON(item)));
	}

	static Response = lib.jsonArray(Item);
}

export class GetStorageRequest {
	static type = "request";
	static src = ["instance", "control"];
	static dst = "controller";
	static plugin = "subspace_storage";
	static permission = "subspace_storage.storage.view";
	static Response = lib.jsonArray(Item);
}

export class UpdateStorageEvent {
	static type = "request";
	static src = "controller";
	static dst = ["instance", "control"];
	static plugin = "subspace_storage";

	constructor(
		public items: Item[]
	) {
	}

	static jsonSchema = Type.Object({
		"items": Type.Array(Item.jsonSchema)
	})

	static fromJSON(json: Static<typeof UpdateStorageEvent.jsonSchema>): UpdateStorageEvent {
		return new this(json.items.map(item => Item.fromJSON(item)));
	}
}

export class SetStorageSubscriptionRequest {
	static type = "request";
	static src = "control";
	static dst = "controller";
	static plugin = "subspace_storage";
	static permission = "subspace_storage.storage.view";

	constructor(
		public storage: boolean
	) {
	}

	static jsonSchema = Type.Object({
		"storage": Type.Boolean()
	})

	static fromJSON(json: Static<typeof SetStorageSubscriptionRequest.jsonSchema>): SetStorageSubscriptionRequest {
		return new this(json.storage);
	}
}
