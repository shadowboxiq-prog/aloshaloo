import React, { useState, useEffect, useRef } from 'react';
import { View, Text, TextInput, TouchableOpacity, FlatList, StyleSheet, KeyboardAvoidingView, Platform, Keyboard, Alert, ActivityIndicator, Modal, Dimensions } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { supabase } from '../../lib/supabase';
import { Ionicons } from '@expo/vector-icons';
import { Image as RNImage } from 'react-native';
import { Audio } from 'expo-av';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { Image } from 'expo-image';

const QUICK_EMOJIS = ['❤️', '😂', '😮', '😢', '😡', '👍', '🔥', '✨', '🙏', '😊'];
const { width: SCREEN_WIDTH } = Dimensions.get('window');

type MediaItem = {
  url: string;
  placeholder: string;
  type: string;
  uri?: string; // used locally before upload
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
  const [myAvatar, setMyAvatar] = useState<string | null>(null);
  const [isTyping, setIsTyping] = useState(false);
  const [otherIsTyping, setOtherIsTyping] = useState(false);
  const [showEmojis, setShowEmojis] = useState(false);
  
  // Media Preview State
  const [selectedMedia, setSelectedMedia] = useState<MediaItem[]>([]);
  const [mediaCaption, setMediaCaption] = useState('');
  const [isHD, setIsHD] = useState(false);
  const [isViewOnce, setIsViewOnce] = useState(false);
  
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
    let channel: any = null;

    const initChat = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      
      const uid = session.user.id;
      setCurrentUserId(uid);

      fetchMessages(uid, id as string);
      fetchProfiles(uid, id as string);
      
      const channelName = `room_${[uid, id].sort().join('_')}`;
      
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
      }

      channelRef.current = supabase
        .channel(channelName, {
          config: { presence: { key: uid } },
        });

      channelRef.current
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'messages' },
          (payload: any) => {
            const newMsg = payload.new;
            if (
              (newMsg.sender_id === uid && newMsg.receiver_id === id) ||
              (newMsg.sender_id === id && newMsg.receiver_id === uid)
            ) {
              setMessages((prev) => {
                 const exists = prev.find(m => m.id === newMsg.id);
                 if (exists) return prev;
                 return [...prev, newMsg];
              });

              if (newMsg.sender_id === id) {
                 markMessagesAsRead(uid, id as string);
              }
            }
          }
        )
        .on('presence', { event: 'sync' }, () => {
          const state = channelRef.current.presenceState();
          const typing = Object.values(state).some((presence: any) => 
            presence.some((p: any) => p.user_id === id && p.is_typing)
          );
          setOtherIsTyping(typing);
        })
        .subscribe(async (status: any) => {
          if (status === 'SUBSCRIBED') {
            await channelRef.current.track({
              user_id: uid,
              is_typing: false,
            });
          }
        });
    }

    initChat();
    fetchFriendStatus();

    const interval = setInterval(fetchFriendStatus, 30000);
    
    return () => {
      clearInterval(interval);
      if (channelRef.current) supabase.removeChannel(channelRef.current);
      if (soundRef.current) soundRef.current.unloadAsync();
      if (recordingIntervalRef.current) clearInterval(recordingIntervalRef.current);
      if (currentRecordingRef.current) currentRecordingRef.current.stopAndUnloadAsync();
      if (currentWebRecorderRef.current && currentWebRecorderRef.current.state !== 'inactive') {
        currentWebRecorderRef.current.stop();
        currentWebRecorderRef.current.stream.getTracks().forEach(track => track.stop());
      }
    };
  }, []);

  const fetchFriendStatus = async () => {
    if (!id) return;
    const { data } = await supabase.from('profiles').select('last_seen').eq('id', id).single();
    if (data?.last_seen) {
      const lastSeen = new Date(data.last_seen).getTime();
      const now = new Date().getTime();
      const diffMin = (now - lastSeen) / 1000 / 60;
      
      if (diffMin < 2) {
        setFriendStatus('متصل الآن');
      } else {
        const date = new Date(data.last_seen);
        setFriendStatus(`آخر ظهور ${date.getHours()}:${date.getMinutes().toString().padStart(2, '0')}`);
      }
    } else {
      setFriendStatus('غير متصل');
    }
  };

  const markMessagesAsRead = async (userId: string, senderId: string) => {
    await supabase.from('messages').update({ is_read: true }).eq('receiver_id', userId).eq('sender_id', senderId).eq('is_read', false);
  };

  const fetchMessages = async (userId: string, receiverId: string) => {
    const { data, error } = await supabase
      .from('messages')
      .select('*')
      .or(`and(sender_id.eq.${userId},receiver_id.eq.${receiverId}),and(sender_id.eq.${receiverId},receiver_id.eq.${userId})`)
      .order('created_at', { ascending: true });

    if (!error && data) {
      setMessages(data);
      markMessagesAsRead(userId, receiverId);
    }
  };

  const fetchProfiles = async (uid: string, friendId: string) => {
    const { data: friendData } = await supabase.from('profiles').select('avatar_url').eq('id', friendId).single();
    if (friendData) setFriendAvatar(friendData.avatar_url);
    const { data: myData } = await supabase.from('profiles').select('avatar_url').eq('id', uid).single();
    if (myData) setMyAvatar(myData.avatar_url);
  };

  const handleTyping = () => {
    if (!isTyping && channelRef.current) {
      setIsTyping(true);
      channelRef.current.track({ user_id: currentUserId, is_typing: true });
    }
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(() => {
      setIsTyping(false);
      if (channelRef.current) {
        channelRef.current.track({ user_id: currentUserId, is_typing: false });
      }
    }, 2000);
  };

  // --------------- MEDIA FUNCTIONS ---------------
  
  const pickMedia = async (useCamera = false) => {
    try {
      const options: ImagePicker.ImagePickerOptions = {
        mediaTypes: ['images'],
        allowsMultipleSelection: !useCamera,
        selectionLimit: 30,
        quality: 1,
        base64: true,
      };

      const result = useCamera 
        ? await ImagePicker.launchCameraAsync(options)
        : await ImagePicker.launchImageLibraryAsync(options);

      if (!result.canceled) {
        const newMedia: MediaItem[] = result.assets.map(asset => ({
          url: '',
          placeholder: '',
          type: asset.type === 'video' ? 'video' : 'image',
          uri: asset.uri,
          base64: asset.base64 || undefined
        }));
        setSelectedMedia(newMedia);
      }
    } catch (e) {
       Alert.alert("خطأ", "لم نتمكن من فتح المعرض/الكاميرا");
    }
  };

  const sendMediaMessage = async () => {
    if (!currentUserId || selectedMedia.length === 0) return;
    
    setIsSending(true);
    Keyboard.dismiss();
    
    const mediaToUpload = [...selectedMedia];
    const captionToSet = mediaCaption.trim();
    const isHDRemember = isHD;
    const isViewOnceRemember = isViewOnce;
    
    // Clear preview state instantly to get back to chat
    setSelectedMedia([]);
    setMediaCaption('');
    setIsHD(false);
    setIsViewOnce(false);
    
    try {
      const finalMediaArray = [];
      
      for (const item of mediaToUpload) {
        if (!item.uri) continue;
        
        let finalUri = item.uri;
        let pHash = '';

        try {
          if (Platform.OS !== 'web') {
            // Generate tiny base64 placeholder
            const placeholderAsset = await ImageManipulator.manipulateAsync(
              item.uri,
              [{ resize: { width: 20 } }],
              { compress: 0.1, base64: true }
            );
            pHash = `data:image/jpeg;base64,${placeholderAsset.base64}`;

            // Compress main image if not HD
            if (!isHDRemember) {
              const compressed = await ImageManipulator.manipulateAsync(
                item.uri,
                [{ resize: { width: 1200 } }], // max width 1200px
                { compress: 0.6 } // 60% quality
              );
              finalUri = compressed.uri;
            }
          }
        } catch (manipErr) {
          console.warn("Failed to compress image, using original", manipErr);
        }

        const fileName = `${currentUserId}_${Date.now()}_${Math.random().toString(36).substring(7)}.jpg`;

        const formData = new FormData();
        formData.append('upload_preset', 'chat_app_unsigned');
        
        if (item.base64) {
           formData.append('file', `data:image/jpeg;base64,${item.base64}`);
        } else {
           const fetchResponse = await fetch(finalUri);
           const blob = await fetchResponse.blob();
           formData.append('file', blob, fileName);
        }

        const uploadResponse = await fetch('https://api.cloudinary.com/v1_1/dy8sl8fzs/image/upload', {
          method: 'POST',
          body: formData,
        });

        const cloudinaryData = await uploadResponse.json();
        
        if (!uploadResponse.ok) {
           throw new Error("Cloudinary Error: " + (cloudinaryData.error?.message || "Unknown error"));
        }
        
        finalMediaArray.push({
          url: cloudinaryData.secure_url,
          placeholder: pHash,
          type: item.type
        });
      }

      // Insert DB record
      const { error } = await supabase.from('messages').insert([{
        sender_id: currentUserId,
        receiver_id: id,
        content: captionToSet,
        message_type: 'media',
        payload: {
          media: finalMediaArray,
          is_hd: isHDRemember,
          is_view_once: isViewOnceRemember
        },
        is_read: false
      }]);

      if (error) throw new Error("DB Error: " + error.message);
      
    } catch (err: any) {
      console.error("SEND ERROR:", err);
      if (Platform.OS === 'web') {
         window.alert('تنبيه للمطور: ' + (err.message || String(err)));
      } else {
         Alert.alert('تنبيه للمطور', 'الخطأ التقني هو: ' + (err.message || String(err)));
      }
    } finally {
      setIsSending(false);
    }
  };

  const markViewOnceAsViewed = async (msgId: string) => {
    // Optimistic UI update or true DB update. We just hide it natively for now.
    // Given the 1-hr delete rule, we'll let it naturally delete, but hide from UI.
  }

  // --------------- AUDIO FUNCTIONS ---------------

  const sendMessage = async () => {
    if (!newMessage.trim() || !currentUserId || isSending) return;
    const msgText = newMessage.trim();
    setIsSending(true);
    Keyboard.dismiss();

    const { error } = await supabase.from('messages').insert([{
        sender_id: currentUserId,
        receiver_id: id,
        content: msgText,
        is_read: false
    }]);

    setIsSending(false);
    if (!error) {
      setNewMessage('');
      setIsTyping(false);
      if (channelRef.current) channelRef.current.track({ user_id: currentUserId, is_typing: false });
    }
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
          } else {
            window.alert('حجم التسجيل صفر! الرجاء التأكد من الميكروفون الخاص بك.');
          }
        };
        currentWebRecorderRef.current = mediaRecorder;
        mediaRecorder.start(500); // 500ms timeslice to guarantee chunks
      } else {
        const permission = await Audio.requestPermissionsAsync();
        if (permission.status !== 'granted') {
          Alert.alert("عذراً", "نحتاج إلى إذن الميكروفون!");
          return;
        }
        await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
        const { recording: newRecording } = await Audio.Recording.createAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
        currentRecordingRef.current = newRecording;
      }
      setIsRecordingUI(true);
      setRecordingDuration(0);
      if (recordingIntervalRef.current) clearInterval(recordingIntervalRef.current);
      recordingIntervalRef.current = setInterval(() => {
        setRecordingDuration(prev => {
          if (prev >= 59) { stopAndSendRecording(); return 60; }
          return prev + 1;
        });
      }, 1000);
    } catch (err: any) {
      if (Platform.OS === 'web') {
        window.alert("الميكروفون غير متصل أو المتصفح يمنع الوصول إليه!");
      } else {
        Alert.alert("الميكروفون", "هناك خطأ في الوصول للمايك!");
      }
    }
  };

  const stopAndSendRecording = async () => {
    if (recordingIntervalRef.current) clearInterval(recordingIntervalRef.current);
    setIsRecordingUI(false);
    if (Platform.OS === 'web') {
      const mediaRecorder = currentWebRecorderRef.current;
      if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        mediaRecorder.stop();
        mediaRecorder.stream.getTracks().forEach(track => track.stop());
      }
      currentWebRecorderRef.current = null;
    } else {
      const activeRecording = currentRecordingRef.current;
      if (activeRecording) {
        await activeRecording.stopAndUnloadAsync();
        const uri = activeRecording.getURI();
        if (uri) uploadAndSendAudio(uri);
      }
      currentRecordingRef.current = null;
    }
  };

  const cancelRecording = async () => {
    if (recordingIntervalRef.current) clearInterval(recordingIntervalRef.current);
    setIsRecordingUI(false);
    setRecordingDuration(0);
    if (Platform.OS === 'web') {
      const mediaRecorder = currentWebRecorderRef.current;
      if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        mediaRecorder.onstop = null;
        mediaRecorder.stop();
        mediaRecorder.stream.getTracks().forEach(track => track.stop());
      }
      currentWebRecorderRef.current = null;
    } else {
      const activeRecording = currentRecordingRef.current;
      if (activeRecording) await activeRecording.stopAndUnloadAsync();
      currentRecordingRef.current = null;
    }
  };
  
  const uploadAndSendAudio = async (uri?: string, directBlob?: Blob) => {
    setIsSending(true);
    try {
      if (!currentUserId) return;
      const fileExt = Platform.OS === 'web' ? 'webm' : 'm4a';
      const fileName = `audio_${currentUserId}_${Date.now()}.${fileExt}`;
      
      const formData = new FormData();
      formData.append('upload_preset', 'chat_app_unsigned');

      if (Platform.OS === 'web') {
        if (!directBlob) throw new Error("لا يوجد تسجيل صوتي للإرسال عبر المتصفح");
        formData.append('file', directBlob, fileName);
      } else {
        if (!uri) throw new Error("لا يوجد ملف صوتي للإرسال");
        formData.append('file', {
          uri: Platform.OS === 'android' ? uri : uri.replace('file://', ''),
          name: fileName,
          type: 'audio/m4a'
        } as any);
      }

      const uploadResponse = await fetch('https://api.cloudinary.com/v1_1/dy8sl8fzs/video/upload', {
         method: 'POST',
         body: formData,
      });
      
      const cloudinaryData = await uploadResponse.json();
      if (!uploadResponse.ok) throw new Error("Cloudinary Error: " + cloudinaryData.error?.message);

      await supabase.from('messages').insert([{
        sender_id: currentUserId, receiver_id: id, content: 'مقطع صوتي 🎵', message_type: 'audio', audio_url: cloudinaryData.secure_url, is_read: false
      }]);
    } catch (err: any) {
      console.error(err);
      if (Platform.OS === 'web') {
         window.alert('خطأ في إرسال الصوت: ' + (err.message || String(err)));
      } else {
         Alert.alert('خطأ في إرسال الصوت', (err.message || String(err)));
      }
    } finally { setIsSending(false); }
  };

  const playAudio = async (msgId: string, url: string) => {
    try {
      if (soundRef.current) {
        await soundRef.current.unloadAsync();
        soundRef.current = null;
        if (playingSoundId === msgId) { setPlayingSoundId(null); return; }
      }
      setPlayingSoundId(msgId);
      const { sound } = await Audio.Sound.createAsync({ uri: url }, { shouldPlay: true });
      soundRef.current = sound;
      sound.setOnPlaybackStatusUpdate((status: any) => {
        if (status.isLoaded && status.didJustFinish) setPlayingSoundId(null);
      });
    } catch (err) {}
  };

  // --------------- RENDERS ---------------

  const isOnline = friendStatus.includes('متصل');

  const renderCustomHeader = () => (
    <View style={styles.topAppBar}>
      <View style={styles.appBarLeft}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="chevron-forward" size={28} color="#575881" />
        </TouchableOpacity>
        <View style={styles.headerInfoGroup}>
          <View style={styles.headerAvatarContainer}>
            {friendAvatar ? (
              <RNImage source={{ uri: friendAvatar }} style={styles.headerAvatar} />
            ) : (
              <View style={[styles.headerAvatar, styles.headerAvatarPlaceholder]}><Text style={styles.headerAvatarText}>{username?.[0]?.toUpperCase()}</Text></View>
            )}
            {isOnline && <View style={styles.onlineIndicator} />}
          </View>
          <View>
            <Text style={styles.headerUsername}>{username || 'المراسلة'}</Text>
            <Text style={styles.headerStatus}>{otherIsTyping ? 'جاري الكتابة...' : friendStatus}</Text>
          </View>
        </View>
      </View>
      <View style={styles.appBarRight}>
        <TouchableOpacity style={styles.iconBtn}><Ionicons name="search" size={24} color="#575881" /></TouchableOpacity>
        <TouchableOpacity style={styles.iconBtn}><Ionicons name="ellipsis-vertical" size={24} color="#575881" /></TouchableOpacity>
      </View>
    </View>
  );

  const renderMediaGrid = (mediaArray: any[]) => {
    if (!mediaArray || mediaArray.length === 0) return null;
    
    // Convert to Image array for ImageViewer
    const onPressImage = (index: number) => {
      setViewerImages(mediaArray.map(m => ({uri: m.url})));
      setViewerIndex(index);
      setViewerVisible(true);
    };

    if (mediaArray.length === 1) {
      return (
        <TouchableOpacity onPress={() => onPressImage(0)}>
          <Image 
            source={mediaArray[0].url} 
            placeholder={mediaArray[0].placeholder}
            contentFit="cover"
            transition={500}
            style={{ width: SCREEN_WIDTH * 0.6, height: SCREEN_WIDTH * 0.6, borderRadius: 12, marginBottom: 8 }} 
          />
        </TouchableOpacity>
      );
    }
    
    if (mediaArray.length === 2) {
      return (
        <View style={{ flexDirection: 'row-reverse', gap: 4, marginBottom: 8 }}>
          {mediaArray.slice(0, 2).map((m, idx) => (
             <TouchableOpacity key={idx} onPress={() => onPressImage(idx)}>
               <Image source={m.url} placeholder={m.placeholder} contentFit="cover" transition={500} style={{ width: (SCREEN_WIDTH * 0.6)/2 - 2, height: SCREEN_WIDTH * 0.6, borderRadius: 12 }} />
             </TouchableOpacity>
          ))}
        </View>
      );
    }

    return (
      <View style={{ flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 4, marginBottom: 8, width: SCREEN_WIDTH * 0.6 }}>
        {mediaArray.slice(0, 4).map((m, idx) => (
           <TouchableOpacity key={idx} onPress={() => onPressImage(idx)} style={{ width: '48%' }}>
             <Image source={m.url} placeholder={m.placeholder} contentFit="cover" transition={500} style={{ width: '100%', aspectRatio: 1, borderRadius: 12 }} />
             {idx === 3 && mediaArray.length > 4 && (
                <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', borderRadius: 12 }]}>
                   <Text style={{ color: 'white', fontSize: 24, fontWeight: 'bold' }}>+{mediaArray.length - 4}</Text>
                </View>
             )}
           </TouchableOpacity>
        ))}
      </View>
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
          onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: true })}
          onLayout={() => flatListRef.current?.scrollToEnd({ animated: true })}
          contentContainerStyle={styles.messagesContainer}
          renderItem={({ item }) => {
            const isMe = item.sender_id === currentUserId;
            
            return (
              <View style={[styles.messageWrapper, isMe ? styles.myMessageWrapper : styles.theirMessageWrapper]}>
                <View style={[styles.messageBubble, isMe ? styles.myMessage : styles.theirMessage]}>
                  
                  {/* Audio Render */}
                  {item.message_type === 'audio' || item.audio_url ? (
                    <TouchableOpacity style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 12 }} onPress={() => playAudio(item.id, item.audio_url)}>
                      <Ionicons name={playingSoundId === item.id ? "pause-circle" : "play-circle"} size={36} color={isMe ? "#ffffff" : "#004be2"} />
                      <View style={{ width: 100, height: 4, backgroundColor: isMe ? '#ffffff55' : '#809bff55', borderRadius: 2 }}>
                        <View style={{ width: playingSoundId === item.id ? '100%' : '0%', height: '100%', backgroundColor: isMe ? '#ffffff' : '#004be2', borderRadius: 2 }} />
                      </View>
                      <Text style={isMe ? styles.myMessageText : styles.theirMessageText}>صوت</Text>
                    </TouchableOpacity>
                  ) : item.message_type === 'media' && item.payload?.media ? (
                    /* Media Render */
                    <>
                      {item.payload.is_view_once ? (
                         item.payload.viewed ? (
                           <View style={{ width: 150, height: 100, backgroundColor: 'rgba(0,0,0,0.1)', borderRadius: 12, justifyContent: 'center', alignItems: 'center' }}>
                              <Ionicons name="checkmark-done-circle-outline" size={32} color={isMe ? "#fff" : "#888"} />
                              <Text style={isMe ? styles.myMessageText : styles.theirMessageText}>تم المشاهدة</Text>
                           </View>
                         ) : (
                           <TouchableOpacity 
                             style={{ width: 150, height: 100, backgroundColor: 'rgba(0,0,0,0.2)', borderRadius: 12, justifyContent: 'center', alignItems: 'center' }}
                             onPress={() => {
                               // Open Modal
                               setViewerImages(item.payload.media.map((m: any) => ({uri: m.url})));
                               setViewerIndex(0);
                               setViewerVisible(true);
                               
                               // If receiver opens it, mark as viewed forever!
                               if (!isMe) {
                                  const newPayload = { ...item.payload, viewed: true, media: [] };
                                  // Optimistic UI Update!
                                  setMessages(prev => prev.map(msg => msg.id === item.id ? { ...msg, payload: newPayload } : msg));
                                  // Update Database
                                  supabase.from('messages').update({ payload: newPayload }).eq('id', item.id).then();
                               }
                             }}
                           >
                              <Ionicons name="eye-outline" size={32} color={isMe ? "#fff" : "#004be2"} />
                              <Text style={[isMe ? styles.myMessageText : styles.theirMessageText, { marginTop: 8 }]}>
                                 {isMe ? 'تم الإرسال لمرة واحدة' : 'اضغط للمشاهدة'}
                              </Text>
                           </TouchableOpacity>
                         )
                      ) : renderMediaGrid(item.payload.media)}
                      {item.content ? <Text style={isMe ? styles.myMessageText : styles.theirMessageText}>{item.content}</Text> : null}
                    </>
                  ) : (
                    /* Text Render */
                    <Text style={isMe ? styles.myMessageText : styles.theirMessageText}>{item.content}</Text>
                  )}

                  <View style={[styles.messageMeta, { justifyContent: 'flex-start' }]}>
                    <Text style={isMe ? styles.myTimeText : styles.theirTimeText}>
                      {new Date(item.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </Text>
                    {isMe && <Ionicons name={item.is_read ? 'checkmark-done' : 'checkmark'} size={14} color={item.is_read ? '#f2f1ff' : '#f2f1ff99'} style={{ marginLeft: 4, marginTop: 4 }}/>}
                  </View>
                </View>
              </View>
            );
          }}
        />

        <View style={styles.inputAreaContainer}>
          <View style={styles.inputPill}>
            
            <View style={styles.inputLeftIcons}>
              <TouchableOpacity style={styles.inputIconBtn} onPress={() => setShowEmojis(!showEmojis)}>
                <Ionicons name={showEmojis ? "close-circle" : "happy-outline"} size={24} color="#575881" />
              </TouchableOpacity>
              <TouchableOpacity style={styles.inputIconBtn} onPress={() => pickMedia(false)}>
                <Ionicons name="attach-outline" size={26} color="#575881" />
              </TouchableOpacity>
              <TouchableOpacity style={styles.inputIconBtn} onPress={() => pickMedia(true)}>
                <Ionicons name="camera-outline" size={24} color="#575881" />
              </TouchableOpacity>
            </View>

            {isRecordingUI ? (
              <View style={styles.recordingArea}>
                <Text style={styles.recordingText}>انقر للحذف، أو أرسل...</Text>
                <Text style={styles.recordingTime}>00:{recordingDuration.toString().padStart(2, '0')}</Text>
                <View style={styles.recordingDot} />
              </View>
            ) : (
              <TextInput
                style={styles.textInput}
                value={newMessage}
                onChangeText={(text) => { setNewMessage(text); handleTyping(); }}
                placeholder="اكتب رسالتك هنا..."
                placeholderTextColor="#9999c6"
                multiline
                editable={!isSending}
                onFocus={() => setShowEmojis(false)}
              />
            )}
            
            <View style={styles.inputRightAction}>
              {isRecordingUI ? (
                <View style={{ flexDirection: 'row-reverse', gap: 8 }}>
                  <TouchableOpacity style={[styles.sendButton, { backgroundColor: '#FF3B30' }]} onPress={stopAndSendRecording}>
                    <Ionicons name="send" size={20} color="#FFFFFF" style={styles.sendIconFix} />
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.cancelButton} onPress={cancelRecording}>
                    <Ionicons name="trash" size={20} color="#EF4444" />
                  </TouchableOpacity>
                </View>
              ) : (
                <View style={{ flexDirection: 'row-reverse', gap: 8 }}>
                  <TouchableOpacity 
                    style={[styles.sendButton, (!newMessage.trim() || isSending) && { opacity: 0.5 }]} 
                    onPress={sendMessage} 
                    disabled={isSending || !newMessage.trim()}
                  >
                    {isSending ? <ActivityIndicator size="small" color="#FFFFFF" /> : <Ionicons name="send" size={20} color="#FFFFFF" style={styles.sendIconFix} />}
                  </TouchableOpacity>
                  
                  <TouchableOpacity 
                    style={[styles.sendButton, isSending && { opacity: 0.5 }, { backgroundColor: '#004be2' }]} 
                    onPress={startRecording} 
                    disabled={isSending}
                  >
                    <Ionicons name="mic" size={22} color="#FFFFFF" />
                  </TouchableOpacity>
                </View>
              )}
            </View>
          </View>
        </View>

        {showEmojis && (
          <View style={styles.emojiPicker}>
            <FlatList
              data={QUICK_EMOJIS} horizontal showsHorizontalScrollIndicator={false}
              keyExtractor={(item) => item}
              renderItem={({ item }) => (
                <TouchableOpacity style={styles.emojiItem} onPress={() => setNewMessage(p => p + item)}>
                  <Text style={styles.emojiText}>{item}</Text>
                </TouchableOpacity>
              )}
              contentContainerStyle={{ paddingHorizontal: 16 }}
            />
          </View>
        )}
      </KeyboardAvoidingView>

      {/* Media Preview Modal */}
      <Modal visible={selectedMedia.length > 0} animationType="slide" presentationStyle="pageSheet">
        <View style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={() => setSelectedMedia([])}><Text style={styles.modalCancel}>إلغاء</Text></TouchableOpacity>
            <Text style={styles.modalTitle}>معاينة ({selectedMedia.length})</Text>
            <View style={{ width: 40 }} />
          </View>
          
          <View style={styles.modalContent}>
            <RNImage source={{ uri: selectedMedia[0]?.uri }} style={styles.modalMainImg} resizeMode="contain" />
          </View>

          <View style={styles.modalTools}>
             <TouchableOpacity style={[styles.toolBtn, isHD && styles.toolBtnActive]} onPress={() => setIsHD(!isHD)}>
               <Ionicons name="videocam-outline" size={24} color={isHD ? "#fff" : "#004be2"} />
               <Text style={[styles.toolText, isHD && {color: '#fff'}]}>HD</Text>
             </TouchableOpacity>
             <TouchableOpacity style={[styles.toolBtn, isViewOnce && styles.toolBtnActive]} onPress={() => setIsViewOnce(!isViewOnce)}>
               <Ionicons name="timer-outline" size={24} color={isViewOnce ? "#fff" : "#004be2"} />
               <Text style={[styles.toolText, isViewOnce && {color: '#fff'}]}>لمرة واحدة</Text>
             </TouchableOpacity>
          </View>

          <View style={styles.modalFooter}>
             <TextInput 
               style={styles.modalInput}
               placeholder="أضف تعليقاً..."
               placeholderTextColor="#999"
               value={mediaCaption}
               onChangeText={setMediaCaption}
             />
             <TouchableOpacity style={styles.sendButton} onPress={sendMediaMessage}>
                {isSending ? <ActivityIndicator color="#fff" /> : <Ionicons name="send" size={20} color="#fff" style={styles.sendIconFix} />}
             </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Custom Fullscreen Image Viewer */}
      {viewerVisible && (
        <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.98)', zIndex: 9999, elevation: 9999, justifyContent: 'center' }]}>
          <TouchableOpacity 
             style={{ position: 'absolute', top: Platform.OS === 'ios' ? 60 : 30, right: 20, zIndex: 10000, padding: 10 }} 
             onPress={() => setViewerVisible(false)}
          >
             <Ionicons name="close-circle" size={40} color="#fff" />
          </TouchableOpacity>
          <FlatList
             data={viewerImages}
             keyExtractor={(_, index) => index.toString()}
             horizontal
             pagingEnabled
             initialScrollIndex={viewerIndex >= 0 && viewerIndex < viewerImages.length ? viewerIndex : 0}
             getItemLayout={(_, index) => ({ length: SCREEN_WIDTH, offset: SCREEN_WIDTH * index, index })}
             showsHorizontalScrollIndicator={false}
             style={{ flex: 1 }}
             renderItem={({ item }) => (
                <View style={{ width: SCREEN_WIDTH, height: Dimensions.get('window').height, justifyContent: 'center', alignItems: 'center' }}>
                   <Image 
                      source={{ uri: item.uri }} 
                      style={{ width: '100%', height: '100%' }} 
                      contentFit="contain" 
                      transition={200}
                   />
                </View>
             )}
          />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8f5ff' },
  topAppBar: { flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: Platform.OS === 'ios' ? 50 : 30, paddingBottom: 12, backgroundColor: 'rgba(248, 245, 255, 0.95)', zIndex: 10, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.05, shadowRadius: 10, elevation: 2 },
  appBarLeft: { flexDirection: 'row-reverse', alignItems: 'center', gap: 8 },
  backBtn: { padding: 8 },
  headerInfoGroup: { flexDirection: 'row-reverse', alignItems: 'center', gap: 12 },
  headerAvatarContainer: { position: 'relative' },
  headerAvatar: { width: 44, height: 44, borderRadius: 14, resizeMode: 'cover' },
  headerAvatarPlaceholder: { backgroundColor: '#e8e6ff', justifyContent: 'center', alignItems: 'center' },
  headerAvatarText: { color: '#004be2', fontSize: 18, fontWeight: 'bold' },
  onlineIndicator: { position: 'absolute', bottom: -2, left: -2, width: 14, height: 14, backgroundColor: '#5be2ff', borderWidth: 2, borderColor: '#ffffff', borderRadius: 7 },
  headerUsername: { fontSize: 18, fontWeight: '700', color: '#2a2b51', textAlign: 'right' },
  headerStatus: { fontSize: 11, fontWeight: '600', color: '#575881', textTransform: 'uppercase', letterSpacing: 0.5, textAlign: 'right', marginTop: 2 },
  appBarRight: { flexDirection: 'row-reverse' },
  iconBtn: { padding: 8 },

  messagesContainer: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 24 },
  messageWrapper: { flexDirection: 'row-reverse', marginBottom: 8 },
  myMessageWrapper: { justifyContent: 'flex-start' },
  theirMessageWrapper: { justifyContent: 'flex-end' },
  messageBubble: { maxWidth: '85%', paddingHorizontal: 16, paddingVertical: 12 },
  myMessage: { backgroundColor: '#004be2', borderTopLeftRadius: 16, borderTopRightRadius: 16, borderBottomLeftRadius: 16, borderBottomRightRadius: 4 },
  theirMessage: { backgroundColor: '#dbd9ff', borderTopLeftRadius: 16, borderTopRightRadius: 16, borderBottomLeftRadius: 4, borderBottomRightRadius: 16 },
  myMessageText: { color: '#f2f1ff', fontSize: 15, lineHeight: 22, fontWeight: '500', textAlign: 'right' },
  theirMessageText: { color: '#2a2b51', fontSize: 15, lineHeight: 22, fontWeight: '500', textAlign: 'right' },
  messageMeta: { flexDirection: 'row-reverse', alignItems: 'center', marginTop: 4 },
  myTimeText: { color: '#f2f1ff', opacity: 0.8, fontSize: 11, fontWeight: '500' },
  theirTimeText: { color: '#575881', fontSize: 11, fontWeight: '500' },

  inputAreaContainer: { backgroundColor: '#f8f5ff', paddingHorizontal: 16, paddingTop: 8, paddingBottom: Platform.OS === 'ios' ? 32 : 16 },
  inputPill: { flexDirection: 'row-reverse', alignItems: 'center', backgroundColor: '#f2efff', borderRadius: 24, paddingHorizontal: 8, paddingVertical: 8 },
  inputLeftIcons: { flexDirection: 'row-reverse', alignItems: 'center', gap: 4 },
  inputIconBtn: { padding: 8, borderRadius: 20 },
  textInput: { flex: 1, fontSize: 15, color: '#2a2b51', textAlign: 'right', maxHeight: 120, paddingHorizontal: 12, paddingTop: 12, paddingBottom: 12 },
  inputRightAction: { marginLeft: 8 },
  sendButton: { backgroundColor: '#004be2', height: 48, width: 48, borderRadius: 16, justifyContent: 'center', alignItems: 'center' },
  cancelButton: { backgroundColor: '#ffeef7', height: 48, width: 48, borderRadius: 16, justifyContent: 'center', alignItems: 'center' },
  sendIconFix: { marginLeft: -2, marginTop: 2 },
  
  recordingArea: { flex: 1, flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'flex-end', paddingHorizontal: 12, height: 48 },
  recordingText: { flex: 1, color: '#575881', fontSize: 13, textAlign: 'right', marginRight: 8 },
  recordingTime: { color: '#EF4444', fontWeight: 'bold', fontSize: 14 },
  recordingDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#EF4444', marginLeft: 8 },

  emojiPicker: { backgroundColor: '#ffffff', paddingVertical: 12 },
  emojiItem: { padding: 8, marginHorizontal: 4, backgroundColor: '#f2efff', borderRadius: 16 },
  emojiText: { fontSize: 24 },

  // Modal Styles
  modalContainer: { flex: 1, backgroundColor: '#1e1e2d' },
  modalHeader: { flexDirection: 'row-reverse', justifyContent: 'space-between', alignItems: 'center', padding: 16, paddingTop: Platform.OS === 'ios' ? 50 : 20 },
  modalCancel: { color: '#ffb4ab', fontSize: 16, fontWeight: '600' },
  modalTitle: { color: '#fff', fontSize: 18, fontWeight: '700' },
  modalContent: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  modalMainImg: { width: '100%', height: '100%' },
  modalTools: { flexDirection: 'row-reverse', justifyContent: 'center', gap: 16, paddingVertical: 16 },
  toolBtn: { flexDirection: 'row-reverse', alignItems: 'center', backgroundColor: '#e8e6ff', paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20, gap: 8 },
  toolBtnActive: { backgroundColor: '#004be2' },
  toolText: { color: '#004be2', fontWeight: 'bold' },
  modalFooter: { flexDirection: 'row-reverse', alignItems: 'center', padding: 16, paddingBottom: Platform.OS === 'ios' ? 40 : 16, backgroundColor: '#2a2b51' },
  modalInput: { flex: 1, backgroundColor: '#fff', borderRadius: 24, paddingHorizontal: 16, height: 48, textAlign: 'right', marginRight: 12 }
});
