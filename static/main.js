

contents = {
	"iron-plate":100,
	"copper-plate":7312,
}

function drawcontents(data) {
	keys = Object.keys(data);
	result = "<table>";
	for(i = 0;i < data.length; i++) {
		result = result + "<tr><td>" + data[i].name + "</td><td>" + data[i].count + "</td></tr>";
	}
	result = result + "</table>"
	document.getElementById("contents").innerHTML = result;
}
setInterval(function() {
	var xmlhttp = new XMLHttpRequest();
	xmlhttp.onreadystatechange = function() {
		if(xmlhttp.readyState == 4 && xmlhttp.status == 200) {
			data = JSON.parse(xmlhttp.responseText);
			drawcontents(data);
		}
	}
	xmlhttp.open("GET", "inventory", true);
	xmlhttp.send();
}, 500)