function getParameterByName(name, url) {
    if (!url) url = window.location.href;
    name = name.replace(/[\[\]]/g, "\\$&");
    var regex = new RegExp("[?&]" + name + "(=([^&#]*)|&|#|$)"),
        results = regex.exec(url);
    if (!results) return null;
    if (!results[2]) return '';
    return decodeURIComponent(results[2].replace(/\+/g, " "));
}

var socket = io.connect(document.location.origin);
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
		drawEntity(entity);
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
function drawImageWithRotation(ctx, image, x, y, w, h, degrees){
	ctx.save();
	ctx.translate(x+w/2, y+h/2);
	ctx.rotate(degrees*Math.PI/180.0);
	ctx.translate(-x-w/2, -y-h/2);
	ctx.drawImage(image, x, y, w, h);
	ctx.restore();
}

Mousetrap.bind("s", e => {
	console.log("s");
	cache.walkUp();
	playerPosition.y += 16;
	clear();drawFromCache();
});
Mousetrap.bind("d", e => {
	console.log("d");
	cache.walkLeft();
	playerPosition.x += 16;
	clear();drawFromCache();
});
Mousetrap.bind("w", e => {
	console.log("w");
	cache.walkDown();
	playerPosition.y -= 16;
	clear();drawFromCache();
});
Mousetrap.bind("a", e => {
	console.log("a");
	cache.walkRight();
	playerPosition.x -= 16;
	clear();drawFromCache();
});
entityCache = new Array(64);
// populate cache with arrays of arrays
for(let i = 0; i < 64; i++){
	entityCache[i] = new Array(64);
	for(let o = 0; o < 64; o++){
		entityCache[i][o] = " ";
	}
}
cache = {
	walkUp: function walkUp(){
		for(let i = 0; i < 64; i++){
			entityCache[i].shift(); // remove leftmost entry
			entityCache[i].push(" "); // add new entry on the right
			// get data from slaveMapper
			let x = playerPosition.x/16 + i;
			let y = playerPosition.y/16+64;
			socket.emit("requestEntity", {x, y, instanceID: getParameterByName("instanceID")});
		}
	},
	walkDown: function walkDown(){
		for(let i = 0; i < 64; i++){
			entityCache[i].pop(); // remove rightmost entry
			entityCache[i].unshift(" "); // add new entry on the left
			// get data from slaveMapper
			let x = playerPosition.x/16 + i;
			let y = playerPosition.y/16;
			socket.emit("requestEntity", {x, y, instanceID: getParameterByName("instanceID")});
		}
	},
	walkLeft: function walkLeft(){
		entityCache.shift();
		entityCache.push(new Array(64));
		// get data from slaveMapper
		// fill in a row on the right side of the screen, that is the bottom of the 1st level array
		for(let i = 0; i < 64; i++){
			let x = playerPosition.x/16 + 64;
			let y = playerPosition.y/16 + i;
			socket.emit("requestEntity", {x, y, instanceID: getParameterByName("instanceID")});
		}
	},
	walkRight: function walkRight(){
		entityCache.pop();
		entityCache.unshift(new Array(64));
		// get data from slaveMapper
		// fill a row on the left side of the screen, that is the top column
		for(let i = 0; i < 64; i++){
			let x = playerPosition.x/16;
			let y = playerPosition.y/16 + i;
			socket.emit("requestEntity", {x, y, instanceID: getParameterByName("instanceID")});
		}
	}
}
function drawFromCache(){
	entityCache.forEach(row => {
		row.forEach(doc => {
			if(doc && typeof doc == "object"){
				drawEntity(doc, true);
			}
		});
	});
}
function drawEntity(entity, dontCache){
	if(entity.x && entity.y){
		if(!dontCache){
			// cache entity for later draws (like panning)
			if(entity.x - playerPosition.x/16 >= 0 && entity.x - playerPosition.x/16 < 64 && entity.y - playerPosition.y/16 >= 0 && entity.y - playerPosition.y/16 < 64){
				if(entity.entity){
					entityCache[entity.x - playerPosition.x/16][entity.y - playerPosition.y/16] = entity;
				} else {
					// delete this entity because we just heard the tile is empty and stuff
					entityCache[entity.x - playerPosition.x/16][entity.y - playerPosition.y/16] = " ";
				}
			}
		}
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
						let rotation = 0;
						if(entity.entity.rot && !isNaN(Number(entity.entity.rot))){
							rotation = entity.entity.rot * 45;
						}
						
						drawImageWithRotation(ctx, entityImages[name].img, xPos, yPos, 16, 16, rotation);
						//console.log("Drawing "+name+" at X: "+xPos+", Y: "+yPos);
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
					console.log("X: "+xPos+", Y: "+yPos);
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

/*
/// ZOOMING AND PANNING COPY PASTA ===============================================
// View parameters
var xleftView = 0;
var ytopView = 0;
var widthViewOriginal = 1.0;           //actual width and height of zoomed and panned display
var heightViewOriginal = 1.0;
var widthView = widthViewOriginal;           //actual width and height of zoomed and panned display
var heightView = heightViewOriginal;

window.addEventListener("load",setup,false);
function setup() {
    canvas = document.getElementById("canvas");
    ctx = canvas.getContext("2d");

    widthCanvas = canvas.width;
    heightCanvas = canvas.height;

    canvas.addEventListener("dblclick", handleDblClick, false);  // dblclick to zoom in at point, shift dblclick to zoom out.
    canvas.addEventListener("mousedown", handleMouseDown, false); // click and hold to pan
    canvas.addEventListener("mousemove", handleMouseMove, false);
    canvas.addEventListener("mouseup", handleMouseUp, false);
    canvas.addEventListener("mousewheel", handleMouseWheel, false); // mousewheel duplicates dblclick function
    canvas.addEventListener("DOMMouseScroll", handleMouseWheel, false); // for Firefox

    draw();
}*/
