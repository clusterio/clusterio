var socket = io.connect('http://localhost:8080');
socket.on('hello', function (data) {
	console.log(data);
	socket.emit('registerSlaveMappper', { instanceID: 'data' });
});
