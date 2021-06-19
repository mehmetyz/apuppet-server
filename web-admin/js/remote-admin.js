$(document).ready(function () {
    var ui = new UI();

    window['ui'] = ui;

    var isJoystickOn = false;

    // Make sure the browser supports WebRTC
    if (!Janus.isWebrtcSupported()) {
        ui.showErrorModal('There is no WebRTC support in this browser. Please, try the newest version of Google Chrome or Mozilla Firefox', 'no_webrtc_support', function () { window.location.reload(); });

        return;
    }

    var remoteChat = new RemoteChat(
        $('#textroomChat'),
        $('#chat-form'),
        $('#textroomMessageInput'),
        $('#textroomSendButton'),
    )

    var videoStats = new VideoStats(
        $('#streamingCurrentBitrate'),
        $('#streamingCurrentResolution'),
        $('#streamingRemoteVideo'),
    );

    var videoLoader = new Loader($("#videoLoader"));

    var remoteVideo = new RemoteVideo(
        $('#streamingRemoteVideo'),
        videoLoader,
        videoStats,
    );

    var commands = new Commands(remoteChat, remoteVideo);
    remoteChat.setCommandsProcessor(commands);

    const gesture = $('#deviceGestures');
    var gestureBuilder = new GestureBuilder(gesture, remoteChat);

    var sessionMonitoring = new SessionMonitoring(remoteChat);

    // Cheat codes on page :)
    window.cheatCodes = new CheatCodes();

    var remoteKeyboard = new RemoteKeyboard(remoteChat, gestureBuilder, gesture);

    var remoteClipboard = new RemoteClipboard(remoteChat);

    window['debugUtils'] = new DebugUtils(remoteChat);

    ui.on('CheatCodes.onCheatEntered', function (cheat) {
        if (cheat === 'needtodebug') {
            window.debugUtils.enable();
        }
    });

    // objects
    var janus = null;
    var textroom = null;
    var streaming = null;

    // Initialize Janus Library
    ui.initStart();
    Janus.init({
        debug: janusDebugLevel,
        callback: function () {
            janus = new Janus({
                server: janusServers,
                apisecret: apiSecret,
                success: function () {
                    // Attach to TextRoom plugin
                    janus.attach({
                        plugin: "janus.plugin.textroom",
                        opaqueId: textroomOpaqueId,
                        success: function (pluginHandle) {
                            textroom = pluginHandle;

                            remoteChat.setUp(textroom);
                            ui.initTextroomReady();
                        },

                        error: function (error) {
                            bootbox.alert("Ошибка подключения к сессии: " + error);
                        },

                        iceState: function (state) {
                            console.debug("textroom: ICE state changed to " + state)
                        },
                        webrtcState: function (on) {
                            console.debug("textroom: WebRTC PeerConnection is " + (on ? "UP" : "DOWN") + " now")
                        },

                        slowLink: function (uplink, lost) {
                            ui.showWarning(`Network problems`, 'Device management', null, null, 2000);
                        },

                        onmessage: function (msg, jsep) {

                            if (msg.error) {
                                bootbox.alert(msg.error);
                            }
                            if (jsep) {
                                // Answer
                                textroom.createAnswer({
                                    jsep: jsep,
                                    media: { audio: false, video: false, data: true },
                                    success: function (jsep) {
                                        console.debug("textroom: success answering with SDP", jsep);
                                        var body = { "request": "ack" };
                                        textroom.send({ "message": body, "jsep": jsep });
                                    },
                                    error: function (error) {
                                        console.error("textroom: WebRTC error", error);
                                        ui.showError(`'WebRTC error: ${JSON.stringify(error)}`, 'webrtc_error');
                                    }
                                });
                            }
                        },

                        ondataopen: function (data) {
                            console.debug("textroom: DataChannel is available", data);
                        },

                        ondata: function (rawData) {

                            var data = JSON.parse(rawData);

                            // process transaction if we have response on it
                            var transactionId = data.transaction;
                            var transactionResult = remoteChat.processTransactionAnswer(transactionId, data);
                            if (transactionResult) {
                                return;
                            }

                            var what = data.textroom;
                            if (what === "message") {
                                // Incoming Message
                                remoteChat.processIncomingMessage(data.text, data.from, data.date, data.whisper);
                            } else if (what === "announcement") {
                                // Room Announcement
                                remoteChat.processAnnouncement(data.text, data.date);
                            } else if (what === "join") {
                                // Somebody joined
                                remoteChat.processJoin(data.username, data.display);
                            } else if (what === "leave") {
                                // Somebody left
                                remoteChat.processLeave(data.username);
                            } else if (what === "kicked") {
                                // Somebody was kicked
                                remoteChat.processKick(data.username);
                            } else if (what === "destroyed") {
                                remoteChat.processRoomDestroy(data.room);
                            }
                        },

                        oncleanup: function () {
                            remoteChat.cleanup();
                        }
                    });

                    // Attach to Streaming plugin
                    janus.attach({
                        plugin: "janus.plugin.streaming",
                        opaqueId: streamingOpaqueId,
                        success: function (pluginHandle) {
                            streaming = pluginHandle;
                            remoteVideo.setStreamingPluginHandle(streaming);
                            videoStats.setStreamingPluginHandle(streaming);
                            ui.initStreamingReady();
                        },

                        error: function (error) {
                            ui.showError(`'Streaming error: ${error}`, 'streaming_error');
                        },

                        iceState: function (state) {
                            console.debug("streaming: ICE state changed to " + state)
                        },
                        webrtcState: function (on) {
                            console.debug("streaming: WebRTC PeerConnection is " + (on ? "UP" : "DOWN") + " now")
                        },

                        slowLink: function (uplink, lost) {
                            ui.showWarning(`Network problems`, 'Screen sharing', null, null, 2000);
                        },

                        onmessage: function (msg, jsep) {
                            var result = msg.result;
                            // check result
                            if (result) {
                                if (result.status) {
                                    if (result.status === 'starting') {
                                        $('#streamingStatus').text("Starting, please wait...").removeClass('d-none');
                                    } else if (result.status === 'started') {
                                        $('#streamingStatus').text("Started").removeClass('d-none');
                                    } else if (result.status === 'stopped') {
                                        remoteVideo.stopStreaming();
                                    }
                                } else if (msg.streaming === 'event') {
                                    // todo: simulcast in place? Is VP9/SVC in place?
                                }
                                ui.connStreamingReady();
                            }
                            // check error
                            else if (msg.error) {
                                ui.connAbort();

                                if (msg.error_code === 455) {
                                    ui.showError(`Session ${remoteVideo.mountpointId} does not exist`, 'no_session');
                                } else {
                                    ui.showError(msg["error"], 'streaming_message_error');
                                    remoteVideo.stopStreaming();
                                }
                                return;
                            }

                            // handle JSEP
                            if (jsep) {
                                var stereo = (jsep.sdp.indexOf("stereo=1") !== -1);
                                // got offer from the plugin, let's answer
                                streaming.createAnswer({
                                    jsep: jsep,
                                    // We want recvonly audio/video and, if negotiated, datachannels
                                    media: { audioSend: false, videoSend: false, data: true },

                                    // our offer should contains stereo if remote SDP has it
                                    customizeSdp: function (jsep) {
                                        if (stereo && jsep.sdp.indexOf("stereo=1") === -1) {
                                            jsep.sdp = jsep.sdp.replace("useinbandfec=1", "useinbandfec=1;stereo=1");
                                        }
                                    },
                                    success: function (jsep) {
                                        var body = { "request": "start" };
                                        streaming.send({ "message": body, "jsep": jsep });
                                    },
                                    error: function (error) {
                                        ui.showError(`'WebRTC error: ${JSON.stringify(error)}`, 'webrtc_error');
                                    }
                                });
                            }
                        },

                        onremotestream: function (stream) {
                            remoteVideo.setStream(stream);
                        },
                        oncleanup: function () {
                            remoteVideo.cleanup();
                        },
                    });
                },
                error: function (error) {
                    ui.showErrorModal(`Session error: ${error}`, 'janus_session_error', function () { window.location.reload(); }, 5);
                },
                destroyed: function () {
                    ui.sessionClosedRemotely('Session has been destroyed');
                }
            });
        }
    });
    // Session login
    $('#login-form').on('submit', function (e) {
        var sessionId = $('#input-session-id').val();
        var pin = $('#input-pin').val();
        ui.connStart();
        remoteVideo.startStreamMountpoint(sessionId, pin);
        remoteChat.startRoom(sessionId, pin);

        Janus.log = function (strix) { };
        e.preventDefault();
    });

    // Back button
    $('#btnBack').on('click', function (e) {
        if (remoteChat) {
            remoteChat.sendData('back');
        }
    });

    // Home button
    $('#btnHome').on('click', function (e) {
        if (remoteChat) {
            remoteChat.sendData('home');
        }
    });

    // Recents button
    $('#btnRecents').on('click', function (e) {
        if (remoteChat) {
            remoteChat.sendData('recents');
        }
    });

    // Notification button
    $('#btnNotifications').on('click', function (e) {
        if (remoteChat) {
            remoteChat.sendData('notifications');
        }
    });

    // Disconnect button
    $('#btnDisconnect').on('click', function (e) {
        ui.emit('Session.Disconnect');
    });

    ui.on('Session.Disconnect', function () {
        remoteVideo.stopStreaming();
        remoteChat.leaveRoom();
        ui.disconnect();
    });


    // Close debug stuff
    $('#debugClose').on('click', function (e) {
        window.debugUtils.disable();
    });


});

