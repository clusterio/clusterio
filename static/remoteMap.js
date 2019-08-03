/**
	Javascript to download and render a map of a factorio world from an instance using websockets and canvas
	
	It is its responsibility to handle:
	* Display settings
	* Ordering of canvases
	* Querying slaves through master for map info
	* Drawing of sprites defined in external files to canvas
	* Handling input for placing/removing items
	* Transmitting item placements/removals through master
	
	That is way too much for one file, so to anyone reading this:
	This file is horribly written and documented.
	I am sorry. Drawing code is at the bottom, good luck.
	
	If you have questions and wish to contact me, my name
	is Danielv123 on Github, Discord and esperNet #factorio
*/
console.log(":)")
/// ES6 imports
// rules for how entities are drawn (sizes, offset etc)
import {entityDrawRules} from "lib/entityDrawRules.js";
import {getParameterByName, drawImageWithRotation, isImageOk} from "lib/utility.js";
import spritesheetJson from "./pictures/spritesheet.js";
import {itemSelector} from "./remoteMap/itemSelection.js";
var global = {};

var itemSelectorGUI = new itemSelector("#remoteMapItemSelector", [
	{name:"stone-furnace"},
	{name:"accumulator"}, 
	{name:"electric-furnace"}, 
	{name:"inserter"},
	{name:"express-transport-belt"},
]);

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
		// load important images then proceed with rendering (and loading more images)
		global.spritesheet = new Image();
		global.spritesheet.onload = function(){
			global.grassBackground = new Image();
			global.grassBackground.onload = function(){
				requestMapDraw();	
			}
			global.grassBackground.src = "/pictures/grass-1.png";
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
(function(){
	let remoteMapLayers = document.querySelectorAll(".remoteMap");
	remoteMapLayers.forEach(layer => {
		layer.addEventListener('contextmenu', event => event.preventDefault());
		layer.width = remoteMapConfig.tileSize * remoteMapConfig.mapSize;
		layer.height = remoteMapConfig.tileSize * remoteMapConfig.mapSize;
	});
	["width", "height"].forEach(style => document.querySelector("#remoteMapContainer").style[style] = remoteMapConfig.tileSize * remoteMapConfig.mapSize + "px");
})();
const canvas = document.querySelector("#remoteMap");
const ctx = canvas.getContext("2d");
ctx.font = "30px Arial";
ctx.fillText("Use WASD to navigate.",10,50);

const selectionCanvas = document.querySelector("#remoteMapSelection");
const selectionCtx = selectionCanvas.getContext("2d");
selectionCtx.font = "30px Arial";
selectionCtx.fillText("Selection layer",10,50);

const backgroundCanvas = document.querySelector("#remoteMapBackground");
const backgroundCtx = backgroundCanvas.getContext("2d");
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
function getMousePos(canvas, evt) {
	var rect = canvas.getBoundingClientRect();
	return {
		x: evt.clientX - rect.left,
		y: evt.clientY - rect.top
	};
}
window.mousePos = {};
selectionCanvas.addEventListener('mousemove', function(evt) {
	var mousePos = getMousePos(selectionCanvas, evt);
	var message = 'Mouse position: ' + mousePos.x + ',' + mousePos.y;
	window.mousePos.x = mousePos.x;
	window.mousePos.y = mousePos.y;
}, false);
selectionCanvas.addEventListener("mousedown", function(evt) {
	if(evt.which === 1) window.mousePos.clicked = true;
	if(evt.which === 3) window.mousePos.rightClicked = true;
	
	// place item in world by sending it with websockets and shit
	let tileSize = remoteMapConfig.tileSize;
	let entity = {
		name: itemSelectorGUI.getItem().name,
		position:{
			x: Math.floor((playerPosition.x + window.mousePos.x) / tileSize),
			y: Math.floor((playerPosition.y + window.mousePos.y) / tileSize),
		},
		direction: itemSelectorGUI.getItem().direction.toString(),
	};
	if(evt.which === 1){ // left click to place
		console.log(JSON.stringify(entity));
		socket.emit("placeEntity", entity);
	} else if(evt.which === 3){ // right click to delete
		entity.name = "deleted";
		socket.emit("placeEntity", entity)
	}
	// console.log(entity);
});
selectionCanvas.addEventListener("mouseup", function(evt) {
	if(evt.which === 1)	window.mousePos.clicked = false;
	if(evt.which === 3)	window.mousePos.rightClicked = false;
});
function renderLoop(){
	// render game canvas
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
				for(let i = 0; i < Math.floor(Math.abs((playerPosition.y-cachePosition.y)/remoteMapConfig.tileSize)); i++){
					cache.walkUp();
				}
			}
		}
		if(leftPressed){
			console.log("a");
			playerPosition.x -= movement;
			if(Math.abs((playerPosition.x-cachePosition.x)/remoteMapConfig.tileSize) > 1){
				for(let i = 0; i < Math.floor(Math.abs((playerPosition.x-cachePosition.x)/remoteMapConfig.tileSize)); i++){
				cache.walkRight();
			}}
		}
		if(downPressed){
			console.log("s");
			playerPosition.y += movement;
			if(Math.abs((playerPosition.y-cachePosition.y)/remoteMapConfig.tileSize) > 1){
				for(let i = 0; i < Math.floor(Math.abs((playerPosition.y-cachePosition.y)/remoteMapConfig.tileSize)); i++){
				cache.walkDown();
			}}
		}
		if(rightPressed){
			console.log("d");
			let oldPos = playerPosition.x;
			playerPosition.x += movement;
			if(Math.abs((playerPosition.x-cachePosition.x)/remoteMapConfig.tileSize) > 1){
				for(let i = 0; i < Math.floor(Math.abs((playerPosition.x-cachePosition.x)/remoteMapConfig.tileSize)); i++){
				cache.walkLeft();
			}}
		}
		// draw map
		drawFromCache();
		// queue next tick
		window.requestAnimationFrame(renderLoop);
	}
	
	// render selection canvas
	let mousePosition = window.mousePos;
	if(mousePosition && mousePosition.x){
		// make a box around the mouse cursor
		selectionCtx.beginPath();
		selectionCtx.lineWidth = remoteMapConfig.tileSize / 16;
		selectionCtx.strokeStyle="yellow";
		if(mousePosition.clicked) selectionCtx.strokeStyle = "red";
		if(mousePosition.rightClicked) selectionCtx.strokeStyle = "blue";
		let tileSize = remoteMapConfig.tileSize
		let halfTile = tileSize / 2;
		let tilePosition = { // position in world coordinates (same as used by factorio)
			x: Math.floor((playerPosition.x + mousePosition.x) / tileSize),
			y: Math.floor((playerPosition.y + mousePosition.y) / tileSize),
		}
		// Long thing to correct for offset between playerPosition, cachePosition (tile grid) and mouse position and draw the box so it aligns with tiles.
		selectionCtx.rect(tilePosition.x * tileSize - playerPosition.x, tilePosition.y * tileSize - playerPosition.y, tileSize, tileSize);
		selectionCtx.stroke();
	}
	
	// render background canvas
	let dw = 1024 / 32 * remoteMapConfig.tileSize;
	let dh = 64 / 32 * remoteMapConfig.tileSize;
	
	// 0-dw and x < ?? + dw is to make sure we draw well outside the canvas on both sides to avoid ugly gfx
	for(let x = 0-dw; x < remoteMapConfig.tileSize * remoteMapConfig.mapSize + dw; x += dw){
		for(let y = 0-dh; y < remoteMapConfig.tileSize * remoteMapConfig.mapSize + dh; y += dh){
			let dx = x - playerPosition.x % dw;
			let dy = y - playerPosition.y % dh;
			if(global.grassBackground && isImageOk(global.grassBackground)) backgroundCtx.drawImage(global.grassBackground, 0, 64, 1024, 64, dx, dy, dw, dh);
		}
	}
}
var entityImages = {}; // cache to store images and details about entities, populated by drawEntity();
window.logEntCache = function(){console.log(entityCache)}
function drawEntity(entity, dontCache){
	if(entity.x !== undefined && entity.y !== undefined){
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
				console.log("Downloading image "+name);
				// download the entityImages and add stuff  to queue
				entityImages[name] = {
					img: new Image(),
					queue: [],
					loaded: false,
				};
				entityImages[name].draw = function(entity){
					if(this.loaded){
						let name = entity.entity.name;
						let image, sprWidth, sprHeight, offLeft, offTop, size, offsetX, offsetY;
						let flipX = false, flipY = false;
						let rotation = 0;
						// check hardcoded entity draw rules for specifics (otherwise draw icon as 1x1 entity with rotation if specified)
						if(entityDrawRules[name] && (entityDrawRules[name].positionOffset || entityDrawRules[name].spritesheet)){
							let rules = entityDrawRules[name]
							if(rules.positionOffset){
								offsetX = rules.positionOffset.x;
								offsetY = rules.positionOffset.y;
							}
							if(rules.sizeInTiles){
								size = {
									x: remoteMapConfig.tileSize * rules.sizeInTiles.x,
									y: remoteMapConfig.tileSize * rules.sizeInTiles.y,
								};
							}
							if(rules.spritesheet && Array.isArray(rules.spritesheet)){
								let dir = Number(entity.entity.rot || 0);
								// 2 animated sprites, we will need to flip it for rotations.
								if(rules.spritesheet.length == 2){
									let spritesheetAnim = dir / 2 % 2;
									let animationStage = Math.floor(Date.now()/16) % rules.spritesheet[spritesheetAnim].spritesheet.length;
									
									try{
									sprWidth =	rules.spritesheet[spritesheetAnim].spritesheet[animationStage].frame.w;
									sprHeight =	rules.spritesheet[spritesheetAnim].spritesheet[animationStage].frame.h;
									offLeft =	rules.spritesheet[spritesheetAnim].spritesheet[animationStage].frame.x;
									offTop =	rules.spritesheet[spritesheetAnim].spritesheet[animationStage].frame.y;
									} catch(e){
										// console.log(name)
										// console.log(rules.spritesheet[spritesheetAnim].spritesheet)
									}
									image = 	global.spritesheet;
									
									// handle rotation (not handled by generic handler because we have to do flips and special stuff)
									if(dir == 4){
										// rotation = (dir/2)*90
										// console.log("rotating")
										flipY = true;
									} else if(dir == 6){
										flipX = true;
										// rotation = ((dir+2)/2)*90+180 // this formula is terrible, don't try to repair, there is no sense to it
									}
									
									if(rules.spritesheet[spritesheetAnim].positionOffset){
										offsetX = rules.spritesheet[spritesheetAnim].positionOffset.x;
										offsetY = rules.spritesheet[spritesheetAnim].positionOffset.y;
									}
									if(rules.spritesheet[spritesheetAnim].sizeInTiles){
										size = {
											x: remoteMapConfig.tileSize * rules.spritesheet[spritesheetAnim].sizeInTiles.x,
											y: remoteMapConfig.tileSize * rules.spritesheet[spritesheetAnim].sizeInTiles.y,
										};
									}
								} else {
									// correct for whether we have 1, 4 or 8 directions
									let spriteSheetRotIndex = dir / (8 / rules.spritesheet.length);
									if(rules.spritesheet.length > 8) {
										// apparently this entity has more than 8 directions. That isn't supported.
										// therefore we can conclude that they are instead intended as animation frames.
										// That is why we treat them as animation frames.
										spriteSheetRotIndex = Math.floor(Date.now()/32) % rules.spritesheet.length;
									} else if(rules.spritesheet[spriteSheetRotIndex].spritesheet.length){
										var animationStage = Math.floor(Date.now()/16) % rules.spritesheet[spriteSheetRotIndex].spritesheet.length;
										var usesAnimation = true;
									} else {
										var usesAnimation = false;
									}
									
									if(usesAnimation){
										try{
										sprWidth =	rules.spritesheet[spriteSheetRotIndex].spritesheet[animationStage].frame.w;
										sprHeight =	rules.spritesheet[spriteSheetRotIndex].spritesheet[animationStage].frame.h;
										offLeft =	rules.spritesheet[spriteSheetRotIndex].spritesheet[animationStage].frame.x;
										offTop =	rules.spritesheet[spriteSheetRotIndex].spritesheet[animationStage].frame.y;
										}catch(e){} // TODO throws error due to yellow belt rendering
									} else {
										sprWidth =	rules.spritesheet[spriteSheetRotIndex].spritesheet.frame.w;
										sprHeight =	rules.spritesheet[spriteSheetRotIndex].spritesheet.frame.h;
										offLeft =	rules.spritesheet[spriteSheetRotIndex].spritesheet.frame.x;
										offTop =	rules.spritesheet[spriteSheetRotIndex].spritesheet.frame.y;
									}
									image =		global.spritesheet;
									
									if(rules.spritesheet[spriteSheetRotIndex].positionOffset){
										offsetX = rules.spritesheet[spriteSheetRotIndex].positionOffset.x;
										offsetY = rules.spritesheet[spriteSheetRotIndex].positionOffset.y;
									}
									if(rules.spritesheet[spriteSheetRotIndex].sizeInTiles){
										size = {
											x: remoteMapConfig.tileSize * rules.spritesheet[spriteSheetRotIndex].sizeInTiles.x,
											y: remoteMapConfig.tileSize * rules.spritesheet[spriteSheetRotIndex].sizeInTiles.y,
										};
									}
									if(rules.spritesheet[spriteSheetRotIndex].flip){
										let flip = rules.spritesheet[spriteSheetRotIndex].flip;
										if(flip == "x") flipX = true;
										if(flip == "y") flipY = true;
									}
								}
							} else if(rules.spritesheet){
								sprWidth = rules.spritesheet.frame.w;
								sprHeight = rules.spritesheet.frame.h;
								offLeft = rules.spritesheet.frame.x;
								offTop = rules.spritesheet.frame.y;
								image = global.spritesheet;
							}
						} else {
							offsetX = 0, offsetY = 0;
							size = {
								x:remoteMapConfig.tileSize, y: remoteMapConfig.tileSize,
							};
						}
						let xPos = ((entity.x + offsetX) * remoteMapConfig.tileSize) - playerPosition.x;
						let yPos = ((entity.y + offsetY) * remoteMapConfig.tileSize) - playerPosition.y;
						if(entity.entity.rot && !isNaN(Number(entity.entity.rot)) && !(entityDrawRules[name] && Array.isArray(entityDrawRules[name].spritesheet))){
							let rules = entityDrawRules[name];
							if(rules && rules.rotOffset){
								rotation = ((entity.entity.rot * 45) + entityDrawRules[name].rotOffset);
							} else {
								rotation = entity.entity.rot * 45;
							}
						}
						if(!image) image = entityImages[name].img;
						// if(name == "oil-refinery") console.log(offsetX)
						drawImageWithRotation(ctx, image, xPos, yPos, size.x, size.y, rotation%360, sprWidth, sprHeight, offLeft, offTop, flipX, flipY);
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
				
				if(entityDrawRules[name] && entityDrawRules[name].spritesheet){
					// imageLoaded();
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
	selectionCtx.clearRect(0, 0, selectionCanvas.width, selectionCanvas.height);
	backgroundCtx.clearRect(0, 0, backgroundCanvas.width, backgroundCanvas.height);
}
// setInterval(()=>console.log(entityDrawRules),5000);
