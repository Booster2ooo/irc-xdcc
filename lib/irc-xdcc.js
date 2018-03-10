'use strict';
var /* MODULES */
    // load irc module
    irc = require('irc')
    // load net module
  , net = require('net')
    // load file system module
  , fs = require('fs')
    // load path module
  , path = require('path')
    // load package file
  , packageInfo = require('./../package.json')

    /* Misc. utils */
    // store events names strings into a literal object to avoid typo
  , _eventsNames = {
        xdcc_error:             'xdcc-error'
      , xdcc_created:           'xdcc-created'
      , xdcc_started:           'xdcc-started'
      , xdcc_removed:           'xdcc-removed'
      , xdcc_queued:            'xdcc-queued'
      , xdcc_cancel:            'xdcc-cancel'
      , xdcc_kill:              'xdcc-kill'
      , xdcc_complete:          'xdcc-complete'
      , xdcc_canceled:          'xdcc-canceled'
      , xdcc_connect:           'xdcc-connect'
      , xdcc_progress:          'xdcc-progress'
      , xdcc_dlerror:           'xdcc-dlerror'
      , irc_notice:             'notice'
      , irc_error:              'error'
      , irc_quit:               'quit'
      , irc_kill:               'kill'
      , irc_registered:         'registered'
      , irc_join:               'join'
      , irc_connected:          'connected'
      , irc_motd:               'motd'
      , irc_names:              'names'
      , irc_topic:              'topic'
      , irc_part:               'part'
      , irc_kick:               'kick'
      , irc_message:            'message'
      , irc_selfMessage:        'selfMessage'
      , irc_ping:               'ping'
      , irc_pm:                 'pm'
      , irc_ctcp:               'ctcp'
      , irc_ctcp_privmsg:       'ctcp-privmsg'
      , irc_ctcp_version:       'ctcp-version'
      , irc_ctcp_notice:        'ctcp-notice'
      , irc_nick:               'nick'
      , irc_invite:             'invite'
      , irc_mode_add:           '+mode'
      , irc_mode_remove:        '-mode'
      , irc_whois:              'whois'
      , irc_channellist_start:  'channellist_start'
      , irc_channellist_item:   'channellist_item'
      , irc_channellist:        'channellist'
      , irc_raw:                'raw'
      , irc_action:             'action'
      , irc_close:              'close'
      /* not documented? */
      , irc_neterror:           'netError'
      , irc_abort:              'abort'
      , irc_pong:               'pong'
      , irc_opered:             'opered'
      , irc_connect:            'connect'
    }
    // convert integer to IPv4 string
  ,  _int_to_IP = function _int_to_IP(n) {
        var octets = [];
        octets.unshift(n & 255);
        octets.unshift((n >> 8) & 255);
        octets.unshift((n >> 16) & 255);
        octets.unshift((n >> 24) & 255);
        return octets.join('.');
    }
    // regex to parse dcc message
  , _dccParser = /DCC (\w+) "?'?(.+?)'?"? (\d+) (\d+) ?(\d+)?/
    // regex to parse a queue notice
  , _queuedParser = /queue for pack #?(\d+) \("(\.+)"\) in position/
    // regex to parse a send notice
  , _sendParser = /sending( you)?( queued)? pack #?(\d+) \("(.+)"\)/i
    // wrap fs.stat async in promise
  , _statPromise = function _statPromise(filePath) {
        return new Promise(function(resolve, reject) {
            fs.stat(filePath, function(err, stats) {
                if(err) return reject(err);
                resolve(stats);
            });
        });
    }
    // wrap fs.rename async in promise
  , _renamePromise = function _renamePromise(oldPath, newPath) {
        return new Promise(function(resolve, reject) {
            fs.rename(oldPath, newPath, function(err) {
                if(err) return reject(err);
                resolve();
            });
        });
    }
    // wrap fs.unlink async in promise
  , _unlinkPromise = function _unlinkPromise(filePath) {
        return new Promise(function(resolve, reject) {
            fs.unlink(filePath, function(err) {
                if(err) return reject(err);
                resolve();
            });
        });
    }
    
    /* IRC module extension */
  , ircXdcc = function ircXdcc(server, nick, opt) {
        return new Promise(function(moduleResolve, moduleReject) {
            try {
                var // will hold irc Client instance
                    ircClient
                    // defines whenever the client is connected and joined the channels
                  , isConnected = false
                    // bot version infos
                  , versionInfo = packageInfo.name + ' v' + packageInfo.version + ' - a Node.js xdcc client'
                    // array used to store xdcc instances
                  , _xdccPool = []
                    // used to search xdcc instances
                  , _searchPool = function _searchPool(searchModel) {
                        return new Promise(function(resolve, reject) {
                            resolve(_xdccPool.filter(function(xdcc) {
                                var isMatch = true;
                                for(var key in searchModel) {
                                    if(searchModel.hasOwnProperty(key)) {
                                        if (
                                            !xdcc.xdccInfo.hasOwnProperty(key)
                                          || xdcc.xdccInfo[key] !== searchModel[key]
                                        ) {
                                            isMatch = false;
                                        }
                                    }
                                }
                                return isMatch;
                            }));
                        });
                    }
                    // used to remove an xdcc instance from pool
                  , _removePool = function _removePool(index) {
                        return new Promise(function(resolve, reject) {
                            var xdcc = _xdccPool[index];
                            _xdccPool.splice(index, 1);
                            xdcc.xdccInfo.xdccPoolIndex = -1;
                            xdcc.cancel();
                            ircClient.emit(_eventsNames.xdcc_removed, xdcc);
                            Promise
                                .all(_xdccPool.map(function(thisXdcc) {
                                    return thisXdcc.getIndex();
                                }))
                                .then(function() { resolve(); })
                                .catch(function() { reject(); })
                                ;
                        });
                    }

                    /* xdcc promises set */
                    // parse incoming dcc message
                  , _parseDccMessage = function _parseDccMessage(xdcc) {
                        return new Promise(function(resolve, reject) {
                            if (xdcc.xdccInfo.target !== ircClient.nick || !xdcc.xdccInfo.message || xdcc.xdccInfo.message.substr(0, 4) !== 'DCC ') {
                                xdcc.xdccInfo.error = 'no dcc message';
                                return reject(xdcc);
                            }
                            xdcc.xdccInfo.params = xdcc.xdccInfo.message.match(_dccParser);
                            if (!xdcc.xdccInfo.params || !xdcc.xdccInfo.params.length) {
                                xdcc.xdccInfo.error = 'unable to parse dcc message';
                                return reject(xdcc);
                            }
                            _searchPool({
                                    botNick: xdcc.xdccInfo.sender
                                  , fileName: xdcc.xdccInfo.params[2]
                                })
                                .then(function(xdccs) {
                                    if(!xdccs.length) {
                                        if(!opt.acceptUnpooled) {
                                            xdcc.xdccInfo.botNick = xdcc.xdccInfo.sender;
                                            xdcc.xdccInfo.error = 'not found in pool';
                                            return reject(xdcc);
                                        }
                                        else {
                                            xdcc.xdccInfo.botNick = xdcc.xdccInfo.sender;
                                            xdcc.xdccInfo.packId = -1;
                                            _xdccFactory(xdcc.xdccInfo)
                                                .then(function(xdccInstance) {
                                                    resolve(xdccInstance);
                                                })
                                                .catch(function(err) {
                                                    xdcc.xdccInfo.error = err;
                                                    reject(xdcc);
                                                });
                                        }
                                    }
                                    else {
                                        xdccs[0].xdccInfo.sender = xdcc.xdccInfo.sender;
                                        xdccs[0].xdccInfo.target = xdcc.xdccInfo.target;
                                        xdccs[0].xdccInfo.message = xdcc.xdccInfo.message;
                                        xdccs[0].xdccInfo.params = xdcc.xdccInfo.params;
                                        if(xdccs[0].finished) {
                                            xdccs[0].xdccInfo.error = 'download already finished';
                                            return reject(xdccs[0]);
                                        }
                                        return resolve(xdccs[0]);
                                    }
                                })
                                .catch(function (err) {
                                    xdcc.xdccInfo.error = err;
                                    reject(xdcc);
                                });
                        });
                    }
                    // bind parsed dcc message to xdccInfo
                  , _bindDccParams = function _bindDccParams(xdcc) {
                        return new Promise(function(resolve, reject) {
                            xdcc.xdccInfo.command = xdcc.xdccInfo.params[1].toUpperCase();
                            if(xdcc.xdccInfo.command == 'SEND') {
                                var sep = path.sep.replace('\\\\','\\');
                                // bind params
                                xdcc.xdccInfo.started = true;
                                xdcc.xdccInfo.queued = false;
                                xdcc.xdccInfo.fileName = xdcc.xdccInfo.params[2];
                                xdcc.xdccInfo.ip = _int_to_IP(parseInt(xdcc.xdccInfo.params[3], 10));
                                xdcc.xdccInfo.port = parseInt(xdcc.xdccInfo.params[4], 10);
                                xdcc.xdccInfo.fileSize = parseInt(xdcc.xdccInfo.params[5], 10);
                                xdcc.xdccInfo.location =
                                    opt.destPath
                                    + (opt.destPath.substr(-1,1) == sep ? '' : sep)
                                    + xdcc.xdccInfo.fileName;
                            }
                            return resolve(xdcc);
                        });
                    }
                    // check the received dcc command
                  , _checkCommand = function _checkCommand(xdcc) {
                        return new Promise(function(resolve, reject) {
                            if(xdcc.xdccInfo.command == 'SEND') {
                                _checkSend(xdcc)
                                    .then(function(xdcc) {
                                        resolve(xdcc);
                                    })
                                    .catch(function(err){
                                        err && !xdcc.xdccInfo.error && (xdcc.xdccInfo.error = err);
                                        reject(xdcc);
                                    });
                            }
                            else if(xdcc.xdccInfo.command == 'ACCEPT') {
                                _checkAccept(xdcc)
                                    .then(function(xdcc) {
                                        resolve(xdcc);
                                    })
                                    .catch(function(err){
                                        err && !xdcc.xdccInfo.error && (xdcc.xdccInfo.error = err);
                                        reject(xdcc);
                                    });
                            }
                            else {
                                reject(xdcc);
                            }
                        });
                    }
                    // process SEND command
                  , _checkSend = function _checkSend(xdcc) {
                        return new Promise(function(resolve, reject) {
                            _destinationFree(xdcc)
                                .then(_partialDestinationFree)
                                .then(function() { return resolve(xdcc); })
                                .catch(function(err) {
                                    return reject(err);
                                })
                            ;
                        });
                    }
                    // verifies if destination file exists
                  , _destinationFree = function _destinationFree(xdcc) {
                        return new Promise(function(resolve, reject) {
                            _statPromise(xdcc.xdccInfo.location)
                                .then(function(stats) {
                                    // file exists & have the same size
                                    if(stats.isFile() && stats.size == xdcc.xdccInfo.fileSize) {
                                        xdcc.xdccInfo.error = 'file already exists with same size';
                                        // it has already been _downloaded
                                        return reject(xdcc);
                                    }
                                    else {
                                        // the size is not the same... ? -> continue, check for partial file
                                        return resolve(xdcc);
                                    }
                                })
                                .catch(function(err) {
                                    return resolve(xdcc);
                                });
                        });
                    }
                    // verifies if partial file (before _download is completed) exists
                  , _partialDestinationFree = function _partialDestinationFree(xdcc) {
                        return new Promise(function(resolve, reject) {
                            _statPromise(xdcc.xdccInfo.location + '.part')
                                .then(function(stats) {
                                    // file exists and have the same size
                                    if(stats.size == xdcc.xdccInfo.fileSize) {
                                        // rename and reject
                                        _renamePromise(xdcc.xdccInfo.location + '.part', xdcc.xdccInfo.location)
                                            .then(function() {
                                                xdcc.xdccInfo.error = 'file already exists with same size';
                                                reject();
                                            });
                                    }
                                    else if(stats.size == 0) {
                                        // file doesn't exist
                                        return resolve(xdcc);
                                    }
                                    // file exists with a different size
                                    else {
                                        // resume mode
                                        if(opt.resume) {
                                            // set position
                                            xdcc.xdccInfo.resumePos = stats.size;
                                            // send resume command
                                            ircClient.ctcp(xdcc.xdccInfo.botNick, 'privmsg',
                                                'DCC RESUME '
                                                + xdcc.xdccInfo.fileName
                                                + ' ' + xdcc.xdccInfo.port
                                                + ' ' + xdcc.xdccInfo.resumePos
                                            );
                                            //reject(xdcc);
                                            reject();
                                        }
                                        // no resume
                                        else {
                                            // delete file and _download again
                                            _unlinkPromise(xdcc.xdccInfo.location + '.part')
                                                .then(function() {
                                                    resolve(xdcc);
                                                });
                                        }
                                    }
                                })
                                .catch(function(err) {
                                    // file doesn't exist
                                    return resolve(xdcc);
                                });
                        });
                    }
                    // process ACCEPT command
                  , _checkAccept = function _checkAccept(xdcc) {
                        return new Promise(function(resolve, reject) {
                            if(xdcc.xdccInfo.error || !xdcc.xdccInfo.params || !xdcc.xdccInfo.params.length || xdcc.xdccInfo.command != 'ACCEPT') {
                                !xdcc.xdccInfo.error && (xdcc.xdccInfo.error = 'neither send nor accept command found');
                                return reject();
                            }
                            // check params
                            if(
                                xdcc.xdccInfo.fileName != xdcc.xdccInfo.params[2]
                             || xdcc.xdccInfo.port != parseInt(xdcc.xdccInfo.params[3], 10)
                             || xdcc.xdccInfo.resumePos != parseInt(xdcc.xdccInfo.params[4], 10)
                            ) {
                                xdcc.xdccInfo.error = 'parameters don\'t match xdcc info';
                                return reject();
                            }
                            return resolve(xdcc);
                        });
                    }
                    // file download process
                  , _download = function _download(xdcc) {
                        return new Promise(function(resolve, reject) {
                            if(xdcc.xdccInfo.finished || xdcc.xdccInfo.canceled) {
                                xdcc.xdccInfo.error = 'transfer aborted: pack finished or canceled';
                                return reject(xdcc);
                            }
                            var writeStream = fs.createWriteStream(xdcc.xdccInfo.location + '.part', { flags: 'a' })
                              , received = xdcc.xdccInfo.resumePos
                              , ack = xdcc.xdccInfo.resumePos
                              , send_buffer = new Buffer(4)
                              , socket
                                // irc client handlers
                              , ircHandlers = {
                                    disconnected: function disconnected(nick, reason, channels, message) {
                                        if(nick == ircClient.nick) {
                                            writeStream.end();
                                            socket && socket.destroy();
                                            xdcc.xdccInfo.error = 'irc client disconnected';
                                            reject(xdcc);
                                        }
                                    }
                                }
                                // socket handlers
                              , socketHandlers = {
                                    connect: function connect() {
                                        xdcc.xdccInfo.intervalId = setInterval(function() {
                                            ircClient.emit(_eventsNames.xdcc_progress, xdcc, received);
                                        }, opt.progressInterval*1000);
                                        xdcc.xdccInfo.startedAt = process.hrtime();
                                        ircClient.emit(_eventsNames.xdcc_connect, xdcc);
                                    }
                                    , data: function data(data) {
										var totalReceived = received + data.length
										  , progress = totalReceived - xdcc.xdccInfo.resumePos
										  , timeDelta = process.hrtime(xdcc.xdccInfo.startedAt)
										  , secondsDelta = (timeDelta[0] * 1e9 + timeDelta[1]) / 1e9
										  , percents = totalReceived / xdcc.xdccInfo.fileSize * 100
										  , speed = progress / secondsDelta
										  ;
										received = totalReceived;
										xdcc.xdccInfo.received = received;
										xdcc.xdccInfo.progress = percents;
										xdcc.xdccInfo.speed = speed;
                                        //support for large files
                                        ack += data.length;
                                        while (ack > 0xFFFFFFFF) {
                                            ack -= 0xFFFFFFFF;
                                        }
                                        send_buffer.writeUInt32BE(ack, 0);
                                        socket.write(send_buffer);
                                        writeStream.write(data);
                                    }
                                    , end: function end() {
										var duration = xdcc.xdccInfo.startedAt ? process.hrtime(xdcc.xdccInfo.startedAt) : 0
										  , secondsDelta = (duration[0] * 1e9 + duration[1]) / 1e9
										  , speed = xdcc.xdccInfo.fileSize / secondsDelta
										  ;
                                        xdcc.xdccInfo.duration = duration;
                                        xdcc.xdccInfo.speed = speed;
                                        if(opt.closeConnectionOnDisconnect) {
                                            ircClient.removeListener(_eventsNames.irc_quit, ircHandlers.disconnected);
                                            ircClient.removeListener(_eventsNames.irc_kill, ircHandlers.disconnected);
                                        }
                                        writeStream.end();
                                        socket.destroy();
                                        // Connection closed
                                        if (received == xdcc.xdccInfo.fileSize) {// download complete
                                            _renamePromise(xdcc.xdccInfo.location + '.part', xdcc.xdccInfo.location)
                                                .then(function() {
                                                    resolve(xdcc);
                                                })
                                                .catch(function(err) {
                                                    xdcc.xdccInfo.error = err;
                                                    reject(xdcc);
                                                });
                                        } else if (received != xdcc.xdccInfo.fileSize && !xdcc.xdccInfo.finished) {// download incomplete
                                            xdcc.xdccInfo.error = 'server unexpected closed connection';
                                            ircClient.emit(_eventsNames.xdcc_dlerror, xdcc);
                                            reject(xdcc);
                                        } else if (received != xdcc.xdccInfo.fileSize && xdcc.xdccInfo.finished) {// download aborted
                                            xdcc.xdccInfo.error = 'server closed connection, download canceled';
                                            ircClient.emit(_eventsNames.xdcc_dlerror, xdcc);
                                            reject(xdcc);
                                        }
                                    }
                                    , error: function error(err) {
										xdcc.xdccInfo.duration = xdcc.xdccInfo.startedAt ? process.hrtime(xdcc.xdccInfo.startedAt) : 0;
                                        if(opt.closeConnectionOnDisconnect) {
                                            ircClient.removeListener(_eventsNames.irc_quit, ircHandlers.disconnected);
                                            ircClient.removeListener(_eventsNames.irc_kill, ircHandlers.disconnected);
                                        }
                                        // Close writeStream
                                        writeStream.end();
                                        xdcc.xdccInfo.error = err;
                                        // Send error message
                                        ircClient.emit(_eventsNames.xdcc_dlerror, xdcc);
                                        // Destroy the connection
                                        socket.destroy();
                                        reject(xdcc);
                                    }
                                }
                                // steam handlers
                              , streamHandlers = {
                                    open: function open() {
                                        socket = net.createConnection(
                                            xdcc.xdccInfo.port
                                          , xdcc.xdccInfo.ip
                                          , socketHandlers.connect
                                        );
                                        socket.on('data', socketHandlers.data);
                                        socket.on('end', socketHandlers.end);
                                        socket.on('error', socketHandlers.error);
                                    }
                                  , error: function error(err) {
                                        if(opt.closeConnectionOnDisconnect) {
                                            ircClient.removeListener(_eventsNames.irc_quit, ircHandlers.disconnected);
                                            ircClient.removeListener(_eventsNames.irc_kill, ircHandlers.disconnected);
                                        }
                                        writeStream.end();
                                        socket && socket.destroy();
                                        xdcc.xdccInfo.error = err;
                                        ircClient.emit(_eventsNames.xdcc_dlerror, xdcc);
                                        reject(xdcc);
                                    }

                                }
                                ;
                            writeStream.on('open', streamHandlers.open);
                            writeStream.on('error', streamHandlers.error);
                            if(opt.closeConnectionOnDisconnect) {
                                ircClient.on('quit', ircHandlers.disconnected);
                                ircClient.on('kill', ircHandlers.disconnected);
                            }
                        });
                    }
                    // xdcc completed
                  , _setRequestCompleted = function _setRequestCompleted(xdcc) {
                        return new Promise(function(resolve, reject) {
                            xdcc.xdccInfo.finished = true;
                            if(xdcc.xdccInfo.intervalId){
                                clearInterval(xdcc.xdccInfo.intervalId);
                                xdcc.xdccInfo.intervalId = null;
                            }
                            ircClient.emit(_eventsNames.xdcc_complete, xdcc);
                            return resolve(xdcc);
                        });
                    }
                    // xdcc cancel or something went wrong
                  , _killRequest = function _killRequest(xdcc) {
                        return new Promise(function(resolve, reject) {
                            if(xdcc.xdccInfo) {
                                if(xdcc.xdccInfo.error == 'no dcc message') {
                                    return reject(xdcc);
                                }
                                if(xdcc.xdccInfo.resumePos && xdcc.xdccInfo.command == 'SEND') {
                                    // waiting for ACCEPT command, do not cancel XDCC
                                    return resolve(xdcc);
                                }
                                if(!xdcc.xdccInfo.finished && !xdcc.xdccInfo.canceled) {
                                    !xdcc.xdccInfo.queued ?
                                        ircClient[opt.method](xdcc.xdccInfo.botNick, opt.cancelCommand)
                                      : ircClient[opt.method](xdcc.xdccInfo.botNick, opt.removeCommand + ' '+ xdcc.xdccInfo.packId)
                                    ;
                                    xdcc.xdccInfo.canceled = true;
                                    if(xdcc.xdccInfo.intervalId){
                                        clearInterval(xdcc.xdccInfo.intervalId);
                                        xdcc.xdccInfo.intervalId = null;
                                    }
                                }
                            }
                            ircClient.emit(_eventsNames.xdcc_canceled, xdcc);
                            return reject(xdcc);
                        });
                    }

                    // event handlers
                  , handlers = {
                        // ctcp privmsg -> dcc
                        ctcp: function ctcp(from, to, text, message) {
                            var xdcc = {
                                xdccInfo: {
                                    sender: from
                                  , target: to
                                  , message: text
                                }
                            };
                            // set a little delay fo the notice to be treated and file name associated
                            setTimeout(function() {
                                _parseDccMessage(xdcc)
                                    .then(_bindDccParams)
                                    .then(_checkCommand)
                                    .then(_download)
                                    .then(_setRequestCompleted)
                                    .catch(_killRequest)
                                    .then()
                                    .catch(function(err) {
                                        ircClient.emit(_eventsNames.irc_error, err);
                                    })
                                ;
                            }, 1000);
                        }
                        // notices -> get file name
                      , notice: function notice(from,to,text,message) {
                            if(to == ircClient.nick && from) {
                                var queuedMessage = text.match(opt.queuedParser)
                                  , sendMessage = text.match(opt.sendParser)
                                  , options
                                  , fileName
                                  ;
                                if(queuedMessage || sendMessage) {
                                    options = {
                                        botNick: from
                                      , packId: queuedMessage ? parseInt(queuedMessage[1], 10) : parseInt(sendMessage[3], 10)
                                    };
                                    fileName = (queuedMessage ? queuedMessage[2] : sendMessage[4]).replace(/\s/g,'_');
                                    _searchPool(options)
                                        .then(function(xdccs) {
                                            xdccs.forEach(function(xdcc) {
                                                xdcc.xdccInfo.fileName = fileName;
                                                if(queuedMessage != null) {
                                                    xdcc.xdccInfo.queued = true;
                                                    ircClient.emit(_eventsNames.xdcc_queued, xdcc);
                                                }
                                            });
                                        });
                                }
                            }
                        }
                        // reply ctcp version
                      , version: function version(from, to, message) {
                            ircClient.ctcp(from, 'normal', 'VERSION ' + versionInfo);
                        }
                      , registered: function registered(message) {
                            Promise
                                .all(opt.channels.map(function(chan) {
                                    return new Promise(function(resolve, reject) {
                                        ircClient.on(_eventsNames.irc_join+chan.toLowerCase(),function (nick, message) {
                                            if(nick == ircClient.nick) {
                                                resolve(chan);
                                            }
                                        });
                                    });
                                }))
                                .then(function(channels) {
                                    isConnected = true;
                                    ircClient.emit(_eventsNames.irc_connected, channels);
                                    opt.channels.forEach(function(chan) {
                                        ircClient.removeAllListeners(_eventsNames.irc_join+chan);
                                    });
                                    return _searchPool({ started: false });
                                })
                                .then(function(xdccInstances) {
                                    return Promise.all(xdccInstances.map(function(xdccInstance) {
                                        return xdccInstance.start();
                                    }));
                                })
                                .then(function(xdccInstances) {
                                    //console.log(xdccInstances.length + ' xdcc instances started');
                                })
                                .catch(function(err) {
                                    ircClient.emit(_eventsNames.irc_error, err);
                                });
                        }
                      , disconnected: function disconnected(nick, reason, channels, message) {
                            if (nick == ircClient.nick) {
                                isConnected = false;
                            }
                        }
                      , topic: function topic(channel, topic, nick, message) {
                            var topicParts = topic.split(' ')
                              , topicChans = topicParts.filter(function(part) {
                                    return part[0]=='#';
                                })
                              ;
                            topicChans.forEach(function(chan) {
                                ircClient.join(chan);
                            });
                        }
                    }

                    // xdcc object
                  , _xdccFactory = function _xdccFactory(packInfo) {
                        return new Promise(function(resolve, reject) {
                            try {
                                var // instance infos
                                    xdccInfo = {
                                        botNick: packInfo.botNick
                                      , packId: packInfo.packId
									  , server: server
                                      , started: false
                                      , queued: false
                                      , finished: false
                                      , canceled: false
                                      , xdccPoolIndex: -1
                                      , resumePos: 0
									  , received: 0
									  , progress: 0
									  , speed: 0
                                      , startedAt: null
                                      , duration: null
                                      , intervalId: null
                                      , fileName: null
                                      , command: null
                                      , ip: null
                                      , port: null
                                      , fileSize: null
                                      , location: null
                                      , sender: packInfo.sender || null
                                      , target: packInfo.target || null
                                      , message: packInfo.message || null
                                      , params: packInfo.params || []
                                      , error: packInfo.error || null
                                    }
                                  , instance = {
                                        start: function start() {
                                            return new Promise(function(resolve, reject) {
                                                if(isConnected) {
                                                    ircClient[opt.method](xdccInfo.botNick, opt.sendCommand + ' ' + xdccInfo.packId);
                                                    ircClient.emit(_eventsNames.xdcc_started, instance);
                                                }
                                                resolve(instance);
                                            });
                                        }
                                      , cancel: function cancel() {
                                            return new Promise(function(resolve, reject) {
                                                if (xdccInfo.finished) {
                                                    resolve(instance);
                                                    return;
                                                }
                                                _killRequest(instance)
                                                    .then(function() { resolve(); })
                                                    .catch(function() { resolve(); });
                                            });
                                        }
                                      , reset: function reset() {
                                            return new Promise(function(resolve, reject) {
                                                xdccInfo.started = false;
                                                xdccInfo.queued = false;
                                                xdccInfo.finished = false;
                                                xdccInfo.canceled = false;
                                                xdccInfo.resumePos = 0;
                                                xdccInfo.received = 0;
                                                xdccInfo.progress = 0;
                                                xdccInfo.speed = 0;
                                                xdccInfo.startedAt  = null;
                                                xdccInfo.duration = null;
                                                xdccInfo.fileName = null;
                                                xdccInfo.command = null;
                                                xdccInfo.ip = null;
                                                xdccInfo.port = null;
                                                xdccInfo.fileSize = null;
                                                xdccInfo.location = null;
                                                xdccInfo.intervalId = null;
                                                xdccInfo.sender = null;
                                                xdccInfo.target = null;
                                                xdccInfo.message = null;
                                                xdccInfo.params = [];
                                                xdccInfo.error = null;
                                                return resolve();
                                            });
                                        }
                                      , restart: function restart() {
                                            return new Promise(function(resolve, reject) {
                                                instance.cancel()
                                                    .then(instance.reset)
                                                    .then(instance.start)
                                                    .then(function() {
                                                        resolve(instance);
                                                    })
                                                    .catch(function(err) {
                                                        reject(err);
                                                    });
                                            })
                                        }
                                      , getIndex: function getIndex() {
                                            return new Promise(function(resolve, reject) {
                                                xdccInfo.xdccPoolIndex = _xdccPool.indexOf(instance);
                                                return resolve(xdccInfo.xdccPoolIndex);
                                            });
                                        }

                                      , xdccInfo: xdccInfo
                                    }
                                  ;
                                // add instance to the pool
                                _xdccPool.push(instance);
                                // refresh poolIndex
                                instance.getIndex().then();
                                ircClient.emit(_eventsNames.xdcc_created, instance);
                                return resolve(instance);
                            }
                            catch (ex) {
                                ircClient.emit(_eventsNames.irc_error, err);
                                reject(ex);
                            }
                        });
                    }
                  ;

                // assigning default values
                // assign a value to opt.progressInterval if it's undefined
                opt.progressInterval = opt.progressInterval || 1;
                // assign a value to opt.destPath if it's undefined
                opt.destPath = opt.destPath || path.join(__dirname, 'downloads');
                // create destination directory
                fs.mkdir(opt.destPath,function() {});
                // assign a value to opt.resume if it's undefined
                if(typeof opt.resume === 'undefined') opt.resume = true;
                // assign a value to opt.acceptUnpooled if it's undefined
                if(typeof opt.acceptUnpooled === 'undefined') opt.acceptUnpooled = false;
                // assign a value to opt.closeConnectionOnDisconnect if it's undefined
                if(typeof opt.closeConnectionOnDisconnect === 'undefined') opt.closeConnectionOnDisconnect = true;
                // assign a value to opt.joinTopicChans if it's undefined
                if(typeof opt.joinTopicChans === 'undefined') opt.joinTopicChans = true;
                // assign a value to opt.method
                switch (opt.method) {
                    case 'say':
                    case 'msg':
                        opt.method = 'say';
                        break;
                    case 'ctcp':
                        opt.method = 'ctcp';
                        break;
                    default:
                        opt.method = 'say';
                        break;
                }
                // assign a value to opt.sendCommand
                opt.sendCommand = opt.sendCommand || 'XDCC SEND';
                // assign a value to opt.cancelCommand
                opt.cancelCommand = opt.cancelCommand || 'XDCC CANCEL';
                // assign a value to opt.removeCommand
                opt.removeCommand = opt.removeCommand || 'XDCC REMOVE';
                // assign a value to regular expressions
                // regex to parse a queue notice
                opt.queuedParser = opt.queuedParser || _queuedParser;
                // regex to parse a send notice
                opt.sendParser = opt.sendParser || _sendParser;

                // instantiate irc Client
                ircClient = new irc.Client(server, nick, opt);


                ircClient
                    // bind handler to ctcp version events
                    .on(_eventsNames.irc_ctcp_version, handlers.version)
                    // bind handler to ctcp privmsg events
                    .on(_eventsNames.irc_ctcp_privmsg, handlers.ctcp)
                    // bind handler to notice events
                    .on(_eventsNames.irc_notice, handlers.notice)
                    // bind handler to connection event
                    .on(_eventsNames.irc_registered, handlers.registered)
                    // bind handler to disconnection events
                    .on(_eventsNames.irc_quit, handlers.disconnected)
                    .on(_eventsNames.irc_kill, handlers.disconnected)
                ;
                if(opt.joinTopicChans) {
                    ircClient.on(_eventsNames.irc_topic, handlers.topic);
                }

                // add xdcc method to irc object
                ircClient.xdcc = function xdcc(packInfo) {
                    return new Promise(function(resolve, reject) {
                        // checking packInfo
                        if(!packInfo.botNick) {
                            ircClient.emit(_eventsNames.xdcc_error, 'botNick not provided');
                            return reject({ code: _eventsNames.xdcc_error, message: 'botNick not provided'});
                        }
                        if(!packInfo.packId) {
                            ircClient.emit(_eventsNames.xdcc_error, 'packId not provided');
                            return reject({ code: _eventsNames.xdcc_error, message: 'packId not provided'});
                        }
                        packInfo.packId = parseInt(packInfo.packId, 10);
                        _searchPool(packInfo)
                            .then(function(xdccs) {
                                if(xdccs.length) {
                                    ircClient.emit(_eventsNames.xdcc_error, 'required pack already in pool', xdccs[0]);
                                    return reject({ code: _eventsNames.xdcc_error, message: 'required pack already in pool'});
                                }
                                else {
                                    // build new xdcc instance
                                    _xdccFactory(packInfo)
                                        .then(function(xdccInstance) {
                                            return xdccInstance.start();
                                        })
                                        // start transfert
                                        .then(function(xdccInstance) {
                                            return resolve(xdccInstance);
                                        })
                                        .catch(function(err) {
                                            reject(err);
                                        });
                                }
                            })
							.catch(function(err) {
                                reject(err);
							}) ;
                    });
                };

                // add cancelXdcc method to irc object
                ircClient.cancelXdcc = function cancelXdcc(xdcc) {
                    return new Promise(function(resolve, reject) {
                        if(xdcc.cancel) {
                            xdcc.cancel().then(function () {
                                resolve();
                            });
                        }
                        else {
                            reject('invalid xdcc object');
                        }
                    });
                };

                // add cancelPackInfo method to irc object
                ircClient.cancelPackInfo = function cancelPackInfo(packInfo) {
                    return new Promise(function(resolve, reject) {
                        // checking packInfo
                        if(!packInfo.botNick) {
                            ircClient.emit(_eventsNames.xdcc_error, 'botNick not provided');
                            return reject({ code: _eventsNames.xdcc_error, message: 'botNick not provided'});
                        }
                        if(!packInfo.packId) {
                            ircClient.emit(_eventsNames.xdcc_error, 'packId not provided');
                            return reject({ code: _eventsNames.xdcc_error, message: 'packId not provided'});
                        }
                        packInfo.packId = parseInt(packInfo.packId, 10);
                        _searchPool(packInfo)
                            .then(function(xdccs) {
                                return Promise.all(xdccs.map(function(xdcc) {
                                    return xdcc.cancel();
                                }));
                            })
                            .then(function() {
                                resolve();
                            })
                            .catch(function() {
                                reject();
                            });
                    });
                };

                // add cancelPoolId method to irc object
                ircClient.cancelPoolId = function cancelPoolId(poolId) {
                    return new Promise(function(resolve, reject) {
                        var xdcc = _xdccPool[poolId];
                        if(xdcc) {
                            xdcc.cancel().then(function () {
                                resolve();
                            });
                        }
                        else {
                            reject('invalid pool Id');
                        }
                    });
                };

                // return xdccPool
                ircClient.getXdccPool = function getXdccPool() {
                    return new Promise(function(resolve, reject) {
                        resolve(_xdccPool);
                    });
                };

                // remove xdcc from pool
                ircClient.removeXdcc = function removeXdcc(xdcc) {
                    return new Promise(function(resolve, reject) {
                        xdcc.getIndex()
                            .then(_removePool)
                            .then(function() {
                                resolve();
                            })
                            .catch(function(err) {
                                reject(err);
                            });
                    });
                };

                // remove indexed instance from pool
                ircClient.removePoolId = function removePoolId(poolId) {
                    return new Promise(function(resolve, reject) {
                        poolId = parseInt(poolId, 10);
                        _removePool(poolId)
                            .then(function() {
                                resolve();
                            })
                            .catch(function(err) {
                                reject(err);
                            });
                    });
                };

                // extend disconnect method to emit quit event manually ( https://github.com/martynsmith/node-irc/issues/441 )
                ircClient.disconnect = function disconnect(message, callback) {
                    message = message || versionInfo;
                    ircClient.emit(_eventsNames.irc_quit, ircClient.nick, message, Object.keys(ircClient.chans), null);
                    irc.Client.prototype.disconnect.call(ircClient, message, callback);
                };

                // expose events names
                ircClient.eventNames = _eventsNames;

                // expose isConnected property
                ircClient.isConnected = isConnected;

                return moduleResolve(ircClient);
            }
            catch(ex) {
                return moduleReject(ex);
            }
        });
    }
  ;

module.exports = ircXdcc;
