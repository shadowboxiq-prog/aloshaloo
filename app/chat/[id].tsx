import React, { useState, useEffect, useRef } from 'react';
import { View, Text, TextInput, TouchableOpacity, FlatList, StyleSheet, KeyboardAvoidingView, Platform, Keyboard, Alert } from 'react-native';
import { useLocalSearchParams, Stack } from 'expo-router';
import { supabase } from '../../lib/supabase';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'react-native';

const QUICK_EMOJIS = ['❤️', '😂', '😮', '😢', '😡', '👍', '🔥', '✨', '🙏', '😊'];

export default function ChatScreen() {
  const { id, username } = useLocalSearchParams();
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
  const flatListRef = useRef<FlatList>(null);
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const channelRef = useRef<any>(null);

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
      
      // Cleanup previous channel if exists
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
      }

      channelRef.current = supabase
        .channel(channelName, {
          config: {
            presence: {
              key: uid,
            },
          },
        });

      channelRef.current
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'messages' },
          (payload) => {
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
          // console.log('Presence state synced:', state);
          const typing = Object.values(state).some((presence: any) => 
            presence.some((p: any) => p.user_id === id && p.is_typing)
          );
          setOtherIsTyping(typing);
        })
        .subscribe(async (status) => {
          console.log(`Channel status for ${channelName}:`, status);
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

    // Setup a poll for friend status every 30 seconds
    const interval = setInterval(fetchFriendStatus, 30000);
    
    return () => {
      clearInterval(interval);
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
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
        setFriendStatus('متصل 🟢');
      } else {
        const date = new Date(data.last_seen);
        setFriendStatus(`آخر ظهور ${date.getHours()}:${date.getMinutes().toString().padStart(2, '0')}`);
      }
    } else {
      setFriendStatus('غير متصل');
    }
  };

  const markMessagesAsRead = async (userId: string, senderId: string) => {
    await supabase
      .from('messages')
      .update({ is_read: true })
      .eq('receiver_id', userId)
      .eq('sender_id', senderId)
      .eq('is_read', false);
  };

  const fetchMessages = async (userId: string, receiverId: string) => {
    const { data, error } = await supabase
      .from('messages')
      .select('*')
      .or(`and(sender_id.eq.${userId},receiver_id.eq.${receiverId}),and(sender_id.eq.${receiverId},receiver_id.eq.${userId})`)
      .order('created_at', { ascending: true });

    if (!error && data) {
      setMessages(data);
      // Mark as read after fetching
      markMessagesAsRead(userId, receiverId);
    }
  };

  const fetchProfiles = async (uid: string, friendId: string) => {
    // Fetch friend profile
    const { data: friendData } = await supabase.from('profiles').select('avatar_url').eq('id', friendId).single();
    if (friendData) setFriendAvatar(friendData.avatar_url);

    // Fetch my profile
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

  const sendMessage = async () => {
    if (!newMessage.trim() || !currentUserId || isSending) return;

    const msgText = newMessage.trim();
    setIsSending(true);
    Keyboard.dismiss();

    const { error } = await supabase.from('messages').insert([
      {
        sender_id: currentUserId,
        receiver_id: id,
        content: msgText,
        is_read: false
      },
    ]);

    setIsSending(false);

    if (error) {
      console.error('Error sending message:', error);
      Alert.alert('خطأ', 'لم يتم إرسال الرسالة: ' + error.message);
    } else {
      setNewMessage('');
      // Stop typing immediately on send
      setIsTyping(false);
      if (channelRef.current) {
        channelRef.current.track({ user_id: currentUserId, is_typing: false });
      }
    }
  };

  const addEmoji = (emoji: string) => {
    setNewMessage(prev => prev + emoji);
  };

  const formatTime = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const renderHeaderTitle = () => (
    <View style={styles.headerTitleContainer}>
      <Text style={styles.headerUsername}>{username || 'المراسلة'}</Text>
      <Text style={[styles.headerStatus, (friendStatus.includes('متصل') || otherIsTyping) && { color: '#10B981' }]}>
        {otherIsTyping ? 'جاري الكتابة...' : friendStatus}
      </Text>
    </View>
  );

  return (
    <KeyboardAvoidingView 
      style={styles.container} 
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
    >
      <Stack.Screen options={{ 
        headerTitle: () => renderHeaderTitle(),
        headerTitleAlign: 'center',
        headerTintColor: '#111827',
      }} />
      
      <FlatList
        ref={flatListRef}
        data={messages}
        keyExtractor={(item) => item.id.toString()}
        onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: true })}
        onLayout={() => flatListRef.current?.scrollToEnd({ animated: true })}
        renderItem={({ item }) => {
          const isMe = item.sender_id === currentUserId;
          return (
            <View style={[styles.messageWrapper, isMe ? styles.myMessageWrapper : styles.theirMessageWrapper]}>
              {!isMe && (
                friendAvatar ? (
                  <Image source={{ uri: friendAvatar }} style={styles.miniAvatar} />
                ) : (
                  <View style={[styles.miniAvatar, styles.miniAvatarPlaceholder]}>
                    <Text style={styles.miniAvatarText}>{username?.[0]?.toUpperCase()}</Text>
                  </View>
                )
              )}
              <View style={[styles.messageBubble, isMe ? styles.myMessage : styles.theirMessage]}>
                <Text style={isMe ? styles.myMessageText : styles.theirMessageText}>{item.content}</Text>
                <View style={[styles.messageMeta, isMe ? { justifyContent: 'flex-start' } : { justifyContent: 'flex-end' }]}>
                  <Text style={isMe ? styles.myTimeText : styles.theirTimeText}>{formatTime(item.created_at)}</Text>
                  {isMe && (
                    <Ionicons 
                      name={item.is_read ? 'checkmark-done-outline' : 'checkmark-outline'} 
                      size={14} 
                      color={item.is_read ? '#4ade80' : '#A5B4FC'} 
                      style={{ marginLeft: 4, marginTop: 4 }}
                    />
                  )}
                </View>
              </View>
              {isMe && (
                myAvatar ? (
                  <Image source={{ uri: myAvatar }} style={[styles.miniAvatar, { marginLeft: 0, marginRight: 8 }]} />
                ) : (
                  <View style={[styles.miniAvatar, styles.miniAvatarPlaceholder, { marginLeft: 0, marginRight: 8, backgroundColor: '#4F46E5', borderWidth: 0 }]}>
                    <Text style={styles.miniAvatarText}>أنا</Text>
                  </View>
                )
              )}
            </View>
          );
        }}
        contentContainerStyle={styles.messagesContainer}
      />

      <View style={styles.inputContainer}>
        <TouchableOpacity 
          style={styles.emojiIconButton} 
          onPress={() => setShowEmojis(!showEmojis)}
        >
          <Ionicons name={showEmojis ? "close-circle" : "happy-outline"} size={26} color="#4F46E5" />
        </TouchableOpacity>
        <TextInput
          style={styles.textInput}
          value={newMessage}
          onChangeText={(text) => {
            setNewMessage(text);
            handleTyping();
          }}
          placeholder="اكتب رسالتك..."
          placeholderTextColor="#9CA3AF"
          multiline
          editable={!isSending}
          onFocus={() => setShowEmojis(false)}
        />
        <TouchableOpacity 
          style={[styles.sendButton, (!newMessage.trim() || isSending) && styles.sendButtonDisabled]} 
          onPress={sendMessage}
          disabled={!newMessage.trim() || isSending}
        >
          <Ionicons name="send" size={20} color="#FFFFFF" style={styles.sendIcon} />
        </TouchableOpacity>
      </View>

      {showEmojis && (
        <View style={styles.emojiPicker}>
          <FlatList
            data={QUICK_EMOJIS}
            horizontal
            showsHorizontalScrollIndicator={false}
            keyExtractor={(item) => item}
            renderItem={({ item }) => (
              <TouchableOpacity style={styles.emojiItem} onPress={() => addEmoji(item)}>
                <Text style={styles.emojiText}>{item}</Text>
              </TouchableOpacity>
            )}
            contentContainerStyle={styles.emojiList}
          />
        </View>
      )}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F3F4F6',
  },
  headerTitleContainer: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerUsername: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#111827',
  },
  headerStatus: {
    fontSize: 12,
    color: '#6B7280',
    marginTop: 2,
  },
  messagesContainer: {
    padding: 16,
    paddingBottom: 20
  },
  messageWrapper: {
    flexDirection: 'row',
    marginBottom: 12,
  },
  myMessageWrapper: {
    justifyContent: 'flex-start',
    flexDirection: 'row-reverse',
  },
  theirMessageWrapper: {
    justifyContent: 'flex-start',
  },
  messageBubble: {
    maxWidth: '75%',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  myMessage: {
    backgroundColor: '#4F46E5',
    borderTopRightRadius: 4,
  },
  theirMessage: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 4,
  },
  myMessageText: {
    color: '#FFFFFF',
    fontSize: 16,
    lineHeight: 22,
    textAlign: 'right',
  },
  theirMessageText: {
    color: '#1F2937',
    fontSize: 16,
    lineHeight: 22,
    textAlign: 'left',
  },
  messageMeta: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    marginTop: 2,
  },
  myTimeText: {
    color: '#A5B4FC',
    fontSize: 11,
    marginTop: 4,
  },
  theirTimeText: {
    color: '#9CA3AF',
    fontSize: 11,
    marginTop: 4,
  },
  inputContainer: {
    flexDirection: 'row-reverse',
    padding: 12,
    paddingBottom: Platform.OS === 'ios' ? 24 : 12,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: '#F3F4F6',
  },
  textInput: {
    flex: 1,
    backgroundColor: '#F9FAFB',
    borderRadius: 24,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 12,
    fontSize: 16,
    maxHeight: 120,
    textAlign: 'right',
    color: '#1F2937',
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  sendButton: {
    backgroundColor: '#4F46E5',
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 12,
    shadowColor: '#4F46E5',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 3,
  },
  sendButtonDisabled: {
    backgroundColor: '#A5B4FC',
    shadowOpacity: 0,
    elevation: 0,
  },
  sendIcon: {
    marginLeft: -2,
  },
  miniAvatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    marginLeft: 8,
    alignSelf: 'flex-end',
    marginBottom: 4,
  },
  miniAvatarPlaceholder: {
    backgroundColor: '#E5E7EB',
    justifyContent: 'center',
    alignItems: 'center',
  },
  miniAvatarText: {
    fontSize: 10,
    fontWeight: 'bold',
    color: '#FFF',
  },
  emojiIconButton: {
    padding: 8,
  },
  emojiPicker: {
    backgroundColor: '#FFFFFF',
    borderTopWidth: 1,
    borderTopColor: '#F3F4F6',
    paddingVertical: 8,
  },
  emojiList: {
    paddingHorizontal: 12,
  },
  emojiItem: {
    padding: 8,
    marginHorizontal: 4,
    backgroundColor: '#F9FAFB',
    borderRadius: 12,
  },
  emojiText: {
    fontSize: 24,
  }
});
