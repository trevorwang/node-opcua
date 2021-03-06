
const assert = require("node-opcua-assert").assert;
const EventEmitter = require("events").EventEmitter;
const util = require("util");

const coerceNodeId = require("node-opcua-nodeid").coerceNodeId;
const VariableIds = require("node-opcua-constants").VariableIds;

const serverStatus_State_Id = coerceNodeId(VariableIds.Server_ServerStatus_State);
const ServerState = require("node-opcua-common").ServerState;
const StatusCodes = require("node-opcua-status-code").StatusCodes;

const debugLog = require("node-opcua-debug").make_debugLog(__filename);
const doDebug = require("node-opcua-debug").checkDebugFlag(__filename);


function ClientSessionKeepAliveManager(session) {
    const self = this;
    self.session = session;
    self.timerId = 0;
}
util.inherits(ClientSessionKeepAliveManager, EventEmitter);
/**
 * @method ping_server
 *
 * when a session is opened on a server, the client shall send request on a regular basis otherwise the server
 * session object might time out.
 * start_ping make sure that ping_server is called on a regular basis to prevent session to timeout.
 *
 * @param callback
 */
ClientSessionKeepAliveManager.prototype.ping_server = function(callback) {
    const self = this;
    callback = callback || function () { };
    const the_session = this.session;
    if (!the_session) {
        return callback();
    }

    const now = Date.now();

    const timeSinceLastServerContact = now - the_session.lastResponseReceivedTime;
    if (timeSinceLastServerContact < self.pingTimeout) {
        // no need to send a ping yet
        //xx console.log("Skipping ",timeSinceLastServerContact,self.session.timeout);
        return callback();
    }

    if (the_session.isReconnecting) {
        debugLog("ClientSessionKeepAliveManager#ping_server skipped because client is reconnecting");
        return callback();
    }
    debugLog("ClientSessionKeepAliveManager#ping_server ",timeSinceLastServerContact,self.session.timeout);
    // Server_ServerStatus_State
    the_session.readVariableValue(serverStatus_State_Id, function (err, dataValue) {
        if (err) {
            console.log(" warning : ClientSessionKeepAliveManager#ping_server ".cyan, err.message.yellow);
            self.stop();

            /**
             * @event failure
             * raised when the server is not responding or is responding with en error to
             * the keep alive read Variable value transaction
             */
            self.emit("failure");

        } else {
            if (dataValue.statusCode === StatusCodes.Good) {
                const newState = ServerState.get(dataValue.value.value);
                //istanbul ignore next
                if (newState !== self.lastKnownState) {
                    console.log(" Server State = ", newState.toString());
                }
                self.lastKnownState = newState;
            }

            self.emit("keepalive",self.lastKnownState);
        }
        callback();
    });
};


ClientSessionKeepAliveManager.prototype.start = function() {
    const self = this;
    assert(!self.timerId);
    assert(self.session.timeout > 100);

    self.pingTimeout   =  self.session.timeout * 2/3;
    self.checkInterval =  self.pingTimeout  / 3;
    self.timerId = setInterval(self.ping_server.bind(self),self.checkInterval);
};

ClientSessionKeepAliveManager.prototype.stop = function() {
    const self = this;
    if (self.timerId) {
        clearInterval(self.timerId);
        self.timerId = 0;
    }
};

exports.ClientSessionKeepAliveManager = ClientSessionKeepAliveManager;