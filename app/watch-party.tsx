import React, { useState, useCallback, useRef, useEffect } from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity, Dimensions, ActivityIndicator, Alert, Platform, ScrollView } from 'react-native';
// Import our platform-specific player
import Player from '../components/WatchParty/Player';
import { useCall } from '../context/CallProvider';
import { Colors, Radius, Spacing, Shadow } from '../constants/theme';
import { Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';

export default function WatchPartyScreen() {
  const { isHost, sendVideoSyncCommand, lastCommand } = useCall();
  const [playing, setPlaying] = useState(false);
  const [videoId, setVideoId] = useState('dQw4w9WgXcQ');
  const [inputUrl, setInputUrl] = useState('');
  const [ready, setReady] = useState(false);
  const playerRef = useRef<any>(null);
  const isInternalChange = useRef(false);

  const extractVideoId = (url: string) => {
    const regExp = /^.*((youtu.be\/)|(v\/)|(\/u\/\w\/)|(embed\/)|(watch\?))\??v?=?([^#&?]*).*/;
    const match = url.match(regExp);
    return (match && match[7].length === 11) ? match[7] : null;
  };

  const handleSetVideo = () => {
    const id = extractVideoId(inputUrl);
    if (id) {
      setVideoId(id);
      setInputUrl('');
      if (isHost) {
        sendVideoSyncCommand({ type: 'CHANGE_VIDEO', videoId: id });
      }
    } else {
      Alert.alert('خطأ', 'يرجى إدخال رابط يوتيوب صحيح');
    }
  };

  useEffect(() => {
    if (!lastCommand || isHost) return;
    switch (lastCommand.type) {
      case 'PLAY':
        isInternalChange.current = true;
        setPlaying(true);
        break;
      case 'PAUSE':
        isInternalChange.current = true;
        setPlaying(false);
        break;
      case 'SEEK':
        if (playerRef.current && playerRef.current.seekTo) {
          isInternalChange.current = true;
          playerRef.current.seekTo(lastCommand.time, true);
        }
        break;
      case 'CHANGE_VIDEO':
        setVideoId(lastCommand.videoId);
        break;
    }
  }, [lastCommand, isHost]);

  const onStateChange = useCallback((state: string) => {
    if (!isHost || isInternalChange.current) {
      isInternalChange.current = false;
      return;
    }
    if (state === 'playing') {
      sendVideoSyncCommand({ type: 'PLAY' });
    } else if (state === 'paused') {
      sendVideoSyncCommand({ type: 'PAUSE' });
    }
  }, [isHost, sendVideoSyncCommand]);

  const togglePlayHost = () => {
    if (!isHost) return;
    const newState = !playing;
    setPlaying(newState);
    sendVideoSyncCommand({ type: newState ? 'PLAY' : 'PAUSE' });
  };

  return (
    <View style={styles.container}>
      <LinearGradient colors={[Colors.dark, '#1a1a1a']} style={StyleSheet.absoluteFill} />
      
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="chevron-back" size={28} color={Colors.white} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>المشاهدة الجماعية</Text>
        <View style={styles.hostBadge}>
          <Text style={styles.hostText}>{isHost ? 'مضيف' : 'ضيف'}</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        {isHost && (
          <BlurView intensity={30} tint="dark" style={styles.searchBox}>
            <TextInput
              style={styles.input}
              placeholder="رابط يوتيوب..."
              placeholderTextColor="rgba(255,255,255,0.4)"
              value={inputUrl}
              onChangeText={setInputUrl}
            />
            <TouchableOpacity style={styles.searchBtn} onPress={handleSetVideo}>
              <Ionicons name="arrow-forward" size={24} color={Colors.white} />
            </TouchableOpacity>
          </BlurView>
        )}

        <View style={styles.playerWrapper}>
          <Player 
            videoId={videoId} 
            playing={playing} 
            onStateChange={onStateChange} 
            playerRef={playerRef}
            onReady={() => setReady(true)}
          />
          {!ready && (
            <View style={styles.loader}>
              <ActivityIndicator color={Colors.primary} size="large" />
            </View>
          )}
        </View>

        {isHost && Platform.OS === 'web' && (
          <TouchableOpacity style={styles.controlBtn} onPress={togglePlayHost}>
            <Ionicons name={playing ? "pause" : "play"} size={32} color={Colors.white} />
            <Text style={styles.controlText}>{playing ? 'إيقاف مؤقت للجميع' : 'شغل للجميع'}</Text>
          </TouchableOpacity>
        )}

        <BlurView intensity={20} tint="dark" style={styles.infoCard}>
          <Ionicons name="information-circle-outline" size={20} color={Colors.primary} />
          <Text style={styles.infoText}>
            {isHost 
              ? 'أنت المتحكم في العرض. سيتم مزامنة أي تشغيل أو إيقاف عند صديقك تلقائياً.'
              : 'صديقك هو المتحكم الآن. سيتم مزامنة الفيديو لديك مع ما يشاهده.'}
          </Text>
        </BlurView>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.dark },
  header: { flexDirection: 'row-reverse', alignItems: 'center', paddingTop: 60, paddingHorizontal: 20, paddingBottom: 20, justifyContent: 'space-between' },
  headerTitle: { color: Colors.white, fontSize: 20, fontWeight: 'bold' },
  backBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.1)', justifyContent: 'center', alignItems: 'center' },
  hostBadge: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: Radius.full, backgroundColor: Colors.primary + '33' },
  hostText: { color: Colors.primary, fontSize: 12, fontWeight: 'bold' },
  scroll: { padding: 20 },
  searchBox: { flexDirection: 'row-reverse', alignItems: 'center', borderRadius: Radius.lg, paddingHorizontal: 15, height: 60, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', marginBottom: 20, overflow: 'hidden' },
  input: { flex: 1, color: Colors.white, textAlign: 'right', fontSize: 16 },
  searchBtn: { width: 40, height: 40, borderRadius: 10, backgroundColor: Colors.primary, justifyContent: 'center', alignItems: 'center', marginLeft: 10 },
  playerWrapper: { width: '100%', borderRadius: Radius.xl, overflow: 'hidden', backgroundColor: '#000', ...Shadow.premium, marginBottom: 20 },
  loader: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, justifyContent: 'center', alignItems: 'center', backgroundColor: '#000' },
  infoCard: { flexDirection: 'row-reverse', padding: 16, borderRadius: Radius.lg, borderWidth: 1, borderColor: 'rgba(255,255,255,0.05)', gap: 12, alignItems: 'center' },
  infoText: { flex: 1, color: 'rgba(255,255,255,0.6)', fontSize: 14, lineHeight: 20, textAlign: 'right' },
  controlBtn: { flexDirection: 'row-reverse', backgroundColor: Colors.primary, padding: 15, borderRadius: Radius.lg, alignItems: 'center', justifyContent: 'center', gap: 15, marginBottom: 20, ...Shadow.premium },
  controlText: { color: Colors.white, fontSize: 18, fontWeight: 'bold' }
});
