var fs = require('fs');
var needle = require("needle")
var Rcon = require('rcon')

// connect us to the server with rcon
// IP, port, password
var conn = new Rcon('localhost', 12345, '123');
conn.on('auth', function() {
  console.log("Authed!");

}).on('response', function(str) {
  console.log("Got response: " + str);

}).on('end', function() {
  console.log("Socket closed!");
  process.exit();

});

conn.connect();

// trigger when something happens to output.txt
fs.watch("Factorio 0.13.9/script-output/output.txt", "utf8", function(eventType, filename) {
	// get array of lines in file
	items = fs.readFileSync("Factorio 0.13.9/script-output/output.txt", "utf8").split("\n");
	// if you found anything, reset the file
	if(items[0]) {
		fs.writeFileSync("Factorio 0.13.9/script-output/output.txt", "")
	}
	for(i = 0;i < items.length; i++) {
		if(items[i]) {
			g = items[i].split(" ");
			g[0] = g[0].replace("\u0000", "");
			console.log(g);
			// send our entity and count to the master for him to keep track of
			needle.post('localhost:8080/place', {name:g[0], count:g[1]}, 
			function(err, resp, body){
				console.log(body);
			});
		}
	}
})

fs.watch("Factorio 0.13.9/script-output/orders.txt", "utf8", function(eventType, filename) {
	// get array of lines in file
	items = fs.readFileSync("Factorio 0.13.9/script-output/orders.txt", "utf8").split("\n");
	// if you found anything, reset the file
	if(items[0]) {
		fs.writeFileSync("Factorio 0.13.9/script-output/orders.txt", "")
	}
	for(i = 0;i < items.length; i++) {
		if(items[i]) {
			g = items[i].split(" ");
			g[0] = g[0].replace("\u0000", "");
			console.log(g);
			// send our entity and count to the master for him to keep track of
			needle.post('localhost:8080/remove', {name:g[0], count:g[1]}, function(err, resp, body){
				console.log(body);
				if(body){
					//conn.send("/c remote.call('clusterio', 'import', '" + g[0] + "', " + g[1] + ")")
				}
			});
		}
	}
})