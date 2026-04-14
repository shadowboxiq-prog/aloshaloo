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
  startCall: (targetUserId: string, targetUsername: string, targetAvatar: string | null) => Promise<void>;
  acceptCall: () => Promise<void>;
  rejectCall: () => void;
  endCall: () => void;
  isMuted: boolean;
  setIsMuted: (muted: boolean) => void;
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
    // Free TURN servers for NAT traversal
    {
      urls: 'turn:openrelay.metered.ca:80',
      username: 'openrelayproject',
      credential: 'openrelayproject',
    },
    {
      urls: 'turn:openrelay.metered.ca:443',
      username: 'openrelayproject',
      credential: 'openrelayproject',
    },
    {
      urls: 'turn:openrelay.metered.ca:443?transport=tcp',
      username: 'openrelayproject',
      credential: 'openrelayproject',
    },
  ],
};

/** Wait for ICE gathering to finish, returns plain { type, sdp } object. */
function waitForIceComplete(pc: RTCPeerConnection, timeoutMs = 8000): Promise<{ type: string; sdp: string }> {
  return new Promise((resolve) => {
    const finish = () => {
      const ld = pc.localDescription;
      resolve({ type: ld!.type, sdp: ld!.sdp });
    };
    if (pc.iceGatheringState === 'complete') { finish(); return; }
    const timer = setTimeout(() => { console.log('[ICE] Gathering timed out'); finish(); }, timeoutMs);
    pc.addEventListener('icegatheringstatechange', () => {
      if (pc.iceGatheringState === 'complete') { clearTimeout(timer); finish(); }
    });
  });
}

/** Play remote audio imperatively (bypasses React re-render issues). */
function playRemoteAudio(stream: MediaStream): HTMLAudioElement | null {
  if (Platform.OS !== 'web') return null;
  try {
    const audio = document.createElement('audio');
    audio.id = 'webrtc-remote-audio';
    audio.autoplay = true;
    (audio as any).playsInline = true;
    audio.srcObject = stream;
    document.body.appendChild(audio);
    audio.play().catch(e => console.warn('[Audio] play() rejected:', e));
    console.log('[Audio] Remote audio element created and playing');
    return audio;
  } catch (e) { console.error('[Audio] Failed to create audio element:', e); return null; }
}

function stopRemoteAudio() {
  if (Platform.OS !== 'web') return;
  try {
    const el = document.getElementById('webrtc-remote-audio');
    if (el) { (el as HTMLAudioElement).srcObject = null; el.remove(); }
  } catch {}
}

