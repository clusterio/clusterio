// ask master for slaves
setInterval(function() {
	var xmlhttp = new XMLHttpRequest();
	xmlhttp.onreadystatechange = function() {
		if(xmlhttp.readyState == 4 && xmlhttp.status == 200) {
			var slaveData = JSON.parse(xmlhttp.responseText);
			var HTML = "<p>Current connections:</p>"
			for(i=0;i<Object.keys(slaveData).length;i++){
				var key = Object.keys(slaveData)[i]
				// Date.getYear.getmonth.getDay
				if(Date.now() - slaveData[key].time < 12000) {
					// Display ISO 6801 compliant date to please Zarthus
					// maybe include an option to use y-ymd-ymd-y for Trangar compatibility as well
					var seenDate = date.yyyymmdd(slaveData[key].time)
					if(g.trangarTime == true){
						var seenDate = (seenDate+"")[0]+"-"+(seenDate+"")[1]+(seenDate+"")[4]+(seenDate+"")[6]+"-"+(seenDate+"")[2]+(seenDate+"")[5]+(seenDate+"")[7]+"-"+(seenDate+"")[3]
					}
					HTML += "<div class='slaveBox'><h2>ID: " + slaveData[key].unique + "</h2><p>Last seen: "+seenDate+"</p><p>Port: "+slaveData[key].serverPort+"</p><p>Host: "+slaveData[key].mac+"</p></div>"
				}
			}
			document.querySelector("#slaves > #display").innerHTML = HTML
		}
	}
	xmlhttp.open("GET", "slaves", true);
	xmlhttp.send();
}, 500)

// get all slaves recently connected to master
