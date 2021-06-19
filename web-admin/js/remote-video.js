function RemoteVideo(remoteVideoElem, videoLoader, videoStats) {
    this.streaming = null;
    this.remoteVideoElem = remoteVideoElem;
    this.videoLoader = videoLoader;
    this.videoStats = videoStats;
    this.stream = null;
    this.mountpointId = null;

    this.videoResolution = null;
    this.isVideoAlreadyPlayed = false;

    var obj = this;  // for event handlers

    this.getStreamVideotracks = function () {
        return this.stream ? this.stream.getVideoTracks() : [];
    }

    this.noRemoteVideo = function () {
        if (!this.isVideoAlreadyPlayed || window.debugUtils.isDebugEnabled()) {
            this.videoLoader.show();
        }
    }

    this.hasRemoteVideo = function () {
        this.videoLoader.hide();
    }

    this.setStreamingPluginHandle = function (streaming) {
        this.streaming = streaming;
    }

    this.setResolution = function (w, h) {
        this.videoResolution = [w, h];
        this.remoteVideoElem.attr('width', w).attr('height', h);
    }

    this.setStream = function (stream) {
        let streamChanged = false;
        if (this.stream !== stream) {
            this.stream = stream;
            streamChanged = true;
        }

        if (this.getStreamVideotracks().length > 0) {
            if (streamChanged) {
                Janus.attachMediaStream(this.remoteVideoElem.get(0), this.stream);
            }
            this.hasRemoteVideo();
            if (['chrome', 'firefox', 'safari'].indexOf(Janus.webRTCAdapter.browserDetails.browser) >= 0) {
                this.videoStats.start();
            }
        } else {
            this.noRemoteVideo();
            this.videoStats.stop();
        }
    }

    this.startStreamMountpoint = function (mountpointId, pin) {
        this.mountpointId = mountpointId;

        var body = { "request": "watch", "id": mountpointId, "pin": pin };
        this.streaming.send({ "message": body });
        this.noRemoteVideo();
    }

    this.remoteVideoElem.on("playing", function (e) {

        if (obj.getStreamVideotracks().length > 0) {
            obj.videoStats.start();
            remoteVideoElem = obj.remoteVideoElem.get(0);
            obj.setResolution(remoteVideoElem.videoWidth, remoteVideoElem.videoHeight);
            obj.isVideoAlreadyPlayed = true;
        } else {
            obj.videoStats.stop();
        }
    });

    this.stopStreaming = function () {
        this.streaming.send({ "message": { "request": "stop" } });
        this.streaming.hangup();
        this.cleanup();
    }

    this.cleanup = function () {
        this.videoStats.stop();
    }
}
