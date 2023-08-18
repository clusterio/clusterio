import { Type, Static } from "@sinclair/typebox";

class FetchPlayerCodeResponse {
	constructor(
		public playerCode: string,
		public controllerUrl: string
	) {
	}

	static jsonSchema = Type.Object({
		"playerCode": Type.String(),
		"controllerUrl": Type.String(),
	})

	static fromJSON(json: Static<typeof FetchPlayerCodeResponse.jsonSchema>): FetchPlayerCodeResponse {
		return new this(json.playerCode, json.controllerUrl);
	}
};

export class FetchPlayerCodeRequest {
	static type = "request";
	static src = "instance";
	static dst = "controller";
	static plugin = "player_auth";
	static Response = FetchPlayerCodeResponse;

	constructor(
		public player: string
	) {
	}

	static jsonSchema = Type.Object({
		"player": Type.String(),
	})

	static fromJSON(json: Static<typeof FetchPlayerCodeRequest.jsonSchema>): FetchPlayerCodeRequest {
		return new this(json.player);
	}
}

export class SetVerifyCodeRequest {
	static type = "request";
	static src = "instance";
	static dst = "controller";
	static plugin = "player_auth";

	constructor(
		public player: string,
		public verifyCode: string
	) {
	}

	static jsonSchema = Type.Object({
		"player": Type.String(),
		"verifyCode": Type.String(),
	})

	static fromJSON(json: Static<typeof SetVerifyCodeRequest.jsonSchema>): SetVerifyCodeRequest {
		return new this(json.player, json.verifyCode);
	}
}
