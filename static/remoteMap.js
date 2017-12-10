var socket = io.connect('http://localhost:8080');
socket.on('hello', function (data) {
	console.log(data);
	socket.emit("registerMapRequester", {instanceID: '1611985668'});
	
	socket.on("displayChunk", function(chunk){
		console.log(chunk)
	});
});

function requestChunk(x,y){
	socket.emit('requestChunk', {x:x, y:y, instanceID: '1611985668'});
}