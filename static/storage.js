// function to draw data we recieve from ajax requests
function drawcontents(data) {
	const table = document.querySelector("#contents tbody"); //tables have tbody inserted automatically
	const rows = table.children;
	
	sortByKey(data, "count");
	data.forEach(function(item, i) {
		let row = rows[i];
		if(!row) {
			row = document.createElement('tr');
			row.innerHTML = "<td><img width=32 height=32></td><td class=name></td><td class=count></td>";
			table.appendChild(row);
		}
		
		const img = row.querySelector('img');
		const imgName = getImageFromName(item.name);
		if(img.getAttribute('src') !== imgName) {
			img.setAttribute('src',imgName);
		}
		
		const name = row.querySelector('.name');
		if(name.textContent !== item.name) {
			name.textContent = item.name;
		}
		
		const count = row.querySelector('.count');
		if(count.textContent !== ''+item.count) {
			count.textContent = item.count;
		}
	})
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
    array.sort(function(a, b) {
        return b[key] - a[key];
    });
}