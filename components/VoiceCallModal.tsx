import React, { useEffect, useState, useRef } from 'react';
import { View, Text, StyleSheet, Modal, TouchableOpacity, Image, Platform, Dimensions } from 'react-native';
import { BlurView } from 'expo-blur';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Radius, Spacing, Shadow, Gradients } from '../constants/theme';
import { useCall } from '../context/CallProvider';
import { LinearGradient } from 'expo-linear-gradient';
import { RTCView } from '../lib/webrtc';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

export const VoiceCallModal: React.FC = () => {
  const { status, caller, acceptCall, rejectCall, endCall, isMuted, setIsMuted, isVideoCall, toggleCamera, localStream, remoteStream } = useCall();
  const [timer, setTimer] = useState(0);

  const localVideoRef = useRef<any>(null);
  const remoteVideoRef = useRef<any>(null);

  useEffect(() => {
    if (Platform.OS === 'web' && localVideoRef.current && localStream) {
      localVideoRef.current.srcObject = localStream;
    }
  }, [localStream, status]);

  useEffect(() => {
    if (Platform.OS === 'web' && remoteVideoRef.current && remoteStream) {
      remoteVideoRef.current.srcObject = remoteStream;
    }
  }, [remoteStream, status]);

  useEffect(() => {
    let interval: any;
    if (status === 'connected') {
      interval = setInterval(() => setTimer((t) => t + 1), 1000);
    } else {
      setTimer(0);
    }
    return () => clearInterval(interval);
  }, [status]);

  if (status === 'idle') return null;

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
  };

  const isIncoming = status === 'ringing';
  const isOutgoing = status === 'calling';
  const isConnected = status === 'connected';

  return (
    <Modal visible={true} transparent animationType="slide">
      <BlurView intensity={100} tint="dark" style={styles.container}>
        <LinearGradient
          colors={['rgba(106, 28, 246, 0.3)', 'transparent']}
          style={StyleSheet.absoluteFill}
        />

        <View style={styles.content}>
          <View style={styles.topSection}>
            <View style={[styles.avatarContainer, isVideoCall && isConnected ? { opacity: 0 } : {}]}>
              <View style={styles.avatarBorder}>
                {caller?.avatar ? (
                  <Image source={{ uri: caller.avatar }} style={styles.avatar} />
                ) : (
                  <View style={styles.placeholderAvatar}>
                    <Text style={styles.placeholderText}>{caller?.username?.[0]?.toUpperCase()}</Text>
                  </View>
                )}
              </View>
              {(isIncoming || isOutgoing) && (
                <View style={styles.pulseContainer}>
                  <View style={styles.pulse} />
                </View>
              )}
            </View>
            
            {!isVideoCall || !isConnected ? (
              <>
                <Text style={styles.username}>{caller?.username}</Text>
                <Text style={styles.statusText}>
                  {isIncoming ? (isVideoCall ? 'مكالمة فيديو واردة...' : 'يتصل بك...') : 
                   isOutgoing ? 'جاري الاتصال...' : 
                   isConnected ? formatTime(timer) : 'انتهت المكالمة'}
                </Text>
              </>
            ) : null}
          </View>

          {/* Video Streams rendering */}
          {isVideoCall && isConnected && (
            <View style={StyleSheet.absoluteFill}>
              {Platform.OS === 'web' ? (
                React.createElement('video', {
                  ref: remoteVideoRef,
                  autoPlay: true,
                  playsInline: true,
                  style: { width: '100%', height: '100%', objectFit: 'cover' }
                })
              ) : (
                remoteStream && <RTCView streamURL={(remoteStream as any).toURL()} style={{ flex: 1 }} objectFit="cover" />
              )}
            </View>
          )}

          {isVideoCall && (
            <View style={styles.pipContainer}>
              {Platform.OS === 'web' ? (
                React.createElement('video', {
                  ref: localVideoRef,
                  autoPlay: true,
                  playsInline: true,
                  muted: true,
                  style: { width: '100%', height: '100%', objectFit: 'cover', transform: 'scaleX(-1)' }
                })
              ) : (
                localStream && <RTCView streamURL={(localStream as any).toURL()} style={{ flex: 1 }} objectFit="cover" />
              )}
            </View>
          )}

          <View style={styles.bottomSection}>
            <View style={styles.controlsRow}>
              {isConnected && (
                <TouchableOpacity 
                   style={[styles.smallBtn, isMuted && styles.activeBtn]} 
                   onPress={() => setIsMuted(!isMuted)}
                >
                  <Ionicons name={isMuted ? "mic-off" : "mic"} size={24} color={isMuted ? Colors.white : Colors.white} />
                  <Text style={styles.btnLabel}>كتم</Text>
                </TouchableOpacity>
              )}

              {isIncoming ? (
                <>
                   <TouchableOpacity style={[styles.mainBtn, styles.rejectBtn]} onPress={rejectCall}>
                    <Ionicons name="close" size={32} color={Colors.white} />
                    <Text style={styles.btnLabel}>رفض</Text>
                  </TouchableOpacity>
                  
                  <TouchableOpacity style={[styles.mainBtn, styles.acceptBtn]} onPress={acceptCall}>
                    <Ionicons name={isVideoCall ? "videocam" : "call"} size={32} color={Colors.white} />
                    <Text style={styles.btnLabel}>قبول</Text>
                  </TouchableOpacity>
                </>
              ) : (
                <TouchableOpacity style={[styles.mainBtn, styles.rejectBtn]} onPress={endCall}>
                  <Ionicons name="call-outline" size={32} color={Colors.white} style={{ transform: [{ rotate: '135deg' }] }} />
                  <Text style={styles.btnLabel}>إنهاء</Text>
                </TouchableOpacity>
              )}

              {isConnected && isVideoCall && (
                <TouchableOpacity style={styles.smallBtn} onPress={toggleCamera}>
                   <Ionicons name="camera-reverse" size={24} color={Colors.white} />
                   <Text style={styles.btnLabel}>الكاميرا</Text>
                </TouchableOpacity>
              )}
              {isConnected && (
                <TouchableOpacity 
                   style={styles.smallBtn} 
                   onPress={() => {
                     import('expo-router').then(({ router }) => router.push('/watch-party'));
                   }}
                >
                   <Ionicons name="tv-outline" size={24} color={Colors.white} />
                   <Text style={styles.btnLabel}>مشاهدة</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        </View>
      </BlurView>
    </Modal>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  content: { flex: 1, width: '100%', justifyContent: 'space-between', paddingVertical: 80, alignItems: 'center', zIndex: 10 },
  topSection: { alignItems: 'center' },
  avatarContainer: { position: 'relative', marginBottom: 24 },
  avatarBorder: {
    width: 140,
    height: 140,
    borderRadius: 70,
    borderWidth: 4,
    borderColor: 'rgba(255,255,255,0.2)',
    padding: 6,
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatar: { width: '100%', height: '100%', borderRadius: 60 },
  placeholderAvatar: { 
    width: '100%', 
    height: '100%', 
    borderRadius: 60, 
    backgroundColor: Colors.primary, 
    justifyContent: 'center', 
    alignItems: 'center' 
  },
  placeholderText: { color: Colors.white, fontSize: 50, fontWeight: 'bold' },
  username: { color: Colors.white, fontSize: 32, fontWeight: '800', marginBottom: 8 },
  statusText: { color: 'rgba(255,255,255,0.7)', fontSize: 18, fontWeight: '500' },
  
  bottomSection: { width: '100%', alignItems: 'center' },
  controlsRow: { flexDirection: 'row-reverse', alignItems: 'center', gap: 30 },
  mainBtn: { 
    width: 80, 
    height: 80, 
    borderRadius: 40, 
    justifyContent: 'center', 
    alignItems: 'center',
    ...Shadow.premium
  },
  smallBtn: { width: 50, height: 50, borderRadius: 25, backgroundColor: 'rgba(255,255,255,0.1)', justifyContent: 'center', alignItems: 'center' },
  activeBtn: { backgroundColor: Colors.error },
  acceptBtn: { backgroundColor: '#00c853' },
  rejectBtn: { backgroundColor: '#ff4b4b' },
  btnLabel: { color: Colors.white, fontSize: 12, marginTop: 8, fontWeight: '600' },

  pulseContainer: { position: 'absolute', top: -20, left: -20, right: -20, bottom: -20, zIndex: -1 },
  pulse: {
    flex: 1,
    borderRadius: 100,
    borderWidth: 2,
    borderColor: Colors.primary,
    opacity: 0.5,
    // Add animation later if possible with Reanimated
  },
  pipContainer: {
    position: 'absolute',
    bottom: 180,
    right: 20,
    width: 120,
    height: 160,
    borderRadius: Radius.lg,
    overflow: 'hidden',
    backgroundColor: '#000',
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.3)',
    ...Shadow.premium,
    zIndex: 20,
  }
});
