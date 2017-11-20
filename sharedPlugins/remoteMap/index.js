const needle = require("needle");
const moduleConfig = require("./config");
console.log("/silent-command game.print('"+moduleConfig.name+" version "+moduleConfig.version+" enabled')");

/*setInterval(function(){
	console.log("/silent-command game.write_file('"+moduleConfig.scriptOutputFileSubscription+"', game.tick, true, 0)");
},1000);*/
var config = {};
process.stdin.setEncoding('utf8');
process.stdin.on('readable', () => {
	var chunk = process.stdin.read();
	if (chunk !== null && !isNaN(chunk) && !chunk.includes("objects")){
		console.log(chunk);
		// objects -29,-35;-28,-34: ,inserter -28.5 -34.5
		
		let data = chunk.split(",");
		data.shift();data.shift();data.shift();
		if(data && data[0] == undefined){
			// this position is now empty, delete whatever was there from DB
		}
		data.forEach(entity => {
			let name = entity.split(" ")[0];
			let xPos = entity.split(" ")[1];
			let yPos = entity.split(" ")[2];
		});
		
	} else {
		// config is the same config as client.js and master.js uses
		config = JSON.parse(chunk);
	}
});
process.stdin.on('end', () => {
	process.stdout.write('end');
});
