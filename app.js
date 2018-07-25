#!/usr/bin/env node
// vim: set ft=javascript:

const util = require('util');
var colors = require('colors/safe');
var path = require('path');
var argv = require('minimist')(process.argv.slice(2));

var _ROOT = __dirname;
console.log('Working dir: '+_ROOT);

process.env['NODE_CONFIG_DIR'] = path.resolve(__dirname, 'config');
var cfg = require('config');
const cote = require('cote')({ multicast: cfg.app.cote_ip });

var is_debug = argv.debug ? true : false;
var debug = function() {};
if (is_debug) {
	debug = function(msg) { console.log(msg) };
	debug('DEBUG MODE ACTIVATED !!!'.yellow);
}

var log4js = require('log4js');
log4js.configure(path.resolve(__dirname, 'config', 'logger.json'), { cwd: path.resolve(__dirname, 'logs'), reloadSecs: 3600 });
var log = log4js.getLogger('dev');
log.setLevel('TRACE');

debug('worker started with pid: '+process.pid);

var app = {};
var consoles = require('./lib/console.js');
consoles.listen(cfg.console, function(server) {
	//server.setNoDelay();
	debug(colors.green('[Console] listening on ' + server.address().address +':'+ server.address().port));
	server.on('connection', function(client) {
		client.setNoDelay();
		client.setEncoding('utf8');
		debug(colors.green('[Console] New connection from ' + client.remoteAddress +':'+ client.remotePort));

		client.on('data', function(data) {
			//debug(util.inspect(data));
			data = data.replace(/(\n|\r)+$/, '');
			var params = data.split(' ', 2);
			var cmd = params[0];
			switch (cmd) {
			case 'exit':
			case 'quit':
			case 'q':
				client.write("Bye!\n");
				client.destroy();
				break;
			default:
				debug(colors.green('[Console] DATA ' + client.remoteAddress + ': ' + data));
				// Write the data back to the socket, the client will receive it as data from the server
				client.write('You said "' + data + '"'+"\n");
			}
		});

		client.on('close', function(data) {
			debug(colors.green('[Console] CLOSED: ' + client.remoteAddress +' '+ client.remotePort));
		});
	});

	server.on('error', (err) => {
		debug(colors.red('[Console] Error: ' + err));
	});

});

function cinfo(info) {
	return info.srcAddr +':'+ info.srcPort +' -> ' +info.dstAddr +':'+ info.dstPort;
}

var piper = require('./lib/piper.js');
var archeage = require('./lib/archeage.js');

var socks = require('socksv5');
var srv = socks.createServer(function(info, accept, deny) {
	if (info.dstPort === cfg.app.server_port) {
		var client;
		if (client = accept(true)) {
			client.setNoDelay();
			debug(colors.cyan('[Client] New connection from ' + cinfo(info)));

			piper(client, function(forward, duplicate) {
				forward({ host: info.dstAddr, port: info.dstPort }, function(server, client_buffer){
					server.setNoDelay();
					// Instantiate a new Publisher component.
					archeage.analize(client, server, client_buffer, cote);
				});
			});

			client.on('close', function(data) {
				debug(colors.cyan('[Client] CLOSED: ' + cinfo(info)));
			});
		}
	} else {
		debug(colors.gray('[Client] Proxy ' + cinfo(info)));
		accept();
	}
});
srv.listen(cfg.app.port, cfg.app.ip, function() {
	debug(colors.cyan('SOCKS server listening on ['+cfg.app.ip+':'+cfg.app.port+']'));
});
srv.useAuth(socks.auth.UserPassword(function(user, password, cb) {
	var is_auth = false;
	if (user === 'archeage' && password === 'archeage') {
   	    is_auth = true;
	}

	debug('[AUTH] ['+(is_auth ? colors.green('OK') : colors.red('FAIL'))+'] '+user);

	cb(is_auth);
}));
