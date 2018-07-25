#!/usr/bin/env node
// vim: set ft=javascript:

var app = require('express')(),
    server = require('http').Server(app),
    io = require('socket.io')(server),
	path = require('path');

process.env['NODE_CONFIG_DIR'] = path.resolve(__dirname, 'config');
var cfg = require('config');
const cote = require('cote')({ multicast: cfg.app.cote_ip });


app.get('/', function (req, res) {
    console.log(`${req.ip} Browser request`);

    res.sendFile(__dirname + '/sniffer.html');
});

server.listen(process.argv[2] || 5555);

var sockend = new cote.Sockend(io, {
    name: 'sniffer',
	//key: '195.209.48.16:51580',
	namespace: 'sniffer'
});

