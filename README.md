# irc-xdcc

## Disclamer
This module does not intend to facilitate illegal files transfer. The author may not be taken responsible for any copyright infringement or illegal uses.


## Introduction
irc-xdcc is a [node-irc module](https://github.com/martynsmith/node-irc) promises based extension providing xdcc handlers.

It's basically a recode of Indysama [node-xdcc](https://github.com/Indysama/node-xdcc) / DaVarga [node-axdcc](https://github.com/DaVarga/node-axdcc/).


## Options
irc-xdcc provide a promise wrapper for the irc module. It extends the [available options](https://node-irc.readthedocs.org/en/latest/API.html#client) with the following:

```javascript
{
    progressInterval: 1 // [Number(int)] Interval (in seconds) for the progress update event (xdcc-progress) -- Default: 1
  , destPath: '/path/to/destination' // [String] The destination path for downloads -- Default: module lib path + /downloads -> path.join(__dirname, 'downloads')
  , resume: true // [Boolean] Allow download to be resumed -- Default: true
  , acceptUnpooled: false // [Boolean] Accept unrequested DCC download (accept a DCC download that doesn't match any DCC instance found in _xdccPool array -- Default: false
  , closeConnectionOnDisconnect: true // [Boolean] Defines if active sockets should be closed if the IRC client get disconnected or killed -- Default: true
  , method: 'say' // [String] Defines the method to trigger xdcc bots, either 'say' or 'ctcp' (you can also use 'msg' which is equivalent to 'say') -- Default: 'say'
  , sendCommand: 'XDCC SEND' // [String] the command sent to the bot to initiate the xdcc transfert -- Default: 'XDCC SEND'
  , cancelCommand: 'XDCC CANCEL' // [String] the command sent to the bot to cancel the xdcc transfert -- Default: 'XDCC CANCEL'
  , removeCommand: 'XDCC REMOVE' // [String] the command sent to the bot to cancel a queued transfert -- Default: 'XDCC REMOVE'
}
```


## Constructor
Instead of using the new irc.Client() method as a construtor, the irc-xdcc module provides a promise wrapper:

```javascript
ircXdcc(server, nick, options).then(function(instance) {});
```

Sample:
```javascript
// load irc-xdcc module
var ircXdcc = require('irc-xdcc')
// set options object
  , ircOptions = {
        userName: 'ircClient'
      , realName: 'irc Client'
      , port: 6697
      , autoRejoin: true
      , autoConnect: true
      , channels: [ '#xdcc', '#xdcc-chat' ]
      , secure: true
      , selfSigned: true
      , certExpired: true
      , stripColors: true
      , encoding: 'UTF-8'
      // xdcc specific options
      , progressInterval: 5
      , destPath: './dls'
      , resume: false
      , acceptUnpooled: true
      , closeConnectionOnDisconnect: false
    }
// used to store bot instance
  , botInstance
  ;
  
// construct instance using promise
ircXdcc('irc.myserver.com', 'myBotNick', ircOptions)
    .then(function(instance) {
      botInstance = instance;
      botInstance.addListener('registered', function() { console.log('bot connected'); });
    })
    .catch(console.error.bind(console));
```


## Methods
irc-xdcc module extends irc.Client methods with a set of promises:

**xdcc(packInfo)**

Add a xdccInstance to the pool and starts xdcc transfer for the provided pack infos ( { botNick: 'xdccBot', packId: 1 } ) where botNick is the xdcc server bot nick and packId, the required pack id.

```javascript
botInstance.xdcc({ botNick: 'xdccBot', packId: '1'})
    .then(function(xdccInstance) {})
    .catch(function(err) {
        if(err.code) {
            console.error('Error ' + err.code + ': ' +  err.message);
        }
        else {
            console.error(err);
        }
    });
```

**cancelXdcc(xdccInstance)**

Cancel DCC transfer using xdccInstance.

```javascript
botInstance.cancelXdcc(xdccInstance)
    .then(function() {})
    .catch(function(err) {
        console.error(err);
    });
```

**cancelPackInfo(packInfo)**

Cancel DCC transfer instances matching packInfo ({ botNick: 'xdccBot', packId: 1 }).

```javascript
botInstance.cancelPackInfo({ botNick: 'xdccBot', packId: '1'})
    .then(function() {})
    .catch(function(err) {
        console.error(err);
    });
```

**cancelPoolId(poolId)**

Cancel DCC transfer for the specified poolId (xdccInstance.xdccPoolId).

```javascript
botInstance.cancelPoolId(2)
    .then(function() {})
    .catch(function(err) {
        console.error(err);
    });
```

**getXdccPool()**

Returns xdccPool array (where xdccInstances are stored).

```javascript
botInstance.getXdccPool()
    .then(function(xdccPool) {})
    .catch(function(err) {
        console.error(err);
    });
```

**removeXdcc(xdccInstance)**

Cancel xdcc transfer and remove xdccInstance from pool.

```javascript
botInstance.removeXdcc(xdccInstance)
    .then(function() {})
    .catch(function(err) {
        console.error(err);
    });
```

**removePoolId(poolId)**

Cancel xdcc transfer and remove xdccInstance from pool using its pool id.

```javascript
botInstance.removePoolId(1)
    .then(function() {})
    .catch(function(err) {
        console.error(err);
    });
```


## Events
Along with extending irc module option and methods, some events have been added too:

**'connected'**
```
function(channels) {}
```
Event fired when the irc client is connected and joined all channels specified in the options

**'xdcc-error'**
```
function(message[,complement]) {}
```
Event fired when a method call is erroneous

**'xdcc-created'**
```
function(xdccInstance) {}
```
Fired when a DCC instance has been created (and added to the xdccPool) (see misc. section for xdccInstance info)

**'xdcc-removed'**
```
function(xdccInstance) {}
```
Fired when a DCC instance has been removed from xdccPool (see misc. section for xdccInstance info)

**'xdcc-started'**
```
function(xdccInstance) {}
```
Fired when the XDCC SEND command has been sent (see misc. section for xdccInstance info)

**'xdcc-queued'**
```
function(xdccInstance) {}
```
Fired when a queue notice has been recieved from the server (see misc. section for xdccInstance info)

**'xdcc-complete'**
```
function(xdccInstance) {}
```
Fired when a DCC transfer has been completed (see misc. section for xdccInstance info)

**'xdcc-canceled'**
```
function(xdccInstance) {}
```
Fired when a DCC transfer has been canceled (see misc. section for xdccInstance info)

**'xdcc-connect'**
```
function(xdccInstance) {}
```
Fired when a DCC transfer starts (see misc. section for xdccInstance info)

**'xdcc-progress'**
```
function(xdccInstance) {}
```
Fired every *option.progressInterval* seconds during DCC transfer

**'xdcc-dlerror'**
```
function(xdccInstance) {}
```
Fired when a DCC transfer encounter an error


## xdccInstance
An xdccInstance is an object containing pieces of information and methods regarding a specific xdcc transfer.

**xdccInfo**
```javascript
{
	botNick // xdcc server bot nick
  , packId // xdcc pack id
  , started // true if the transfer started already
  , queued // true if the transfer has been queued by the server
  , finished // true if the transfer has been completed
  , canceled // true if an error occured and the cancel/remove command has been send to the server
  , xdccPoolIndex // index of the instance in the internal _xdccPool array
  , resumePos // used to store resume position when an incomplete file is found in the destPath
  , startedAt // process.hrtime() value when the download has been started
  , duration // process.hrtime(startedAt) value when the download has been completed
  , intervalId // progress event setInterval id 
  , fileName // xdcc file name
  , command: // last xdcc command recieved from the server (SEND or ACCEPT)
  , ip: // server's ip address
  , port // server's socket port
  , fileSize: // xdcc file size
  , location: // file destination
  , sender // ctcp message emitter (= botNick)
  , target // ctcp message target (= ircClient nick)
  , message // ctcp message
  , params // ctcp parsed parts
  , error // error message/infos
}
```

**start()**

Used to send XDCC SEND command to the bot.

**cancel()**

Used to send XDCC CANCEL/REMOVE command to the bot.

**reset()**

Reset xdccInfo

**restart()**

Reset xdccInfo and start again

**getIndex()**

Refresh instance _xdccPool index and return it


## Thanks

- [Indysama](https://github.com/Indysama) for [node-xdcc](https://github.com/Indysama/node-xdcc)
- [DaVarga](https://github.com/DaVarga) for  [node-axdcc](https://github.com/DaVarga/node-axdcc/)
- [relisys](https://github.com/coinigy) from irc.freenode.org#node.JS for its help (pointing the obvious !)
