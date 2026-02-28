import { useRef, useCallback, useEffect } from 'react';
import { useSocket } from './useSocket';
import { useStreamStore } from '../store/streamStore';

const ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

export const useWebRTC = (streamId: string | null) => {
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteStreamRef = useRef<MediaStream | null>(null);
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const { connect, sendOffer, sendAnswer, sendIceCandidate, socket } = useSocket();
  const { setStreaming } = useStreamStore();

  const createPeerConnection = useCallback(() => {
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });

    pc.onicecandidate = (event) => {
      if (event.candidate && streamId) {
        const targetId = (pc as any)._targetSocketId;
        if (targetId) sendIceCandidate(targetId, event.candidate, streamId);
      }
    };

    pc.ontrack = (event) => {
      const [remoteStream] = event.streams;
      remoteStreamRef.current = remoteStream;
      if (remoteVideoRef.current) {
        remoteVideoRef.current.srcObject = remoteStream;
      }
    };

    pc.onconnectionstatechange = () => {
      setStreaming(pc.connectionState === 'connected');
    };

    pc.oniceconnectionstatechange = () => { /* ICE state change */ };

    peerConnectionRef.current = pc;
    return pc;
  }, [streamId, sendIceCandidate, setStreaming]);

  const startLocalStream = useCallback(async (video = true, audio = true) => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video, audio });
      localStreamRef.current = stream;
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
      }
      return stream;
    } catch (err) {
      throw err;
    }
  }, []);

  const startCall = useCallback(async (targetSocketId: string) => {
    if (!streamId) return;
    const pc = createPeerConnection();
    (pc as any)._targetSocketId = targetSocketId;

    const stream = localStreamRef.current || await startLocalStream();
    stream.getTracks().forEach((track) => pc.addTrack(track, stream));

    const offer = await pc.createOffer({ offerToReceiveVideo: true, offerToReceiveAudio: true });
    await pc.setLocalDescription(offer);
    sendOffer(targetSocketId, offer, streamId);
  }, [streamId, createPeerConnection, startLocalStream, sendOffer]);

  const stopStream = useCallback(() => {
    peerConnectionRef.current?.close();
    peerConnectionRef.current = null;
    localStreamRef.current?.getTracks().forEach((t) => t.stop());
    localStreamRef.current = null;
    if (localVideoRef.current) localVideoRef.current.srcObject = null;
    if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;
    setStreaming(false);
  }, [setStreaming]);

  // Handle incoming WebRTC signaling
  useEffect(() => {
    const s = connect();
    if (!s || !streamId) return;

    const handleOffer = async ({ offer, fromSocketId }: { offer: RTCSessionDescriptionInit; fromSocketId: string }) => {
      const pc = createPeerConnection();
      (pc as any)._targetSocketId = fromSocketId;
      const stream = localStreamRef.current || await startLocalStream(false, true);
      stream.getTracks().forEach((track) => pc.addTrack(track, stream));
      await pc.setRemoteDescription(new RTCSessionDescription(offer));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      sendAnswer(fromSocketId, answer, streamId);
    };

    const handleAnswer = async ({ answer }: { answer: RTCSessionDescriptionInit }) => {
      await peerConnectionRef.current?.setRemoteDescription(new RTCSessionDescription(answer));
    };

    const handleIce = async ({ candidate }: { candidate: RTCIceCandidateInit }) => {
      await peerConnectionRef.current?.addIceCandidate(new RTCIceCandidate(candidate));
    };

    s.on('webrtc-offer', handleOffer);
    s.on('webrtc-answer', handleAnswer);
    s.on('ice-candidate', handleIce);

    return () => {
      s.off('webrtc-offer', handleOffer);
      s.off('webrtc-answer', handleAnswer);
      s.off('ice-candidate', handleIce);
    };
  }, [streamId, connect, createPeerConnection, startLocalStream, sendAnswer]);

  return {
    localVideoRef,
    remoteVideoRef,
    startCall,
    startLocalStream,
    stopStream,
    peerConnection: peerConnectionRef.current,
  };
};
