import { Type, Static } from "@sinclair/typebox";
import { Event } from "@clusterio/lib";

export class ChatEvent implements Event<ChatEvent> {
	declare ["constructor"]: typeof ChatEvent;
	static type = "event" as const;
	static src = ["control", "instance"] as const;
	static dst = "instance" as const;
	static plugin = "global_chat" as const;
	static permission = null;

	constructor(
		public instanceName: string,
		public content: string,
	) {
	}

	static jsonSchema = Type.Object({
		"instanceName": Type.String(),
		"content": Type.String(),
	});

	static fromJSON(json: Static<typeof ChatEvent.jsonSchema>) {
		return new this(json.instanceName, json.content);
	}
}
