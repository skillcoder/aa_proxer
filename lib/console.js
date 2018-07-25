var net = require('net');

function listen(cfg, callback) {
	var server = net.createServer();

	server.listen(cfg.port, cfg.ip);

	server.on('listening', function() {
		if (callback) callback(server);
	});

}

exports.listen = listen;
