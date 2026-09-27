// Type declarations for the window functions the fixture page exposes.
// See peer.html for the real code. The test script (in Node) calls these
// through page.evaluate, so their types must match here by hand.
declare global {
  interface Window {
    createPeer(iceServers: RTCIceServer[]): boolean;
    drainCandidates(): RTCIceCandidateInit[];
    addMicTrack(): Promise<boolean>;
    addRecvOnlyAudio(): boolean;
    createOffer(): Promise<RTCSessionDescriptionInit>;
    createAnswer(offer: RTCSessionDescriptionInit): Promise<RTCSessionDescriptionInit>;
    acceptAnswer(answer: RTCSessionDescriptionInit): Promise<boolean>;
    addRemoteCandidate(candidate: RTCIceCandidateInit): Promise<boolean>;
    getConnectionState(): RTCPeerConnectionState;
    getSelectedCandidateType(): Promise<string | null>;
    getInboundBytesReceived(): Promise<number>;
  }
}

export {};
