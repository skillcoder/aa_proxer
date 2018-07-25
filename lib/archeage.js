var colors = require('colors/safe');
var zlib = require('zlib');
var hd = require('./hexdump.js');

var is_debug = true;
if (is_debug) {
    debug = function(msg) { colors.cyan(console.log('[ARCH] '+msg)) };
}

function hStrCmp(buff, idx, cnt, hex) {
	hex = hex.replace(/ /g, '');
	return buff.slice(idx, idx+cnt).equals(Buffer.from(hex, 'hex'))
}

function chunk(buff, idx, cnt) {
	return buff.slice(idx, idx+cnt);
}

function uncompress(buff) {
    return zlib.inflateRawSync(buff.slice(6));
}

function compress(buff, count) {
    count = count || 1;
    var compressed = zlib.deflateRawSync(buff, {level: 0});

    var aPacketLen = compressed.length + 6;
    var aPacketBuf = new Buffer(aPacketLen);
    compressed.copy(aPacketBuf, 6, 0, compressed.length);
    compressed = null;
    aPacketBuf.writeUInt16LE(aPacketLen-2, 0);
    aPacketBuf.writeUInt16BE(0xdd04, 2);
    aPacketBuf.writeUInt16LE(count, 4);
    return aPacketBuf;
}

var PACKETHEADERLEN = 2;

function parseBuffer(data, gSys, packetHandler) {
	gSys.recvedThisTimeLen = Buffer.byteLength(data);
	var tmpBuffer = new Buffer(gSys.accumulatingLen + gSys.recvedThisTimeLen);
	gSys.accumulatingBuffer.copy(tmpBuffer);
	data.copy(tmpBuffer, gSys.accumulatingLen); // offset for accumulating
	gSys.accumulatingBuffer = tmpBuffer;
	tmpBuffer = null;
	gSys.accumulatingLen = gSys.accumulatingLen + gSys.recvedThisTimeLen;

	if (gSys.accumulatingLen <= PACKETHEADERLEN) { 
		return;
	} else {
		//a packet info is available..
		if (gSys.totalPacketLen < 0) {
			gSys.totalPacketLen = gSys.accumulatingBuffer.readUInt16LE(0);
		}
	}

	while (gSys.accumulatingLen >= gSys.totalPacketLen + PACKETHEADERLEN) {
		var aPacketLen = gSys.totalPacketLen + PACKETHEADERLEN;
		var aPacketBuf = new Buffer(aPacketLen); // a whole packet is available...
		gSys.accumulatingBuffer.copy(aPacketBuf, 0, 0, aPacketLen);

		////////////////////////////////////////////////////////////////////
		//process packet data
		packetHandler(aPacketBuf);

		// Buffer rebuild
		var newBufRebuild = new Buffer(gSys.accumulatingBuffer.length - aPacketLen); // we can reduce size of allocatin
		gSys.accumulatingBuffer.copy(newBufRebuild, 0, aPacketLen, gSys.accumulatingBuffer.length);

		//init      
		gSys.accumulatingLen = gSys.accumulatingLen - aPacketLen;
		gSys.accumulatingBuffer = newBufRebuild;
		newBufRebuild = null;
		gSys.totalPacketLen = -1;

		//For a case in which multiple packets are transmitted at once.
		if (gSys.accumulatingLen <= PACKETHEADERLEN) {
			//need to get more data -> wait..
			return;
		} else {
			gSys.totalPacketLen = gSys.accumulatingBuffer.readUInt16LE(0);
		}
	}
}

