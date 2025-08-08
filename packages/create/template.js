"use strict";
const { logger } = require("./logging");
const fs = require("fs-extra");
const path = require("path");

const _package = require("./package.json");

async function copyTemplateFile(src, dst, properties) {
	logger.verbose(`Writing ${dst} from template ${src}`);

	// Closure, get the property value or throw
	function getProperty(property) {
		if (!properties.hasOwnProperty(property)) {
			throw new Error(`Unknown property (${property}) found in template file ${src}`);
		}

		return properties[property];
	}

	// Closure, Get the boolean conjunction of a set of properties
	function propertyConjunction(props) {
		for (const property of props) {
			if (property.startsWith("!")) {
				if (Boolean(getProperty(property.slice(1)))) {
					return false;
				}
			} else if (!Boolean(getProperty(property))) {
				return false;
			}
		}

		return true;
	}

	// Process the the template file
	const badChars = /[\(\)-+/*<>=]/;
	const templateData = await fs.readFile(src, "utf8");
	const outputData = templateData
		// match preprocessor comments: //%//
		.replace(/^\/\/%\/\/.*\n/gm, "")
		// match preprocessor insert: __property__
		.replace(/__([a-zA-Z][a-zA-Z0-9_]*?[a-zA-Z0-9]?)__/gm, (_, property) => getProperty(property))
		// match preprocessor conditionals: //%if <CONDITION> [// COMMENT]\n <CONTENT> \n//%endif [COMMENT]\n
		.replace(/^\/\/%if ([^\n\/]*)(?:\/\/.*?)?\n((?:.|\n)*?)\/\/%endif.*\n/gm, (_, condition, content) => {
			let include = false;
			const conjunctions = condition.split("|");
			for (const conjunct of conjunctions) {
				if (badChars.test(conjunct)) {
					throw new Error("Preprocessor condition can only contain logical operators" +
						"such as & | or ! it can not have arithmetic, comparisons or parenthesis"
					);
				}

				const property_names = conjunct.split("&").map(s => s.trim());
				if (propertyConjunction(property_names)) {
					include = true;
					break;
				}
			}

			return include ? content : "";
		});

	// Attempt to write the output file, warn if it already exists
	try {
		await fs.outputFile(dst, outputData, { flag: "wx" });
	} catch (err) {
		if (err.code === "EEXIST") {
			logger.warn(`Could not create file ${dst} because it already exists`);
		} else {
			throw err;
		}
	}
}

async function copyPluginTemplates(pluginName, templates) {
	logger.info(`Please wait, coping templates for ${templates.join(", ")}`);
	const files = new Map();
	const prepare = [];

	// Some basic flags for selecting files to include
	const javascriptOnly = templates.includes("js");
	const config = !templates.includes("no_config") && templates.some(value => (
		["controller", "host", "instance", "ctl"].includes(value)
	));
	const webpack = config || templates.includes("controller") || templates.includes("web");

	// A count of the number of isolated contexts the plugin runs under
	let pluginContexts = 0;

	// Get the file extension and path to the templates
	const ext = javascriptOnly ? "js" : "ts";
	const templatePath = path.resolve(__dirname, javascriptOnly ? "./templates/plugin-js" : "./templates/plugin-ts");
	const commonPath = path.resolve(__dirname, "./templates/common");

	// Files included in all templates
	files.set(".gitignore", path.join(commonPath, ".gitignore"));
	files.set(".npmignore", path.join(commonPath, ".npmignore"));
	files.set("package.json", path.join(commonPath, "package.json"));
	files.set(`index.${ext}`, path.join(templatePath, `index.${ext}`));

	// Files and dependencies to support typescript
	if (!javascriptOnly) {
		prepare.push("tsc --build");
		files.set("tsconfig.json", path.join(templatePath, "tsconfig.json"));
		files.set("tsconfig.node.json", path.join(templatePath, "tsconfig.node.json"));
		files.set("tsconfig.base.json", path.join(templatePath, "tsconfig.base.json"));
		if (webpack) {
			files.set("tsconfig.browser.json", path.join(templatePath, "tsconfig.browser.json"));
		}
	}

	// Files and dependences to support webpack
	if (webpack) {
		prepare.push("webpack-cli --env production");
		files.set("webpack.config.js", path.join(commonPath, "webpack.config.js"));
		if (templates.includes("web")) {
			files.set(`web/index.${ext}x`, path.join(templatePath, `web/plugin.${ext}x`));
			pluginContexts += 1;
		} else {
			files.set(`web/index.${ext}x`, path.join(templatePath, `web/no_plugin.${ext}x`));
		}
	}

	// Files for the controller
	if (templates.includes("controller")) {
		files.set(`controller.${ext}`, path.join(templatePath, `controller.${ext}`));
		pluginContexts += 1;
	}

	// Files for hosts
	if (templates.includes("host")) {
		files.set(`host.${ext}`, path.join(templatePath, `host.${ext}`));
		pluginContexts += 1;
	}

	// Files for instances
	if (templates.includes("instance")) {
		files.set(`instance.${ext}`, path.join(templatePath, `instance.${ext}`));
		pluginContexts += 1;
	}

	// Files for lua modules
	if (templates.includes("module")) {
		files.set("module/module.json", path.join(commonPath, "module/module.json"));
		files.set("module/control.lua", path.join(commonPath, "module/control.lua"));
		files.set("module/module_exports.lua", path.join(commonPath, "module/module_exports.lua"));
		if (templates.includes("instance")) {
			files.set("module/globals.lua", path.join(commonPath, "module/globals.lua"));
		} else {
			files.set(`instance.${ext}`, path.join(templatePath, `instance_empty.${ext}`));
		}
	}

	// Files for the control tool
	if (templates.includes("ctl")) {
		files.set(`ctl.${ext}`, path.join(templatePath, `ctl.${ext}`));
		pluginContexts += 1;
	}

	// If there are more than one contexts then include the message file
	if (pluginContexts > 1) {
		files.set(`messages.${ext}`, path.join(templatePath, `messages.${ext}`));
	}

	// Properties that will control the replacements in the templates
	const properties = {
		// Weather this is ts or js
		typescript: !javascriptOnly,
		ext: ext,
		// Which templates where requested
		multi_context: pluginContexts > 1,
		controller: templates.includes("controller"),
		host: templates.includes("host"),
		instance: templates.includes("instance"),
		module: templates.includes("module"),
		ctl: templates.includes("ctl"),
		web: templates.includes("web"),
		// Macro flags for context requirements
		webpack: webpack,
		config: config,
		// String values for package json
		clusterio_version: _package.version,
		node_version: _package.engines.node,
		prepare: prepare.join(" && "),
		plugin_name: pluginName,
	};

	// Write all the template files
	const writes = [];
	for (let [dst, src] of files) {
		writes.push(copyTemplateFile(src, dst, properties));
	}

	// Wait for writes to complete
	await Promise.all(writes);
	logger.info("Successfully wrote all template files");
}

module.exports = {
	copyPluginTemplates,
};
