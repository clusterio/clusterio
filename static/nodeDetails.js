// string, object, function(object)
function post(url, data, callback) {
	console.log("POST " + url + JSON.stringify(data))
	var xhr = new XMLHttpRequest();
	xhr.open("POST", url, true);
	xhr.setRequestHeader("Content-type", "application/json");
	xhr.onreadystatechange = function () {
		if (xhr.readyState == 4 && xhr.status == 200) {
			var json = JSON.parse(xhr.responseText);
			callback(json);
		}
	}
	xhr.send(JSON.stringify(data));
}
function getJSON(url, callback) {
    var xhr = new XMLHttpRequest();
    xhr.open('GET', url, true);
    xhr.responseType = 'json';
    xhr.onload = function() {
      var status = xhr.status;
      if (status == 200) {
        callback(null, xhr.response);
      } else {
        callback(status);
      }
    };
    xhr.send();
};
function getParameterByName(name, url) {
    if (!url) url = window.location.href;
    name = name.replace(/[\[\]]/g, "\\$&");
    var regex = new RegExp("[?&]" + name + "(=([^&#]*)|&|#|$)"),
        results = regex.exec(url);
    if (!results) return null;
    if (!results[2]) return '';
    return decodeURIComponent(results[2].replace(/\+/g, " "));
}

function populateSlaveInfo(){
	let slaveID = getParameterByName("slaveID");
	if(!slaveID){
		throw "We need slaveID! GIVE US SLAVEID! ALL HAIL OUR NEW OVERLORDS!"
	}
	getJSON("/api/slaves", function(err, slaveData){
		/*
		{"-1530507550":{
			"time":"1495475926375",
			"rconPort":"8714",
			"rconPassword":"hidden",
			"serverPort":"14345",
			"unique":"-1530507550",
			"publicIP":"localhost",
			"mods":[
				{
					"modName":"clusterio_1.0.0.zip",
					"hash":"341feb6c60918c83f7f3a6a14a4a308aef18dda6"
				},{
					"modName":"clusterio_1.0.1.zip",
					"hash":"aee7a4b67ece19bddf236312fe408a5d4b67248d"
				},{
					"modName":"clusterio_1.1.0.zip",
					"hash":"18e2f7e402d716e3dd1c1458b7fab2d0bb29eccf"
				}],
			"playerCount":"0",
			"instanceName":"t",
			"mac":"44-85-00-D2-7E-D6"}
		}
		*/
		let slave = slaveData[slaveID];
		let HTML = "<div id='header'><div id='onlineIndicator'></div><h1>Name: " + slave.instanceName+"</h1>"
		HTML += "<div class='subbar'><h6>Host: "+slave.mac+" </h6><h6>Unique: "+slave.unique+" </h6></div>"
		HTML += "</div>" // end of header
		HTML += "<div id='displayBody'><p>Last seen: <span id='lastSeenDate'>"+slave.time+"</span></p>"
		HTML += "</div>" // end of displayBody
		// list mods and other metadata
		HTML += "<h2>Mods</h2><ul id='modlist'>"
		for(let i = 0; i < slave.mods.length; i++){
			HTML += "<li>"+slave.mods[i].modName+"</li>"
		}
		
		document.querySelector("#hero").innerHTML = HTML;
		
		
	});
}

populateSlaveInfo();
