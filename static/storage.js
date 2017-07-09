// function to draw data we recieve from ajax requests
function drawcontents(data) {
	data = sortByKey(data, "count");
	let result = "<table>";
	for(i = 0;i < data.length; i++) {
		var img = "";
		if(imagedata[data[i].name]) {
			img = "https://wiki.factorio.com/images/" + imagedata[data[i].name] + ".png"
		} else if(imagelinks[data[i].name]) {
			img = imagelinks[data[i].name];
		} else {
			img = "https://wiki.factorio.com/images/" + capitalizeFirstletter(data[i].name.replace('-','_')) + ".png";
		}
		var searchField = document.querySelector("#search");
		if(!searchField.value || data[i].name.includes(searchField.value)) {
			result = result + "<tr><td><image src='" + img + "' onerror='hideThis(this);'></td><td>" + data[i].name + "</td><td>" + data[i].count + "</td></tr>";
		}
	}
	result = result + "</table>"
	document.getElementById("contents").innerHTML = result;
}

// get cluster inventory from master
function updateInventory() {
	var xmlhttp = new XMLHttpRequest();
	xmlhttp.onreadystatechange = function() {
		if(xmlhttp.readyState == 4 && xmlhttp.status == 200) {
			let data = JSON.parse(xmlhttp.responseText);
			drawcontents(data);
		}
	}
	xmlhttp.open("GET", "api/inventory", true);
	xmlhttp.send();
}
if(JSON.parse(localStorage.settings)["Periodically update storage screen"]) {
	setInterval(updateInventory, 500);
} else {
	updateInventory();
}

// function to sort arrays of objects after a keys value
function sortByKey(array, key) {
    return array.sort(function(a, b) {
        var x = Number(a[key]); var y = Number(b[key]);
        return ((x < y) ? 1 : ((x > y) ? -1 : 0));
    });
}