import React, { useState, useEffect, useRef } from 'react';
import { View, Text, TextInput, TouchableOpacity, FlatList, StyleSheet, KeyboardAvoidingView, Platform, Keyboard, Alert, ActivityIndicator, Modal, Dimensions, Linking, AppState } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { supabase } from '../../lib/supabase';
import { Ionicons } from '@expo/vector-icons';
import { Image as RNImage } from 'react-native';
import { Audio, Video, ResizeMode } from 'expo-av';
import * as ImagePicker from 'expo-image-picker';
import { Image } from 'expo-image';
import { Colors, Radius, Spacing, Shadow, Gradients } from '../../constants/theme';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { formatLastSeenArabic } from '../../lib/date-utils';
import * as DocumentPicker from 'expo-document-picker';
import { useCall } from '../../context/CallProvider';

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
  const [viewerImages, setViewerImages] = useState<{uri: string, type?: string}[]>([]);
  const [viewerIndex, setViewerIndex] = useState(0);
  const [showAttachmentMenu, setShowAttachmentMenu] = useState(false);

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
  const { startCall } = useCall();

  useEffect(() => {
    if (messages.length > 0) {
      setTimeout(() => {
        flatListRef.current?.scrollToEnd({ animated: true });
      }, 100);
    }
  }, [messages]);

  useEffect(() => {    let isMounted = true;
    const uid_val = currentUserId; // helper for listeners

    const initChat = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session || !isMounted) return;
      
      const uid = session.user.id;
      setCurrentUserId(uid);

      await fetchMessages(uid, id as string);
      await fetchProfiles(id as string);
      
      setupSubscription(uid);
    }

    const setupSubscription = (uid: string) => {
      const channelName = `room_${[uid, id].sort().join('_')}`;
      if (channelRef.current) supabase.removeChannel(channelRef.current);

      channelRef.current = supabase.channel(channelName, { config: { presence: { key: uid } } });

      channelRef.current
        .on('postgres_changes', { event: '*', schema: 'public', table: 'messages' }, (payload: any) => {
            if (!isMounted) return;
            
            if (payload.eventType === 'INSERT') {
              const newMsg = payload.new;
              if ((newMsg.sender_id === uid && newMsg.receiver_id === id) || (newMsg.sender_id === id && newMsg.receiver_id === uid)) {
                setMessages((prev) => {
                  const exists = prev.find(m => m.id === newMsg.id);
                  if (exists) return prev;
                  return [...prev.filter(m => !(m.isOptimistic && m.content === newMsg.content)), newMsg];
                });
                if (newMsg.sender_id === id) markMessagesAsRead(uid, id as string);
              }
            } else if (payload.eventType === 'UPDATE') {
              const updatedMsg = payload.new;
              setMessages((prev) => prev.map(m => m.id === updatedMsg.id ? updatedMsg : m));
            } else if (payload.eventType === 'DELETE') {
              setMessages((prev) => prev.filter(m => m.id !== payload.old.id));
            }
        })
        .on('presence', { event: 'sync' }, () => {
          if (!isMounted) return;
          const state = channelRef.current.presenceState();
          const typing = Object.values(state).some((presence: any) => 
            presence.some((p: any) => p.user_id === id && p.is_typing)
          );
          setOtherIsTyping(typing);
        })
        .subscribe(async (status: any) => {
          if (status === 'SUBSCRIBED') {
            await channelRef.current.track({ user_id: uid, is_typing: false });
          } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
            console.log('Realtime Status:', status);
            // Reconnect aggressively if app is foregrounded
            if (isMounted && currentUserId) {
               fetchMessages(currentUserId, id as string);
               setTimeout(() => { if (isMounted) setupSubscription(uid); }, 3000);
            }
          }
        });
    }

    initChat();
    fetchFriendStatus();
    
    // Background/Foreground re-sync
    const appStateListener = AppState.addEventListener('change', (nextAppState) => {
      if (nextAppState === 'active' && currentUserId && isMounted) {
        fetchMessages(currentUserId, id as string);
        fetchFriendStatus();
        setupSubscription(currentUserId);
      }
    });

    return () => {
       isMounted = false;
       appStateListener.remove();
       if (channelRef.current) supabase.removeChannel(channelRef.current);
       if (soundRef.current) soundRef.current.unloadAsync();
       if (recordingIntervalRef.current) clearInterval(recordingIntervalRef.current);
       if (currentRecordingRef.current) currentRecordingRef.current.stopAndUnloadAsync();
    };
  }, [id]);

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
    setIsSending(true);
    const msgText = newMessage.trim();
    setNewMessage('');
    setIsTyping(false);
    Keyboard.dismiss();

    // Optimistic Update
    const tempId = `temp-${Date.now()}`;
    const optimisticMsg = {
      id: tempId,
      sender_id: currentUserId,
      receiver_id: id,
      content: msgText,
      is_read: false,
      created_at: new Date().toISOString(),
      isOptimistic: true, 
    };
    
    setMessages(prev => [...prev, optimisticMsg]);
    if (channelRef.current) channelRef.current.track({ user_id: currentUserId, is_typing: false });

    const { data: realMsg, error } = await supabase.from('messages').insert([{ 
      sender_id: currentUserId, 
      receiver_id: id, 
      content: msgText, 
      is_read: false 
    }]).select().single();

    if (error) {
      Alert.alert('خطأ', 'فشل إرسال الرسالة');
      setMessages(prev => prev.filter(m => m.id !== tempId));
    } else if (realMsg) {
      setMessages(prev => {
        const exists = prev.find(m => m.id === realMsg.id);
        if (exists) return prev.filter(m => m.id !== tempId); // Already got via realtime
        return prev.map(m => m.id === tempId ? realMsg : m);
      });
    }
    setIsSending(false);
  };

  const startRecording = async () => {
    try {
      if (Platform.OS === 'web') {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
          Alert.alert('خطأ في المتصفح', 'المتصفح يحظر الوصول للميكروفون في الروابط غير المشفرة (HTTP). يرجى تجربة الميزة من خلال الرابط العام (HTTPS) أو من خلال localhost.');
          return;
        }
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
    } catch (err: any) {
      console.error(err);
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        Alert.alert('خطأ في الميكروفون', 'يرجى السماح بالوصول للميكروفون من إعدادات المتصفح.');
      } else if (err.name === 'SecurityError') {
        Alert.alert('خطأ أمني', 'التسجيل الصوتي يتطلب رابط آمن (HTTPS) أو التحميل من localhost.');
      } else {
        Alert.alert('خطأ', 'تعذر تشغيل الميكروفون: ' + err.message);
      }
    }
  };

   const stopAndSendRecording = async () => {
    if (recordingIntervalRef.current) clearInterval(recordingIntervalRef.current);
    setIsRecordingUI(false);
    try {
      if (Platform.OS === 'web') {
        currentWebRecorderRef.current?.stop();
      } else {
        await currentRecordingRef.current?.stopAndUnloadAsync();
        const uri = currentRecordingRef.current?.getURI();
        if (uri) uploadAndSendAudio(uri);
      }
    } catch {}
  };

  const cancelRecording = async () => {
    if (recordingIntervalRef.current) clearInterval(recordingIntervalRef.current);
    setIsRecordingUI(false);
    try {
      if (Platform.OS === 'web') {
        currentWebRecorderRef.current?.stop(); // We stop but discard chunks
        webChunksRef.current = [];
      } else {
        await currentRecordingRef.current?.stopAndUnloadAsync();
      }
    } catch {}
  };

  const pickMedia = async (useGallery: boolean) => {
    try {
      const result = useGallery 
        ? await ImagePicker.launchImageLibraryAsync({
            mediaTypes: ['images', 'videos'],
            allowsMultipleSelection: true,
            quality: 0.8,
          })
        : await ImagePicker.launchCameraAsync({
            mediaTypes: ['images'], // Explicitly images for camera
            quality: 0.8,
            allowsEditing: true,
          });

      if (!result.canceled) {
        // Send each selected item
        for (const asset of result.assets) {
          uploadAndSendMedia(asset.uri, asset.type === 'video' ? 'video' : 'image');
        }
      }
    } catch (err) {
      Alert.alert('خطأ', 'فشل في اختيار الميديا');
    }
  };

  const uploadAndSendMedia = async (uri: string, type: 'image' | 'video') => {
    setIsSending(true);
    try {
      const formData = new FormData();
      formData.append('upload_preset', 'chat_unsigned');
      
      if (Platform.OS === 'web') {
        const response = await fetch(uri);
        const blob = await response.blob();
        formData.append('file', blob);
      } else {
        formData.append('file', {
          uri,
          name: type === 'video' ? 'video.mp4' : 'image.jpg',
          type: type === 'video' ? 'video/mp4' : 'image/jpeg',
        } as any);
      }

      const res = await fetch(`https://api.cloudinary.com/v1_1/dpdyevp6z/${type === 'video' ? 'video' : 'image'}/upload`, {
        method: 'POST',
        body: formData,
      });
      
      const data = await res.json();
      if (data.secure_url) {
        const { data: realMsg } = await supabase.from('messages').insert([{
          sender_id: currentUserId,
          receiver_id: id,
          content: type === 'video' ? '📽️ فيديو' : '🖼️ صورة',
          message_type: type,
          file_url: data.secure_url,
          file_type: type,
          is_read: false
        }]).select().single();
        
        if (realMsg) {
           setMessages(prev => {
             if (prev.find(m => m.id === realMsg.id)) return prev;
             return [...prev, realMsg];
           });
        }
      }
    } catch (err) {
      Alert.alert('خطأ', 'فشل في رفع الملف');
    } finally {
      setIsSending(false);
    }
  };

  const pickDocument = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
      });

      if (!result.canceled) {
        for (const asset of result.assets) {
          uploadAndSendFile(asset.uri, asset.name, asset.mimeType || 'application/octet-stream');
        }
      }
    } catch (err) {
      Alert.alert('خطأ', 'فشل في اختيار المستند');
    }
  };

  const uploadAndSendFile = async (uri: string, name: string, mimeType: string) => {
    setIsSending(true);
    try {
      const formData = new FormData();
      formData.append('upload_preset', 'chat_unsigned');
      
      if (Platform.OS === 'web') {
        const response = await fetch(uri);
        const blob = await response.blob();
        formData.append('file', blob);
      } else {
        formData.append('file', { uri, name, type: mimeType } as any);
      }

      // PDFs and raw files use /raw/upload or /image/upload (image handles pdf for thumbnails, but raw is safer for all)
      const isPdf = name.toLowerCase().endsWith('.pdf');
      const resourceType = isPdf ? 'image' : 'raw'; // image allows thumbnails for PDFs

      const res = await fetch(`https://api.cloudinary.com/v1_1/dpdyevp6z/${resourceType}/upload`, {
        method: 'POST',
        body: formData,
      });
      
      const data = await res.json();
      if (data.secure_url) {
        const { data: realMsg } = await supabase.from('messages').insert([{
          sender_id: currentUserId,
          receiver_id: id,
          content: `📄 ${name}`,
          message_type: 'file',
          file_url: data.secure_url,
          file_type: 'file',
          payload: { name, size: data.bytes },
          is_read: false
        }]).select().single();
        
        if (realMsg) {
           setMessages(prev => {
             if (prev.find(m => m.id === realMsg.id)) return prev;
             return [...prev, realMsg];
           });
        }
      }
    } catch (err) {
      Alert.alert('خطأ', 'فشل في رفع المستند');
    } finally {
      setIsSending(false);
    }
  };

  const uploadAndSendAudio = async (uri?: string, blob?: Blob) => {
    setIsSending(true);
    try {
      const formData = new FormData();
      formData.append('upload_preset', 'chat_unsigned');
      
      if (blob) {
        formData.append('file', blob, 'audio.webm');
      } else if (uri) {
        if (Platform.OS === 'web') {
          const resp = await fetch(uri);
          const b = await resp.blob();
          formData.append('file', b, 'audio.webm');
        } else {
          formData.append('file', { uri, name: 'audio.m4a', type: 'audio/m4a' } as any);
        }
      }
      
      const res = await fetch('https://api.cloudinary.com/v1_1/dpdyevp6z/video/upload', { method: 'POST', body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message || 'فشل الرفع لـ Cloudinary');
      
      const { data: realMsg } = await supabase.from('messages').insert([{ 
        sender_id: currentUserId, 
        receiver_id: id, 
        content: 'مقطع صوتي 🎵', 
        message_type: 'audio', 
        audio_url: data.secure_url, 
        is_read: false 
      }]).select().single();
      
      if (realMsg) {
         setMessages(prev => {
           if (prev.find(m => m.id === realMsg.id)) return prev;
           return [...prev, realMsg];
         });
      }
    } catch (err: any) {
      console.error('Audio Upload Error:', err);
      Alert.alert('خطأ في الإرسال', 'لم نتمكن من إرسال البصمة: ' + err.message);
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
           <TouchableOpacity 
             style={styles.iconCircle} 
             onPress={() => startCall(id as string, username as string, friendAvatar, true)}
           >
             <Ionicons name="videocam" size={22} color={Colors.primary} />
           </TouchableOpacity>
           <TouchableOpacity 
             style={styles.iconCircle} 
             onPress={() => startCall(id as string, username as string, friendAvatar, false)}
           >
             <Ionicons name="call" size={22} color={Colors.primary} />
           </TouchableOpacity>
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
            const isMedia = item.message_type === 'image' || item.message_type === 'video' || item.message_type === 'audio';

            return (
              <View style={[styles.msgWrap, isMe ? styles.myWrap : styles.theirWrap]}>
                {isMe ? (
                  <LinearGradient colors={Gradients.primary} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[styles.bubble, isMedia && { padding: 4, borderRadius: 16 }]}>
                    {item.message_type === 'image' && (
                      <TouchableOpacity onPress={() => { setViewerImages([{ uri: item.file_url }]); setViewerIndex(0); setViewerVisible(true); }}>
                        <Image source={{ uri: item.file_url }} style={styles.mediaContent} contentFit="cover" transition={300} />
                      </TouchableOpacity>
                    )}
                    {item.message_type === 'video' && (
                       <TouchableOpacity style={styles.mediaContent} onPress={() => { setViewerImages([{ uri: item.file_url, type: 'video' }]); setViewerIndex(0); setViewerVisible(true); }}>
                          <RNImage source={{ uri: item.file_url.replace('.mp4', '.jpg') }} style={styles.mediaContent} />
                          <View style={styles.playOverlay}>
                            <Ionicons name="play-circle" size={50} color={Colors.white} />
                          </View>
                       </TouchableOpacity>
                    )}
                    {item.message_type === 'audio' && (
                      <TouchableOpacity style={styles.audioRow} onPress={() => playAudio(item.id, item.audio_url)}>
                        <Ionicons name={playingSoundId === item.id ? "pause" : "play"} size={24} color={Colors.white} />
                        <View style={styles.audioWave}><View style={styles.waveBar} /><View style={styles.waveBarActive} /><View style={styles.waveBar} /></View>
                        <Text style={styles.audioText}>رسالة صوتية</Text>
                      </TouchableOpacity>
                    )}
                    {item.message_type === 'file' && (
                      <TouchableOpacity style={styles.fileRow} onPress={() => Linking.openURL(item.file_url)}>
                        <View style={isMe ? styles.fileIconWrapMy : styles.fileIconWrapTheir}>
                           <Ionicons name="document-text" size={30} color={isMe ? Colors.white : Colors.primary} />
                        </View>
                        <View style={{ flex: 1, alignItems: 'flex-end' }}>
                          <Text style={[styles.fileName, { color: isMe ? Colors.white : Colors.onSurface }]} numberOfLines={1}>{item.payload?.name || 'مستند'}</Text>
                          <Text style={[styles.fileSize, { color: isMe ? 'rgba(255,255,255,0.7)' : Colors.onSurfaceVariant }]}>{(item.payload?.size / 1024).toFixed(1)} KB</Text>
                        </View>
                      </TouchableOpacity>
                    )}
                    {!isMedia && item.message_type !== 'file' && <Text style={styles.myTxt}>{item.content}</Text>}
                    <View style={styles.meta}>
                      <Text style={styles.myTime}>{new Date(item.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</Text>
                      <Ionicons name={item.is_read ? 'checkmark-done' : 'checkmark'} size={14} color={Colors.white} style={{ marginLeft: 4 }} />
                    </View>
                  </LinearGradient>
                ) : (
                  <View style={[styles.bubble, styles.theirBubble, isMedia && { padding: 4, borderRadius: 16 }]}>
                    {item.message_type === 'image' && (
                      <TouchableOpacity onPress={() => { setViewerImages([{ uri: item.file_url }]); setViewerIndex(0); setViewerVisible(true); }}>
                        <Image source={{ uri: item.file_url }} style={styles.mediaContent} contentFit="cover" transition={300} />
                      </TouchableOpacity>
                    )}
                    {item.message_type === 'video' && (
                       <TouchableOpacity style={styles.mediaContent} onPress={() => { setViewerImages([{ uri: item.file_url, type: 'video' }]); setViewerIndex(0); setViewerVisible(true); }}>
                          <RNImage source={{ uri: item.file_url.replace('.mp4', '.jpg') }} style={styles.mediaContent} />
                          <View style={styles.playOverlay}>
                            <Ionicons name="play-circle" size={50} color={Colors.white} />
                          </View>
                       </TouchableOpacity>
                    )}
                    {item.message_type === 'audio' && (
                      <TouchableOpacity style={styles.audioRow} onPress={() => playAudio(item.id, item.audio_url)}>
                        <Ionicons name={playingSoundId === item.id ? "pause" : "play"} size={24} color={Colors.primary} />
                        <View style={[styles.audioWave, { backgroundColor: Colors.surfaceContainer }]}><View style={[styles.waveBar, { backgroundColor: Colors.primary }]} /></View>
                        <Text style={[styles.audioText, { color: Colors.primary }]}>رسالة صوتية</Text>
                      </TouchableOpacity>
                    )}
                    {item.message_type === 'file' && (
                      <TouchableOpacity style={styles.fileRow} onPress={() => Linking.openURL(item.file_url)}>
                        <View style={isMe ? styles.fileIconWrapMy : styles.fileIconWrapTheir}>
                           <Ionicons name="document-text" size={30} color={isMe ? Colors.white : Colors.primary} />
                        </View>
                        <View style={{ flex: 1, alignItems: 'flex-end' }}>
                          <Text style={[styles.fileName, { color: isMe ? Colors.white : Colors.onSurface }]} numberOfLines={1}>{item.payload?.name || 'مستند'}</Text>
                          <Text style={[styles.fileSize, { color: isMe ? 'rgba(255,255,255,0.7)' : Colors.onSurfaceVariant }]}>{(item.payload?.size / 1024).toFixed(1)} KB</Text>
                        </View>
                      </TouchableOpacity>
                    )}
                    {!isMedia && item.message_type !== 'file' && <Text style={styles.theirTxt}>{item.content}</Text>}
                    <Text style={styles.theirTime}>{new Date(item.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</Text>
                  </View>
                )}
              </View>
            );
          }}
        />

        <View style={styles.composerContainer}>
          {showAttachmentMenu && (
            <BlurView intensity={80} tint="light" style={styles.attachmentMenu}>
              <TouchableOpacity style={styles.menuItem} onPress={() => { pickMedia(true); setShowAttachmentMenu(false); }}>
                <View style={[styles.menuIcon, { backgroundColor: '#6200ee' }]}>
                  <Ionicons name="images" size={24} color={Colors.white} />
                </View>
                <Text style={styles.menuText}>صور وفيديوهات</Text>
              </TouchableOpacity>
              
              <TouchableOpacity style={styles.menuItem} onPress={() => { pickDocument(); setShowAttachmentMenu(false); }}>
                <View style={[styles.menuIcon, { backgroundColor: '#00c853' }]}>
                  <Ionicons name="document" size={24} color={Colors.white} />
                </View>
                <Text style={styles.menuText}>مستند / PDF</Text>
              </TouchableOpacity>
            </BlurView>
          )}

          <View style={styles.inputArea}>
            <TouchableOpacity style={styles.extraBtn} onPress={() => setShowAttachmentMenu(!showAttachmentMenu)}>
              <Ionicons name={showAttachmentMenu ? "close" : "add"} size={28} color={Colors.primary} />
            </TouchableOpacity>
            {isRecordingUI ? (
              <View style={styles.recordingArea}>
                <TouchableOpacity onPress={cancelRecording} style={styles.iconPadded}>
                  <Ionicons name="trash-outline" size={24} color="#ff4b4b" />
                </TouchableOpacity>
                <View style={styles.recordingInfo}>
                   <View style={styles.recordingDot} />
                   <Text style={styles.recordingTimer}>{Math.floor(recordingDuration / 60)}:{(recordingDuration % 60).toString().padStart(2, '0')}</Text>
                </View>
                <TouchableOpacity style={styles.recordStopBtn} onPress={stopAndSendRecording}>
                   <Ionicons name="stop" size={24} color={Colors.white} />
                </TouchableOpacity>
              </View>
            ) : (
              <>
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
                     <TouchableOpacity style={styles.iconPadded} onPress={() => pickMedia(false)}><Ionicons name="camera-outline" size={26} color={Colors.onSurfaceVariant} /></TouchableOpacity>
                     <TouchableOpacity style={styles.iconPadded} onPress={startRecording}><Ionicons name="mic-outline" size={26} color={Colors.primary} /></TouchableOpacity>
                   </View>
                )}
              </>
            )}
          </View>
        </View>
      </KeyboardAvoidingView>

      {/* Media Viewer Modal */}
      <Modal visible={viewerVisible} transparent animationType="fade">
        <BlurView intensity={100} tint="dark" style={styles.viewerContainer}>
          <TouchableOpacity style={styles.viewerClose} onPress={() => setViewerVisible(false)}>
            <Ionicons name="close" size={30} color={Colors.white} />
          </TouchableOpacity>
          
          <View style={styles.viewerContent}>
            {viewerImages[viewerIndex]?.type === 'video' ? (
              <Video
                source={{ uri: viewerImages[viewerIndex].uri }}
                style={styles.fullMedia}
                useNativeControls
                resizeMode={ResizeMode.CONTAIN}
                shouldPlay
                isLooping
              />
            ) : (
              <Image 
                source={{ uri: viewerImages[viewerIndex]?.uri }} 
                style={styles.fullMedia} 
                contentFit="contain"
              />
            )}
          </View>
        </BlurView>
      </Modal>
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
  sendBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: Colors.primary, justifyContent: 'center', alignItems: 'center', ...Shadow.premium },

  // Media Styles
  mediaContent: { width: 200, height: 200, borderRadius: 12, backgroundColor: Colors.surfaceContainerHigh },
  playOverlay: { ...StyleSheet.absoluteFillObject, justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.2)', borderRadius: 12 },
  audioRow: { flexDirection: 'row-reverse', alignItems: 'center', gap: 10, paddingVertical: 4 },
  audioWave: { flex: 1, height: 20, backgroundColor: 'rgba(255,255,255,0.2)', borderRadius: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 2 },
  waveBar: { width: 3, height: 10, backgroundColor: Colors.white, borderRadius: 2 },
  waveBarActive: { width: 3, height: 16, backgroundColor: Colors.white, borderRadius: 2 },
  audioText: { color: Colors.white, fontSize: 13, fontWeight: '600' },

  // Viewer Styles
  viewerContainer: { flex: 1, backgroundColor: 'rgba(0,0,0,0.9)' },
  viewerClose: { position: 'absolute', top: 50, left: 20, zIndex: 10, width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.2)', justifyContent: 'center', alignItems: 'center' },
  viewerContent: { flex: 1, width: '100%', height: '100%', justifyContent: 'center', alignItems: 'center' },
  fullMedia: { width: '100%', height: '100%' },

  // File Styles
  fileRow: { flexDirection: 'row-reverse', alignItems: 'center', gap: 12, paddingVertical: 4, minWidth: 180 },
  fileIconWrapMy: { width: 50, height: 50, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.2)', justifyContent: 'center', alignItems: 'center' },
  fileIconWrapTheir: { width: 50, height: 50, borderRadius: 12, backgroundColor: Colors.surfaceContainerHigh, justifyContent: 'center', alignItems: 'center' },
  fileName: { fontSize: 15, fontWeight: '700', textAlign: 'right' },
  fileSize: { fontSize: 12, marginTop: 2, textAlign: 'right' },

  // Attachment Menu
  attachmentMenu: {
    position: 'absolute',
    bottom: 80,
    right: 20,
    left: 20,
    borderRadius: 24,
    padding: 16,
    flexDirection: 'row-reverse',
    justifyContent: 'space-around',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.5)',
    overflow: 'hidden',
    ...Shadow.premium
  },
  menuItem: { alignItems: 'center', gap: 8 },
  menuIcon: { width: 50, height: 50, borderRadius: 25, justifyContent: 'center', alignItems: 'center', ...Shadow.ambient },
  menuText: { fontSize: 13, fontWeight: '700', color: Colors.onSurface },

  // Recording UI Styles
  recordingArea: { flex: 1, flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 8 },
  recordingInfo: { flexDirection: 'row-reverse', alignItems: 'center', gap: 8 },
  recordingDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#ff4b4b' },
  recordingTimer: { fontSize: 16, fontWeight: '700', color: Colors.primary, fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace' },
  recordStopBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: Colors.primary, justifyContent: 'center', alignItems: 'center', ...Shadow.premium }
});
