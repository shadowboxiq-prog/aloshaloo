import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import { Platform, Alert } from 'react-native';
import { supabase } from '../lib/supabase';
import { Audio } from 'expo-av';

type CallStatus = 'idle' | 'calling' | 'ringing' | 'connected';

interface CallContextType {
  status: CallStatus;
  caller: { id: string; username: string; avatar: string | null } | null;
  remoteUserId: string | null;
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  startCall: (targetUserId: string, targetUsername: string, targetAvatar: string | null, isVideo?: boolean) => Promise<void>;
  acceptCall: () => Promise<void>;
  rejectCall: () => void;
  endCall: () => void;
  isMuted: boolean;
  setIsMuted: (muted: boolean) => void;
  isVideoCall: boolean;
  toggleCamera: () => void;
}

const CallContext = createContext<CallContextType | undefined>(undefined);

export const useCall = () => {
  const context = useContext(CallContext);
  if (!context) throw new Error('useCall must be used within CallProvider');
  return context;
};

const ICE_SERVERS: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' },
    { urls: 'turn:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' },
    { urls: 'turn:openrelay.metered.ca:443?transport=tcp', username: 'openrelayproject', credential: 'openrelayproject' },
  ],
};

/** Wait for ICE gathering — short timeout since TURN resolves fast. */
function waitForIce(pc: RTCPeerConnection): Promise<{ type: string; sdp: string }> {
  return new Promise((resolve) => {
    const finish = () => resolve({ type: pc.localDescription!.type, sdp: pc.localDescription!.sdp });
    if (pc.iceGatheringState === 'complete') { finish(); return; }
    const timer = setTimeout(finish, 3000); // 3s max
    pc.addEventListener('icegatheringstatechange', () => {
      if (pc.iceGatheringState === 'complete') { clearTimeout(timer); finish(); }
    });
  });
}

/** Play remote audio imperatively. */
function playRemoteAudio(stream: MediaStream) {
  if (Platform.OS !== 'web') return;
  stopRemoteAudio();
  const audio = document.createElement('audio');
  audio.id = 'webrtc-remote-audio';
  audio.autoplay = true;
  (audio as any).playsInline = true;
  audio.srcObject = stream;
  document.body.appendChild(audio);
  audio.play().catch(() => {});
}
function stopRemoteAudio() {
  if (Platform.OS !== 'web') return;
  const el = document.getElementById('webrtc-remote-audio') as HTMLAudioElement | null;
  if (el) { el.srcObject = null; el.remove(); }
}

