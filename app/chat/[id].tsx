import React, { useState, useEffect, useRef } from 'react';
import { View, Text, TextInput, TouchableOpacity, FlatList, StyleSheet, KeyboardAvoidingView, Platform, Keyboard, Alert, ActivityIndicator, Modal, Dimensions } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { supabase } from '../../lib/supabase';
import { Ionicons } from '@expo/vector-icons';
import { Image as RNImage } from 'react-native';
import { Audio } from 'expo-av';
import * as ImagePicker from 'expo-image-picker';
import { Image } from 'expo-image';
import { Colors, Radius, Spacing, Shadow, Gradients } from '../../constants/theme';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { formatLastSeenArabic } from '../../lib/date-utils';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

type MediaItem = {
  url: string;
  placeholder: string;
  type: string;
  uri?: string; 
  base64?: string;
}

export default function ChatScreen() {
  const { id, username } = useLocalSearchParams();
  const router = useRouter();
  const [messages, setMessages] = useState<any[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [friendStatus, setFriendStatus] = useState<string>('جاري التحقق...');
  const [friendAvatar, setFriendAvatar] = useState<string | null>(null);
  const [isTyping, setIsTyping] = useState(false);
  const [otherIsTyping, setOtherIsTyping] = useState(false);
  const [onlineUsers, setOnlineUsers] = useState<Set<string>>(new Set());
  
  // Media Preview State
  const [selectedMedia, setSelectedMedia] = useState<MediaItem[]>([]);
  const [mediaCaption, setMediaCaption] = useState('');
  
  // Full-screen Viewer State
  const [viewerVisible, setViewerVisible] = useState(false);
  const [viewerImages, setViewerImages] = useState<{uri: string}[]>([]);
  const [viewerIndex, setViewerIndex] = useState(0);

  const flatListRef = useRef<FlatList>(null);
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const channelRef = useRef<any>(null);
  
  // Audio state
  const [isRecordingUI, setIsRecordingUI] = useState(false);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const recordingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  
  // Audio Refs
  const currentRecordingRef = useRef<Audio.Recording | null>(null);
  const currentWebRecorderRef = useRef<MediaRecorder | null>(null);
  const webChunksRef = useRef<Blob[]>([]);
  
  const [playingSoundId, setPlayingSoundId] = useState<string | null>(null);
  const soundRef = useRef<Audio.Sound | null>(null);

  useEffect(() => {
    if (messages.length > 0) {
      setTimeout(() => {
        flatListRef.current?.scrollToEnd({ animated: true });
      }, 100);
    }
  }, [messages]);

  useEffect(() => {
    const initChat = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      
      const uid = session.user.id;
      setCurrentUserId(uid);

      fetchMessages(uid, id as string);
      fetchProfiles(id as string);
      
      const channelName = `room_${[uid, id].sort().join('_')}`;
      if (channelRef.current) supabase.removeChannel(channelRef.current);

      channelRef.current = supabase.channel(channelName, { config: { presence: { key: uid } } });

      channelRef.current
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, (payload: any) => {
            const newMsg = payload.new;
            if ((newMsg.sender_id === uid && newMsg.receiver_id === id) || (newMsg.sender_id === id && newMsg.receiver_id === uid)) {
              setMessages((prev) => prev.find(m => m.id === newMsg.id) ? prev : [...prev, newMsg]);
              if (newMsg.sender_id === id) markMessagesAsRead(uid, id as string);
            }
        })
        .on('presence', { event: 'sync' }, () => {
          const state = channelRef.current.presenceState();
          const typing = Object.values(state).some((presence: any) => 
            presence.some((p: any) => p.user_id === id && p.is_typing)
          );
          setOtherIsTyping(typing);
        })
        .subscribe(async (status: any) => {
          if (status === 'SUBSCRIBED') await channelRef.current.track({ user_id: uid, is_typing: false });
        });
    }

    initChat();
    fetchFriendStatus();
    
    const handlePresence = (e: any) => {
      const ids = new Set(e.detail.ids);
      // If peer was online and now is not, re-fetch last_seen
      if (onlineUsers.has(id as string) && !ids.has(id as string)) {
        fetchFriendStatus();
      }
      setOnlineUsers(ids);
    };

    window.addEventListener('presence-sync', handlePresence);
    
    return () => {
      window.removeEventListener('presence-sync', handlePresence);
      if (channelRef.current) supabase.removeChannel(channelRef.current);
      if (soundRef.current) soundRef.current.unloadAsync();
      if (recordingIntervalRef.current) clearInterval(recordingIntervalRef.current);
      if (currentRecordingRef.current) currentRecordingRef.current.stopAndUnloadAsync();
    };
  }, []);

  const fetchFriendStatus = async () => {
    if (!id) return;
    const { data } = await supabase.from('profiles').select('last_seen').eq('id', id).single();
    setFriendStatus(formatLastSeenArabic(data?.last_seen));
  };

  const markMessagesAsRead = async (userId: string, senderId: string) => {
    await supabase.from('messages').update({ is_read: true }).eq('receiver_id', userId).eq('sender_id', senderId).eq('is_read', false);
  };

  const fetchMessages = async (userId: string, receiverId: string) => {
    const { data } = await supabase.from('messages').select('*').or(`and(sender_id.eq.${userId},receiver_id.eq.${receiverId}),and(sender_id.eq.${receiverId},receiver_id.eq.${userId})`).order('created_at', { ascending: true });
    if (data) { setMessages(data); markMessagesAsRead(userId, receiverId); }
  };

  const fetchProfiles = async (friendId: string) => {
    const { data } = await supabase.from('profiles').select('avatar_url').eq('id', friendId).single();
    if (data) setFriendAvatar(data.avatar_url);
  };

  const handleTyping = () => {
    if (!isTyping && channelRef.current) {
      setIsTyping(true);
      channelRef.current.track({ user_id: currentUserId, is_typing: true });
    }
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(() => {
      setIsTyping(false);
      if (channelRef.current) channelRef.current.track({ user_id: currentUserId, is_typing: false });
    }, 2000);
  };

  const sendMessage = async () => {
    if (!newMessage.trim() || !currentUserId || isSending) return;
    const msgText = newMessage.trim();
    setIsSending(true);
    Keyboard.dismiss();
    const { error } = await supabase.from('messages').insert([{ sender_id: currentUserId, receiver_id: id, content: msgText, is_read: false }]);
    setIsSending(false);
    if (!error) { setNewMessage(''); setIsTyping(false); if (channelRef.current) channelRef.current.track({ user_id: currentUserId, is_typing: false }); }
  };

  const startRecording = async () => {
    try {
      if (Platform.OS === 'web') {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const mediaRecorder = new MediaRecorder(stream);
        webChunksRef.current = [];
        mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) webChunksRef.current.push(e.data); };
        mediaRecorder.onstop = () => {
          if (webChunksRef.current.length > 0) {
            const blob = new Blob(webChunksRef.current, { type: 'audio/webm' });
            uploadAndSendAudio(undefined, blob);
          }
        };
        currentWebRecorderRef.current = mediaRecorder;
        mediaRecorder.start(500);
      } else {
        const { status } = await Audio.requestPermissionsAsync();
        if (status !== 'granted') return;
        await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
        const { recording } = await Audio.Recording.createAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
        currentRecordingRef.current = recording;
      }
      setIsRecordingUI(true);
      setRecordingDuration(0);
      recordingIntervalRef.current = setInterval(() => setRecordingDuration(p => p + 1), 1000);
    } catch {}
  };

  const stopAndSendRecording = async () => {
    if (recordingIntervalRef.current) clearInterval(recordingIntervalRef.current);
    setIsRecordingUI(false);
    if (Platform.OS === 'web') {
      currentWebRecorderRef.current?.stop();
    } else {
      await currentRecordingRef.current?.stopAndUnloadAsync();
      const uri = currentRecordingRef.current?.getURI();
      if (uri) uploadAndSendAudio(uri);
    }
  };

  const uploadAndSendAudio = async (uri?: string, blob?: Blob) => {
    setIsSending(true);
    try {
      const formData = new FormData();
      formData.append('upload_preset', 'chat_app_unsigned');
      if (blob) formData.append('file', blob, 'audio.webm'); else formData.append('file', { uri, name: 'audio.m4a', type: 'audio/m4a' } as any);
      const res = await fetch('https://api.cloudinary.com/v1_1/dy8sl8fzs/video/upload', { method: 'POST', body: formData });
      const data = await res.json();
      await supabase.from('messages').insert([{ sender_id: currentUserId, receiver_id: id, content: 'مقطع صوتي 🎵', message_type: 'audio', audio_url: data.secure_url, is_read: false }]);
    } finally { setIsSending(false); }
  };

  const playAudio = async (msgId: string, url: string) => {
    if (soundRef.current) { await soundRef.current.unloadAsync(); soundRef.current = null; if (playingSoundId === msgId) { setPlayingSoundId(null); return; } }
    setPlayingSoundId(msgId);
    const { sound } = await Audio.Sound.createAsync({ uri: url }, { shouldPlay: true });
    soundRef.current = sound;
    sound.setOnPlaybackStatusUpdate((s: any) => { if (s.didJustFinish) setPlayingSoundId(null); });
  };

  const renderCustomHeader = () => {
    const isPeerOnline = onlineUsers.has(id as string);
    const peerStatusText = isPeerOnline ? 'متصل الآن' : friendStatus;

    return (
      <BlurView intensity={90} tint="light" style={styles.header}>
        <View style={styles.headerLeft}>
          <TouchableOpacity onPress={() => router.back()} style={styles.iconCircle}>
            <Ionicons name="chevron-forward" size={24} color={Colors.primary} />
          </TouchableOpacity>
          <TouchableOpacity style={styles.profileGroup} onPress={() => router.push('/profile')}>
            <View style={styles.headerAvatarWrap}>
               <View style={[styles.squircleAvatar, { backgroundColor: Colors.surfaceContainerHigh }]}>
                  {friendAvatar ? <RNImage source={{ uri: friendAvatar }} style={styles.avatarImg} /> : <Text style={styles.avatarText}>{username?.[0]?.toUpperCase()}</Text>}
               </View>
               <View style={[styles.statusDot, { backgroundColor: isPeerOnline ? '#00f2ff' : '#ff4b4b' }]} />
            </View>
            <View>
              <Text style={styles.headerName}>{username}</Text>
              <Text style={styles.headerSub}>{otherIsTyping ? 'جاري الكتابة...' : peerStatusText}</Text>
            </View>
          </TouchableOpacity>
        </View>
        <View style={styles.headerRight}>
           <TouchableOpacity style={styles.iconCircle}><Ionicons name="call" size={22} color={Colors.primary} /></TouchableOpacity>
           <TouchableOpacity style={styles.iconCircle}><Ionicons name="ellipsis-vertical" size={22} color={Colors.onSurfaceVariant} /></TouchableOpacity>
        </View>
      </BlurView>
    );
  };

  return (
    <View style={styles.container}>
      {renderCustomHeader()}
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <FlatList
          ref={flatListRef}
          data={messages}
          keyExtractor={(item) => item.id.toString()}
          contentContainerStyle={styles.listContent}
          renderItem={({ item }) => {
            const isMe = item.sender_id === currentUserId;
            return (
              <View style={[styles.msgWrap, isMe ? styles.myWrap : styles.theirWrap]}>
                {isMe ? (
                  <LinearGradient colors={Gradients.primary} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.bubble}>
                    <Text style={styles.myTxt}>{item.content}</Text>
                    <View style={styles.meta}>
                      <Text style={styles.myTime}>{new Date(item.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</Text>
                      <Ionicons name={item.is_read ? 'checkmark-done' : 'checkmark'} size={14} color={Colors.white} style={{ marginLeft: 4 }} />
                    </View>
                  </LinearGradient>
                ) : (
                  <View style={[styles.bubble, styles.theirBubble]}>
                    <Text style={styles.theirTxt}>{item.content}</Text>
                    <Text style={styles.theirTime}>{new Date(item.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</Text>
                  </View>
                )}
              </View>
            );
          }}
        />

        <View style={styles.composerContainer}>
          <View style={styles.inputArea}>
            <TouchableOpacity style={styles.extraBtn}><Ionicons name="add" size={28} color={Colors.primary} /></TouchableOpacity>
            <TextInput
              style={styles.textInput}
              value={newMessage}
              onChangeText={(t) => { setNewMessage(t); handleTyping(); }}
              placeholder="اكتب شيئاً..."
              placeholderTextColor={Colors.onSurfaceVariant}
              multiline
            />
            {newMessage.trim() ? (
               <TouchableOpacity style={styles.sendBtn} onPress={sendMessage}>
                  <Ionicons name="send" size={20} color={Colors.white} />
               </TouchableOpacity>
            ) : (
               <View style={styles.rightIcons}>
                 <TouchableOpacity style={styles.iconPadded} onPress={() => ImagePicker.launchCameraAsync()}><Ionicons name="camera-outline" size={26} color={Colors.onSurfaceVariant} /></TouchableOpacity>
                 <TouchableOpacity style={styles.iconPadded} onPress={startRecording}><Ionicons name="mic-outline" size={26} color={Colors.primary} /></TouchableOpacity>
               </View>
            )}
          </View>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: { 
    flexDirection: 'row-reverse', 
    alignItems: 'center', 
    justifyContent: 'space-between', 
    paddingHorizontal: Spacing.lg, 
    paddingTop: Platform.OS === 'ios' ? 60 : 40, 
    paddingBottom: 16,
    zIndex: 100,
  },
  headerLeft: { flexDirection: 'row-reverse', alignItems: 'center', gap: 12 },
  iconCircle: { width: 40, height: 40, borderRadius: 20, backgroundColor: Colors.white, justifyContent: 'center', alignItems: 'center', ...Shadow.ambient },
  profileGroup: { flexDirection: 'row-reverse', alignItems: 'center', gap: 12 },
  headerAvatarWrap: { position: 'relative' },
  squircleAvatar: { width: 44, height: 44, borderRadius: Radius.md, overflow: 'hidden', justifyContent: 'center', alignItems: 'center' },
  avatarImg: { width: '100%', height: '100%' },
  avatarText: { fontSize: 20, fontWeight: 'bold', color: Colors.primary },
  statusDot: { position: 'absolute', bottom: -2, left: -2, width: 14, height: 14, borderRadius: 7, backgroundColor: Colors.secondaryContainer, borderWidth: 3, borderColor: Colors.white },
  headerName: { fontSize: 17, fontWeight: '800', color: Colors.onSurface, textAlign: 'right' },
  headerSub: { fontSize: 12, color: Colors.primary, textAlign: 'right', marginTop: 2 },
  headerRight: { flexDirection: 'row-reverse', alignItems: 'center', gap: 8 },

  listContent: { padding: Spacing.lg },
  msgWrap: { flexDirection: 'row-reverse', marginBottom: 12 },
  myWrap: { justifyContent: 'flex-start' },
  theirWrap: { justifyContent: 'flex-end' },
  bubble: { maxWidth: '80%', padding: 14, borderRadius: 20, ...Shadow.ambient },
  myTime: { fontSize: 10, color: Colors.white, opacity: 0.7 },
  theirBubble: { backgroundColor: Colors.white, borderBottomLeftRadius: 4 },
  myTxt: { fontSize: 16, color: Colors.white, textAlign: 'right', fontWeight: '500' },
  theirTxt: { fontSize: 16, color: Colors.onSurface, textAlign: 'right' },
  meta: { flexDirection: 'row-reverse', alignItems: 'center', marginTop: 4 },
  theirTime: { fontSize: 10, color: Colors.onSurfaceVariant, marginTop: 4, textAlign: 'left' },

  composerContainer: { padding: Spacing.md, paddingBottom: Platform.OS === 'ios' ? 40 : 20 },
  inputArea: { flexDirection: 'row-reverse', alignItems: 'center', backgroundColor: Colors.white, borderRadius: Radius.full, padding: 8, ...Shadow.ambient },
  extraBtn: { width: 44, height: 44, justifyContent: 'center', alignItems: 'center' },
  textInput: { flex: 1, maxHeight: 100, fontSize: 16, color: Colors.onSurface, textAlign: 'right', marginHorizontal: 8, ...(Platform.OS === 'web' && { outlineStyle: 'none' } as any) },
  rightIcons: { flexDirection: 'row-reverse', alignItems: 'center', gap: 8 },
  iconPadded: { padding: 8 },
  sendBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: Colors.primary, justifyContent: 'center', alignItems: 'center', ...Shadow.premium }
});
