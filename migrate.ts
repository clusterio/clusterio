import * as fs from "node:fs";

const files = [
	"packages/lib/src/config/classes.ts",
	"packages/lib/src/data/ExportManifest.ts",
	"packages/lib/src/data/HostDetails.ts",
	"packages/lib/src/data/InstanceDetails.ts",
	"packages/lib/src/data/messages_controller.ts",
	"packages/lib/src/data/messages_core.ts",
	"packages/lib/src/data/messages_host.ts",
	"packages/lib/src/data/messages_instance.ts",
	"packages/lib/src/data/messages_mod.ts",
	"packages/lib/src/data/messages_mod.ts",
	"packages/lib/src/data/messages_plugin.ts",
	"packages/lib/src/data/messages_role.ts",
	"packages/lib/src/data/messages_user.ts",
	"packages/lib/src/data/ModuleInfo.ts",
	"packages/lib/src/data/Permission.ts",
	"packages/lib/src/data/Role.ts",
	"packages/lib/src/data/UserDetails.ts",
	"packages/lib/src/data/version.ts",
	"packages/lib/src/datastore.ts",
	"packages/lib/src/errors.ts",
	"packages/lib/src/factorio/exchange_string.ts",
	"packages/lib/src/helpers.ts",
	"packages/lib/src/link/connectors.ts",
	"packages/lib/src/link/link.ts",
	"packages/lib/src/LockFile.ts",
	"packages/lib/src/logging.ts",
	"packages/lib/src/logging_utils.ts",
	"packages/lib/src/ModStore.ts",
	"packages/lib/src/prometheus.ts",
	"packages/lib/src/schema.ts",
	"packages/lib/src/subscriptions.ts",
	"packages/lib/src/ValueCache.ts",
	"packages/controller/src/BaseConnection.ts",
	"packages/controller/src/BaseControllerPlugin.ts",
	"packages/controller/src/ControlConnection.ts",
	"packages/controller/src/Controller.ts",
	"packages/controller/src/ControllerRouter.ts",
	"packages/controller/src/HostRecord.ts",
	"packages/controller/src/InstanceManager.ts",
	"packages/controller/src/InstanceRecord.ts",
	"packages/controller/src/User.ts",
	"packages/controller/src/UserManager.ts",
	"packages/controller/src/UserRecord.ts",
	"packages/controller/src/WsServerConnector.ts",
	"packages/host/host.ts",
	"packages/host/src/BaseHostPlugin.ts",
	"packages/host/src/BaseInstancePlugin.ts",
	"packages/host/src/Host.ts",
	"packages/host/src/InstanceConnection.ts",
	"packages/host/src/patch.ts",
	"packages/ctl/src/BaseCtlPlugin.ts",
	"plugins/global_chat/messages.ts",
	"plugins/inventory_sync/messages.ts",
	"plugins/player_auth/messages.ts",
	"plugins/research_sync/messages.ts",
	"plugins/subspace_storage/messages.ts",
];

