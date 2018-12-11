
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
	let sliders = document.querySelectorAll(".settings-box .switch .slider");
	for(let i = 0; i < sliders.length; i++) {
		sliders[i].onclick = function() {
			let settings = JSON.parse(localStorage.settings);
			
			// walk through DOM structure created by drawSetting and update localstorage from that
			console.log(this.parentElement.parentElement.childNodes[0].innerHTML + " = " + !this.parentElement.childNodes[0].checked);
			settings[this.parentElement.parentElement.childNodes[0].innerHTML] = !this.parentElement.childNodes[0].checked;
			
			localStorage.settings = JSON.stringify(settings);
		}
	}
};

function drawSetting(settingText, checked) {

	let HTML = '<div class="settings-box">' +
		'<label class="switch"><input type="checkbox" checked="' + checked + '"' +
		'><div class="slider round"></div></label><span class="settings-text ml-3 align-middle">' + settingText + '</span></div>';
	return HTML;
}