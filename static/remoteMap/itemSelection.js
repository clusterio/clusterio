export class itemSelector {
	constructor(containerSelector, entities){
		this.containerSelector = containerSelector;
		this.container = document.querySelector(containerSelector);
		if(!this.container) throw new Error("Could not find container "+container);
		this.entities = entities;
		this.direction = 0;
		
		// populate container
		let cont = this.container;
		let HTML = "";
		HTML += "<div class='header'>";
			HTML += "<h2>Item selection</h2>";
		HTML += "</div>";
		HTML += "<div class='itemSelector'>";
			HTML += "<span>Name: </span>";
			HTML += "<select class='blackText'>";
				this.entities.forEach(entity => HTML += "<option value='"+entity.name+"'>"+entity.name+"</option>");
			HTML += "</select>";
		HTML += "</div>";
		// direction selector
		HTML += "<div id='directionSelector'>";
			HTML += "<h2>Direction: </h2>";
			HTML += "<h2 id='directionDisplay'>"+this.directionToCardinal(0)+"</h2>"
			HTML += "<p>Press R to rotate</p>";
		HTML += "</div>";
		
		// write styles
		let styles = {
			".header > h2":{
				color:"white",
			},
			".blackText":{
				color:"black",
			},
			".blackText > option":{
				color:"black",
			}
		}
		
		// turn style object into style tag
		HTML += "<style>";
		for(let style in styles){
			HTML += containerSelector+" "+style+"{";
			for(let styleName in styles[style]){
				let styleValue = styles[style][styleName];
				HTML += styleName+":"+styleValue+";";
			}
			HTML += "}";
		}
		cont.innerHTML += HTML + "</style>";
		
		// handle direction keyboard event
		Mousetrap.bind('r', ()=>this.rotate());
	}
	directionToCardinal(dir){
		if(dir == 0){
			return "north";
		} else if(dir == 1){
			return "north-east";
		} else if(dir == 2){
			return "east";
		} else if(dir == 3){
			return "south-east";
		} else if(dir == 4){
			return "south";
		} else if(dir == 5){
			return "south-west";
		} else if(dir == 6){
			return "west";
		} else if(dir == 7){
			return "north-west";
		}
	}
	rotate(){
		this.direction = (this.direction + 2) % 8;
		// update display
		document.querySelector("#directionDisplay").innerHTML = this.directionToCardinal(this.direction);
	}
	getItem(){
		let name = document.querySelector(this.containerSelector+" > .itemSelector > select").value;
		let direction = this.direction;
		return {name, direction};
	}
}