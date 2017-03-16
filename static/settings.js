
if(localStorage.settings) {
	let settings = JSON.parse(localStorage.settings);

	let HTML = "";
	for(let key in settings) {
		HTML += drawSetting(key, settings[key]);
	}
	document.querySelector("#body").innerHTML = document.querySelector("#body").innerHTML + HTML;
}

window.onload = function(){
	// loop through all settings and add onclick events for them
	let thingies = document.querySelectorAll(".settingsBox .switch .slider");
	for(let i = 0; i < thingies.length; i++) {
		thingies[i].onclick = function() {
			let settings = JSON.parse(localStorage.settings);
			
			// walk through DOM structure created by drawSetting and update localstorage from that
			console.log(this.parentElement.parentElement.childNodes[0].innerHTML + " = " + !this.parentElement.childNodes[0].checked);
			settings[this.parentElement.parentElement.childNodes[0].innerHTML] = !this.parentElement.childNodes[0].checked;
			
			localStorage.settings = JSON.stringify(settings);
		}
	}
}

function drawSetting(settingText, checked) {
	// please don't change these without fixing what it will break in window.onload
	let boxPart1 = '<div class="settingsBox"><span class="settingsText">'; // setting text
	let boxPart2 = '</span><label class="switch"><input type="checkbox"'; // either checked or nothing
	let boxPart3 = '><div class="slider"></div></label></div>';          // comment for balance and looks
	
	let HTML = boxPart1;
	if(settingText && typeof settingText == "string") {
		HTML += settingText;
	} else {
		HTML += "unknown";
	}
	HTML += boxPart2;
	if(checked && typeof checked == "boolean") {
		HTML += " checked";
	}
	HTML += boxPart3;
	return HTML;
}