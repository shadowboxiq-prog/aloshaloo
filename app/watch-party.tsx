import React, { useState, useCallback, useRef, useEffect } from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity, Dimensions, ActivityIndicator, Alert, KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
import YoutubePlayer from 'react-native-youtube-iframe';
import { useCall } from '../context/CallProvider';
import { Colors, Radius, Spacing, Shadow, Gradients } from '../constants/theme';
import { Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

export default function WatchPartyScreen() {
  const { isHost, sendVideoSyncCommand, lastCommand } = useCall();
  const [playing, setPlaying] = useState(false);
  const [videoId, setVideoId] = useState('dQw4w9WgXcQ'); // Default placeholder
  const [inputUrl, setInputUrl] = useState('');
  const [ready, setReady] = useState(false);
  const playerRef = useRef<any>(null);
  const isInternalChange = useRef(false);

  // Extract ID from YouTube URL
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

  // Sync logic: Listen for commands from Host (if user is Guest)
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
        if (playerRef.current) {
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

  return (
    <View style={styles.container}>
      <LinearGradient colors={[Colors.dark, '#1a1a1a']} style={StyleSheet.absoluteFill} />
      
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="chevron-back" size={28} color={Colors.white} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>المشاهدة الجماعية</Text>
        <View style={styles.hostBadge}>
          <Text style={styles.hostText}>{isHost ? 'مضيف (Host)' : 'ضيف (Guest)'}</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        {/* URL Input (Host Only) */}
        {isHost && (
          <BlurView intensity={30} tint="dark" style={styles.searchBox}>
            <TextInput
              style={styles.input}
              placeholder="الصق رابط يوتيوب هنا..."
              placeholderTextColor="rgba(255,255,255,0.4)"
              value={inputUrl}
              onChangeText={setInputUrl}
            />
            <TouchableOpacity style={styles.searchBtn} onPress={handleSetVideo}>
              <Ionicons name="arrow-forward" size={24} color={Colors.white} />
            </TouchableOpacity>
          </BlurView>
        )}

        {/* Player Container */}
        <View style={styles.playerWrapper}>
          <YoutubePlayer
            ref={playerRef}
            height={SCREEN_WIDTH * 0.5625}
            play={playing}
            videoId={videoId}
            onChangeState={onStateChange}
            onReady={() => setReady(true)}
            webViewProps={{
              allowsFullscreenVideo: true,
            }}
          />
          {!ready && (
            <View style={styles.loader}>
              <ActivityIndicator color={Colors.primary} size="large" />
            </View>
          )}
        </View>

        {/* Info Card */}
        <BlurView intensity={20} tint="dark" style={styles.infoCard}>
          <Ionicons name="information-circle-outline" size={20} color={Colors.primary} />
          <Text style={styles.infoText}>
            {isHost 
              ? 'أنت المتحكم في العرض. سيتم مزامنة أي تشغيل أو إيقاف عند صديقك تلقائياً.'
              : 'صديقك هو المتحكم الآن. سيتم مزامنة الفيديو لديك مع ما يشاهده.'}
          </Text>
        </BlurView>
      </ScrollView>

      {/* Control Overlay Hint */}
      {!isHost && playing && (
        <View style={styles.syncOverlay}>
          <Text style={styles.syncText}>⏳ تم المزامنة مع المضيف</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.dark },
  header: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    paddingTop: 60,
    paddingHorizontal: 20,
    paddingBottom: 20,
    justifyContent: 'space-between'
  },
  headerTitle: { color: Colors.white, fontSize: 20, fontWeight: 'bold' },
  backBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.1)', justifyContent: 'center', alignItems: 'center' },
  hostBadge: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: Radius.full, backgroundColor: Colors.primary + '33' },
  hostText: { color: Colors.primary, fontSize: 12, fontWeight: 'bold' },
  
  scroll: { padding: 20 },
  searchBox: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    borderRadius: Radius.lg,
    paddingHorizontal: 15,
    height: 60,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    marginBottom: 20,
    overflow: 'hidden'
  },
  input: { flex: 1, color: Colors.white, textAlign: 'right', fontSize: 16, fontFamily: Platform.OS === 'ios' ? 'System' : 'serif' },
  searchBtn: { width: 40, height: 40, borderRadius: 10, backgroundColor: Colors.primary, justifyContent: 'center', alignItems: 'center', marginLeft: 10 },
  
  playerWrapper: {
    width: '100%',
    borderRadius: Radius.xl,
    overflow: 'hidden',
    backgroundColor: '#000',
    ...Shadow.premium,
    marginBottom: 20
  },
  loader: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, justifyContent: 'center', alignItems: 'center', backgroundColor: '#000' },
  
  infoCard: {
    flexDirection: 'row-reverse',
    padding: 16,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)',
    gap: 12,
    alignItems: 'center'
  },
  infoText: { flex: 1, color: 'rgba(255,255,255,0.6)', fontSize: 14, lineHeight: 20, textAlign: 'right' },
  
  syncOverlay: {
    position: 'absolute',
    bottom: 40,
    alignSelf: 'center',
    backgroundColor: 'rgba(0,0,0,0.8)',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: Radius.full,
    borderWidth: 1,
    borderColor: Colors.primary + '44'
  },
  syncText: { color: Colors.white, fontSize: 13, fontWeight: '600' }
});
