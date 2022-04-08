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
  * Date: 26th May 2020
  * Extended node: Node-Red v1.06 (trigger.js) 
  */

//Manage the flow of messages within a flow
module.exports = function (RED) {
    "use strict";
    var mustache = require("mustache");

    function VOTriggerNode(n) {
        RED.nodes.createNode(this, n);

        const flushTag = "flush";
        const resetTag = "reset";
        const noTopic = "_none";
		const queueTag = "queue:";

        this.bytopic = n.bytopic || "all";
        this.op1 = n.op1 || "1";
        this.op2 = n.op2 || "0";
        this.op1type = n.op1type || "str";
        this.op2type = n.op2type || "str";

        if (this.op1type === 'val') {
            if (this.op1 === 'true' || this.op1 === 'false') {
                this.op1type = 'bool'
            } else if (this.op1 === 'null') {
                this.op1type = 'null';
                this.op1 = null;
            } else {
                this.op1type = 'str';
            }
        }
        if (this.op2type === 'val') {
            if (this.op2 === 'true' || this.op2 === 'false') {
                this.op2type = 'bool'
            } else if (this.op2 === 'null') {
                this.op2type = 'null';
                this.op2 = null;
            } else {
                this.op2type = 'str';
            }
        }
        this.extend = n.extend || "false";
        this.units = n.units || "Milliseconds";
        this.reset = n.reset || '';
        this.duration = parseFloat(n.duration);

        if (isNaN(this.duration)) {
            this.duration = 250;
        }

        if (this.duration < 0) {
            this.loop = true;
            this.duration = this.duration * -1;
            this.extend = false;
        }

        var getDuration = function (duration, units) {
            if (units == "second") { return duration * 1000; }
            if (units == "minute") { return duration * 1000 * 60; }
            if (units == "hour") { return duration * 1000 * 60 * 60; }
            return duration;
        }
        this.duration = getDuration(this.duration, this.units);

        this.op1Templated = (this.op1type === 'str' && this.op1.indexOf("{{") != -1);
        this.op2Templated = (this.op2type === 'str' && this.op2.indexOf("{{") != -1);
        if ((this.op1type === "num") && (!isNaN(this.op1))) { this.op1 = Number(this.op1); }
        if ((this.op2type === "num") && (!isNaN(this.op2))) { this.op2 = Number(this.op2); }

        var node = this;
        node.topics = {};
		node.status({ fill: "green", shape: "dot", text: queueTag + " 0"});

        function ourTimeout(handler, delay) {
            var toutID = setTimeout(handler, delay);
            return {
                clear: function () { clearTimeout(toutID); },
                trigger: function () { clearTimeout(toutID); return handler(); }
            };
        }

        function ourInterval(handler, delay) {
            var toutID = setInterval(handler, delay);
            return {
                clear: function () { clearInterval(toutID); },
                trigger: function () { clearInterval(toutID); return handler(); }
            };
        }

        var npay = {};
        var pendingMessages = [];
        var activeMessagePromise = null;
        var processMessageQueue = function (msg) {
            if (msg) {
                // A new message has arrived - add it to the message queue
                pendingMessages.push(msg);
                if (activeMessagePromise !== null) {
                    // The node is currently processing a message, so do nothing
                    // more with this message
                    return;
                }
            }
            if (pendingMessages.length === 0) {
                // There are no more messages to process, clear the active flag
                // and return
                activeMessagePromise = null;
                return;
            }

            // There are more messages to process. Get the next message and
            // start processing it. Recurse back in to check for any more
            var nextMsg = pendingMessages.shift();
            activeMessagePromise = processMessage(nextMsg)
                .then(processMessageQueue)
                .catch((err) => {
                    node.error(err, nextMsg);
                    return processMessageQueue();
                });
        }

        var updateStatus = function (msg, tag) {
            let duration = (undefined !== msg && undefined !== msg.duration ? msg.duration : node.duration);
            let units = (undefined !== msg && msg.units ? msg.units : node.units);
            let queued = Object.keys(node.topics || {}).length;
            node.status({ fill: (queued > 0 ? "blue" : "green"), shape: "dot", text: queueTag + " " + queued + (tag ? " - " + tag : "") });
        }

        var resetNode = function (topic) {
            if (node.topics[topic] && node.topics[topic].tout) node.topics[topic].tout.clear();
            delete node.topics[topic];
        }

        var updateResetFlush = function (msg) {
            let reset = (undefined !== msg.reset);
            let attr = msg.reset || msg.flush || 0;
            let tCount = 0;
            let toRemove = (typeof attr === "number" ? attr : Object.keys(node.topics).length);

            for (var t in node.topics) {
                if (t !== noTopic || (t === noTopic && node.topics[t].tout)) {
                    if (typeof attr !== "number" || (typeof attr === "number" && tCount < toRemove)) {
                        if (reset || !node.topics[t].tout) {
                            resetNode(t);
                        } else {
                            node.topics[t].tout.trigger();
                        }
                        tCount++;
                    }
                } else {
                    resetNode(t);
                }
            };
            setTimeout(function () {
                updateStatus(undefined, (reset ? resetTag : flushTag) + " (" + (msg.topic ? "topic" : (typeof attr === "number" ? "number" : "all")) + ": " + tCount + ")");
            });
        }

        this.on('input', function (msg) {
            processMessageQueue(msg);
        });

        var processMessage = function (msg) {
            var topic = msg.topic || noTopic;
            var promise;
            var mDuration = (typeof msg.duration === "number" ? getDuration(msg.duration, msg.units || node.units) : node.duration);

            if (msg.hasOwnProperty(resetTag) || ((node.reset !== '') && msg.hasOwnProperty("payload") && (msg.payload !== null) && msg.payload.toString && (msg.payload.toString() == node.reset))) {
                if (msg.hasOwnProperty("topic")) {
                    //clear topic (reset + topic on msg)
                    let exists = (undefined !== node.topics[topic] && topic !== noTopic && node.topics[topic].tout && node.topics[topic].tout !== 0);
                    if (exists) resetNode(topic);
                    updateStatus(undefined, resetTag + " (topic: " + (exists ? 1 : 0) + ")");
                } else {
                    //Clear all topics (reset + no topic on msg)
                    updateResetFlush(msg);
                }
            } else if (msg.hasOwnProperty(flushTag)) {
                if (msg.hasOwnProperty("topic")) {
                    //flush by topic (flush + topic on msg)
                    if (undefined !== node.topics[topic] && topic !== noTopic && topic !== noTopic && node.topics[topic].tout && node.topics[topic].tout !== 0) {
                        node.topics[topic].tout.trigger();
                        setTimeout(function () {
                            resetNode(topic);
                            updateStatus(undefined, flushTag + " (topic: 1)");
                        });
                    } else {
                        //topic undefined or array empty
                        updateStatus(undefined, flushTag + " (topic; 0)");
                    }
                } else {
                    //flush all topics (flush + no topic on msg)	
                    updateResetFlush(msg);
                }
            }
            else {
                if (node.bytopic === "all" && Object.keys(node.topics).length > 0) { topic = Object.keys(node.topics)[0]; }
                node.topics[topic] = node.topics[topic] || {};

                if (node.op2type === "payl") { npay[topic] = RED.util.cloneMessage(msg); }
                if (((!node.topics[topic].tout) && (node.topics[topic].tout !== 0)) || (node.loop === true)) {
                    promise = Promise.resolve();
                    if (node.op2type === "pay") { node.topics[topic].m2 = RED.util.cloneMessage(msg.payload || {}); }
                    else if (node.op2Templated) { node.topics[topic].m2 = mustache.render(node.op2, msg); }
                    else if (node.op2type !== "nul") {
                        promise = new Promise((resolve, reject) => {
                            RED.util.evaluateNodeProperty(node.op2, node.op2type, node, msg, (err, value) => {
                                if (err) {
                                    reject(err);
                                } else {
                                    node.topics[topic].m2 = value;
                                    resolve();
                                }
                            });
                        });
                    }

                    return promise.then(() => {
                        promise = Promise.resolve();
                        if (node.op1type === "pay") { }
                        else if (node.op1Templated) { msg.payload = mustache.render(node.op1, msg); }
                        else if (node.op1type !== "nul") {
                            promise = new Promise((resolve, reject) => {
                                RED.util.evaluateNodeProperty(node.op1, node.op1type, node, msg, (err, value) => {
                                    if (err) {
                                        reject(err);
                                    } else {
                                        msg.payload = value;
                                        resolve();
                                    }
                                });
                            });
                        }
                        return promise.then(() => {
                            if (mDuration === 0) { node.topics[topic].tout = 0; }
                            else if (node.loop === true) {
                                if (node.topics[topic].tout) { node.topics[topic].tout.clear(); }
                                if (node.op1type !== "nul") {
                                    var msg2 = RED.util.cloneMessage(msg);
                                    node.topics[topic].tout = ourInterval(function () { node.send(RED.util.cloneMessage(msg2)); }, mDuration);
                                }
                            }
                            else {
                                if (!node.topics[topic].tout) {
                                    node.topics[topic].tout = ourTimeout(function () {
                                        var msg2 = null;
                                        if (node.op2type !== "nul") {
                                            var promise = Promise.resolve();
                                            msg2 = RED.util.cloneMessage(msg);
                                            if (node.op2type === "flow" || node.op2type === "global") {
                                                promise = new Promise((resolve, reject) => {
                                                    RED.util.evaluateNodeProperty(node.op2, node.op2type, node, msg, (err, value) => {
                                                        if (err) {
                                                            reject(err);
                                                        } else {
                                                            node.topics[topic].m2 = value;
                                                            resolve();
                                                        }
                                                    });
                                                });
                                            }
                                            promise.then(() => {
                                                if (node.op2type === "payl") {
                                                    node.send(npay[topic]);
                                                    delete npay[topic];
                                                }
                                                else {
                                                    msg2.payload = node.topics[topic].m2;
                                                    node.send(msg2);
                                                }
                                                delete node.topics[topic];
                                                updateStatus(msg);
                                            }).catch(err => {
                                                node.error(err);
                                            });
                                        } else {
                                            delete node.topics[topic];
                                            updateStatus(msg);
                                        }

                                    }, mDuration);
                                }
                            }
                            updateStatus(msg);
                            if (node.op1type !== "nul") { node.send(RED.util.cloneMessage(msg)); }
                        });
                    });
                }
                else if ((node.extend === "true" || node.extend === true) && (mDuration > 0)) {
                    if (node.op2type === "payl") { node.topics[topic].m2 = RED.util.cloneMessage(msg.payload || {}); }
                    if (node.topics[topic].tout) { node.topics[topic].tout.clear(); }
                    node.topics[topic].tout = ourTimeout(function () {
                        var msg2 = null;
                        var promise = Promise.resolve();

                        if (node.op2type !== "nul") {
                            if (node.op2type === "flow" || node.op2type === "global") {
                                promise = new Promise((resolve, reject) => {
                                    RED.util.evaluateNodeProperty(node.op2, node.op2type, node, msg, (err, value) => {
                                        if (err) {
                                            reject(err);
                                        } else {
                                            node.topics[topic].m2 = value;
                                            resolve();
                                        }
                                    });
                                });
                            }
                        }
                        promise.then(() => {
                            if (node.op2type !== "nul") {
                                if (node.topics[topic] !== undefined) {
                                    msg2 = RED.util.cloneMessage(msg);
                                    msg2.payload = node.topics[topic].m2;
                                }
                            }
                            delete node.topics[topic];
                            updateStatus(msg);
                            node.send(msg2);
                        }).catch(err => {
                            node.error(err);
                        });
                    }, mDuration);
                }
            }
            return Promise.resolve();
        }
        this.on("close", function () {
            for (var t in node.topics) {
                if (node.topics[t]) {
                    if(node.topics[t].tout !== 0)node.topics[t].tout.clear();
                    delete node.topics[t];
                }
            }
            node.status({ fill: "green", shape: "dot", text: queueTag + " 0"});
        });
    }
    RED.nodes.registerType("votrigger", VOTriggerNode);
}