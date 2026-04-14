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
  ],
};

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
  const iceChannelRef = useRef<any>(null);
  const soundRef = useRef<Audio.Sound | null>(null);

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
      async (event, session) => {
        if (session) {
          setCurrentUserId(session.user.id);
          setupSignaling(session.user.id);
        } else {
          setCurrentUserId(null);
          if (subscriptionRef.current) subscriptionRef.current.unsubscribe();
          if (iceChannelRef.current) supabase.removeChannel(iceChannelRef.current);
        }
      }
    );

    return () => {
      if (subscriptionRef.current) subscriptionRef.current.unsubscribe();
      if (iceChannelRef.current) supabase.removeChannel(iceChannelRef.current);
      stopSound();
      authListener.subscription.unsubscribe();
    };
  }, []);

  const playSound = async (type: 'calling' | 'ringing') => {
    try {
      if (soundRef.current) await soundRef.current.unloadAsync();
      const url = type === 'calling' 
        ? 'https://assets.mixkit.co/active_storage/sfx/2592/2592-preview.mp3' 
        : 'https://assets.mixkit.co/active_storage/sfx/2591/2591-preview.mp3';
      
      const { sound } = await Audio.Sound.createAsync({ uri: url }, { shouldPlay: true, isLooping: true });
      soundRef.current = sound;
    } catch (e) { console.log('Sound play error:', e); }
  };

  const stopSound = async () => {
    if (soundRef.current) {
      try {
        await soundRef.current.stopAsync();
        await soundRef.current.unloadAsync();
      } catch {}
      soundRef.current = null;
    }
  };

  const setupSignaling = (uid: string) => {
    console.log('Setting up DB signaling for:', uid);
    if (subscriptionRef.current) subscriptionRef.current.unsubscribe();

    subscriptionRef.current = supabase
      .channel(`calls-listener-${uid}`)
      .on('postgres_changes', { 
        event: '*', 
        schema: 'public', 
        table: 'calls'
      }, async (payload: any) => {
        const call = payload.new || payload.old;
        if (!call) return;

        // I am the receiver
        if (call.receiver_id === uid) {
          if (payload.eventType === 'INSERT') {
            console.log('Incoming call via DB');
            setActiveCallId(call.id);
            setRemoteUserId(call.caller_id);
            setCaller({ id: call.caller_id, username: call.caller_name, avatar: call.caller_avatar });
            setStatus('ringing');
            playSound('ringing');
            setupIceChannel(call.id);
          } else if (payload.eventType === 'UPDATE') {
            if (call.status === 'ended' || call.status === 'rejected') {
              cleanupCall();
            }
          } else if (payload.eventType === 'DELETE') {
            cleanupCall();
          }
        }

        // I am the caller
        if (call.caller_id === uid) {
          if (payload.eventType === 'UPDATE') {
            if (call.status === 'connected' && call.answer) {
              console.log('Call accepted by remote via DB');
              stopSound();
              setStatus('connected');
              if (pcRef.current) {
                try {
                  await pcRef.current.setRemoteDescription(new RTCSessionDescription(call.answer));
                } catch (e) { console.error('Answer error:', e); }
              }
            } else if (call.status === 'rejected' || call.status === 'ended') {
              cleanupCall();
              if (call.status === 'rejected') Alert.alert('المكالمة', 'تم رفض المكالمة من قبل الطرف الآخر');
            }
          } else if (payload.eventType === 'DELETE') {
            cleanupCall();
          }
        }
      })
      .subscribe((status) => {
        console.log('Call signaling status:', status);
      });
  };

  const iceQueueRef = useRef<RTCIceCandidate[]>([]);

  const setupIceChannel = (callId: string) => {
    if (iceChannelRef.current) supabase.removeChannel(iceChannelRef.current);
    iceChannelRef.current = supabase.channel(`ice:${callId}`);
    iceChannelRef.current
      .on('broadcast', { event: 'candidate' }, async ({ payload }: any) => {
        if (payload.from_id !== currentUserId && pcRef.current && payload.candidate) {
          try {
            await pcRef.current.addIceCandidate(new RTCIceCandidate(payload.candidate));
          } catch (e) { console.error('ICE add error:', e); }
        }
      })
      .subscribe((status: string) => {
        if (status === 'SUBSCRIBED') {
          // Send any queued candidates now that we are subscribed
          iceQueueRef.current.forEach(candidate => {
            iceChannelRef.current.send({
              type: 'broadcast',
              event: 'candidate',
              payload: { candidate, from_id: currentUserId }
            });
          });
          iceQueueRef.current = [];
        }
      });
  };

  const createPeerConnection = (targetUid: string, callId: string) => {
    if (pcRef.current) return;
    const pc = new RTCPeerConnection(ICE_SERVERS);
    pcRef.current = pc;
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        if (iceChannelRef.current && activeCallId) {
            iceChannelRef.current.send({
              type: 'broadcast',
              event: 'candidate',
              payload: { candidate: event.candidate, from_id: currentUserId }
            });
        } else {
            iceQueueRef.current.push(event.candidate);
        }
      }
    };
    pc.ontrack = (event) => {
      setRemoteStream(event.streams[0]);
    };
    if (localStream) {
      localStream.getTracks().forEach((track) => pc.addTrack(track, localStream));
    }
  };

  const startCall = async (targetUid: string, targetUsername: string, targetAvatar: string | null) => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      setLocalStream(stream);
      setRemoteUserId(targetUid);
      setCaller({ id: targetUid, username: targetUsername, avatar: targetAvatar });
      setStatus('calling');
      playSound('calling');

      const { data: { user } } = await supabase.auth.getUser();
      const myUsername = user?.user_metadata?.username || 'مستخدم';
      const myAvatar = user?.user_metadata?.avatar_url;

      iceQueueRef.current = [];

      const pc = new RTCPeerConnection(ICE_SERVERS);
      pcRef.current = pc;
      pc.onicecandidate = (event) => {
        if (event.candidate) {
          if (iceChannelRef.current) {
            iceChannelRef.current.send({
              type: 'broadcast',
              event: 'candidate',
              payload: { candidate: event.candidate, from_id: currentUserId }
            });
          } else {
            iceQueueRef.current.push(event.candidate);
          }
        }
      };
      pc.ontrack = (event) => setRemoteStream(event.streams[0]);
      stream.getTracks().forEach(track => pc.addTrack(track, stream));

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      const { data, error } = await supabase.from('calls').insert([{
        caller_id: currentUserId,
        receiver_id: targetUid,
        caller_name: myUsername,
        caller_avatar: myAvatar,
        offer: offer,
        status: 'ringing'
      }]).select().single();

      if (error) throw error;
      setActiveCallId(data.id);
      setupIceChannel(data.id);

    } catch (err) {
      console.error('Call Error:', err);
      cleanupCall();
      Alert.alert('خطأ', 'تعذر بدء المكالمة، تأكد من صلاحيات الميكروفون.');
    }
  };

  const acceptCall = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      setLocalStream(stream);
      setStatus('connected');
      stopSound();

      // Get offer from DB
      const { data: call } = await supabase.from('calls').select('offer').eq('id', activeCallId).single();
      if (!call?.offer) throw new Error('No offer found');

      createPeerConnection(remoteUserId!, activeCallId!);
      await pcRef.current?.setRemoteDescription(new RTCSessionDescription(call.offer));
      const answer = await pcRef.current?.createAnswer();
      await pcRef.current?.setLocalDescription(answer);

      await supabase.from('calls').update({ 
        status: 'connected', 
        answer: answer 
      }).eq('id', activeCallId);

    } catch (err) {
      rejectCall();
    }
  };

  const rejectCall = async () => {
    if (activeCallId) {
      await supabase.from('calls').update({ status: 'rejected' }).eq('id', activeCallId);
      // Row will be cleaned up by cleanupCall or background janitor later
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
      localStream.getTracks().forEach(track => track.stop());
      setLocalStream(null);
    }
    setRemoteStream(null);
    if (pcRef.current) { pcRef.current.close(); pcRef.current = null; }
    if (iceChannelRef.current) { supabase.removeChannel(iceChannelRef.current); iceChannelRef.current = null; }
  };

  useEffect(() => {
    if (localStream) {
      localStream.getAudioTracks().forEach(track => { track.enabled = !isMuted; });
    }
  }, [isMuted, localStream]);

  return (
    <CallContext.Provider value={{
      status, caller, remoteUserId, localStream, remoteStream,
      startCall, acceptCall, rejectCall, endCall, isMuted, setIsMuted
    }}>
      {children}
      {Platform.OS === 'web' && remoteStream && (
        <audio
          autoPlay
          ref={(audio) => {
            if (audio) {
              audio.srcObject = remoteStream;
              audio.play().catch(e => console.log('Autoplay blocked:', e));
            }
          }}
        />
      )}
    </CallContext.Provider>
  );
};
