var socket = io.connect('http://localhost:8080');
socket.on('hello', function (data) {
	console.log(data);
	socket.emit("registerMapRequester", {instanceID: '1611985668'});
	
	socket.on("displayChunk", function(chunk){
		console.log(chunk);
		drawChunk(chunk, ctx);
	});
	socket.on("displayEntity", function(entity){
		console.log("Displaying entity "+JSON.stringify(entity));
		drawEntity(entity, ctx);
	});
});

function requestChunk(x,y){
	socket.emit('requestChunk', {x:x, y:y, instanceID: '1611985668'});
}
setTimeout(function(){
	canvas = document.getElementById("remoteMap");
	ctx = canvas.getContext("2d");
	ctx.beginPath();
	ctx.arc(95,50,40,0,2*Math.PI);
	ctx.stroke();
	ctx.font = "30px Arial";
	ctx.fillText("Hello World",10,50);
	
	var img = new Image();
	img.onload = function() {
		ctx.drawImage(img, 0, 0, 32, 32);
	};
	img.src = 'https://wiki.factorio.com/images/Lab.png';
	
	requestChunk(0, -1);
}, 500);
entityImages = {};
entityImages["express-transport-belt"] = new Image();
entityImages["express-transport-belt"].src = 'https://wiki.factorio.com/images/Express_transport_belt.png';

// map view position, top left corner (or another corner?)
playerPosition = {
	x:0,
	y:0,
}
function requestMapDraw(){
	let xLow = Math.floor(playerPosition.x % 16);
	let yLow = Math.floor(playerPosition.y % 16);
	
	let xHigh = xLow+64;
	let yHigh = yLow+64;
	for(let x = xLow; x < xHigh; x++){
		for(let y = yLow; y < yHigh; y++){
			socket.emit("requestEntity", {x, y, instanceID: '1611985668'});
		}
	}
}
function drawEntity(entity, ctx){
	if(entity.x && entity.y){
		if(entity.entity && entity.entity.name && typeof entity.entity.name == "string"){
			let name = entity.entity.name;
			let xPos = (entity.x * 16) - playerPosition.x;
			let yPos = (entity.y * 16) - playerPosition.y;
			if(!entityImages[name]){
				// download the entityImages
				entityImages[name] = new Image();
				entityImages[name].onload = function(){
					ctx.drawImage(entityImages[name], xPos, yPos, 16, 16);
					console.log("Drawing "+name+" at X: "+xPos+", Y: "+yPos);
				}
				entityImages[name].src = getImageFromName(name);
			}
			
		} else {
			throw new Error(entity);
		}
	} else {
		throw new Error("drawEntity on entity without x and y coordinates")
	}
}
function drawChunk(chunk, ctx){
	Object.keys(chunk.dataObject).forEach(xValue => {
		let xRow = chunk.dataObject[xValue];
		Object.keys(xRow).forEach(yValue => {
			let yCell = xRow[yValue];
			if(yCell && yCell.name && yCell.name){
				let img = new Image();
				let xPos = (xValue*16)+(chunk.position.x*64*16)+(64*16*3);
				let yPos = (yValue*16)+(chunk.position.y*64*16)+(64*16);
				img.onload = function() {
					ctx.drawImage(img, xPos, yPos, 16, 16);
					console.log("X: "+xPos+", Y: "+yPos)
				};
				img.src = getImageFromName(yCell.name);
				//img.src = entityImages[yCell.name].src;
			}
		});
	});
}
