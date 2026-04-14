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

const ICE_SERVERS = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun3.l.google.com:19302' },
  ],
};

/** Wait for ICE gathering to complete, then return the full local description. */
function waitForIceGathering(pc: RTCPeerConnection, timeoutMs = 5000): Promise<RTCSessionDescription | null> {
  return new Promise((resolve) => {
    if (pc.iceGatheringState === 'complete') {
      resolve(pc.localDescription);
      return;
    }
    const timer = setTimeout(() => {
      console.log('ICE gathering timed out, using current candidates');
      resolve(pc.localDescription);
    }, timeoutMs);
    pc.addEventListener('icegatheringstatechange', () => {
      if (pc.iceGatheringState === 'complete') {
        clearTimeout(timer);
        resolve(pc.localDescription);
      }
    });
  });
}

export const CallProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [status, setStatus] = useState<CallStatus>('idle');
  const [caller, setCaller] = useState<{ id: string; username: string; avatar: string | null } | null>(null);
  const [remoteUserId, setRemoteUserId] = useState<string | null>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [isMuted, setIsMuted] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [activeCallId, setActiveCallId] = useState<string | null>(null);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const subscriptionRef = useRef<any>(null);
  const soundRef = useRef<Audio.Sound | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    const initSession = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        setCurrentUserId(session.user.id);
        setupSignaling(session.user.id);
      }
    };
    initSession();

    const { data: authListener } = supabase.auth.onAuthStateChange(
      async (_event, session) => {
        if (session) {
          setCurrentUserId(session.user.id);
          setupSignaling(session.user.id);
        } else {
          setCurrentUserId(null);
          if (subscriptionRef.current) subscriptionRef.current.unsubscribe();
        }
      }
    );

    return () => {
      if (subscriptionRef.current) subscriptionRef.current.unsubscribe();
      stopSound();
      authListener.subscription.unsubscribe();
    };
  }, []);

  // ─── Sound helpers ──────────────────────────────────────────────────
  const playSound = async (type: 'calling' | 'ringing') => {
    try {
      if (soundRef.current) await soundRef.current.unloadAsync();
      const url = type === 'calling'
        ? 'https://assets.mixkit.co/active_storage/sfx/2592/2592-preview.mp3'
        : 'https://assets.mixkit.co/active_storage/sfx/2591/2591-preview.mp3';

      const { sound } = await Audio.Sound.createAsync(
        { uri: url },
        { shouldPlay: true, isLooping: true },
      );
      soundRef.current = sound;
    } catch (e) { console.log('Sound play error:', e); }
  };

  const stopSound = async () => {
    if (soundRef.current) {
      try { await soundRef.current.stopAsync(); await soundRef.current.unloadAsync(); } catch {}
      soundRef.current = null;
    }
  };

  // ─── Signaling via DB changes ───────────────────────────────────────
  const setupSignaling = (uid: string) => {
    console.log('[Call] Setting up DB signaling for:', uid);
    if (subscriptionRef.current) subscriptionRef.current.unsubscribe();

    subscriptionRef.current = supabase
      .channel(`calls-listener-${uid}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'calls',
      }, async (payload: any) => {
        const call = payload.new || payload.old;
        if (!call) return;

        // ── I am the RECEIVER ─────────────────────────────────────────
        if (call.receiver_id === uid) {
          if (payload.eventType === 'INSERT') {
            console.log('[Call] Incoming call from', call.caller_name);
            setActiveCallId(call.id);
            setRemoteUserId(call.caller_id);
            setCaller({ id: call.caller_id, username: call.caller_name, avatar: call.caller_avatar });
            setStatus('ringing');
            playSound('ringing');
          } else if (payload.eventType === 'UPDATE') {
            if (call.status === 'ended' || call.status === 'rejected') {
              cleanupCall();
            }
          } else if (payload.eventType === 'DELETE') {
            cleanupCall();
          }
        }

        // ── I am the CALLER ───────────────────────────────────────────
        if (call.caller_id === uid) {
          if (payload.eventType === 'UPDATE') {
            if (call.status === 'connected' && call.answer) {
              console.log('[Call] Remote accepted, setting answer');
              stopSound();
              setStatus('connected');
              if (pcRef.current) {
                try {
                  await pcRef.current.setRemoteDescription(
                    new RTCSessionDescription(call.answer),
                  );
                  console.log('[Call] Caller: remote description set successfully');
                } catch (e) { console.error('[Call] Answer error:', e); }
              }
            } else if (call.status === 'rejected' || call.status === 'ended') {
              cleanupCall();
              if (call.status === 'rejected')
                Alert.alert('المكالمة', 'تم رفض المكالمة من قبل الطرف الآخر');
            }
          } else if (payload.eventType === 'DELETE') {
            cleanupCall();
          }
        }
      })
      .subscribe((st) => { console.log('[Call] Signaling channel status:', st); });
  };

  // ─── Start a call (CALLER) ──────────────────────────────────────────
  const startCall = async (
    targetUid: string,
    targetUsername: string,
    targetAvatar: string | null,
  ) => {
    try {
      // 1. Get microphone
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      setLocalStream(stream);
      setRemoteUserId(targetUid);
      setCaller({ id: targetUid, username: targetUsername, avatar: targetAvatar });
      setStatus('calling');
      playSound('calling');

      // 2. Get my profile info
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('No user');
      const { data: profile } = await supabase
        .from('profiles')
        .select('username, avatar_url')
        .eq('id', user.id)
        .single();
      const myUsername = profile?.username || user?.user_metadata?.username || 'مستخدم';
      const myAvatar = profile?.avatar_url || user?.user_metadata?.avatar_url;

      // 3. Create PeerConnection
      const pc = new RTCPeerConnection(ICE_SERVERS);
      pcRef.current = pc;
      pc.ontrack = (event) => {
        console.log('[Call] Caller received remote track');
        setRemoteStream(event.streams[0]);
      };
      stream.getTracks().forEach((track) => pc.addTrack(track, stream));

      // 4. Create offer and WAIT for all ICE candidates to be gathered
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      console.log('[Call] Waiting for ICE gathering…');
      const fullOffer = await waitForIceGathering(pc);
      console.log('[Call] ICE gathering complete. Candidates in SDP:', 
        (fullOffer?.sdp?.match(/a=candidate/g) || []).length);

      // 5. Insert call with FULL offer (including all ICE candidates)
      const { data, error } = await supabase.from('calls').insert([{
        caller_id: user.id,
        receiver_id: targetUid,
        caller_name: myUsername,
        caller_avatar: myAvatar,
        offer: fullOffer,
        status: 'ringing',
      }]).select().single();

      if (error) throw error;
      setActiveCallId(data.id);
      console.log('[Call] Call created:', data.id);

    } catch (err) {
      console.error('[Call] Start error:', err);
      cleanupCall();
      Alert.alert('خطأ', 'تعذر بدء المكالمة، تأكد من صلاحيات الميكروفون.');
    }
  };

  // ─── Accept a call (RECEIVER) ───────────────────────────────────────
  const acceptCall = async () => {
    try {
      // 1. Get microphone
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      setLocalStream(stream);
      setStatus('connected');
      stopSound();

      // 2. Get the offer from DB
      const { data: call } = await supabase
        .from('calls')
        .select('offer')
        .eq('id', activeCallId)
        .single();
      if (!call?.offer) throw new Error('No offer found');

      // 3. Create PeerConnection
      const pc = new RTCPeerConnection(ICE_SERVERS);
      pcRef.current = pc;
      pc.ontrack = (event) => {
        console.log('[Call] Receiver received remote track');
        setRemoteStream(event.streams[0]);
      };
      stream.getTracks().forEach((track) => pc.addTrack(track, stream));

      // 4. Set the remote description (the full offer with ICE candidates)
      await pc.setRemoteDescription(new RTCSessionDescription(call.offer));
      console.log('[Call] Receiver: remote description set');

      // 5. Create answer and WAIT for all ICE candidates
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      console.log('[Call] Waiting for ICE gathering…');
      const fullAnswer = await waitForIceGathering(pc);
      console.log('[Call] ICE gathering complete. Candidates in SDP:',
        (fullAnswer?.sdp?.match(/a=candidate/g) || []).length);

      // 6. Update DB with FULL answer (including all ICE candidates)
      await supabase.from('calls').update({
        status: 'connected',
        answer: fullAnswer,
      }).eq('id', activeCallId);

      console.log('[Call] Answer sent via DB');

    } catch (err) {
      console.error('[Call] Accept error:', err);
      rejectCall();
    }
  };

  // ─── Reject / End / Cleanup ─────────────────────────────────────────
  const rejectCall = async () => {
    if (activeCallId) {
      await supabase.from('calls').update({ status: 'rejected' }).eq('id', activeCallId);
    }
    cleanupCall();
  };

  const endCall = async () => {
    if (activeCallId) {
      await supabase.from('calls').update({ status: 'ended' }).eq('id', activeCallId);
    }
    cleanupCall();
  };

  const cleanupCall = () => {
    setStatus('idle');
    setCaller(null);
    setRemoteUserId(null);
    setActiveCallId(null);
    setIsMuted(false);
    stopSound();
    if (localStream) {
      localStream.getTracks().forEach((t) => t.stop());
      setLocalStream(null);
    }
    setRemoteStream(null);
    if (pcRef.current) { pcRef.current.close(); pcRef.current = null; }
  };

  // ─── Mute toggle ───────────────────────────────────────────────────
  useEffect(() => {
    if (localStream) {
      localStream.getAudioTracks().forEach((t) => { t.enabled = !isMuted; });
    }
  }, [isMuted, localStream]);

  // ─── Render ─────────────────────────────────────────────────────────
  return (
    <CallContext.Provider value={{
      status, caller, remoteUserId, localStream, remoteStream,
      startCall, acceptCall, rejectCall, endCall, isMuted, setIsMuted,
    }}>
      {children}
      {Platform.OS === 'web' && remoteStream && (
        <audio
          autoPlay
          playsInline
          ref={(el) => {
            if (el && el !== audioRef.current) {
              audioRef.current = el;
              el.srcObject = remoteStream;
              el.play().catch((e) => console.log('[Call] Autoplay blocked:', e));
            }
          }}
        />
      )}
    </CallContext.Provider>
  );
};
