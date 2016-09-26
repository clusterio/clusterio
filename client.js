var fs = require('fs');
var needle = require("needle");
// require config.json
var config = require('./config');
// connect us to the server with rcon
// IP, port, password
var Rcon = require('simple-rcon');
var client = new Rcon({
	host: config.clientIP,
	port: config.clientPort,
	password: config.clientPassword,
	timeout: 0
}).connect();

fs.writeFileSync(config.factorioDirectory + "/script-output/orders.txt", "")

client.on('authenticated', function() {
	console.log('Authenticated!');
}).on('connected', function() {
	console.log('Connected!');
}).on('disconnected', function() {
	console.log('Disconnected!');
	// now reconnect
	client.connect();
});

// set some globals
confirmedOrders = [];

// trigger when something happens to output.txt
fs.watch(config.factorioDirectory + "/script-output/output.txt", "utf8", function(eventType, filename) {
	// get array of lines in file
	items = fs.readFileSync(config.factorioDirectory + "/script-output/output.txt", "utf8").split("\n");
	// if you found anything, reset the file
	if(items[0]) {
		fs.writeFileSync(config.factorioDirectory + "/script-output/output.txt", "")
	}
	for(i = 0;i < items.length; i++) {
		if(items[i]) {
			g = items[i].split(" ");
			g[0] = g[0].replace("\u0000", "");
			console.log("exporting " + JSON.stringify(g));
			// send our entity and count to the master for him to keep track of
			needle.post(config.masterIP + ":" + config.masterPort + '/place', {name:g[0], count:g[1]}, 
			function(err, resp, body){
				// console.log(body);
			});
		}
	}
})
setInterval(function() {
	// get array of lines in file
	items = fs.readFileSync(config.factorioDirectory + "/script-output/orders.txt", "utf8").split("\n");
	// if you found anything, reset the file
	if(items[0]) {
		fs.writeFileSync(config.factorioDirectory + "/script-output/orders.txt", "")
		for(i = 0;i < items.length; i++) {
			(function(i){
				if(items[i]) {
					items[i] = items[i].split(" ");
					items[i][0] = items[i][0].replace("\u0000", "");
					items[i][0] = items[i][0].replace(",", "");
					// send our entity and count to the master for him to keep track of
					needle.post(config.masterIP + ":" + config.masterPort + '/remove', {name:items[i][0], count:items[i][1]}, function(err, response, body){
						if(response && response.body && typeof response.body == "object") {
							// buffer confirmed orders
							confirmedOrders[confirmedOrders.length] = {[response.body.name]: response.body.count}
						}
						/*if(response && response.body === "successier"){
							console.log(response.body + " : importing: " + JSON.stringify({[items[i][0]]: items[i][1]}));
							// buffer confirmed orders
							confirmedOrders[confirmedOrders.length] = {[items[i][0]]: items[i][1]}
							//client.exec("/c remote.call('clusterio', 'importMany', '[" + JSON.stringify(jsonobject) + "]')")
						} else {
							console.log("ERROR: "+JSON.stringify({[items[i][0]]: items[i][1]}));
						}*/
					});
				}
			})(i);
		}
		// if we got some confirmed orders
		console.log("Importing " + confirmedOrders.length + " items! " + JSON.stringify(confirmedOrders));
		sadas = JSON.stringify(confirmedOrders)
		confirmedOrders = [];
		// send our RCON command
		client.exec("/c remote.call('clusterio', 'importMany', '" + sadas + "')");
	}
	
	
	/*for(i = 0;i < items.length; i++) {
		if(items[i]) {
			g = items[i].split(" ");
			g[0] = g[0].replace("\u0000", "");
			g[0] = g[0].replace(",", "");
			console.log(g);
			// send our entity and count to the master for him to keep track of
			needle.post(config.masterIP + ":" + config.masterPort + '/remove', {name:g[0], count:g[1]}, function(err, resp, body){
				console.log(body);
				if(body == "success"){
					client.exec("/c remote.call('clusterio', 'import', '" + g[0] + "', " + g[1] + ")")
				}
			});
		}
	}*/
}, 10000)
/*
fs.watch(config.factorioDirectory + "/script-output/orders.txt", "utf8", function(eventType, filename) {
	
})
*/