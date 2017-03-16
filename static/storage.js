// function to draw data we recieve from ajax requests
function drawcontents(data) {
	var data = sortByKey(data, "count");
	result = "<table>";
	for(i = 0;i < data.length; i++) {
		var img = "";
		if(imagedata[data[i].name]) {
			img = "https://wiki.factorio.com/images/" + imagedata[data[i].name] + ".png"
		} else if(imagelinks[data[i].name]) {
			img = imagelinks[data[i].name];
		} else {
			img = "https://wiki.factorio.com/images/" + capitalizeFirstLetter(data[i].name) + ".png";
		}
		result = result + "<tr><td><image src='" + img + "' onerror='hideThis(this);'></td><td>" + data[i].name + "</td><td>" + data[i].count + "</td></tr>";
	}
	result = result + "</table>"
	document.getElementById("contents").innerHTML = result;
}

// get cluster inventory from master
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

// function to sort arrays of objects after a keys value
function sortByKey(array, key) {
    return array.sort(function(a, b) {
        var x = Number(a[key]); var y = Number(b[key]);
        return ((x < y) ? 1 : ((x > y) ? -1 : 0));
    });
}