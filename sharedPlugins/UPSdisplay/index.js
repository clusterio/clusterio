const needle = require("needle");

console.log("/silent-command game.print('UPSdisplay enabled')\n");

setInterval(function(){
	console.log("/silent-command game.write_file('UPSdisplay.txt', game.tick, true, 0)\n");
},1000);
var config = {};
process.stdin.setEncoding('utf8');
let historicalTicks = [];
process.stdin.on('readable', () => {
	var chunk = process.stdin.read();
	if (chunk !== null && !isNaN(chunk) && !chunk.includes("{")){
		// console.log("Tick: " + chunk);
		historicalTicks[historicalTicks.length] = {tick:Number(chunk), timestamp:Date.now()};
		if(historicalTicks.length > 30){
			historicalTicks.shift(); // delete last element in array (position 0);
		}
	} else {
		config = JSON.parse(chunk);
	}
});
process.stdin.on('end', () => {
	process.stdout.write('end');
});

// Post average UPS
setInterval(function(){
	if(historicalTicks && historicalTicks[0]){
		let timePeriod = historicalTicks[historicalTicks.length-1].timestamp - historicalTicks[0].timestamp;
		let ticksInPeriod = historicalTicks[historicalTicks.length-1].tick - historicalTicks[0].tick;
		let UPS = Math.round(ticksInPeriod / (timePeriod/1000));
		// console.log("UPS: " + UPS);
		try{
			needle.post(config.masterIP+':'+config.masterPort+'/api/editSlaveMeta', {slaveID: config.unique, password: config.clientPassword, meta: {UPS:UPS}}, function(err, resp) {
				// success?
			});
		} catch (err){
			console.log(err);
		}
	}
}, 10000);