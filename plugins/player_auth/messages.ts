import { Type, Static } from "@sinclair/typebox";
import { Request } from "@clusterio/lib";

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

export class FetchPlayerCodeRequest implements Request<FetchPlayerCodeRequest, FetchPlayerCodeResponse> {
	declare ["constructor"]: typeof FetchPlayerCodeRequest;
	static type = "request" as const;
	static src = "instance" as const;
	static dst = "controller" as const;
	static plugin = "player_auth" as const;
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

export class SetVerifyCodeRequest implements Request<SetVerifyCodeRequest> {
	declare ["constructor"]: typeof SetVerifyCodeRequest;
	static type = "request" as const;
	static src = "instance" as const;
	static dst = "controller" as const;
	static plugin = "player_auth" as const;

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