function migrateFile(path: string) {
	const content = fs.readFileSync(path, { encoding: "utf8" });
	const lines: string[] = content.split("\n");

	type ClassItem = {
		start: number,
		classBodyStart?: number,
		constructorStart?: number,
		constructorBodyStart?: number,
		constructorBodyEnd?: number,
		end: number,
	};
	const classes: ClassItem[] = [];
	for (let pos = 0; pos < lines.length; pos++) {
		if (/^(export (default )?)?class/.test(lines[pos])) {
			const cls: Partial<ClassItem> = {};
			cls.start = pos;
			while (!/{ ?}?;?$/.test(lines[pos])) { pos += 1; }
			if (!/};?$/.test(lines[pos])) {
				cls.classBodyStart = pos + 1;
				while(lines[pos] !== "\tconstructor(" && lines[pos] !== "}") { pos += 1; }
				if (lines[pos] !== "}") {
					cls.constructorStart = pos;
					while (!/{ ?}?;?$/.test(lines[pos])) { pos += 1; }
					cls.constructorBodyStart = pos;
				}
				while (!/};?$/.test(lines[pos])) { pos += 1; }
				cls.constructorBodyEnd = pos;
				while (!/^};?$/.test(lines[pos])) { pos += 1; }
			}
			cls.end = pos;
			classes.push(cls as ClassItem);
		}
	}

	type Mutation = {
		start: number,
		end: number;
		content: string[],
	};
	const mutations: Mutation[] = [];

	for (const cls of classes) {
		if (!cls.constructorStart) {
			continue;
		}

		// Find parameter properties that needs to be replaced
		const fields = [];
		for (let i = cls.constructorStart + 1; i < cls.constructorBodyStart!; i++) {
			let docStart: number | undefined, docEnd: number | undefined;
			if (lines[i].startsWith("\t\t/**")) {
				docStart = i;
				while (!lines[i].endsWith("*/")) {
					i += 1;
				}
				i += 1;
				docEnd = i;
			}
			const match = /^\t\t((?:private|protected|public)(?: readonly)?) ([a-zA-Z0-9_$]+)(\??)(: .*?)?( = .*?)?,?$/.exec(lines[i]);
			if (match) {
				let [, visibility, name, optional, type, value] = match;
				const typeInConstructor = Boolean(type);
				if (!type) {
					if (value) {
						let typeMatch = /^ = new ([a-zA-Z_$ ,.<>]+)\(.*?\)$/.exec(value);
						if (typeMatch) {
							type = `: ${typeMatch[1]}`;
						} else if (/^ = ".*"$/.test(value)) {
							type = ": string";
						} else if (value === " = true" || value === " = false") {
							type = ": boolean";
						} else if (/^ = \d+$/.test(value) || value === " = PatchInfo.currentVersion") {
							type = ": number";
						}
					}
					if (!type) {
						throw `Unable to deduce type from ${value}`;
					}
				}
				if (value === undefined) {
					value = "";
				}
				fields.push({
					docStart,
					docEnd,
					pos: i,
					visibility,
					name,
					optional,
					type,
					typeInConstructor,
					value,
				});
			}
		}

		if (!fields.length) {
			continue;
		}

		let assignmentPos = cls.constructorBodyStart! + 1;
		if (cls.constructorBodyStart !== cls.constructorBodyEnd) {
			// Look for super
			for (let i = cls.constructorBodyStart!; i < cls.constructorBodyEnd!; i+= 1) {
				if (/^\t\tsuper\(/.test(lines[i])) {
					assignmentPos = i + 1;
					break;
				}
			}
		}

		let propertyPos = cls.classBodyStart!;
		// Look for static assignments and put property after it
		for (let i = propertyPos; i < cls.constructorStart; i++) {
			if (/\tstatic [a-zA-Z_$]+\??( =|;)/.test(lines[i])) {
				propertyPos = i + 1;
			}
		}

		// Insert space between static fields and fields
		if (propertyPos !== cls.classBodyStart) {
			mutations.push({
				start: propertyPos,
				end: propertyPos,
				content: [""],
			});
		}

		for (const field of fields) {
			if (field.docStart !== undefined && field.docEnd !== undefined) {
				// Insert property docblock
				let doc = [];
				for (let i = field.docStart; i < field.docEnd; i++) {
					doc.push(lines[i].replace("\t", ""));
				}
				mutations.push({
					start: propertyPos,
					end: propertyPos,
					content: doc,
				});
				// Replace docblock in constructor arguments
				mutations.push({
					start: field.docStart,
					end: field.docEnd,
					content: [`\t\t/** {@inheritDoc ${field.name}} */`],
				});
			}
			// Insert property into the class
			mutations.push({
				start: propertyPos,
				end: propertyPos,
				content: [
					`\t${(field.visibility + " ").replace(/public ?/, "")}${field.name}${field.optional}${field.type};`
				],
			});

			// Replace property in constructor arguments
			mutations.push({
				start: field.pos,
				end: field.pos + 1,
				content: [`\t\t${field.name}${field.optional}${field.typeInConstructor ? field.type : ""}${field.value},`],
			});

			// Insert assignment in constructor
			mutations.push({
				start: assignmentPos,
				end: assignmentPos,
				content: [`\t\tthis.${field.name} = ${field.name};`],
			});
		}

		// Replace empty body on a single line
		if (cls.constructorBodyStart === cls.constructorBodyEnd) {
			mutations.push({
				start: cls.constructorBodyStart! + 1,
				end: cls.constructorBodyStart! + 1,
				content: ["\t}"],
			});
			mutations.push({
				start: cls.constructorBodyStart!,
				end: cls.constructorBodyStart! + 1,
				content: [lines[cls.constructorBodyStart!].replace(" }", "")],
			});
		}

		// Insert space between constructor and fields
		if (propertyPos === cls.constructorStart) {
			mutations.push({
				start: cls.constructorStart,
				end: cls.constructorStart,
				content: [""],
			});
		}
	}

	// Excute mutations in reverse to preserve line numbering during operation
	mutations.sort((a, b) => a.start - b.start);
	for (let i = mutations.length - 1; i >= 0; i--) {
		const { start, end, content } = mutations[i];
		lines.splice(start, end - start, ...content)
	}

	//console.log(lines.slice(40, 285).join("\n"))
	fs.writeFileSync(path, lines.join("\n"), { encoding: "utf8" });
}

for (const file of files) {
	console.log(file);
	migrateFile(file);
}
