var fs = require('fs');
var needle = require("needle")

// connect us to the server with rcon
// IP, port, password
var Rcon = require('simple-rcon');
var client = new Rcon({
  host: '81.167.2.56',
  port: '12345',
  password: '123',
  timeout: 0
}).connect();

client.on('authenticated', function() {
  console.log('Authenticated!');
}).on('connected', function() {
  console.log('Connected!');
}).on('disconnected', function() {
  console.log('Disconnected!');
  // now reconnect
  client.connect();
});


// trigger when something happens to output.txt
fs.watch("Factorio 0.13.9/script-output/output.txt", "utf8", function(eventType, filename) {
	console.log('hit output')
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
			g[0] = g[0].replace(",", "");
			console.log(g);
			// send our entity and count to the master for him to keep track of
			needle.post('localhost:8080/remove', {name:g[0], count:g[1]}, function(err, resp, body){
				console.log(body);
				if(body == "success"){
					client.exec("/c remote.call('clusterio', 'import', '" + g[0] + "', " + g[1] + ")")
				}
			});
		}
	}
})