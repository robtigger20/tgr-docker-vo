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
  * Extended node: Node-Red v1.06 (delay.js)
  */

//Simple node to introduce a pause and rate limiting into a flow
module.exports = function (RED) {
    "use strict";

    var MILLIS_TO_NANOS = 1000000;
    var SECONDS_TO_NANOS = 1000000000;

    function VODelayNode(n) {
		RED.nodes.createNode(this, n);

        const rateMin = 1; //milliseconds
        const rateStatus = 200; //milliseconds
        const delayStatus = 200; //milliseconds
        const initialRate = 20;  //milliseconds

        const flushTag = "flush";
        const resetTag = "reset";
        const queueTag = "queue:";
        const shortDayTag = "day";
        const shortHourTag = "hr";
        const shortMinuteTag = "min";
        const shortSecondTag = "sec";
        const shortMillisecondTag = "ms";

        this.pauseType = n.pauseType;
        this.timeoutUnits = n.timeoutUnits;
        this.timeoutMultiply = 1000; //default seconds
        this.timeoutUnitsTag = shortSecondTag; //default seconds
        this.randomUnits = n.randomUnits;
        this.randomMultiply = 1000; //default seconds
        this.randomUnitsTag = shortSecondTag; //default seconds
        this.rateUnits = n.rateUnits;
        this.nbRateUnits = n.nbRateUnits;
        this.rate = n.rate;

        if (n.timeoutUnits === "millisecond") {
            this.timeoutMultiply = 1;
            this.timeoutUnitsTag = shortMillisecondTag;
        } else if (n.timeoutUnits === "minute") {
            this.timeoutMultiply = (60 * 1000);
            this.timeoutUnitsTag = shortMinuteTag;
        } else if (n.timeoutUnits === "hour") {
            this.timeoutMultiply = (60 * 60 * 1000);
            this.timeoutUnitsTag = shortHourTag;
        } else if (n.timeoutUnits === "day") {
            this.timeoutMultiply = (24 * 60 * 60 * 1000);
            this.timeoutUnitsTag = shortDayTag;
        }
        this.timeout = n.timeout * this.timeoutMultiply;

        if (n.randomUnits === "millisecond") {
            this.randomMultiply = 1;
            this.randomUnitsTag = shortMillisecondTag;
        } else if (n.randomUnits === "minute") {
            this.randomMultiply = (60 * 1000);
            this.randomUnitsTag = shortMinuteTag;
        } else if (n.randomUnits === "hour") {
            this.randomMultiply = (60 * 60 * 1000);
            this.randomUnitsTag = shortHourTag;
        } else if (n.randomUnits === "day") {
            this.randomMultiply = (24 * 60 * 60 * 1000);
            this.randomUnitsTag = shortDayTag;
        }
        this.randomFirst = n.randomFirst * this.randomMultiply;
        this.randomLast = n.randomLast * this.randomMultiply;

        this.diff = this.randomLast - this.randomFirst;
        this.name = n.name;
        this.idList = [];
        this.buffer = [];
        this.intervalID = -1;
        this.intervalRate = -1;
        this.randomID = -1;
        this.lastSent = null;
        this.drop = n.drop;
        this.batch = n.batch;
        this.pass = n.pass;
        this.busy = null;

        var node = this;
		
		node.status({ fill: "green", shape: "dot", text: queueTag + " 0"});

        function ourTimeout(handler, delay) {
            var toutID = setTimeout(handler, delay);
            return {
                clear: function () { clearTimeout(toutID); },
                trigger: function (status) { clearTimeout(toutID); return handler(status); }
            };
        }

        var getRate = function (rate, nbRateUnits, rateUnits) {
            if (rateUnits === "second") {
                rate = 1000 / rate;
            } else if (rateUnits === "minute") {
                rate = (60 * 1000) / rate;
            } else if (rateUnits === "hour") {
                rate = (60 * 60 * 1000) / rate;
            } else if (rateUnits === "day") {
                rate = (24 * 60 * 60 * 1000) / rate;
            } else {// Default to milliseconds
                rate = (rate < rateMin ? rateMin : rate);
                return ((nbRateUnits > 0 ? nbRateUnits : 1) / rate);
            }

            rate *= (nbRateUnits > 0 ? nbRateUnits : 1);
            return rate;
        }

        var getShortUnits = function (rateUnits) {
            let units;
            if (rateUnits === "second") {
                units = shortSecondTag;
            } else if (rateUnits === "minute") {
                units = shortMinuteTag;
            } else if (rateUnits === "hour") {
                units = shortHourTag;
            } else if (rateUnits === "day") {
                units = shortDayTag;
            } else {// Default to milliseconds
                units = shortMillisecondTag;
            }
            return units;
        }

        var closeDelayList = function () {
            for (var i = 0; i < node.idList.length; i++) { node.idList[i].id.clear(); }
            node.idList = [];
            node.status({ fill: "green", shape: "dot", text: queueTag + " 0"});
        }

        var clearDelayList = function (clear, topic, reset = false) {
            let tag = (reset ? resetTag : flushTag) + " (" + (topic ? "topic" : (typeof clear === "number" ? "number" : "all"));
            let toClear = 0;

            if (topic) {
                toClear = clearDelayTopic(topic, !reset);
            } else {
                let len = node.idList.length;
                toClear = (typeof clear === "number" && clear < node.idList.length ? clear : node.idList.length);
                for (var i = 0; i < toClear; i++) {
                    if (reset) {
                        node.idList[0].id.clear();
                        node.idList.shift();
                    } else {
                        node.idList[0].id.trigger(tag + ": " + toClear + ")");
                    }
                }
                if (reset && typeof clear !== "number" && clear === len) {
                    node.idList = [];
                    if (node.busy) {
                        clearTimeout(node.busy);
                        node.busy = null;
                    }
                }
            }
            node.status({ fill: (node.idList.length === 0 ? "green" : "blue"), shape: "dot", text: queueTag + " " + node.idList.length + " - " + tag + ": " + toClear + ")" });
        }

        var clearDelayTopic = function (topic, flush = false) {
            let count = 0;
            if (topic) {
                for (var b = node.idList.length - 1; b > -1; b--) {
                    if (topic === node.idList[b].topic) {
                        count++;
                        if (flush) {
                            node.idList[b].id.trigger(flushTag + " (topic: " + count + ")");
                        } else {
                            node.idList[b].id.clear();
                            node.idList.splice(b, 1);
                        }
                    }
                }
            }
            return count;
        }

        var clearRateList = function (clear, topic, reset = false) {
            let tag = reset ? resetTag : flushTag;

            if (topic) {
                //topic defined, search and flush\reset
                node.reportDepth(0, undefined, undefined, tag + " (topic: " + clearRateTopic(topic, !reset) + ")");
            } else {
                //no topic defined
                if (typeof clear === "number" && clear < node.buffer.length) {
                    for (var i = 0; i < clear; i++) {
                        if (reset) { node.buffer.shift() }
                        else { node.send(node.buffer.shift()); }
                    }
                    node.reportDepth(0, undefined, undefined, tag + " (number: " + clear + ")");
                } else {
                    if (node.intervalID !== -1) { resetInterval(); }
                    let toClear = node.buffer.length;
                    if (reset) { node.buffer = []; }
                    else { while (node.buffer.length > 0) { node.send(node.buffer.shift()); } }
                    if (node.busy) {
                        clearTimeout(node.busy);
                        node.busy = null;
                    }
                    node.status({ fill: (node.buffer.length === 0 ? "green" : "blue"), shape: "dot", text: queueTag + " " + node.buffer.length + " - " + tag + " (" + (typeof clear === "number"?"number":"all") + ": " + toClear + ")" });
                }
            }
        }

        var clearRateTopic = function (topic, flush = false) {
            let count = 0;
            if (topic) {
                for (var b = node.buffer.length - 1; b > -1; b--) { // check if already in queue
                    if (topic === node.buffer[b].topic) {
                        if (flush) { node.send(node.buffer.splice(b, 1)); }
                        else { node.buffer.splice(b, 1); }
                        count++;
                    }
                }
            }
            return count;
        }
		
		var closeRateLimit = function(){
			clearInterval(node.intervalID);
            clearTimeout(node.busy);
            node.buffer = [];
            node.status({ fill: "green", shape: "dot", text: queueTag + " 0"});
		}

        var resetInterval = function () {
            if (node.intervalID !== -1) clearInterval(node.intervalID);
            node.intervalID = -1;
        }

        var getIdIndex = function (id) {
            if (id) {
                for (var i = 0; i < node.idList.length; i++) {
                    if (node.idList[i] && node.idList[i].id === id) return i;
                }
            }
            return -1;
        }

        var getTimeout = function (msg, timeout, status) {
            var id = ourTimeout(function (status) {
                node.idList.splice(getIdIndex(id), 1);
                if (!node.busy) {
                    node.busy = setTimeout(function () {
                        node.status({ fill: (node.idList.length === 0 ? "green" : "blue"), shape: "dot", text: queueTag + " " + node.idList.length + (status ? " - " + status : "") });
                        node.busy = null;
                    }, delayStatus);
                }
                node.send(msg);
            }, timeout);
            return id;
        }

        node.reportDepth = function (rate = 0, nbRateUnits = node.nbRateUnits, rateUnits = node.rateUnits, clearTag) {
            if (!node.busy) {
                node.busy = setTimeout(function () {
                    if (!node.batch && (node.pauseType === "queue" || node.pauseType === "rate")) rate = 1;
					let tag = (node.buffer.length > 0 && typeof node.intervalRate === "number" ? " - " + (node.pauseType === "rate" && node.batch ? "batch" : node.pauseType) + " (" + (rate > 0 ? rate + "msg" + (rate > 1 ? "s" : "") + "/" : "") + (node.pauseType === "rate" && node.batch ? nbRateUnits + getShortUnits(rateUnits) + (rateUnits > 1 ? "s" : "") : node.intervalRate.toFixed(0) + shortMillisecondTag) : "") + (clearTag ? ", " + clearTag : "");
                    node.status({ fill: (node.buffer.length > 0 ? "blue" : "green"), shape: "dot", text: queueTag + " " + node.buffer.length + (tag ? tag + ")" : "")});
                    node.busy = null;
                }, node.intervalRate < rateStatus ? node.intervalRate : rateStatus);
            }
        }

        if (node.pauseType === "delay") {
            node.on("input", function (msg) {
                if (msg.hasOwnProperty(resetTag)) { clearDelayList(msg.reset, msg.topic, true); }
                else if (msg.hasOwnProperty(flushTag)) { clearDelayList(msg.flush, msg.topic); }
                else {
                    node.idList.push({ id: getTimeout(msg, node.timeout), topic: msg.topic });
                    if ((node.timeout > 1000) && (node.idList.length !== 0)) {
                        node.status({ fill: "blue", shape: "dot", text: queueTag + " " + node.idList.length });
                    }
                }
            });
            node.on("close", function () { 
				closeDelayList(); 
			});
        }
        else if (node.pauseType === "delayv") {
            node.on("input", function (msg) {
                if (msg.hasOwnProperty(resetTag)) { clearDelayList(msg.reset, msg.topic, true); }
                else if (msg.hasOwnProperty(flushTag)) { clearDelayList(msg.flush, msg.topic); }
                else {
                    var delayvar = Number(node.timeout);
                    if (msg.hasOwnProperty("delay") && !isNaN(parseFloat(msg.delay))) {
                        delayvar = parseFloat(msg.delay);
                    }
                    if (delayvar < 0) { delayvar = 0; }
                    node.idList.push({ id: getTimeout(msg, delayvar, "(" + delayvar + "ms)"), topic: msg.topic });
                    if ((delayvar >= 0) && (node.idList.length !== 0)) {
                        node.status({ fill: "blue", shape: "dot", text: queueTag + " " + node.idList.length + " (" + delayvar + "ms)" });
                    }
                }
            });
            node.on("close", function () { 
				closeDelayList(); 
			});
        }
        else if (node.pauseType === "rate") {
            node.on("input", function (msg) {
                if (msg.hasOwnProperty(resetTag)) {
                    clearRateList(msg.reset, msg.topic, true);
                } else if (msg.hasOwnProperty(flushTag)) {
                    clearRateList(msg.flush, msg.topic);
                } else {
                    if (!node.drop) {
                        var m = RED.util.cloneMessage(msg);
                        delete m.flush;

                        let nbRateUnits = (typeof msg.nbRateUnits === "number" ? msg.nbRateUnits : node.nbRateUnits);
                        let rateUnits = (typeof msg.rateUnits === "string" ? msg.rateUnits : node.rateUnits);
                        let rate = (typeof msg.rate === "number" ? msg.rate : node.rate);
                        let intervalRate = getRate((node.batch ? 1 : rate), nbRateUnits, rateUnits);

                        if (node.intervalID !== -1 && node.intervalRate === intervalRate) {
                            node.buffer.push(m);
                            node.reportDepth(rate, nbRateUnits, rateUnits);
                        }
                        else {
                            if (node.intervalID !== -1 && node.intervalRate !== intervalRate) resetInterval(node.intervalID); //Clear old timer, ready to set.

                            var intervalFunc = function (reportDepth = true) {
                                if (node.buffer.length === 0) {
                                    resetInterval();
                                } else if (node.buffer.length > 0) {
                                    node.send(node.buffer.shift());
                                }
                                if (reportDepth) node.reportDepth(rate, nbRateUnits, rateUnits);
                            }

                            var sendMessage = function () {
                                if (node.batch) {
                                    for (let i = 0; i < rate; i++) { intervalFunc(); }
                                } else {
                                    intervalFunc();
                                }
                            }

                            node.buffer.push(m);
                            node.reportDepth(rate, nbRateUnits, rateUnits);
                            

                            if (node.buffer.length > 0) {
                                if (node.pass && node.buffer.length===1){
                                    setTimeout(function(){
                                        sendMessage();
                                    }, (typeof msg.initialRate==="number" ? msg.initialRate : initialRate))
                                }

                                node.intervalID = setInterval(function () {
                                    sendMessage();
                                },intervalRate);

                                node.intervalRate = intervalRate;
                            } else {
                                node.reportDepth(rate, nbRateUnits, rateUnits);
                            }
                        }
                    }
                    else {
                        var timeSinceLast;
                        if (node.lastSent) {
                            timeSinceLast = process.hrtime(node.lastSent);
                        }
                        if (!node.lastSent) { // ensuring that we always send the first message
                            node.lastSent = process.hrtime();
                            node.send(msg);
                        }
                        else if (((timeSinceLast[0] * SECONDS_TO_NANOS) + timeSinceLast[1]) > (node.rate * MILLIS_TO_NANOS)) {
                            node.lastSent = process.hrtime();
                            node.send(msg);
                        }
                    }
                }
            });
            node.on("close", function () {
                closeRateLimit();
            });
        }
        else if ((node.pauseType === "queue") || (node.pauseType === "timed")) {
            node.on("input", function (msg) {
                let nbRateUnits = (typeof msg.nbRateUnits === "number" ? msg.nbRateUnits : node.nbRateUnits);
                let rateUnits = (typeof msg.rateUnits === "string" ? msg.rateUnits : node.rateUnits);
                let rate = (typeof msg.rate === "number" ? msg.rate : node.rate);
                let intervalRate = getRate(rate, nbRateUnits, rateUnits);

                if (node.intervalRate !== intervalRate) { resetInterval(); }

                if (msg.hasOwnProperty(resetTag)) {
                    clearRateList(msg.reset, msg.topic, true);
                    return;
                }
                if (msg.hasOwnProperty(flushTag)) {
                    clearRateList(msg.flush, msg.topic);
                    return;
                }

                if (node.intervalID == -1) {
                    node.intervalID = setInterval(function () {
                        if (node.pauseType === "queue") {
                            if (node.buffer.length > 0) {
                                node.send(node.buffer.shift()); // send the first on the queue
                            }
                            if (node.buffer.length === 0) { resetInterval(); }
                        }
                        else {
                            if (node.drop){
                                while (node.buffer.length > 0) {    // send the whole queue
                                    node.send(node.buffer.shift());
                                }
                            } else {
                                let topics=[];
                                for (var b=0;b < node.buffer.length;b++) {    // send one of all topics
                                    if (!topics.includes(node.buffer[b].topic)){
                                        topics.push(node.buffer[b].topic);
                                        node.send(node.buffer.splice(b,1));
                                    }
                                }
                            }
                            
                            if (node.buffer.length === 0) { resetInterval(); }
                        }
                        node.reportDepth(rate, nbRateUnits, rateUnits);
                    }, intervalRate);

                    node.intervalRate = intervalRate;
                }

                if (!msg.hasOwnProperty("topic")) { msg.topic = "_none_"; }
                var exists = false;

                if (node.drop){
                    for (var b in node.buffer) { // check if already in queue
                        if (msg.topic === node.buffer[b].topic) {
                            node.buffer[b] = msg; // if so - replace existing entry
                            exists = true;
                            break;
                        }
                    }
                }

                if (!exists) {
                    node.buffer.push(msg); // if not add to end of queue
                    node.reportDepth(rate, nbRateUnits, rateUnits);
                }

            });
            node.on("close", function () {
                closeRateLimit();
            });
        }
        else if (node.pauseType === "random") {
            node.on("input", function (msg) {
                if (msg.hasOwnProperty(resetTag)) { clearDelayList(msg.reset, msg.topic, true); }
                else if (msg.hasOwnProperty(flushTag)) { clearDelayList(msg.flush, msg.topic); }
                else {
                    var wait = node.randomFirst + (node.diff * Math.random());
                    let status = "(" + parseInt(wait / node.randomMultiply) + node.randomUnitsTag + ")";
                    node.idList.push({ id: getTimeout(msg, wait, status), topic: msg.topic });
                    if ((node.timeout >= 1000) && (node.idList.length !== 0)) {
                        node.status({ fill: "blue", shape: "dot", text: queueTag + " " + node.idList.length + " " + status });
                    }
                }

            });
            node.on("close", function () { 
				closeDelayList();
			});
        }
    }
    RED.nodes.registerType("vodelay", VODelayNode);
}