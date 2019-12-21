
// ask master for slaves and render them nicely on a page with production graphs
setTimeout(function() {
	var xmlhttp = new XMLHttpRequest();
	xmlhttp.onreadystatechange = function() {
		if(xmlhttp.readyState == 4 && xmlhttp.status == 200) {
			var slaveData = JSON.parse(xmlhttp.responseText);
			var HTML = "<p>Current connections:</p>"
			for(i=0;i<Object.keys(slaveData).length;i++){
				var key = Object.keys(slaveData)[i]
				// Only show slaves connected last 2 minutes (depending on setting now)
				if(JSON.parse(localStorage.settings)["Display offline slaves"]) var displayOffline = true;
				if(Date.now() - slaveData[key].time < 120000 || displayOffline) {
					let seenDate = moment(Number(slaveData[key].time)).format('DD.MM.YY, hh:mm:ss')
					HTML += "<div class='slaveBox'>";
					HTML += "<a href='nodeDetails?instanceID="+slaveData[key].unique+"'><h2>" + slaveData[key].instanceName + "</h2></a><p>ID: " + slaveData[key].unique + "</p><p>Last seen: "+seenDate+"</p><p>Online players: "+slaveData[key].playerCount+"</p><p>IP: "+slaveData[key].publicIP +":"+ slaveData[key].serverPort+"</p>"
					HTML += "<p>Host: "+slaveData[key].mac+"</p>";
					HTML += "</div>";
				}
			}
			document.querySelector("#slaves > #display").innerHTML = HTML
		}
	}
	xmlhttp.open("GET", "api/slaves", true);
	xmlhttp.send();
}, 0)
