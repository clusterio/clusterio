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