/**
	Javascript to download and render a map of a factorio world from an instance using websockets and canvas
*/

/// ES6 imports
// rules for how entities are drawn (sizes, offset etc)
import {entityDrawRules} from "./lib/entityDrawRules.js";
import {getParameterByName} from "./lib/utility.js";
import spritesheetJson from "./pictures/spritesheet.js";
var global = {};

if(!localStorage.remoteMapConfig || localStorage.remoteMapConfig == "[object Object]"){
	localStorage.remoteMapConfig = JSON.stringify({
		mapSize: 32,
		tileSize: 8,
		movementSpeed: 0.2,
	});
}

var remoteMapConfig = JSON.parse(localStorage.remoteMapConfig);

// Handle config changes through UI buttons
(function(){
	let selectMapSize = document.querySelector("#mapSize");
	let selectTileSize = document.querySelector("#tileSize");
	if(selectMapSize && selectTileSize){
		selectMapSize.value = Number(remoteMapConfig.mapSize) || 32;
		selectTileSize.value = Number(remoteMapConfig.tileSize) || 8;
		
		selectMapSize.onchange = function(){
			let config = JSON.parse(localStorage.remoteMapConfig);
			config.mapSize = Number(selectMapSize.value);
			localStorage.remoteMapConfig = JSON.stringify(config);
			console.log("Config updated: "+localStorage.remoteMapConfig);
		}
		selectTileSize.onchange = function(){
			let config = JSON.parse(localStorage.remoteMapConfig);
			config.tileSize = Number(selectTileSize.value);
			localStorage.remoteMapConfig = JSON.stringify(config);
			console.log("Config updated: "+localStorage.remoteMapConfig);
		}
	}
	let pauseOnBlur = document.querySelector("#pauseOnBlur");
	if(pauseOnBlur){
		pauseOnBlur.checked = localStorage.remoteMapPauseOnBlur || true;
		pauseOnBlur.onchange = function(){
			localStorage.remoteMapPauseOnBlur = pauseOnBlur.checked;
		}
	}
	let movementSpeed = document.querySelector("#movementSpeed");
	if(movementSpeed){
		movementSpeed.value = Number(remoteMapConfig.movementSpeed) || 0.2;
		movementSpeed.onchange = function(){
			let config = JSON.parse(localStorage.remoteMapConfig);
			config.movementSpeed = Number(movementSpeed.value);
			localStorage.remoteMapConfig = JSON.stringify(config);
			console.log("Config updated: "+localStorage.remoteMapConfig);
			
			// also update config live
			remoteMapConfig.movementSpeed = config.movementSpeed;
		}
	}
})();

var socket = io.connect(document.location.origin);
socket.on('hello', function (data) {
	console.log(data);
	socket.emit("registerMapRequester", {instanceID: getParameterByName("instanceID")});
	socket.on("mapRequesterReady", function(){
		setInterval(()=>{
			socket.emit("heartbeat"); // send our heartbeat to prevent being assumed dead
		},10000);
		global.spritesheet = new Image();
		global.spritesheet.onload = function(){
			requestMapDraw();
		}
		global.spritesheet.src = "/pictures/spritesheet.png";
	});
	
	socket.on("displayChunk", function(chunk){
		console.log("displayChunk triggered but I can't draw chunks");
	});
	socket.on("displayEntity", function(entity){
		// console.log("Displaying entity "+JSON.stringify(entity));
		drawEntity(entity);
	});
});

function requestChunk(x,y){
	socket.emit('requestChunk', {x:x, y:y, instanceID: getParameterByName("instanceID")});
}
const canvas = document.getElementById("remoteMap");
canvas.height = remoteMapConfig.tileSize * remoteMapConfig.mapSize;
canvas.width = remoteMapConfig.tileSize * remoteMapConfig.mapSize;
const ctx = canvas.getContext("2d");
ctx.font = "30px Arial";
ctx.fillText("Use WASD to navigate.",10,50);

