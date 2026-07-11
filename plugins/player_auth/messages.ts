import { Type, Static } from "@sinclair/typebox";

export class PlayerAuthServer {
	declare ["constructor"]: typeof PlayerAuthServer;

	static jsonSchema = Type.Object({
		name: Type.String(),
		address: Type.Optional(Type.String()),
		factorioVersion: Type.Optional(Type.String()),
	});

	constructor(
		public name: string,
		public address?: string,
		public factorioVersion?: string,
	) {}

	toJSON(): Static<typeof PlayerAuthServer.jsonSchema> {
		const json = { name: this.name } as Static<typeof PlayerAuthServer.jsonSchema>;
		if (this.address !== undefined) {
			json.address = this.address;
		}
		if (this.factorioVersion !== undefined) {
			json.factorioVersion = this.address;
		}
		return json;
	}

	static fromJSON(json: Static<typeof PlayerAuthServer.jsonSchema>) {
		return new this(json.name, json.address, json.factorioVersion);
	}
}

class FetchPlayerCodeResponse {
	constructor(
		public playerCode: string,
		public controllerUrl: string
	) {
	}

	static jsonSchema = Type.Object({
		"playerCode": Type.String(),
		"controllerUrl": Type.String(),
	});

	static fromJSON(json: Static<typeof FetchPlayerCodeResponse.jsonSchema>): FetchPlayerCodeResponse {
		return new this(json.playerCode, json.controllerUrl);
	}
};

export class FetchPlayerCodeRequest {
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
	});

	static fromJSON(json: Static<typeof FetchPlayerCodeRequest.jsonSchema>): FetchPlayerCodeRequest {
		return new this(json.player);
	}
}

export class SetVerifyCodeRequest {
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
	});

	static fromJSON(json: Static<typeof SetVerifyCodeRequest.jsonSchema>): SetVerifyCodeRequest {
		return new this(json.player, json.verifyCode);
	}
}