export const CallProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [status, setStatus] = useState<CallStatus>('idle');
  const [caller, setCaller] = useState<{ id: string; username: string; avatar: string | null } | null>(null);
  const [remoteUserId, setRemoteUserId] = useState<string | null>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [isMuted, setIsMuted] = useState(false);
  const [activeCallId, setActiveCallId] = useState<string | null>(null);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const subscriptionRef = useRef<any>(null);
  const soundRef = useRef<Audio.Sound | null>(null);
  const currentUidRef = useRef<string | null>(null);

  // ─── Auth & signaling setup ─────────────────────────────────────────
  useEffect(() => {
    const init = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (session) { currentUidRef.current = session.user.id; setupSignaling(session.user.id); }
    };
    init();

    const { data: authListener } = supabase.auth.onAuthStateChange((_ev, session) => {
      if (session) { currentUidRef.current = session.user.id; setupSignaling(session.user.id); }
      else { currentUidRef.current = null; subscriptionRef.current?.unsubscribe(); }
    });

    return () => { subscriptionRef.current?.unsubscribe(); stopSound(); authListener.subscription.unsubscribe(); };
  }, []);

  // ─── Sound helpers ──────────────────────────────────────────────────
  const playSound = async (type: 'calling' | 'ringing') => {
    try {
      if (soundRef.current) await soundRef.current.unloadAsync();
      const url = type === 'calling'
        ? 'https://assets.mixkit.co/active_storage/sfx/2592/2592-preview.mp3'
        : 'https://assets.mixkit.co/active_storage/sfx/2591/2591-preview.mp3';
      const { sound } = await Audio.Sound.createAsync({ uri: url }, { shouldPlay: true, isLooping: true });
      soundRef.current = sound;
    } catch (e) { console.log('[Sound] error:', e); }
  };
  const stopSound = async () => {
    if (soundRef.current) { try { await soundRef.current.stopAsync(); await soundRef.current.unloadAsync(); } catch {} soundRef.current = null; }
  };

  // ─── DB signaling ───────────────────────────────────────────────────
  const setupSignaling = (uid: string) => {
    console.log('[Sig] Listening for calls for:', uid);
    subscriptionRef.current?.unsubscribe();

    subscriptionRef.current = supabase
      .channel(`calls-${uid}-${Date.now()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'calls' }, async (payload: any) => {
        const call = payload.new || payload.old;
        if (!call) return;

        // ── RECEIVER side ──
        if (call.receiver_id === uid) {
          if (payload.eventType === 'INSERT') {
            console.log('[Sig] Incoming call from:', call.caller_name);
            setActiveCallId(call.id);
            setRemoteUserId(call.caller_id);
            setCaller({ id: call.caller_id, username: call.caller_name, avatar: call.caller_avatar });
            setStatus('ringing');
            playSound('ringing');
          }
          if (payload.eventType === 'UPDATE' && (call.status === 'ended' || call.status === 'rejected')) cleanupCall();
          if (payload.eventType === 'DELETE') cleanupCall();
        }

        // ── CALLER side ──
        if (call.caller_id === uid) {
          if (payload.eventType === 'UPDATE') {
            if (call.status === 'connected' && call.answer) {
              console.log('[Sig] Caller: answer received, setting remote desc');
              stopSound();
              setStatus('connected');
              try {
                if (pcRef.current) {
                  await pcRef.current.setRemoteDescription({ type: call.answer.type, sdp: call.answer.sdp });
                  console.log('[Sig] Caller: remote desc SET. connectionState:', pcRef.current.connectionState,
                    'iceConnectionState:', pcRef.current.iceConnectionState);
                }
              } catch (e) { console.error('[Sig] Caller setRemoteDescription error:', e); }
            }
            if (call.status === 'rejected' || call.status === 'ended') {
              cleanupCall();
              if (call.status === 'rejected') Alert.alert('المكالمة', 'تم رفض المكالمة من قبل الطرف الآخر');
            }
          }
          if (payload.eventType === 'DELETE') cleanupCall();
        }
      })
      .subscribe((s) => console.log('[Sig] channel status:', s));
  };

  // ─── Start call (CALLER) ────────────────────────────────────────────
  const startCall = async (targetUid: string, targetUsername: string, targetAvatar: string | null) => {
    try {
      console.log('[Call] Starting call to:', targetUsername);
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      setLocalStream(stream);
      setRemoteUserId(targetUid);
      setCaller({ id: targetUid, username: targetUsername, avatar: targetAvatar });
      setStatus('calling');
      playSound('calling');

      // Get my info
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');
      const { data: profile } = await supabase.from('profiles').select('username, avatar_url').eq('id', user.id).single();
      const myName = profile?.username || user?.user_metadata?.username || 'مستخدم';
      const myAvatar = profile?.avatar_url || user?.user_metadata?.avatar_url || null;

      // ① INSERT call row IMMEDIATELY → receiver gets notification instantly
      const { data, error } = await supabase.from('calls').insert([{
        caller_id: user.id,
        receiver_id: targetUid,
        caller_name: myName,
        caller_avatar: myAvatar,
        offer: null,
        status: 'ringing',
      }]).select().single();
      if (error) throw error;
      setActiveCallId(data.id);
      console.log('[Call] Call row created INSTANTLY:', data.id);

      // ② Create peer connection & gather ICE in parallel
      const pc = new RTCPeerConnection(ICE_SERVERS);
      pcRef.current = pc;
      pc.oniceconnectionstatechange = () => console.log('[PC-Caller] iceConnectionState:', pc.iceConnectionState);
      pc.onconnectionstatechange = () => console.log('[PC-Caller] connectionState:', pc.connectionState);
      pc.ontrack = (ev) => {
        console.log('[PC-Caller] ontrack fired');
        if (ev.streams[0]) { setRemoteStream(ev.streams[0]); playRemoteAudio(ev.streams[0]); }
      };
      stream.getTracks().forEach(t => pc.addTrack(t, stream));

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      console.log('[Call] Gathering ICE candidates...');
      const fullOffer = await waitForIceComplete(pc);
      console.log('[Call] ICE done. Candidates:', (fullOffer.sdp.match(/a=candidate/g) || []).length);

      // ③ UPDATE call row with full offer (ICE candidates embedded)
      await supabase.from('calls').update({ offer: fullOffer }).eq('id', data.id);
      console.log('[Call] Offer updated in DB');

    } catch (err) {
      console.error('[Call] startCall error:', err);
      cleanupCall();
      Alert.alert('خطأ', 'تعذر بدء المكالمة، تأكد من صلاحيات الميكروفون.');
    }
  };

  // ─── Accept call (RECEIVER) ─────────────────────────────────────────
  const acceptCall = async () => {
    try {
      console.log('[Call] Accepting call:', activeCallId);
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      setLocalStream(stream);
      setStatus('connected');
      stopSound();

      // Read offer from DB — poll if caller hasn't finished ICE yet
      let offerData: { type: string; sdp: string } | null = null;
      for (let i = 0; i < 15; i++) {
        const { data: call } = await supabase.from('calls').select('offer').eq('id', activeCallId).single();
        if (call?.offer?.sdp) { offerData = call.offer; break; }
        console.log('[Call] Offer not ready yet, waiting... attempt', i + 1);
        await new Promise(r => setTimeout(r, 500));
      }
      if (!offerData) throw new Error('Offer not available after waiting');
      console.log('[Call] Got offer. Candidates:', (offerData.sdp.match(/a=candidate/g) || []).length);

      // Create peer connection
      const pc = new RTCPeerConnection(ICE_SERVERS);
      pcRef.current = pc;
      pc.oniceconnectionstatechange = () => console.log('[PC-Recv] iceConnectionState:', pc.iceConnectionState);
      pc.onconnectionstatechange = () => console.log('[PC-Recv] connectionState:', pc.connectionState);
      pc.ontrack = (ev) => {
        console.log('[PC-Recv] ontrack fired');
        if (ev.streams[0]) { setRemoteStream(ev.streams[0]); playRemoteAudio(ev.streams[0]); }
      };
      stream.getTracks().forEach(t => pc.addTrack(t, stream));

      // Set remote description & create answer
      await pc.setRemoteDescription({ type: offerData.type, sdp: offerData.sdp });
      console.log('[Call] Receiver: remote description set');

      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      const fullAnswer = await waitForIceComplete(pc);
      console.log('[Call] Answer ICE done. Candidates:', (fullAnswer.sdp.match(/a=candidate/g) || []).length);

      await supabase.from('calls').update({ status: 'connected', answer: fullAnswer }).eq('id', activeCallId);
      console.log('[Call] Answer saved to DB');

    } catch (err) {
      console.error('[Call] acceptCall error:', err);
      rejectCall();
    }
  };

  // ─── Reject / End ───────────────────────────────────────────────────
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
    stopSound();
    stopRemoteAudio();
    if (localStream) { localStream.getTracks().forEach(t => t.stop()); setLocalStream(null); }
    setRemoteStream(null);
    if (pcRef.current) { pcRef.current.close(); pcRef.current = null; }
  };

  // ─── Mute ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (localStream) localStream.getAudioTracks().forEach(t => { t.enabled = !isMuted; });
  }, [isMuted, localStream]);

  return (
    <CallContext.Provider value={{
      status, caller, remoteUserId, localStream, remoteStream,
      startCall, acceptCall, rejectCall, endCall, isMuted, setIsMuted,
    }}>
      {children}
    </CallContext.Provider>
  );
};
