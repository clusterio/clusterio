"use strict";
const fs = require("fs-extra");
const path = require("path");
const Express = require("express");
const ejs = require("ejs");

const database = require("lib/database");
const routes = require("./routes");


class masterPlugin {
	constructor({
		config, pluginConfig, pluginPath, socketio, express, db, Prometheus, prometheusPrefix, endpointHitCounter,
	}) {
		this.config = config;
		this.pluginConfig = pluginConfig;
		this.pluginPath = pluginPath;
		this.io = socketio;

		this.express = express;
		this.db = db,
		this.Prometheus = Prometheus;
		this.prometheusPrefix = prometheusPrefix;
		this.endpointHitCounter = endpointHitCounter;

		this.prometheusMasterInventoryGauge = new Prometheus.Gauge({
			name: prometheusPrefix+'master_inventory_gauge',
			help: 'Amount of items stored on master',
			labelNames: ["itemName"],
		});

		this.ui = {
			sidebar: [
				{
					getHtml: () => `
    <div class="nav-item mr-1">
        <a class="nav-link align-middle" href="/clusterioMod/storage">Storage</a>
    </div>`,
				},
			],
		};
	}

	onMetrics() {
		if (this.items) {
			for (let [key, count] of this.items._items) {
				this.prometheusMasterInventoryGauge.labels(key).set(Number(count) || 0);
			}
		}
	}

	async onLoadFinish() {
		this.items = await loadDatabase(this.config);
		this.autosaveId = setInterval(async function() {
			let file = path.join(this.config.databaseDirectory, "items.json");
			console.log(`autosaving ${file}`);
			let content = JSON.stringify(db.items.serialize());
			await fs.outputFile(file, content);
		},this.config.autosaveInterval || 60000);

		routes.addApiRoutes(
			this.express, this.config, this.db, this.items,
			this.Prometheus, this.prometheusPrefix, this.endpointHitCounter,
		);

		routes.addWebRoutes(this.express);
	}

	async onExit(){
		clearInterval(this.autosaveId);
		await saveDatabase(this.config, this.items);
	}
}

async function loadDatabase(config) {
	let itemsPath = path.resolve(config.databaseDirectory, "items.json");
	console.log(`Loading ${itemsPath}`);
	try {
		let content = await fs.readFile(itemsPath);
		return new database.ItemDatabase(JSON.parse(content));

	} catch (err) {
		if (err.code === "ENOENT") {
			console.log("Creating new item database");
			return new database.ItemDatabase();

		} else {
			throw err;
		}
	}
}

async function saveDatabase(config, items) {
	if (items && items.size < 50000) {
		let file = path.resolve(config.databaseDirectory, "items.json");
		console.log(`writing ${file}`);
		let content = JSON.stringify(items.serialize());
		await fs.outputFile(file, content);
	} else if (items) {
		console.error(`Item database too large, not saving (${items.size})`);
	}
}

module.exports = masterPlugin;
