"use strict";

const oracledb = require('oracledb');
const _ = require('lodash');

module.exports = function (RED) {
    function getConnectString(host, port, connectionType, connectionTypeValue) {
        if (!connectionType) {
            connectionType = 'SERVICE_NAME';
        }
        if (connectionType==='TNS'){
            return connectionTypeValue;
        }
        return `(DESCRIPTION = 
                    (ADDRESS = (PROTOCOL = TCP)(HOST = ${host})(PORT = ${port}))
                    (CONNECT_DATA = (${connectionType} = ${connectionTypeValue}))
                )`;
    }

    function getConnection(user, password, connectString) {
        return oracledb.getConnection({user, password, connectString});
    }

    function setNodeStatus(node, color, text) {
        node.status({fill: color, shape: "dot", text});
    }

    function releaseConnection(conn, node) {
        if (conn) {
            conn.close(err1 => {
                if (err1) {
                    setNodeStatus(node, "red", "Error disconnecting");
                    node.send([null, {err: `Oracle error closing resultSet: ${err1.message}`}]);
                } else {
                    setNodeStatus(node, "grey", "disconnected");
                }
            });
        }
    }

    function getOutputMsg(msg, results, metadata, lastRow) {
        let outputMsg = _.cloneDeep(msg);
        outputMsg.payload = results;
        outputMsg.lastRow = lastRow;
        if (metadata) {
            outputMsg.metadata = metadata;
        }
        delete outputMsg.query;
        return outputMsg;
    }

    function VOOracleDBNode(config) {
        RED.nodes.createNode(this, config);
        
        this.host = config.host;
        this.port = config.port;
        this.connectionType = config.connectionType;
        this.connectionTypeValue = config.db;
        this.username = this.credentials.username;
        this.password = this.credentials.password;
        this.connectString = getConnectString(this.host, this.port, this.connectionType, this.connectionTypeValue);
        this.outputMsgType = config.outputMsgType;
        this.resultLimit = +config.resultLimit;
        const node = this;

        let sentLastRowFlag = false;

        function fetchRowsFromResultSet(resultSet, msg, metadata, connection) {
            const resultLimit = msg.resultLimit || node.resultLimit;
            resultSet.getRows(resultLimit, function (err, rows) {
                if (err) {
                    node.send([null, {err: `Oracle resultSet error: ${err.message}`}]);
                } else if (rows.length === 0) {
                    if (!sentLastRowFlag) {
                        const outputMsg = getOutputMsg(msg, rows, metadata, true);
                        node.send([outputMsg, null]);
                    }
                    resultSet.close(function (err1) {
                        if (err1) {
                            node.send([null, {err: `Oracle error closing resultSet: ${err1.message}`}]);
                        }
                    });
                    releaseConnection(connection, node);
                } else {
                    const lastRow = rows.length < resultLimit;
                    if (lastRow) {
                        sentLastRowFlag = true;
                    }
                    const outputMsg = getOutputMsg(msg, rows, metadata, lastRow);
                    node.send([outputMsg, null]);
                    setNodeStatus(node, "green", "result " + rows.length + " rows");
                    fetchRowsFromResultSet(resultSet, msg, metadata, connection);
                }
            });
        }

        node.on('input', function (msg) {
            sentLastRowFlag = false;
            const query = msg.payload;
            msg.query = query;
            msg.payload = '';
            if (typeof query !== 'string') {
                msg.error = 'Invalid query- ensure msg.payload contains query to execute';
                node.send([null, msg]);
                return;
            }
            let connection;
            let useResultSet = false;
            try {
                getConnection(node.username, node.password, node.connectString).then(conn => {
                    node.status({fill: "green", shape: "ring", text: "Connected"});
                    connection = conn;
                    return conn;
                }).then(connxion => {
                    useResultSet = node.outputMsgType === 'multi' && query && query.trim().toLowerCase().includes('select');
                    return connxion.execute(query, {}, {
                        outFormat: oracledb.OBJECT,
                        autoCommit: true,
                        resultSet: useResultSet
                    });
                }).then(output => {
                    if (useResultSet) { //multi
                        fetchRowsFromResultSet(output.resultSet, msg, output.metadata, connection);
                    } else {
                        const text = (output.rows && output.rows.length ? output.rows.length + " rows" : " ");
                        setNodeStatus(node, "green", text);
                        const metadata = output.metadata;
                        if (!output.rows && output.rowsAffected) {
                            node.send([getOutputMsg(msg, output, metadata, true), null]);
                            releaseConnection(connection, node);
                            return;
                        }
                        node.send([getOutputMsg(msg, output.rows, metadata, true), null]);
                        releaseConnection(connection, node);
                    }
                }).catch(err => {
                    msg.error = '' + err;
                    node.send([null, msg]);
                    releaseConnection(connection, node);
                });
            } catch (e) {
                msg.error = '' + e;
                node.send([null, msg]);
            }
        });
    }

    RED.nodes.registerType("vooracle", VOOracleDBNode, {
        credentials: {
            username: {type: "text"},
            password: {type: "password"}
        }
    });
};
