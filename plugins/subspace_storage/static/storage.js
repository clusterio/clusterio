// function to draw data we recieve from ajax requests
_lastData = [];
function drawcontents(data) {
	data = data || _lastData; //Cache data so we can drawcontents without waiting for the server, for the search box.
	_lastData = data;

        // allow searching for multiple criteria separated by space
        var searchArgs = document.querySelector("#search").value;
        searchArgs = searchArgs.trim();
        searchArgs = '(' + searchArgs.replace(/ +/g,")|(") + ')';
        const search = new RegExp(searchArgs, 'i');
        data = data.filter(function(item) {
		return search.test(item.name);
	})
	
	sortByKey(data, "count");
	
	const table = document.querySelector("#contents tbody"); //tables have tbody inserted automatically
	const rows = table.children;
	
	//update existing rows or create new ones
	data.forEach(function(item, i) {
		// format count to have .s in it for large number readability (1,000,000)
		item.count = item.count.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
		
		let row = rows[i];
		if(!row) {
			row = document.createElement('tr');
			row.innerHTML = "<td><div></div></td><td class=name></td><td class=count></td>";
			table.appendChild(row);
		}
		
		const itemIcon = row.querySelector("div");
		const iconClass = getItemIconClass(item.name);
		if (itemIcon.getAttribute("class") !== iconClass) {
			itemIcon.setAttribute("class", iconClass);
		}
		
		const name = row.querySelector('.name');
		if(name.textContent !== item.name) {
			name.textContent = item.name;
		}
		
		const count = row.querySelector('.count');
		if(count.textContent !== ''+item.count) {
			count.textContent = item.count;
		}
	});
	
	//remove excess rows, for example, after filtering
	while (data.length < rows.length) {
		table.removeChild(rows[data.length]);
	}
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
	xmlhttp.open("GET", `${root}api/inventory`, true);
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

document.querySelector("#search").addEventListener('input', function() {
	drawcontents();
});
