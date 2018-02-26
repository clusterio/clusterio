export class itemSelector {
	constructor(containerSelector, entities){
		this.containerSelector = containerSelector;
		this.container = document.querySelector(containerSelector);
		if(!this.container) throw new Error("Could not find container "+container);
		this.entities = entities;
		
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
	}
	getItem(){
		let name = document.querySelector(this.containerSelector+" > .itemSelector > select").value;
		return {name};
	}
}