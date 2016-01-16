# irc-xdcc

## Introduction
nodeJS [irc module](https://github.com/martynsmith/node-irc) extension that provide xdcc handlers.

It's basically a recode of Indysama [node-xdcc](https://github.com/Indysama/node-xdcc) / DaVarga [node-axdcc](https://github.com/DaVarga/node-axdcc/)


## Options
irc-xdcc provide a promise wrapper for the irc module. It extends the [available options](https://node-irc.readthedocs.org/en/latest/API.html#client) with the following:

```javascript
{
    progressInterval: 1 // [Number(int)] Interval (in seconds) for the progress update event (xdcc-progress) -- Default: 1
  , destPath: '/path/to/destination' // [String] The destination path for downloads -- Default is the current process path + /downloads -> path.join(__dirname, 'downloads')
  , resume: true // [Boolean] Allow download to be resumed -- Default: true
  , acceptUnpooled: false // [Boolean] Accept unrequested DCC download (accept a DCC download that doesn't match any DCC instance found in _xdccPool array -- Default: false
  , closeConnectionOnDisconnect: true // [Boolean] Defines if active sockets should be closed if the IRC client get disconnected or killed -- Default: true
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

**'xdcc-error'**
```
function(message[,complement]) {}
```
Event fired when a method call is erroneous

**'xdcc-complete'**
```
function(packet) {}
```
Fired when a DCC transfer has been completed (see misc. section for packet info)

**'xdcc-canceled'**
```
function(packet) {}
```
Fired when a DCC transfer has been canceled (see misc. section for packet info)

**'xdcc-connect'**
```
function(packet) {}
```
Fired when a DCC transfer starts (see misc. section for packet info)

**'xdcc-progress'**
```
function(packet) {}
```
Fired every *option.progressInterval* seconds during DCC transfer

**'xdcc-dlerror'**
```
function(packet) {}
```
Fired when a DCC transfer encounter an error


## Misc.
Todo...