function analize(client, server, client_buffer, cote) {
	var packetPublisher = null;
	var cmdResponder = null;
	var abs_packet_num = 0;
	var gSys = {};
    gSys.isGS = 0; // тип геймсервера
    gSys.isLS = 0; // тип логинсервера
	gSys.myself_id = false;
	gSys.target = false;
	gSys.isGo = false;

	// TODO save opcode to file for load it here // search by: detect_opcode
	var opcode = {};
	opcode.myself = false;  // 0x7a02
	opcode.target = false;  // 0xd500
	opcode.dead   = false;  // 0x7a02
	opcode.destroy= 0x7500;
	opcode.chat   = 0x1A01;

	gSys.accumulatingBuffer = new Buffer(0);
	gSys.totalPacketLen = -1;
	gSys.accumulatingLen = 0;
	gSys.recvedThisTimeLen = 0;

	server.on('data', function(data) {
		//console.log(hd(data));
		parseBuffer(data, gSys, function(buff) {
			//console.log(colors.green(hd(buff)));
			abs_packet_num++;
			if (abs_packet_num == 1) {
				if (traffic_detector(buff) && gSys.isGS == 1) {
					onInit(buff);
				}
			}

			// ArcheAge transmits in little endian
			if (gSys.isGS == 1 && buff.readUInt16BE(2) == 0xdd04) {
				show_packet(buff);
				if (gSys.myself_id === false) {
					gSys.myself_id = detect_myself_id(buff);
				} else {
					if (opcode.target === false) {
						opcode.target = detect_opcode_target(buff);
					} else {
						is_detect_target(buff);
						if (gSys.selected_target) {


							/*
							if (is_detect_object_dead(buff, gSys.selected_target)) {
								if (gSys.isGo) {
									setTimeout(function() {
										client_buffer.resume();
										sendEvent('client_traff_pause', 0);
										gSys.isGo = false;
										sendEvent('mode_suspending', 0);
									}, 30000);

									setTimeout(function() {
                                        sendEvent('client_traff_pause', 1);
										csend_chat('GOGOGO', 0x0A00); // 0A00 - raid
										csend_hide_object(gSys.selected_target);
										client_buffer.pause();
                                    }, 15000);
								} else {
									// event selected_target dead
									csend_hide_object(gSys.selected_target);
								}
							}
							*/
						}
					}
				}
			}
			
			//debug(util.inspect(buff));
		});
	});

    // Выбираем цель, Убиваем цель, Включаем поиск опкода дестроя, 
	// destroy
	// 1D 00 DD 04 02 00    ________    ________
	// 00 01 D1 00 19 12 00 DF F8 00 00 DF F8 00 00 00 00 00 00 00 01 05 2F 00 00 00 00 33 02 19 12

	// death
	// 0F 00 DD 04 01 00
	//             ________
	// 00 00 7A 02 A3 EF 00 00 00 00 00 00 00 00 00 00 00 00 00
	// 00 00 7A 02 8D F2 00 00 00 00 00 00 00 00 00 00 00 00 00

	// 11:28:47.392 detect_object_dead 9e8100
	// 11:29:17.359 detect_target 0
	// Ровно 30 сек до исчезновения

	function is_detect_object_dead(buff, target) {
		if (buff.readUInt16BE(4) == 0x0100) {
            var gbuff = uncompress(buff);
            if (gbuff.length == 19 && gbuff.readUIntBE(4, 3) == target && gbuff.readUInt32BE(7) == 0 && gbuff.readUInt32BE(11) == 0 && gbuff.readUInt32BE(15) == 0) {
				if (opcode.dead === false) {
					if (hStrCmp(gbuff, 7, 12, '00 00 00 00 00 00 00 00 00 00 00 00')) {
						opcode.dead = gbuff.readUInt16BE(2);
						sendEvent('detect_opcode_dead', opcode.dead);
					}
				}

				if (gbuff.readUInt16BE(2) == opcode.dead) {
                	debug(colors.red('Dead target: '+target.toString(16)));
					sendEvent('detect_object_dead', target);
    	            return true;
				}
            }
        }

        return false;
	}

	function is_detect_target(buff) {
		if (buff.readUInt16BE(4) == 0x0100) {
			var gbuff = uncompress(buff);
			if (gbuff.length == 10 && gbuff.readUInt16BE(2) == opcode.target && gbuff.readUIntBE(4, 3) == gSys.myself_id) {
				var id = gbuff.readUIntBE(7, 3);
				if (gSys.isGo && id == 0) {
					client_buffer.resume();
					sendEvent('client_traff_pause', 0);
					gSys.isGo = false;
					sendEvent('mode_suspending', 0);
				}

				gSys.target = id;
                debug(colors.red('New target: '+id.toString(16)));
                sendEvent('detect_target', id);
                return true;
			}
		}

		return false;
	}

	function detect_opcode_target(buff) {
		if (buff.readUInt16BE(4) == 0x0100) {
			var gbuff = uncompress(buff);
			if (gbuff.length == 10 && gbuff.readUIntBE(4, 3) == gSys.myself_id && gbuff.readUIntBE(4, 3) == gbuff.readUIntBE(7, 3)) {
				var id = gbuff.readUInt16BE(2);
				debug(colors.red('Detect target opcode: '+id.toString(16)));
				sendEvent('detect_opcode_target', id);
				return id;
			}
		}

		return false;
	}

	function detect_myself_id(buff) {
		if (buff.readUInt16LE(0) < 50 && buff.readUInt16BE(4) == 0x0100) {
			var gbuff = uncompress(buff);

			// search 
			if (gbuff.length == 19) {
				if (opcode.myself === false) {
					opcode.myself = gbuff.readUInt16BE(2);
					sendEvent('detect_opcode_myself', opcode.myself);
					opcode.dead = opcode.myself;
					sendEvent('detect_opcode_dead', opcode.dead);
				}

				var id = gbuff.readUIntBE(4, 3); //chunk(gbuff, 4, 3).toString('hex');
				debug(colors.red('Detect myself: '+id.toString(16)));
				sendEvent('detect_myself_id', id);
				return id;
			}
		}

		return false;
	}

	function show_packet(buff) {
		//console.log(colors.yellow(hd(chunk(buff, 0, 6))));
		var gbuff = uncompress(buff);
		//console.log(colors.cyan(hd(gbuff)));
		if (packetPublisher) {
		    packetPublisher.publish('s2c', {hex: hd(gbuff), type: 'dd04', header: hd(chunk(buff, 0, 6))});

		}
	}

	function traffic_detector(buff) {
		// Возьмем первый байт пакета
		var le = buff.readUInt16BE(0);
		debug('traffic_detector: '+le.toString(16));

		// Определим тип сервера по первому пакету
		switch (le) {
			// LS AUTH
			case 0x1D:
				gSys.isLS = 1;
				debug('LS AUTH');
				return true;
			break;
			// LS AUTH
			case 0x42:
				gSys.isLS = 1;
				debug('LS AUTH');
				return true;
			break;
			// GS WORLD
			case 0x24:
				gSys.isGS = 1;
				debug('GS WORLD');
				return true;
			break;
			// GS WORLD 1.8
			case 0x28:
				gSys.isGS = 1;
				debug('GS WORLD 1.8');
				return true;
			break;
			// GS WORLD 3.5 (3.5.2.1) r341676
			case 0x2C01:
				gSys.isGS = 1;
				debug('GS WORLD 3.5');
				return true;
			break;
			// GS STREAM
			case 0x0A:
				gSys.isGS = 2;
				debug('GS STREAM');
				return true;
			break;
		}

		return false;
	}

	function csend_hide_object(target) {
		var buffer = new Buffer(9);
		buffer.writeUInt16BE(0x0000, 0);
		buffer.writeUInt16BE(opcode.destroy, 2);
		buffer.writeUInt16BE(0x0100, 4);
		buffer.writeUIntBE(target, 6, 3);
		var buff = compress(buffer, 1);
		packetPublisher.publish('s2c', {hex: hd(buff)});
		client.write(buff);
	}

    //                     user   32       32       32
    // 0000 1A01 0A00 0000 6F2C00 00FF0B01 BB5F9000 09039400 0000 040046676866100041414141414141414141414141414141000000
	//      opcd chat 16   32       user   32       32       16   len from                
	// 0000 1A01 FDFF 0000 00000000 d75801 00000000 00000000 0000 0400466768660400696E6974 00 00000010 27000000
	// 0 1  2    4    6    8 9 1011 12     15       19       23   25  27
	function csend_chat(msg, type = 0xFDFF) {
        var from = 'Господь';
        var buff_from = new Buffer(from, 'utf8');
        var buff_msg = new Buffer(msg, 'utf8');

        var nxt = 27 + buff_from.length + 2 + buff_msg.length;

        var buffer = new Buffer(nxt+9);
        buffer.writeUInt16BE(0x0000, 0);
        buffer.writeUInt16BE(opcode.chat, 2);
        buffer.writeUInt16BE(type, 4);
        buffer.writeUInt16BE(0x0000, 6);
        buffer.writeUInt32BE(0x00000000, 8);
        buffer.writeUIntBE(gSys.myself_id, 12, 3);
        buffer.writeUInt32BE(0x00000000, 15);
        buffer.writeUInt32BE(0x00000000, 19);
        buffer.writeUInt16BE(0x0000, 23);
        buffer.writeUInt16LE(buff_from.length, 25);
        buff_from.copy(buffer, 27, 0, buff_from.length);
        buffer.writeUInt16LE(buff_msg.length, 27+buff_from.length);
        buff_msg.copy(buffer, 27+buff_from.length+2, 0, buff_msg.length);

        buffer.writeUInt8(0x00, nxt);
        buffer.writeUInt32BE(0x00000010, nxt+1);
        buffer.writeUInt32BE(0x27000000, nxt+5);
        var buff = compress(buffer, 1);

        packetPublisher.publish('s2c', {hex: hd(buff)});
        client.write(buff);
	}

	client.on('data', function(data) {
		//
	});

	function sendEvent(e, obj) {
		if (packetPublisher) {
		    packetPublisher.publish('event', {e: e, obj: obj});
		}
	}

	function onInit(buff) {
		packetPublisher = new cote.Publisher({
			name: 'Packet Publisher',
			namespace: 'sniffer',
			//key: info.srcAddr +':'+ info.srcPort,
			// environment: 'test',
			broadcasts: ['s2c', 'c2s', 'event']
		});

		cmdResponder = new cote.Responder({
			name: 'Cmd Responder',
			namespace: 'sniffer',
			// key: 'a certain key',
			respondsTo: ['cmd'] // types of requests this responder can respond to.
		});

		cmdResponder.on('cmd', (req, cb) => {
			debug('request', req.cmd);
			switch(req.cmd) {
				case '2c':
					var buff = new Buffer(req.packet, 'hex');
					packetPublisher.publish('s2c', {hex: hd(buff)});
					client.write(buff);
					cb(false, 'done');
				break;

				case 'hide':
					if (gSys.target) {
						csend_hide_object(gSys.target);
						cb(false, 'hided: '+gSys.target.toString(16));
					} else {
						cb('empty_target', 'Need select target');
					}
				break;

				case 'chat':
					csend_chat(req.packet, 0x0A00);
					cb(false, 'OK');
				break;

				case 'ts':
					if (gSys.target) {
						gSys.selected_target = gSys.target;
						cb(false, 'selected: '+gSys.target.toString(16));
					} else {
						cb('empty_target', 'Need select target');
					}
				break;

				// set opcode
				case 'so':
				case 'setopcode':
					var arr = req.packet.split(' ', 2);
					var opcode_name = arr[0];
					var opcode_hex = arr[1];
					if (!opcode_hex || opcode_hex.length != 4) {
						 cb('invalid_opcode', 'opcode length must be 2 byte');
					} else if (opcode.hasOwnProperty(opcode_name)) {
                    	//var buff = new Buffer(opcode_hex, 'hex');
						opcode[opcode_name] = Buffer(opcode_hex, 'hex').readUInt16BE(0);
                    	cb(false, 'opcode.'+opcode_name+' = '+opcode[opcode_name].toString(16));
					} else {
						cb('unknown_opcode_name', opcode_name);
					}
                break;

				case 'go':
					csend_hide_object(gSys.selected_target);

					setTimeout(function() {
						gSys.isGo = true;
					    sendEvent('mode_suspending', 1);
						csend_chat('ОСТАНОВКА!', 0x0A00);
						sendEvent('client_traff_pause', 1);
						client_buffer.pause();
						setTimeout(function() {
							client_buffer.resume();
							sendEvent('client_traff_pause', 0);
							gSys.isGo = false;
							sendEvent('mode_suspending', 0);
						}, 15000);
					}, 5000);

					cb(false, 'OK');
				break;
				
				case 'wait': // активный режим ожидания
					if (gSys.isGo === false) {
						gSys.isGo = true;
						sendEvent('mode_suspending', 1);
					} else {
						gSys.isGo = false;
						sendEvent('mode_suspending', 0);
					}

					cb(false, 'OK');
				break;
				default:
					cb('cmd_not_found', 'fail');
			}
		});
	}

	client.on('close', function() {
		debug(colors.red('End connection'));
		//server.disconnect()
		//client_buffer.cleanup();
		if (cmdResponder) cmdResponder.close();
		if (packetPublisher) packetPublisher.close();
	});

	//debug('Analize');
}

exports.analize = analize;

