/**
* Copyright JS Foundation and other contributors, http://js.foundation
*
* Licensed under the Apache License, Version 2.0 (the "License");
* you may not use this file except in compliance with the License.
* You may obtain a copy of the License at
*
* http://www.apache.org/licenses/LICENSE-2.0
*
* Unless required by applicable law or agreed to in writing, software
* distributed under the License is distributed on an "AS IS" BASIS,
* WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
* See the License for the specific language governing permissions and
* limitations under the License.
**/

/** 
* Created by: Robert Goodsell
* Date: 7th Sept. 2021
* Extended node: Node-Red v0.1.0 (mysql.js)
*/

module.exports = function (RED) {
    "use strict";
    const reconnect = (RED.settings.mysqlReconnectTime || 30000) / 1000; //seconds
    const connectionLimit = 10; //1-30 connections
    const statusConnect = 3000; //milliseconds
    const statusRefresh = 500; //milliseconds
    const connectTimeout = 10000; //milliseconds
    const connectRetries = 3; //Retry on connecting before error
    const readTimeout = 30000; //milliseconds
    const versionTimeout = 30; //minutes;

    var mysqldb = require('mysql');

    function MySQLNode(n) {
        RED.nodes.createNode(this, n);

        this.dbname = n.db;
        this.host = n.host;
        this.port = n.port;
        this.tz = n.tz || "local";
        this.rc = n.rc || reconnect;
        this.hold = (typeof n.hold === "boolean" ? n.hold : false);
        this.idle = n.idle || 30;
        this.cl = n.cl || connectionLimit;
        this.vc = (typeof n.vc === "boolean" ? n.vc : false);
        this.rt = (typeof n.rt === "number" ? n.rt : readTimeout);
        this.ct = (typeof n.ct === "number" ? n.ct : connectTimeout);

        this.connected = false;
        this.connecting = false;

        this.setMaxListeners(0);

        var node = this;

        function checkVersion() {
            if (node.vc) {
                node.pool.query("SELECT version();", [], function (err, rows) {
                    if (err) {
                        node.error(err);
                        node.status({ fill: "red", shape: "ring", text: "Bad Ping" });
                        doConnect();
                    }
                });
            }
        }

        function doConnect(msg, reconnect = false) {
            node.connecting = true;
            node.emit("state", "connecting");

            if (!node.pool || (node.pool && reconnect) || (node.pool && ((undefined !== msg.host && msg.host !== node.pool.host) || (undefined !== msg.port && msg.port !== node.pool.port) || (undefined !== msg.user && msg.user !== node.pool.user) || (undefined !== msg.pass && msg.pass !== node.pool.password) || (undefined !== msg.db && msg.db !== node.pool.database) || (typeof msg.connectTimeout === 'number' && msg.connectTimeout !== node.pool.connectTimeout)))) {
                node.pool = mysqldb.createPool({
                    host: msg.host || node.host,
                    port: msg.port || node.port,
                    user: msg.user || node.credentials.user,
                    password: msg.pass || node.credentials.password,
                    database: msg.db || node.dbname,
                    timezone: node.tz,
                    insecureAuth: true,
                    multipleStatements: true,
                    connectionLimit: node.cl,
                    connectTimeout: msg.connectTimeout || node.ct || connectTimeout
                });
            }

            node.pool.getConnection(function (err, connection) {
                node.connecting = false;

                if (err) {
                    if (node.hold) {
                        node.emit("state", err.code);
                        node.error(err);
                        if (node.rc > 0) node.reconnectTimeout = setTimeout(doConnect, node.rc * 1000);
                    } else {
                        node.emit("state", err.code);
                        node.emit("error", Object.assign({}, msg, { payload: { error: true, errorMessage: err, errorCode: err.code, fatal: err.fatal } }), err);
                    }
                }
                else {
                    node.connection = connection;
                    node.connected = true;
                    node.emit("state", "connected");

                    if (!node.hold) node.emit("connected", node.connected, msg);
                    if (node.hold && node.vc && !node.versionInterval) { node.versionInterval = setInterval(checkVersion, versionTimeout * 3600); }
                }
            });
        }

        this.connect = function (msg = {}) {
            if (!this.connected && !this.connecting) {
                doConnect(msg);
            }
        }

        this.disconnect = function (release = true) {
            if (this.reconnectTimeout) { clearTimeout(this.reconnectTimeout); }
            if (this.versionInterval) { clearInterval(this.versionInterval); }
            if (this.connection) {
                this.connected = false;
                try {
                    if (release) {
                        node.connection.release();
                        node.connection.destroy();
                    }
                } catch (ex) {
                }
            }
            if (this.connecting) this.connecting = false;
            node.emit("state", "disconnected");
        }

        this.on('close', function (done) {
            this.disconnect();
            node.pool.end(function (err) { done(); });
        });
    }

    RED.nodes.registerType("VOMySQLdatabase", MySQLNode, {
        credentials: {
            user: { type: "text" },
            password: { type: "password" }
        }
    });

    function MySqlDBNodeIn(n) {
        RED.nodes.createNode(this, n);

        this.mydb = n.mydb;
        this.mydbConfig = RED.nodes.getNode(this.mydb);
        this.queries = 0;
        this.idleTimeout;
        this.queryTimeout;

        var doQuery = function (msg, hold = true) {
            if (typeof msg.sql === 'string') {
                var bind = [];
                var timeout = (typeof msg.queryTimeout === "number" ? msg.queryTimeout : readTimeout);

                if (Array.isArray(msg.payload)) { bind = msg.payload; }
                else if (typeof msg.payload === 'object' && msg.payload !== null) {
                    bind = msg.payload;
                    node.mydbConfig.pool.config.queryFormat = function (query, values) {
                        if (!values) {
                            return query;
                        }
                        return query.replace(/\:(\w+)/g, function (txt, key) {
                            if (values.hasOwnProperty(key)) {
                                return this.escape(values[key]);
                            }
                            return txt;
                        }.bind(this));
                    };
                }

                console.log("query: " + msg.sql + ", timeout: " + timeout);

                node.mydbConfig.pool.query((timeout > 0 ? { sql: msg.sql, timeout: timeout } : msg.sql), bind, function (err, rows) {
                    node.queries--;
                    msg.queryRunning = node.queries;

                    if (err) {
                        status = { fill: "red", shape: "ring", text: err };
                        node.status(status);
                        if (hold) {
                            node.error(err, msg);
                        } else {
                            node.mydbConfig.emit("error", Object.assign({}, msg, { payload: { error: true, erroMessage: err, errorCode: err.code, fatal: err.fatal } }));
                        }
                    } else {
                        msg.payload = rows;
                        node.send(msg);
                        status = { fill: "green", shape: "dot", text: "query success" + (Array.isArray(rows) ? " (" + rows.length + " rows)" : "") };
                        node.status(status);

                        if (hold) {
                            node.queryTimeout = setTimeout(function () {
                                if (node.mydbConfig.connected) node.mydbConfig.emit("state", "connected");
                            }, statusConnect);
                        }
                    }

                    if (!hold && node.queries === 0) {
                        if (node.mydbConfig.idle > 0) {
                            let idle = node.mydbConfig.idle;
                            node.idleTimeout = setInterval(function () {
                                status = { fill: "blue", shape: "dot", text: "idle " + idle + " second" + (idle > 1 ? "s" : "") };
                                node.status(status);

                                if (idle <= 0) {
                                    clearInterval(node.idleTimeout);
                                    node.mydbConfig.disconnect();
                                }

                                idle--;
                            }, 1000);
                        } else {
                            node.mydbConfig.disconnect();
                        }
                    }
                });
            } else {
                let errMsg = "msg.sql: " + (undefined === msg.sql ? " is not defined" : "the query is not defined as a string");
                if (node.hold) {
                    node.error(errMsg);
                } else {
                    node.mydbConfig.emit("error", Object.assign({}, msg, { payload: { error: true, errorMessge: errMsg } }), "query invalid");
                }
            }
        }

        if (this.mydbConfig) {
            var node = this;
            var busy = false;
            var status = {};

            node.mydbConfig.on("state", function (info) {
                if (info === "connecting") { node.status({ fill: "yellow", shape: "ring", text: info }); }
                else if (info === "connected") { node.status({ fill: "green", shape: "dot", text: info }); }
                else if (info === "disconnected") { node.status({ fill: "grey", shape: "dot", text: info }); }
                else {
                    if (info === "ECONNREFUSED") { info = "connection refused"; }
                    if (info === "PROTOCOL_CONNECTION_LOST") { info = "connection lost"; }
                    node.status({ fill: "red", shape: "ring", text: info });
                }
            });

            node.mydbConfig.on("connected", function (state, msg) {
                if (state) {
                    return doQuery(msg, node.mydbConfig.hold);
                } else {
                    let errMsg = "database not connected";
                    if (node.hold) {
                        node.error(errMsg, msg);
                    } else {
                        node.emit("error", Object.assign({}, msg, { payload: { error: true, errorMessge: errMsg } }), "db not connected", "ring");
                    }
                }
            });

            node.mydbConfig.on("error", function (msg, err, shape = 'dot', colour = 'red') {
                node.queries--;

                if (msg) {
                    if (undefined === msg.queryRunning) msg.queryRunning = node.queries;
                    node.send(msg);
                }
                if (err) node.status({ fill: colour, shape: shape, text: err.code || err });
            });

            var connectingTimeout = function (oMsg, retry = 0) {
                setTimeout(function (nMsg, nRetry) {
                    if (node.mydbConfig.connected) {
                        node.mydbConfig.emit("connected", node.mydbConfig.connected, nMsg);
                    } else if (nRetry < connectRetries) {
                        connectingTimeout(nMsg, nRetry + 1);
                    } else {
                        node.emit("error", Object.assign({}, nMsg, { error: true, errorMessage: "db connection timeout" }));
                    }
                }, connectTimeout, oMsg, retry);
            }

            node.on("input", function (msg) {
                if (undefined !== msg.dbConfig) {
                    this.mydb = msg.dbConfig;
                    this.mydbConfig = RED.nodes.getNode(this.mydb);
                }

                node.queries++;

                if (node.mydbConfig.hold) {
                    if (node.queryTimeout) clearTimeout(node.queryTimeout);
                    if (node.mydbConfig.connected) {
                        return doQuery(msg, node.mydbConfig.hold);
                    }
                    else {
                        node.error("database not connected", msg);
                        status = { fill: "red", shape: "ring", text: "db not connected" };
                    }
                    if (!busy) {
                        busy = true;
                        node.status(status);
                        node.busyTimeout = setTimeout(function () {
                            busy = false;
                            node.status(status);
                        }, statusRefresh);
                    }
                } else {
                    if (node.idleTimeout) clearTimeout(node.idleTimeout);

                    if (node.mydbConfig.connected) {
                        node.mydbConfig.emit("connected", node.mydbConfig.connected, msg);
                    } else if (node.mydbConfig.connecting || node.queries > 1) {
                        connectingTimeout(msg);
                    } else {
                        node.mydbConfig.connect(msg);
                    }
                }
            });

            node.on('close', function () {
                if (node.busyTimeout) { clearTimeout(node.busyTimeout); }
                if (node.idleTimeout) clearTimeout(node.idleTimeout);
                if (node.queryTimeout) clearTimeout(node.queryTimeout);
                node.mydbConfig.removeAllListeners();
                node.status({});
                node.queries = 0;
            });

            if (node.mydbConfig.hold) {
                node.mydbConfig.connect();
            } else {
                node.mydbConfig.disconnect(false);
            }
        }
        else {
            this.error("VO MySQL database not configured");
        }
    }
    RED.nodes.registerType("vomysql", MySqlDBNodeIn);
}
