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

if (!fs.existsSync(config.factorioDirectory + "/script-output/")){
    fs.mkdirSync(config.factorioDirectory + "/script-output/");
}
fs.writeFileSync(config.factorioDirectory + "/script-output/output.txt", "")
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
// provide items --------------------------------------------------------------
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
// request items --------------------------------------------------------------
setInterval(function() {
	// get array of lines in file
	items = fs.readFileSync(config.factorioDirectory + "/script-output/orders.txt", "utf8").split("\n");
	// if we actually got anything from the file, proceed and reset file
	if(items[0]) {
		fs.writeFileSync(config.factorioDirectory + "/script-output/orders.txt", "");
		// prepare a package of all our requested items in a more tranfer friendly format
		var preparedPackage = {};
		for(i = 0;i < items.length; i++) {
			(function(i){
				if(items[i]) {
					items[i] = items[i].split(" ");
					items[i][0] = items[i][0].replace("\u0000", "");
					items[i][0] = items[i][0].replace(",", "");
					if(preparedPackage[items[i][0]]){
						if(typeof Number(preparedPackage[items[i][0]].count) == "number" && typeof Number(items[i][1]) == "number") {
							preparedPackage[items[i][0]] = {"name":items[i][0], "count":Number(preparedPackage[items[i][0]].count) + Number(items[i][1])};
						} else if (typeof Number(items[i][1]) == "number") {
							preparedPackage[items[i][0]] = {"name":items[i][0], "count":Number(items[i][1])};
						}
					} else if (typeof Number(items[i][1]) == "number") {
						preparedPackage[items[i][0]] = {"name":items[i][0], "count":Number(items[i][1])};
					}
				}
			})(i);
		}
		// request our items, one item at a time
		for(i = 0;i<Object.keys(preparedPackage).length;i++){
			console.log(preparedPackage[Object.keys(preparedPackage)[i]])
			needle.post(config.masterIP + ":" + config.masterPort + '/remove', preparedPackage[Object.keys(preparedPackage)[i]], function(err, response, body){
				if(response && response.body && typeof response.body == "object") {
					// buffer confirmed orders
					confirmedOrders[confirmedOrders.length] = {[response.body.name]: response.body.count}
				}
			});
		}
		// if we got some confirmed orders
		console.log("Importing " + confirmedOrders.length + " items! " + JSON.stringify(confirmedOrders));
		sadas = JSON.stringify(confirmedOrders)
		confirmedOrders = [];
		// send our RCON command with whatever we got
		client.exec("/silent-command remote.call('clusterio', 'importMany', '" + sadas + "')");
	}
}, 3000)
// COMBINATOR SIGNALS ---------------------------------------------------------
// send any signals the slave has been told to send
setInterval(function() {
	// get array of lines in file
	signals = fs.readFileSync(config.factorioDirectory + "/script-output/txbuffer.txt", "utf8").split("\n");
	// if we actually got anything from the file, proceed and reset file
	if(signals[0]) {
		fs.writeFileSync(config.factorioDirectory + "/script-output/txbuffer.txt", "");
		for(i = 0;i < signals.length; i++) {
			(function(i){
				if(signals[i]) {
					// signals[i] is a JSON array, we need to unnest it
					signal = JSON.parse(signals[i])
					for(o=0;o<signal.length;o++) {
						(function(o) {
							singleSignal = signal[o];
							singleSignal.time = Date.now();
							console.log(singleSignal)
							needle.post(config.masterIP + ":" + config.masterPort + '/setSignal', singleSignal, function(err, response, body){
								if(response && response.body) {
									// In the future we might be interested in whether or not we actually manage to send it, but honestly I don't care.
								}
							});
						})(o);
					}
				}
			})(i);
		}
	}
}, 3000)