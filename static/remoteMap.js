function getParameterByName(name, url) {
    if (!url) url = window.location.href;
    name = name.replace(/[\[\]]/g, "\\$&");
    var regex = new RegExp("[?&]" + name + "(=([^&#]*)|&|#|$)"),
        results = regex.exec(url);
    if (!results) return null;
    if (!results[2]) return '';
    return decodeURIComponent(results[2].replace(/\+/g, " "));
}

var socket = io.connect('http://localhost:8080');
socket.on('hello', function (data) {
	console.log(data);
	socket.emit("registerMapRequester", {instanceID: getParameterByName("instanceID")});
	socket.on("mapRequesterReady", function(){
		setInterval(()=>{
			socket.emit("heartbeat"); // send our heartbeat to prevent being assumed dead
		},10000);
		requestMapDraw();
	});
	
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
	socket.emit('requestChunk', {x:x, y:y, instanceID: getParameterByName("instanceID")});
}
setTimeout(function(){
	canvas = document.getElementById("remoteMap");
	ctx = canvas.getContext("2d");
	ctx.font = "30px Arial";
	ctx.fillText("Hello World",10,50);
	
	var img = new Image();
	img.onload = function() {
		ctx.drawImage(img, 0, 0, 32, 32);
	};
	img.src = 'https://wiki.factorio.com/images/Lab.png';
	
}, 1);
entityImages = {};
/*
entityImages["express-transport-belt"] = new Image();
entityImages["express-transport-belt"].src = 'https://wiki.factorio.com/images/Express_transport_belt.png';
*/

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
			socket.emit("requestEntity", {x, y, instanceID: getParameterByName("instanceID")});
		}
	}
}
function drawEntity(entity){
	if(entity.x && entity.y){
		if(entity.entity && entity.entity.name && typeof entity.entity.name == "string"){
			let name = entity.entity.name;
			if(!entityImages[name]){
				// download the entityImages and add stuff  to queue
				entityImages[name] = {};
				entityImages[name].img = new Image();
				entityImages[name].queue = [];
				entityImages[name].queue.push(entity);
				entityImages[name].loaded = false;
				entityImages[name].img.onload = function(){
					// process queue and display
					console.log("Image loaded!");
					entityImages[name].loaded = true;
					entityImages[name].queue.forEach(entity => {
						entityImages[name].draw(entity);
					});
					entityImages[name].queue = [];
				}
				entityImages[name].draw = function(entity){
					if(this.loaded){
						let name = entity.entity.name;
						let xPos = (entity.x * 16) - playerPosition.x;
						let yPos = (entity.y * 16) - playerPosition.y;
						ctx.drawImage(entityImages[name].img, xPos, yPos, 16, 16);
						console.log("Drawing "+name+" at X: "+xPos+", Y: "+yPos);
					} else {
						this.queue.push(entity);
					}
				}
				entityImages[name].img.src = getImageFromName(name);
			} else {
				entityImages[name].draw(entity);
			}
		} else {
			// we got an empty coordinate pair, that usually means this tile was occupied before but is empty now
			console.log("Clearing at X: "+entity.x+", Y: "+entity.y);
			ctx.clearRect(entity.x * 16, entity.y * 16, 16, 16);
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
function clear(){
	ctx.clearRect(0, 0, canvas.width, canvas.height);
}