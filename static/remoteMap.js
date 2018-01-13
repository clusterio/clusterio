function getParameterByName(name, url) {
    if(!url) url = window.location.href;
    name = name.replace(/[\[\]]/g, "\\$&");
    var regex = new RegExp("[?&]" + name + "(=([^&#]*)|&|#|$)"),
        results = regex.exec(url);
    if(!results) return null;
    if(!results[2]) return '';
    return decodeURIComponent(results[2].replace(/\+/g, " "));
}
remoteMapConfig = {
	mapSize : 64,
	tileSize: 16,
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
		console.log("displayChunk triggered but I can't draw chunks");
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
	ctx.fillText("Use WASD to navigate.",10,50);
}, 1);

// map view position, top left corner (or another corner?)
playerPosition = {
	x:0,
	y:0,
}
function requestMapDraw(){
	let xLow = Math.floor(playerPosition.x % 16);
	let yLow = Math.floor(playerPosition.y % 16);
	
	let xHigh = xLow+remoteMapConfig.mapSize;
	let yHigh = yLow+remoteMapConfig.mapSize;
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
entityCache = new Array(remoteMapConfig.mapSize);
// populate cache with arrays of arrays
for(let i = 0; i < remoteMapConfig.mapSize; i++){
	entityCache[i] = new Array(remoteMapConfig.mapSize);
	for(let o = 0; o < remoteMapConfig.mapSize; o++){
		entityCache[i][o] = " ";
	}
}
// cache navigation functions, for panning (walking, if you will)
cache = {
	walkUp: function walkUp(){
		for(let i = 0; i < remoteMapConfig.mapSize; i++){
			entityCache[i].shift(); // remove leftmost entry
			entityCache[i].push(" "); // add new entry on the right
			// get data from slaveMapper
			let x = playerPosition.x/16 + i;
			let y = playerPosition.y/16+remoteMapConfig.mapSize;
			socket.emit("requestEntity", {x, y, instanceID: getParameterByName("instanceID")});
		}
	},
	walkDown: function walkDown(){
		for(let i = 0; i < remoteMapConfig.mapSize; i++){
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
		entityCache.push(new Array(remoteMapConfig.mapSize));
		// get data from slaveMapper
		// fill in a row on the right side of the screen, that is the bottom of the 1st level array
		for(let i = 0; i < remoteMapConfig.mapSize; i++){
			let x = playerPosition.x/16 + remoteMapConfig.mapSize;
			let y = playerPosition.y/16 + i;
			socket.emit("requestEntity", {x, y, instanceID: getParameterByName("instanceID")});
		}
	},
	walkRight: function walkRight(){
		entityCache.pop();
		entityCache.unshift(new Array(remoteMapConfig.mapSize));
		// get data from slaveMapper
		// fill a row on the left side of the screen, that is the top column
		for(let i = 0; i < remoteMapConfig.mapSize; i++){
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
entityImages = {}; // cache to store images and details about entities, populated by drawEntity();
entityDrawRules = {
	"assembling-machine-3": {
		sizeInTiles: {
			x:3,
			y:3,
		},
		positionOffset: {
			x:-1,
			y:-1,
		},
	},
	"electric-furnace": {
		sizeInTiles: {
			x:3,
			y:3,
		},
		positionOffset: {
			x:-1,
			y:-1,
		},
	},
	"beacon": {
		sizeInTiles: {
			x:3,
			y:3,
		},
		positionOffset: {
			x:-1,
			y:-1,
		},
	},
	"electric-mining-drill": {
		sizeInTiles: {
			x:3,
			y:3,
		},
		positionOffset: {
			x:-1,
			y:-1,
		},
	},
	"big-electric-pole": {
		sizeInTiles: {
			x:2,
			y:2,
		},
		positionOffset: {
			x:-1,
			y:-1,
		}
	},
	"lab": {
		sizeInTiles: {
			x:3,
			y:3,
		},
		positionOffset: {
			x:-1,
			y:-1,
		}
	},
	"solar-panel": {
		sizeInTiles: {
			x:3,
			y:3,
		},
		positionOffset: {
			x:-1,
			y:-1,
		}
	},
	"accumulator": {
		sizeInTiles: {
			x:2,
			y:2,
		},
		positionOffset: {
			x:-1,
			y:-1,
		}
	},
	"radar": {
		sizeInTiles: {
			x:3,
			y:3,
		},
		positionOffset: {
			x:-1,
			y:-1,
		}
	},
	"chemical-plant": {
		sizeInTiles: {
			x:3,
			y:3,
		},
		positionOffset: {
			x:-1,
			y:-1,
		}
	},
};
for(let i = 1; i <= 3; i++){
	let assemblingMachineTemplate = {
		sizeInTiles: {
			x:3,
			y:3,
		},
		positionOffset: {
			x:-1,
			y:-1,
		},
	};
	let name = "assembling-machine-"+i;
	entityDrawRules[name] = assemblingMachineTemplate;
}
function drawEntity(entity, dontCache){
	if(entity.x && entity.y){
		if(!dontCache){
			// cache entity for later draws (like panning)
			if(entity.x - playerPosition.x/16 >= 0 && entity.x - playerPosition.x/16 < remoteMapConfig.mapSize && entity.y - playerPosition.y/16 >= 0 && entity.y - playerPosition.y/16 < remoteMapConfig.mapSize){
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
						// check hardcoded entity draw rules for specifics (otherwise draw icon as 1x1 entity with rotation if specified)
						if(entityDrawRules[name]){
							var offsetX = entityDrawRules[name].positionOffset.x;
							var offsetY = entityDrawRules[name].positionOffset.y;
							var size = {
								x: remoteMapConfig.tileSize * entityDrawRules[name].sizeInTiles.x,
								y: remoteMapConfig.tileSize * entityDrawRules[name].sizeInTiles.y,
							};
						} else {
							var offsetX = 0, offsetY = 0;
							var size = {
								x:remoteMapConfig.tileSize, y: remoteMapConfig.tileSize,
							};
						}
						let xPos = ((entity.x + offsetX) * 16) - playerPosition.x;
						let yPos = ((entity.y + offsetY) * 16) - playerPosition.y;
						let rotation = 0;
						if(entity.entity.rot && !isNaN(Number(entity.entity.rot))){
							rotation = entity.entity.rot * 45;
						}
						
						drawImageWithRotation(ctx, entityImages[name].img, xPos, yPos, size.x, size.y, rotation);
						//console.log("Drawing "+name+" at X: "+xPos+", Y: "+yPos+" with with rotation "+rotation);
					} else {
						// we are waiting for the image to load, push the task to our queue. It will be processed once the image loads.
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
		console.log(entity);
		throw new Error("drawEntity on entity without x and y coordinates");
	}
}
function clear(){
	ctx.clearRect(0, 0, canvas.width, canvas.height);
}