// map view position, top left corner (or another corner?)
window.playerPosition = {
	x:0,
	y:0,
}
window.cachePosition = {
	x:0,
	y:0,
};
function requestMapDraw(){
	let xLow = Math.floor(cachePosition.x % remoteMapConfig.tileSize);
	let yLow = Math.floor(cachePosition.y % remoteMapConfig.tileSize);
	
	let xHigh = xLow+remoteMapConfig.mapSize;
	let yHigh = yLow+remoteMapConfig.mapSize;
	for(let x = xLow; x < xHigh; x++){
		for(let y = yLow; y < yHigh; y++){
			socket.emit("requestEntity", {x, y, instanceID: getParameterByName("instanceID")});
		}
	}
}
// ctx, entityImages[name].img, xPos, yPos, size.x, size.y, rotation, sprWidth, sprHeight, offLeft, offTop
function drawImageWithRotation(ctx, image, x, y, w, h, degrees, sprWidth, sprHeight, offLeft, offTop){
	ctx.save();
	ctx.translate(x+w/2, y+h/2);
	ctx.rotate(degrees*Math.PI/180.0);
	ctx.translate(-x-w/2, -y-h/2);
	if(sprWidth != undefined && sprHeight != undefined && offLeft != undefined && offTop != undefined){
		// console.log(sprWidth+" "+sprHeight+" "+offLeft+" "+offTop+" "+w+" "+h)
		ctx.drawImage(image, offLeft, offTop, sprWidth, sprHeight, x, y, w, h);
	} else {
		ctx.drawImage(image, x, y, w, h);
	}
	ctx.restore();
}
/* 
Mousetrap.bind("s", e => {
	console.log("s");
	cache.walkUp();
	playerPosition.y += remoteMapConfig.tileSize;
	clear();//drawFromCache();
});
Mousetrap.bind("d", e => {
	console.log("d");
	cache.walkLeft();
	playerPosition.x += remoteMapConfig.tileSize;
	clear();//drawFromCache();
});
Mousetrap.bind("w", e => {
	console.log("w");
	cache.walkDown();
	playerPosition.y -= remoteMapConfig.tileSize;
	clear();//drawFromCache();
});
Mousetrap.bind("a", e => {
	console.log("a");
	cache.walkRight();
	playerPosition.x -= remoteMapConfig.tileSize;
	clear();//drawFromCache();
}); */
document.addEventListener('keydown', keyDownHandler, false);
document.addEventListener('keyup', keyUpHandler, false);
var rightPressed = false;
var leftPressed = false;
var upPressed = false;
var downPressed = false;
function keyDownHandler(event) {
	if(event.keyCode == 39 || event.keyCode == 68) {
		rightPressed = true;
	}
	else if(event.keyCode == 37 || event.keyCode == 65) {
		leftPressed = true;
	}
	if(event.keyCode == 40 || event.keyCode == 83) {
		downPressed = true;
	}
	else if(event.keyCode == 38 || event.keyCode == 87) {
		upPressed = true;
	}
}
function keyUpHandler(event) {
	if(event.keyCode == 39 || event.keyCode == 68) {
		rightPressed = false;
	}
	else if(event.keyCode == 37 || event.keyCode == 65) {
		leftPressed = false;
	}
	if(event.keyCode == 40 || event.keyCode == 83) {
		downPressed = false;
	}
	else if(event.keyCode == 38 || event.keyCode == 87) {
		upPressed = false;
	}
}

var entityCache = new Array(remoteMapConfig.mapSize);
// populate cache with arrays of arrays
for(let i = 0; i < remoteMapConfig.mapSize; i++){
	entityCache[i] = new Array(remoteMapConfig.mapSize);
	for(let o = 0; o < remoteMapConfig.mapSize; o++){
		entityCache[i][o] = " ";
	}
}
// cache navigation functions, for panning (walking, if you will)
const cache = {
	walkDown: function walkUp(){
		cachePosition.y += remoteMapConfig.tileSize;
		for(let i = 0; i < remoteMapConfig.mapSize; i++){
			entityCache[i].shift(); // remove leftmost entry
			entityCache[i].push(" "); // add new entry on the right
			// get data from slaveMapper
			let x = cachePosition.x/remoteMapConfig.tileSize + i;
			let y = cachePosition.y/remoteMapConfig.tileSize+remoteMapConfig.mapSize-1;
			socket.emit("requestEntity", {x, y, instanceID: getParameterByName("instanceID")});
		}
	},
	walkUp: function walkDown(){
		cachePosition.y -= remoteMapConfig.tileSize;
		for(let i = 0; i < remoteMapConfig.mapSize; i++){
			entityCache[i].pop(); // remove rightmost entry
			entityCache[i].unshift(" "); // add new entry on the left
			// get data from slaveMapper
			let x = cachePosition.x/remoteMapConfig.tileSize + i;
			let y = cachePosition.y/remoteMapConfig.tileSize;
			socket.emit("requestEntity", {x, y, instanceID: getParameterByName("instanceID")});
		}
	},
	walkLeft: function walkLeft(){
		cachePosition.x += remoteMapConfig.tileSize;
		entityCache.shift();
		entityCache.push(new Array(remoteMapConfig.mapSize));
		// get data from slaveMapper
		// fill in a row on the right side of the screen, that is the bottom of the 1st level array
		for(let i = 0; i < remoteMapConfig.mapSize; i++){
			let x = cachePosition.x/remoteMapConfig.tileSize + remoteMapConfig.mapSize - 1;
			let y = cachePosition.y/remoteMapConfig.tileSize + i;
			socket.emit("requestEntity", {x, y, instanceID: getParameterByName("instanceID")});
		}
	},
	walkRight: function walkRight(){
		cachePosition.x -= remoteMapConfig.tileSize;
		entityCache.pop();
		entityCache.unshift(new Array(remoteMapConfig.mapSize));
		// get data from slaveMapper
		// fill a row on the left side of the screen, that is the top column
		for(let i = 0; i < remoteMapConfig.mapSize; i++){
			let x = cachePosition.x/remoteMapConfig.tileSize;
			let y = cachePosition.y/remoteMapConfig.tileSize + i;
			socket.emit("requestEntity", {x, y, instanceID: getParameterByName("instanceID")});
		}
	}
}
function drawFromCache(){
	clear();
	let startTime = Date.now()
	entityCache.forEach(row => {
		row.forEach(doc => {
			if(doc && typeof doc == "object"){
				drawEntity(doc, true);
			}
		});
	});
}
window.requestAnimationFrame(renderLoop);
var fpsTimings = {
	lastFrame: Date.now(),
	averageLength: 60,
	sum:0,
	counter: document.querySelector("#fpsCounter"),
}
var isPaused = false;
window.onblur = function() {
	if(localStorage.remoteMapPauseOnBlur == "true"){
		isPaused = true;
		console.log("paused");
	}
}
window.onfocus = function() {
	if(isPaused){
		isPaused = false;
		console.log("unpaused");
		window.requestAnimationFrame(renderLoop);
	}
}

