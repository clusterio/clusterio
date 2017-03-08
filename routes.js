module.exports = function(app) {
	app.get("/", function(req, res) {
		res.render("index");
	});
	app.get("/nodes", function(req, res) {
		res.render("nodes");
	});
};