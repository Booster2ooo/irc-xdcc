var /* MODULES */
    // load irc module
    irc = require('irc')
    // load net module
  , net = require('net')
    // load file system module
  , fs = require('fs')
    // load path module
  , path = require('path')

    /* Misc. utils */
    // store events names strings into a literal object to avoid typo
  , _eventsNames = {
        xdcc_error:             'xdcc-error'
      , xdcc_cancel:            'xdcc-cancel'
      , xdcc_kill:              'xdcc-kill'
      , xdcc_complete:          'xdcc-complete'
      , xdcc_canceled:          'xdcc-canceled'
      , xdcc_connect:           'xdcc-connect'
      , xdcc_progress:          'xdcc-progress'
      , xdcc_dlerror:           'xdcc-dlerror'
      , irc_ctcp_privmsg:       'ctcp-privmsg'
      , irc_notice:             'notice'
      , irc_error:              'error'
    }
    // convert integer to IPv4 string
  ,  _int_to_IP = function _int_to_IP(n) {
        var octets = [];
        octets.unshift(n & 255);
        octets.unshift((n >> 8) & 255);
        octets.unshift((n >> 16) & 255);
        octets.unshift((n >> 24) & 255);
        return octets.join(".");
    }
    // regex to parse dcc message
  , _dccParser = /DCC (\w+) "?'?(.+?)'?"? (\d+) (\d+) ?(\d+)?/
    // regex to parse a queue notice
  , _queuedParser = /queue for pack (\d+) \("(\.+)"\) in position/
    // regex to parse a send notice
  , _sendParser = /sending you( queued)? pack #?(\d+) \("(.+)"\)/i
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
            var // will hold irc Client instance
                ircClient
                // array used to store xdcc instances
              , _xdccPool = []
                // used to seach xdcc instances
              , _searchPool = function _searchPool(searchModel) {
                    return new Promise(function(resolve, reject) {
                        var results = [];
                        _xdccPool.forEach(function(xdcc) {
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
                            isMatch && results.push(xdcc);
                        });
                        resolve(results);
                    });
                }

                /* xdcc promises set */
                // parse incoming dcc message
              , _parseDccMessage = function _parseDccMessage(packet) {
                    return new Promise(function(resolve, reject) {
                        if (packet.target !== ircClient.nick || !packet.message || packet.message.substr(0, 4) !== "DCC ") {
                            packet.error = "no dcc message";
                            return reject(packet);
                        }
                        packet.params = packet.message.match(_dccParser);
                        if (!packet.params || !packet.params.length) {
                            packet.error = "unable to parse dcc message";
                            return reject(packet);
                        }
                        _searchPool({
                            botNick: packet.sender
                          , fileName: packet.params[2]
                        }).then(function(xdccs) {
                            if(!xdccs.length) {
                                if(!opt.acceptUnpooled) {
                                    packet.xdccInfo = { botNick: packet.sender };
                                    packet.error = "not found in pool";
                                    return reject(packet);
                                }
                                else {
                                    var xdcc = _xdccFactory({ botNick: packet.sender, packId: -1 });
                                    packet.xdccInfo = xdcc.xdccInfo;
                                    return resolve(packet);
                                }
                            }
                            else if(xdccs[0].finished) {
                                packet.error = "_download already finished";
                                return reject(packet);
                            }
                            packet.xdccInfo = xdccs[0].xdccInfo;
                            return resolve(packet);
                        });
                    });
                }
                // bind parsed dcc message to xdccInfo
              , _bindDccParams = function _bindDccParams(packet) {
                    return new Promise(function(resolve, reject) {
                        packet.xdccInfo.command = packet.params[1];
                        if(packet.xdccInfo.command == 'SEND') {
                            var sep = path.sep.replace('\\\\','\\');
                            // bind params
                            packet.xdccInfo.started = true;
                            packet.xdccInfo.queued = false;
                            packet.xdccInfo.fileName = packet.params[2];
                            packet.xdccInfo.ip = _int_to_IP(parseInt(packet.params[3], 10));
                            packet.xdccInfo.port = parseInt(packet.params[4], 10);
                            packet.xdccInfo.fileSize = parseInt(packet.params[5], 10);
                            packet.xdccInfo.location =
                                opt.destPath
                                + (opt.destPath.substr(-1,1) == sep ? '' : sep)
                                + packet.xdccInfo.fileName;
                            return resolve(packet);
                        }
                        return reject(packet);
                    });
                }
                // process SEND command
              , _checkSend = function setDccInfo(packet) {
                    return new Promise(function(resolve, reject) {
                        _destinationFree(packet)
                            .then(_partialDestinationFree)
                            .then(function() { return resolve(packet); })
                            .catch(function() { return reject(packet); })
                        ;
                    });
                }
                // verifies if destination file exists
              , _destinationFree = function _destinationFree(packet) {
                    return new Promise(function(resolve, reject) {
                        _statPromise(packet.xdccInfo.location)
                            .then(function(stats) {
                                // file exists & have the same size
                                if(stats.isFile() && stats.size == packet.xdccInfo.fileSize) {
                                    packet.error = "file already exists with same size";
                                    // it has already been _downloaded
                                    return reject(packet);
                                }
                                else {
                                    // the size is not the same... ? -> continue, check for partial file
                                    return resolve(packet);
                                }
                            })
                            .catch(function(err) {
                                return resolve(packet);
                            });
                    });
                }
                // verifies if partial file (beofore _download is completed) exists
              , _partialDestinationFree = function _partialDestinationFree(packet) {
                    return new Promise(function(resolve, reject) {
                        _statPromise(packet.xdccInfo.location + '.part')
                            .then(function(stats) {
                                // file exists and have the same size
                                if(stats.size == packet.xdccInfo.fileSize) {
                                    // rename and reject
                                    _renamePromise(packet.xdccInfo.location + '.part', packet.xdccInfo.location)
                                        .then(function() {
                                            packet.error = "file already exists with same size";
                                            reject(packet);
                                        });
                                }
                                else if(stats.size == 0) {
                                    // file doesn't exist
                                    return resolve(packet);
                                }
                                // file exists with a different size
                                else {
                                    // resume mode
                                    if(opt.resume) {
                                        // set position
                                        packet.xdccInfo.resumePos = stats.size;
                                        // send resume command
                                        ircClient.ctcp(packet.xdccInfo.botNick, 'privmsg',
                                            'DCC RESUME '
                                            + packet.xdccInfo.fileName
                                            + ' ' + packet.xdccInfo.port
                                            + ' ' + packet.xdccInfo.resumePos
                                        );
                                        reject(packet);
                                    }
                                    // no resume
                                    else {
                                        // delete file and _download again
                                        _unlinkPromise(packet.xdccInfo.location + '.part')
                                            .then(function() {
                                                resolve(packet);
                                            });
                                    }
                                }
                            })
                            .catch(function(err) {
                                // file doesn't exist
                                return resolve(packet);
                            });
                    });
                }
                // process ACCEPT command
              , _checkAccept = function _checkAccept(packet) {
                    return new Promise(function(resolve, reject) {
                        if(packet.error || !packet.params || !packet.params.length || packet.xdccInfo.command != "ACCEPT") {
                            !packet.error && (packet.error = "neither send nor accept command found");
                            return reject(packet);
                        }
                        // check params
                        if(
                            packet.xdccInfo.fileName != packet.params[2]
                         || packet.xdccInfo.port != parseInt(packet.params[3], 10)
                         || packet.xdccInfo.resumePos != parseInt(packet.params[4], 10)
                        ) {
                            packet.error = "parameters don't match packet info";
                            return reject(packet);
                        }
                        return resolve(packet);
                    });
                }
                // file download process
              , _download = function _download(packet) {
                    return new Promise(function(resolve, reject) {
                        if(packet.xdccInfo.finished || packet.xdccInfo.canceled) {
                            packet.error = "transfer aborted: pack finished or canceled";
                            return reject(packet);
                        }
                        var writeStream = fs.createWriteStream(packet.xdccInfo.location + '.part', { flag: 'a'})
                          , received = packet.xdccInfo.resumePos
                          , ack = packet.xdccInfo.resumePos
                          , send_buffer = new Buffer(4)
                          , socket
                            // socket handlers
                          , socketHandlers = {
                                connect: function connectHandler() {
                                    packet.xdccInfo.intervalId = setInterval(function() {
                                        ircClient.emit(_eventsNames.xdcc_progress, packet, received);
                                    }, opt.progressInteval*1000);
                                    ircClient.emit(_eventsNames.xdcc_connect, packet);
                                }
                                , data: function data(data) {
                                    received += data.length;
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
                                    writeStream.end();
                                    socket.destroy();
                                    // Connection closed
                                    if (received == packet.xdccInfo.fileSize) {// download complete
                                        _renamePromise(packet.xdccInfo.location + ".part", packet.xdccInfo.location)
                                            .then(function() {
                                                resolve(packet);
                                            });
                                    } else if (received != packet.xdccInfo.fileSize && !packet.xdccInfo.finished) {// download incomplete
                                        packet.error = "server unexpected closed connection";
                                        ircClient.emit(_eventsNames.xdcc_dlerror, packet);
                                        reject(packet);
                                    } else if (received != packet.xdccInfo.fileSize && packet.xdccInfo.finished) {// download aborted
                                        packet.error = "server closed connection, _download canceled";
                                        ircClient.emit(_eventsNames.xdcc_dlerror, packet);
                                        reject(packet);
                                    }
                                }
                                , error: function error(err) {
                                    // Close writeStream
                                    writeStream.end();
                                    packet.error = err;
                                    // Send error message
                                    ircClient.emit(_eventsNames.xdcc_dlerror, packet);
                                    // Destroy the connection
                                    socket.destroy();
                                    reject(packet);
                                }
                            }
                            // steam handlers
                          , streamHandlers = {
                                open: function openHandler() {
                                    socket = net.createConnection(
                                        packet.xdccInfo.port
                                      , packet.xdccInfo.ip
                                      , socketHandlers.connect
                                    );
                                    socket.on('data', socketHandlers.data);
                                    socket.on('end', socketHandlers.end);
                                    socket.on('error', socketHandlers.error);
                                }
                                , error: function errorHandler(err) {
                                    writeStream.end();
                                    socket && socket.destroy();
                                    packet.error = err;
                                    ircClient.emit(_eventsNames.xdcc_dlerror, packet);
                                    reject(packet);
                                }

                            }
                            ;
                        writeStream.on('open', streamHandlers.open);
                        writeStream.on('error', streamHandlers.error);
                    });
                }
                // xdcc completed
              , _setRequestCompleted = function _setRequestCompleted(packet) {
                    return new Promise(function(resolve, reject) {
                        packet.xdccInfo.finished = true;
                        if(packet.xdccInfo.intervalId){
                            clearInterval(packet.xdccInfo.intervalId);
                            packet.xdccInfo.intervalId = null;
                        }
                        ircClient.emit(_eventsNames.xdcc_complete, packet);
                        return resolve(packet);
                    });
                }
                // xdcc cancel or something went wrong
              , _killRequest = function _killRequest(packet) {
                    return new Promise(function(resolve, reject) {
                        if(packet.xdccInfo) {
                            if(!packet.xdccInfo.finished && !packet.xdccInfo.canceled) {
                                !packet.xdccInfo.queued ?
                                    ircClient.say(packet.xdccInfo.botNick, 'XDCC CANCEL')
                                  : ircClient.say(packet.xdccInfo.botNick, 'XDCC REMOVE '+ packet.xdccInfo.packId)
                                ;
                                packet.xdccInfo.canceled = true;
                                if(packet.xdccInfo.intervalId){
                                    clearInterval(packet.xdccInfo.intervalId);
                                    packet.xdccInfo.intervalId = null;
                                }
                            }
                            packet.xdccInfo.error = packet.error;
                        }
                        ircClient.emit(_eventsNames.xdcc_canceled, packet);
                        return reject(packet);
                    });
                }

                // event handlers
              , handlers = {
                    // ctcp privmsg -> dcc
                    ctcp: function ctcp(sender, target, message) {
                        var packet = {
                            sender: sender
                          , target: target
                          , message: message
                          , xdccInfo: null
                          , params: []
                        };
                        // set a little delay fo the notice to be treated and file name associated
                        setTimeout(function() {
                            _parseDccMessage(packet)
                                .then(_bindDccParams)
                                .then(_checkSend)
                                .catch(_checkAccept)
                                .then(_download)
                                .then(_setRequestCompleted)
                                .catch(_killRequest)
                                .then()
                                .catch(function(err) {
                                    console.error(err);
                                    err.stack && console.error(err.stack);
                                })
                            ;
                        }, 1500);
                    }
                    // notices -> get file name
                  , notice: function notice(from,to,text,message) {
                        if(to == ircClient.nick && from) {
                            var queuedMessage = text.match(_queuedParser)
                              , sendMessage = text.match(_sendParser)
                              , options
                              , fileName
                              ;
                            if(queuedMessage || sendMessage) {
                                options = {
                                    botNick: from
                                  , packId: queuedMessage ? parseInt(queuedMessage[1], 10) : parseInt(sendMessage[2], 10)
                                };
                                fileName = (queuedMessage ? queuedMessage[2] : sendMessage[3]).replace(/\s/g,'_');
                                _searchPool(options)
                                    .then(function(xdccs) {
                                        xdccs.forEach(function(xdcc) {
                                            xdcc.xdccInfo.fileName = fileName;
                                            xdcc.xdccInfo.queued = queuedMessage != null;
                                        });
                                    });
                            }
                        }
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
                                  , started: false
                                  , queued: false
                                  , finished: false
                                  , canceled: false
                                  , _xdccPoolId: -1
                                  , resumePos: 0
                                  , intervalId: null
                                  , fileName: null
                                  , command: null
                                  , ip: null
                                  , port: null
                                  , fileSize: null
                                  , location: null
                                  , error: null
                                }
                              , instance = {
                                    start: function start() {
                                        return new Promise(function(resolve, reject) {
                                            ircClient.say(xdccInfo.botNick, 'XDCC SEND ' + xdccInfo.packId);
                                            resolve(instance);
                                        });
                                    }
                                  , cancel: function cancel() {
                                        return new Promise(function(resolve, reject) {
                                            if (xdccInfo.finished) {
                                                resolve(instance);
                                                return;
                                            }
                                            var packet = { xdccInfo: xdccInfo };
                                            _killRequest(packet)
                                                .then(function() { resolve(); })
                                                .catch(function() { resolve(); });
                                        });
                                    }
                                  , getIndex: function getIndex() {
                                        return new Promise(function(resolve, reject) {
                                            xdccInfo._xdccPoolId = _xdccPool.indexOf(instance);
                                            return resolve(xdccInfo._xdccPoolId);
                                        });
                                    }

                                  , xdccInfo: xdccInfo
                                }
                              ;
                            // add instance to the pool
                            _xdccPool.push(instance);
                            // refresh poolIndex
                            instance.getIndex().then();
                            return resolve(instance);
                        }
                        catch (ex) {
                            console.log(ex);
                            console.log(ex.stack);
                            reject(ex);
                        }
                    });
                }
              ;

            // assigning default values
            // assign a value to opt.progressInterval if it's undefined
            opt.progressInteval = opt.progressInteval || 1;
            // assign a value to opt.destPath if it's undefined
            opt.destPath = opt.destPath || path.join(__dirname, '_downloads');
            // assign a value to opt.resume if it's undefined
            if(typeof opt.resume === "undefined") opt.resume = true;
            // assign a value to opt.resume if it's undefined
            if(typeof opt.acceptUnpooled === "undefined") opt.acceptUnpooled = false;
            // check for channels
            // verifying search channels
            if(!opt.searchChannels || !opt.searchChannels.length) {
                return moduleReject({ code: _eventsNames.irc_error, message: "searchChannels not provided"})
            }
            // verifying xdcc channels
            if(!opt.xdccChannels || !opt.xdccChannels.length) {
                return moduleReject({ code: _eventsNames.irc_error, message: "xdccChannels not provided"})
            }
            // concatenate search and xdcc channels in irc channel option
            opt.channels = (opt.channels || []).concat(opt.searchChannels).concat(opt.xdccChannels);

            // instantiate irc Client
            ircClient = new irc.Client(server, nick, opt);

            // bind handler to ctcp events
            ircClient.on(_eventsNames.irc_ctcp_privmsg, handlers.ctcp);
            // bind handler to notice events
            ircClient.on(_eventsNames.irc_notice, handlers.notice);

            // add xdcc method to irc object
            ircClient.xdcc = function xdcc(packInfo) {
                return new Promise(function(resolve, reject) {
                    // checking packInfo
                    if(!packInfo.botNick) {
                        ircClient.emit(_eventsNames.xdcc_error, "botNick not provided");
                        return reject({ code: _eventsNames.xdcc_error, message: "botNick not provided"});
                    }
                    if(!packInfo.packId) {
                        ircClient.emit(_eventsNames.xdcc_error, "packId not provided");
                        return reject({ code: _eventsNames.xdcc_error, message: "packId not provided"});
                    }
                    packInfo.packId = parseInt(packInfo.packId, 10);
                    _searchPool(packInfo)
                        .then(function(xdccs) {
                            if(xdccs.length) {
                                ircClient.emit(_eventsNames.xdcc_error, "required pack already in pool", xdccs[0]);
                                return reject({ code: _eventsNames.xdcc_error, message: "required pack already in pool"});
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
                        });
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
                        reject("invalid xdcc object");
                    }
                });
            };

            // add cancelPackInfo method to irc object
            ircClient.cancelPackInfo = function cancelPackInfo(packInfo) {
                return new Promise(function(resolve, reject) {
                    // checking packInfo
                    if(!packInfo.botNick) {
                        ircClient.emit(_eventsNames.xdcc_error, "botNick not provided");
                        return reject({ code: _eventsNames.xdcc_error, message: "botNick not provided"});
                    }
                    if(!packInfo.packId) {
                        ircClient.emit(_eventsNames.xdcc_error, "packId not provided");
                        return reject({ code: _eventsNames.xdcc_error, message: "packId not provided"});
                    }
                    packInfo.packId = parseInt(packInfo.packId, 10);
                    _searchPool(packInfo)
                        .then(function(xdccs) {
                            var promisePool = [];
                            xdccs.forEach(function(xdcc) {
                                promisePool.push(xdcc.cancel());
                            });
                            Promise.all(promisePool)
                                .then(function() {
                                    resolve();
                                })
                                .catch(function() {
                                    reject();
                                });
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
                        reject("invalid pool Id");
                    }
                });
            };

            // return xdccPool
            ircClient.get_xdccPool = function get_xdccPool() {
                return new Promise(function(resolve, reject) {
                    resolve(_xdccPool);
                });
            };

            return moduleResolve(ircClient);
        });
    }
  ;

module.exports = ircXdcc;