function renderLoop(){
	let newTimestamp = Date.now();
	fpsTimings.sum = fpsTimings.sum / fpsTimings.averageLength * (fpsTimings.averageLength - 1);
	let timeSinceLastFrame;
	fpsTimings.sum += timeSinceLastFrame = newTimestamp - fpsTimings.lastFrame;
	fpsTimings.counter.value = (1000 / (fpsTimings.sum / fpsTimings.averageLength)).toPrecision(4);
	fpsTimings.lastFrame = newTimestamp;
	if(!isPaused){
		let moveSpeed = Number(remoteMapConfig.movementSpeed);
		let movement = moveSpeed * timeSinceLastFrame;
		// handle movement and requesting new entities
		if(upPressed){
			console.log("w");
			playerPosition.y -= movement;
			if(Math.abs((playerPosition.y-cachePosition.y)/remoteMapConfig.tileSize) > 1){
				cache.walkUp();
			}
		}
		if(leftPressed){
			console.log("a");
			playerPosition.x -= movement;
			if(Math.abs((playerPosition.x-cachePosition.x)/remoteMapConfig.tileSize) > 1){
				cache.walkRight();
			}
		}
		if(downPressed){
			console.log("s");
			playerPosition.y += movement;
			if(Math.abs((playerPosition.y-cachePosition.y)/remoteMapConfig.tileSize) > 1){
				cache.walkDown();
			}
		}
		if(rightPressed){
			console.log("d");
			let oldPos = playerPosition.x;
			playerPosition.x += movement;
			if(Math.abs((playerPosition.x-cachePosition.x)/remoteMapConfig.tileSize) > 1){
				cache.walkLeft();
			}
		}
		// draw map
		drawFromCache();
		// queue next tick
		window.requestAnimationFrame(renderLoop);
	}
}
var entityImages = {}; // cache to store images and details about entities, populated by drawEntity();
window.logEntCache = function(){console.log(entityCache)}
function drawEntity(entity, dontCache){
	if(entity.x && entity.y){
		if(!dontCache){
			// cache entity for later draws (like panning)
			if(entity.x - cachePosition.x/remoteMapConfig.tileSize >= 0 && entity.x - cachePosition.x/remoteMapConfig.tileSize < remoteMapConfig.mapSize && entity.y - cachePosition.y/remoteMapConfig.tileSize >= 0 && entity.y - cachePosition.y/remoteMapConfig.tileSize < remoteMapConfig.mapSize){
				if(entity.entity){
					entityCache[entity.x - cachePosition.x/remoteMapConfig.tileSize][entity.y - cachePosition.y/remoteMapConfig.tileSize] = entity;
				} else {
					// delete this entity because we just heard the tile is empty and stuff
					entityCache[entity.x - cachePosition.x/remoteMapConfig.tileSize][entity.y - cachePosition.y/remoteMapConfig.tileSize] = " ";
				}
			}
		}
		if(entity.entity && entity.entity.name && typeof entity.entity.name == "string"){
			let name = entity.entity.name;
			if(!entityImages[name]){
				console.log("Downloading image")
				// download the entityImages and add stuff  to queue
				entityImages[name] = {
					img: new Image(),
					queue: [],
					loaded: false,
				};
				entityImages[name].draw = function(entity){
					if(this.loaded){
						let name = entity.entity.name;
						let image, sprWidth, sprHeight, offLeft, offTop
						let rotation = 0;
						// check hardcoded entity draw rules for specifics (otherwise draw icon as 1x1 entity with rotation if specified)
						if(entityDrawRules[name]){
							let rules = entityDrawRules[name]
							// console.log(entityDrawRules[name])
							var offsetX = entityDrawRules[name].positionOffset.x;
							var offsetY = entityDrawRules[name].positionOffset.y;
							var size = {
								x: remoteMapConfig.tileSize * entityDrawRules[name].sizeInTiles.x,
								y: remoteMapConfig.tileSize * entityDrawRules[name].sizeInTiles.y,
							};
							if(rules.spritesheet && Array.isArray(rules.spritesheet)){
								let dir = Number(entity.entity.rot);
								sprWidth = rules.spritesheet[dir].frame.w;
								sprHeight = rules.spritesheet[dir].frame.h;
								offLeft = rules.spritesheet[dir].frame.x;
								offTop = rules.spritesheet[dir].frame.y;
								image = global.spritesheet;
								
								offsetX = rules.spritesheet[dir].positionOffset.x;
								offsetY = rules.spritesheet[dir].positionOffset.y;
								size = {
									x: remoteMapConfig.tileSize * rules.spritesheet[dir].sizeInTiles.x,
									y: remoteMapConfig.tileSize * rules.spritesheet[dir].sizeInTiles.y,
								};
							} else if(rules.spritesheet){
								sprWidth = rules.spritesheet.frame.w;
								sprHeight = rules.spritesheet.frame.h;
								offLeft = rules.spritesheet.frame.x;
								offTop = rules.spritesheet.frame.y;
								image = global.spritesheet;
							}
						} else {
							var offsetX = 0, offsetY = 0;
							var size = {
								x:remoteMapConfig.tileSize, y: remoteMapConfig.tileSize,
							};
						}
						let xPos = ((entity.x + offsetX) * remoteMapConfig.tileSize) - playerPosition.x;
						let yPos = ((entity.y + offsetY) * remoteMapConfig.tileSize) - playerPosition.y;
						if(entityDrawRules[name] && entity.entity.rot && !isNaN(Number(entity.entity.rot)) && !Array.isArray(entityDrawRules[name].spritesheet)){
							let rules = entityDrawRules[name];
							if(rules && rules.rotOffset){
								rotation = ((entity.entity.rot * 45) + entityDrawRules[name].rotOffset);
							} else {
								rotation = entity.entity.rot * 45;
							}
						}
						if(!image) image = entityImages[name].img;
						drawImageWithRotation(ctx, image, xPos, yPos, size.x, size.y, rotation, sprWidth, sprHeight, offLeft, offTop);
						//console.log("Drawing "+name+" at X: "+xPos+", Y: "+yPos+" with with rotation "+rotation);
					} else {
						// we are waiting for the image to load, push the task to our queue. It will be processed once the image loads.
						this.queue.push(entity);
					}
				}
				let imageLoaded = function(){
					// process queue and display
					console.log("Image loaded!");
					entityImages[name].loaded = true;
					entityImages[name].queue.forEach(entity => {
						entityImages[name].draw(entity);
					});
					entityImages[name].queue = [];
				}
				entityImages[name].queue.push(entity);
				entityImages[name].img.onload = imageLoaded()
				
				if(entityDrawRules[name]){
					imageLoaded();
				} else entityImages[name].img.src = getImageFromName(name);
			} else {
				// console.log("Already got image, drawing")
				entityImages[name].draw(entity);
			}
		} else {
			// we got an empty coordinate pair, that usually means this tile was occupied before but is empty now
			console.log("Clearing at X: "+entity.x+", Y: "+entity.y);
			ctx.clearRect((entity.x + playerPosition.x/remoteMapConfig.tileSize) * remoteMapConfig.tileSize, (entity.y + playerPosition.y/remoteMapConfig.tileSize) * remoteMapConfig.tileSize, remoteMapConfig.tileSize, remoteMapConfig.tileSize);
		}
	} else {
		console.log(entity);
		throw new Error("drawEntity on entity without x and y coordinates");
	}
}
function clear(){
	ctx.clearRect(0, 0, canvas.width, canvas.height);
}
