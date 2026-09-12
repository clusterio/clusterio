import { Type, type Static } from "@sinclair/typebox";

export class PlayerAuthServer {
	declare ["constructor"]: typeof PlayerAuthServer;

	static jsonSchema = Type.Object({
		name: Type.String(),
		address: Type.Optional(Type.String()),
		factorioVersion: Type.Optional(Type.String()),
	});

	name: string;
	address?: string;
	factorioVersion?: string;

	constructor(
		name: string,
		address?: string,
		factorioVersion?: string,
	) {
		this.name = name;
		this.address = address;
		this.factorioVersion = factorioVersion;
	}

	toJSON(): Static<typeof PlayerAuthServer.jsonSchema> {
		const json = { name: this.name } as Static<typeof PlayerAuthServer.jsonSchema>;
		if (this.address !== undefined) {
			json.address = this.address;
		}
		if (this.factorioVersion !== undefined) {
			json.factorioVersion = this.factorioVersion;
		}
		return json;
	}

	static fromJSON(json: Static<typeof PlayerAuthServer.jsonSchema>) {
		return new this(json.name, json.address, json.factorioVersion);
	}
}

class FetchPlayerCodeResponse {
	playerCode: string;
	controllerUrl: string;

	constructor(
		playerCode: string,
		controllerUrl: string,
	) {
		this.playerCode = playerCode;
		this.controllerUrl = controllerUrl;
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

	player: string;

	constructor(
		player: string,
	) {
		this.player = player;
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

	player: string;
	verifyCode: string;

	constructor(
		player: string,
		verifyCode: string,
	) {
		this.player = player;
		this.verifyCode = verifyCode;
	}

	static jsonSchema = Type.Object({
		"player": Type.String(),
		"verifyCode": Type.String(),
	});

	static fromJSON(json: Static<typeof SetVerifyCodeRequest.jsonSchema>): SetVerifyCodeRequest {
		return new this(json.player, json.verifyCode);
	}
}
