// Handle config editing
originalSettings = {};
let settings = document.querySelectorAll(".settingInput");
settings.forEach(setting => {
	let entry = setting.children[0].innerText
	originalSettings[setting.children[0].innerText] = {
		entry: setting.children[0].innerText,
		value: setting.children[1].value,
	}
	setting.children[1].addEventListener("input", ()=>{
		let newValue = setting.children[1].value;
		if(newValue != originalSettings[entry].value){
			setting.children[1].style.backgroundColor = "lightgreen";
		} else {
			setting.children[1].style.backgroundColor = "";
		}
	});
});

submitSettings.addEventListener("click", async ()=>{
	let settings = document.querySelectorAll(".settingInput");
	for(let i = 0; i < settings.length; i++){
		let setting = settings[i];
		let entry = setting.children[0].innerText
		if(setting.children[1].value != originalSettings[entry].value){
			// upload new changes, display results somehow
			let status = await postJSON("/api/serverManager/editConfig", {
				entry,
				value: setting.children[1].value,
				instanceID: getParameterByName("instanceID"),
			});
			if(status.ok){
				setting.children[1].style.backgroundColor = "";
			}
		}
	}
});
// Handle plugin management
let pluginStatuses = document.querySelectorAll(".pluginStatus");
pluginStatuses.forEach(pluginStatus => {
	pluginStatus.addEventListener("click", async ()=>{
		if(pluginStatus.style.backgroundColor == "green"){
			let status = await postJSON("/api/serverManager/disablePlugin", {
				instanceID: getParameterByName("instanceID"),
				pluginName: pluginStatus.parentElement.children[1].children[0].innerText,
			});
			if(status.ok){
				pluginStatus.style.backgroundColor = "red";
			}
		} else {
			let status = await postJSON("/api/serverManager/enablePlugin", {
				instanceID: getParameterByName("instanceID"),
				pluginName: pluginStatus.parentElement.children[1].children[0].innerText,
			});
			if(status.ok){
				pluginStatus.style.backgroundColor = "green";
			}
		}
	});
});