"use strict";
module.exports = function(app) {
	app.get("/", function(req, res) {
		res.render("index");
	});
	app.get("/nodes", function(req, res) {
		res.render("nodes");
	});
	app.get("/settings", function(req, res) {
		res.render("settings");
	});
	app.get("/nodeDetails", function(req, res) {
		res.render("nodeDetails");
	});
};