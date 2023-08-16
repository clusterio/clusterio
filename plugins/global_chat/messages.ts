import { Type, Static } from "@sinclair/typebox";
export class ChatEvent {
	static type = "event";
	static src = ["control", "instance"];
	static dst = "instance";
	static plugin = "global_chat";
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
