export var entityDrawRules = {
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
};
let template3x3entity = {
	sizeInTiles: {
		x:3,
		y:3,
	},
	positionOffset: {
		x:-1,
		y:-1,
	},
};
for(let i = 1; i <= 3; i++){
	let name = "assembling-machine-"+i;
	entityDrawRules[name] = template3x3entity;
};
["chemical-plant", "radar", "solar-panel", "lab", "electric-mining-drill", "beacon", "electric-furnace"].forEach(name => {
	entityDrawRules[name] = template3x3entity;
});