export const CallProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [status, setStatus] = useState<CallStatus>('idle');
  const [caller, setCaller] = useState<{ id: string; username: string; avatar: string | null } | null>(null);
  const [remoteUserId, setRemoteUserId] = useState<string | null>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoCall, setIsVideoCall] = useState(false);
  const [activeCallId, setActiveCallId] = useState<string | null>(null);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const subscriptionRef = useRef<any>(null);
  const soundRef = useRef<Audio.Sound | null>(null);
  const currentUidRef = useRef<string | null>(null);

  // Pre-cached data for fast accept
  const cachedOfferRef = useRef<{ type: string; sdp: string } | null>(null);
  const preStreamRef = useRef<MediaStream | null>(null);
  // Cache my profile so startCall doesn't need to fetch it each time
  const myProfileRef = useRef<{ name: string; avatar: string | null } | null>(null);

  // ─── Auth & signaling ───────────────────────────────────────────────
  useEffect(() => {
    const init = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        currentUidRef.current = session.user.id;
        setupSignaling(session.user.id);
        // Pre-cache profile
        cacheMyProfile(session.user.id);
      }
    };
    init();

    const { data: authListener } = supabase.auth.onAuthStateChange((_ev, session) => {
      if (session) {
        currentUidRef.current = session.user.id;
        setupSignaling(session.user.id);
        cacheMyProfile(session.user.id);
      } else {
        currentUidRef.current = null;
        subscriptionRef.current?.unsubscribe();
      }
    });

    return () => { subscriptionRef.current?.unsubscribe(); stopSound(); authListener.subscription.unsubscribe(); };
  }, []);

  const cacheMyProfile = async (uid: string) => {
    try {
      const { data } = await supabase.from('profiles').select('username, avatar_url').eq('id', uid).single();
      if (data) myProfileRef.current = { name: data.username || 'مستخدم', avatar: data.avatar_url || null };
    } catch {}
  };

  // ─── Sound ──────────────────────────────────────────────────────────
  const playSound = async (type: 'calling' | 'ringing') => {
    try {
      if (soundRef.current) await soundRef.current.unloadAsync();
      const url = type === 'calling'
        ? 'https://assets.mixkit.co/active_storage/sfx/2592/2592-preview.mp3'
        : 'https://assets.mixkit.co/active_storage/sfx/2591/2591-preview.mp3';
      const { sound } = await Audio.Sound.createAsync({ uri: url }, { shouldPlay: true, isLooping: true });
      soundRef.current = sound;
    } catch {}
  };
  const stopSound = async () => {
    if (soundRef.current) { try { await soundRef.current.stopAsync(); await soundRef.current.unloadAsync(); } catch {} soundRef.current = null; }
  };

  // ─── DB signaling ───────────────────────────────────────────────────
  const setupSignaling = (uid: string) => {
    subscriptionRef.current?.unsubscribe();

    subscriptionRef.current = supabase
      .channel(`calls-${uid}-${Date.now()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'calls' }, async (payload: any) => {
        const call = payload.new || payload.old;
        if (!call) return;

        if (call.receiver_id === uid) {
          if (payload.eventType === 'INSERT') {
            setActiveCallId(call.id);
            setRemoteUserId(call.caller_id);
            setCaller({ id: call.caller_id, username: call.caller_name, avatar: call.caller_avatar });
            setIsVideoCall(!!call.is_video);
            setStatus('ringing');
            playSound('ringing');

            // Pre-request microphone (and camera if video) while ringing (so accept is instant)
            navigator.mediaDevices.getUserMedia({ audio: true, video: !!call.is_video })
              .then(s => { preStreamRef.current = s; })
              .catch(() => {});

            // If offer is already in this INSERT, cache it
            if (call.offer?.sdp) cachedOfferRef.current = call.offer;
          }
          // Cache offer when it arrives via UPDATE
          if (payload.eventType === 'UPDATE' && call.offer?.sdp && !cachedOfferRef.current) {
            cachedOfferRef.current = call.offer;
          }
          if (payload.eventType === 'UPDATE' && (call.status === 'ended' || call.status === 'rejected')) cleanupCall();
          if (payload.eventType === 'DELETE') cleanupCall();
        }

        // ── CALLER ──
        if (call.caller_id === uid) {
          if (payload.eventType === 'UPDATE') {
            if (call.status === 'connected' && call.answer) {
              stopSound();
              setStatus('connected');
              try {
                if (pcRef.current) await pcRef.current.setRemoteDescription({ type: call.answer.type, sdp: call.answer.sdp });
              } catch (e) { console.error('[Sig] setRemoteDescription error:', e); }
            }
            if (call.status === 'rejected' || call.status === 'ended') {
              cleanupCall();
              if (call.status === 'rejected') Alert.alert('المكالمة', 'تم رفض المكالمة من قبل الطرف الآخر');
            }
          }
          if (payload.eventType === 'DELETE') cleanupCall();
        }
      })
      .subscribe();
  };

  // ─── Start call (CALLER) ────────────────────────────────────────────
  const startCall = async (targetUid: string, targetUsername: string, targetAvatar: string | null, isVideo = false) => {
    try {
      // ① Get mic/cam + set UI simultaneously
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: isVideo });
      setLocalStream(stream);
      setRemoteUserId(targetUid);
      setCaller({ id: targetUid, username: targetUsername, avatar: targetAvatar });
      setIsVideoCall(isVideo);
      setStatus('calling');
      playSound('calling');

      const uid = currentUidRef.current!;
      const myName = myProfileRef.current?.name || 'مستخدم';
      const myAvatar = myProfileRef.current?.avatar || null;

      // ② Create PeerConnection & start ICE gathering NOW (runs in background)
      const pc = new RTCPeerConnection(ICE_SERVERS);
      pcRef.current = pc;
      pc.ontrack = (ev) => { if (ev.streams[0]) { setRemoteStream(ev.streams[0]); playRemoteAudio(ev.streams[0]); } };
      stream.getTracks().forEach(t => pc.addTrack(t, stream));
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      // ③ INSERT call into DB immediately (don't wait for ICE!)
      const icePromise = waitForIce(pc); // runs in parallel
      const { data, error } = await supabase.from('calls').insert([{
        caller_id: uid,
        receiver_id: targetUid,
        caller_name: myName,
        caller_avatar: myAvatar,
        offer: null,
        status: 'ringing',
        is_video: isVideo,
      }]).select().single();
      if (error) throw error;
      setActiveCallId(data.id);

      // ④ Wait for ICE to finish, then update offer
      const fullOffer = await icePromise;
      await supabase.from('calls').update({ offer: fullOffer }).eq('id', data.id);

    } catch (err) {
      console.error('[Call] startCall error:', err);
      cleanupCall();
      Alert.alert('خطأ', 'تعذر بدء المكالمة، تأكد من صلاحيات الميكروفون.');
    }
  };

  // ─── Accept call (RECEIVER) ─────────────────────────────────────────
  const acceptCall = async () => {
    try {
      // ① Use pre-cached mic stream, or get new one
      const stream = preStreamRef.current || await navigator.mediaDevices.getUserMedia({ audio: true, video: isVideoCall });
      preStreamRef.current = null;
      setLocalStream(stream);
      setStatus('connected');
      stopSound();

      // ② Get offer — use cache first, then poll briefly
      let offerData = cachedOfferRef.current;
      if (!offerData) {
        for (let i = 0; i < 10; i++) {
          const { data: call } = await supabase.from('calls').select('offer').eq('id', activeCallId).single();
          if (call?.offer?.sdp) { offerData = call.offer; break; }
          await new Promise(r => setTimeout(r, 300));
        }
      }
      cachedOfferRef.current = null;
      if (!offerData) throw new Error('Offer not available');

      // ③ Create PeerConnection, set offer, create answer
      const pc = new RTCPeerConnection(ICE_SERVERS);
      pcRef.current = pc;
      pc.ontrack = (ev) => { if (ev.streams[0]) { setRemoteStream(ev.streams[0]); playRemoteAudio(ev.streams[0]); } };
      stream.getTracks().forEach(t => pc.addTrack(t, stream));

      await pc.setRemoteDescription({ type: offerData.type, sdp: offerData.sdp });
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      const fullAnswer = await waitForIce(pc);

      // ④ Save answer
      await supabase.from('calls').update({ status: 'connected', answer: fullAnswer }).eq('id', activeCallId);

    } catch (err) {
      console.error('[Call] acceptCall error:', err);
      rejectCall();
    }
  };

  // ─── Reject / End / Cleanup ─────────────────────────────────────────
  const rejectCall = async () => {
    if (activeCallId) await supabase.from('calls').update({ status: 'rejected' }).eq('id', activeCallId);
    cleanupCall();
  };
  const endCall = async () => {
    if (activeCallId) await supabase.from('calls').update({ status: 'ended' }).eq('id', activeCallId);
    cleanupCall();
  };

  const cleanupCall = () => {
    setStatus('idle');
    setCaller(null);
    setRemoteUserId(null);
    setActiveCallId(null);
    setIsMuted(false);
    setIsVideoCall(false);
    stopSound();
    stopRemoteAudio();
    if (localStream) { localStream.getTracks().forEach(t => t.stop()); setLocalStream(null); }
    // Also stop pre-cached stream
    if (preStreamRef.current) { preStreamRef.current.getTracks().forEach(t => t.stop()); preStreamRef.current = null; }
    setRemoteStream(null);
    if (pcRef.current) { pcRef.current.close(); pcRef.current = null; }
    cachedOfferRef.current = null;
  };

  const toggleCamera = () => {
    if (localStream) {
      localStream.getVideoTracks().forEach(t => { t.enabled = !t.enabled; });
    }
  };

  useEffect(() => {
    if (localStream) localStream.getAudioTracks().forEach(t => { t.enabled = !isMuted; });
  }, [isMuted, localStream]);

  return (
    <CallContext.Provider value={{
      status, caller, remoteUserId, localStream, remoteStream,
      startCall, acceptCall, rejectCall, endCall, isMuted, setIsMuted,
      isVideoCall, toggleCamera
    }}>
      {children}
    </CallContext.Provider>
  );
};
