import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, FlatList, Image, ScrollView, Platform } from 'react-native';
import { supabase } from '../lib/supabase';
import { useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

type TabType = 'chats' | 'friends';

export default function HomeScreen() {
  const [activeTab, setActiveTab] = useState<TabType>('chats');
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [friends, setFriends] = useState<any[]>([]);
  const [chats, setChats] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  const fetchUserData = async () => {
    setLoading(true);
    const { data: { session } } = await supabase.auth.getSession();
    const currentUserId = session?.user.id;
    if (!currentUserId) return;

    // Fetch Current User
    const { data: profile } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', currentUserId)
      .single();
    
    if (profile) setCurrentUser(profile);

    // Fetch Friends
    const { data: friendsData } = await supabase
      .from('friends')
      .select(`
        user_id, friend_id,
        user:profiles!friends_user_id_fkey(id, username, last_seen, avatar_url),
        friend:profiles!friends_friend_id_fkey(id, username, last_seen, avatar_url)
      `)
      .or(`user_id.eq.${currentUserId},friend_id.eq.${currentUserId}`);
    
    let formattedFriends = friendsData?.map((f: any) => {
      return f.user_id === currentUserId ? f.friend : f.user;
    }) || [];

    formattedFriends = Array.from(new Map(formattedFriends.map(item => [item.id, item])).values());
    setFriends(formattedFriends);

    // Fetch Chats
    const { data: messagesData } = await supabase
      .from('messages')
      .select(`
        id, content, created_at, is_read, sender_id, receiver_id, message_type,
        sender:profiles!messages_sender_id_fkey(id, username, last_seen, avatar_url),
        receiver:profiles!messages_receiver_id_fkey(id, username, last_seen, avatar_url)
      `)
      .or(`sender_id.eq.${currentUserId},receiver_id.eq.${currentUserId}`)
      .order('created_at', { ascending: false });

    if (messagesData) {
      const chatsMap = new Map();
      messagesData.forEach(msg => {
        const isMeSender = msg.sender_id === currentUserId;
        const otherUser = isMeSender ? msg.receiver : msg.sender;
        const otherUserId = otherUser.id;

        if (!chatsMap.has(otherUserId)) {
          chatsMap.set(otherUserId, {
            user: otherUser,
            lastMessage: msg.message_type === 'audio' ? 'رسالة صوتية 🎵' : msg.content,
            lastMessageTime: msg.created_at,
            unreadCount: (!isMeSender && !msg.is_read) ? 1 : 0
          });
        } else {
          if (!isMeSender && !msg.is_read) {
            const existing = chatsMap.get(otherUserId);
            chatsMap.set(otherUserId, { ...existing, unreadCount: existing.unreadCount + 1 });
          }
        }
      });
      setChats(Array.from(chatsMap.values()));
    }

    setLoading(false);
  };

  useFocusEffect(
    useCallback(() => {
      fetchUserData();
    }, [])
  );

  const formatTime = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 3600 * 24));
    
    if (diffDays === 0) {
      return `${date.getHours()}:${date.getMinutes().toString().padStart(2, '0')}`;
    } else if (diffDays === 1) {
      return 'أمس';
    } else {
      return date.toLocaleDateString('ar-EG', { weekday: 'short' });
    }
  };

  const getStatusText = (lastSeen: string) => {
    if (!lastSeen) return 'غير متصل';
    const numLastSeen = new Date(lastSeen).getTime();
    const now = new Date().getTime();
    const diffMin = (now - numLastSeen) / 1000 / 60;
    
    if (diffMin < 2) return 'متصل 🟢';
    return 'غير متصل';
  };

  const renderTopAppBar = () => (
    <View style={styles.topAppBar}>
      <View style={styles.headerTitleRow}>
        <TouchableOpacity style={styles.headerAvatarContainer} onPress={() => router.push('/profile')}>
          {currentUser?.avatar_url ? (
            <Image source={{ uri: currentUser.avatar_url }} style={styles.headerAvatar} />
          ) : (
            <View style={styles.headerAvatarPlaceholder}>
              <Text style={styles.headerAvatarText}>{currentUser?.username?.[0]?.toUpperCase() || 'U'}</Text>
            </View>
          )}
        </TouchableOpacity>
        <Text style={styles.headerTitle}>المراسلات</Text>
      </View>
      <TouchableOpacity style={styles.searchIconBtn} onPress={() => router.push('/add-friend')}>
        <Ionicons name="search" size={28} color="#575881" />
      </TouchableOpacity>
    </View>
  );

  const renderActiveUsers = () => (
    <View style={styles.activeUsersSection}>
      <ScrollView 
        horizontal 
        showsHorizontalScrollIndicator={false} 
        contentContainerStyle={styles.activeUsersScroll}
        inverted={Platform.OS === 'web' ? false : true} // Adjust for RTL natively
        style={{ flexDirection: 'row-reverse' }}
      >
        <TouchableOpacity style={styles.activeUserContainer} onPress={() => router.push('/add-friend')}>
          <View style={styles.myActiveUserImageWrapper}>
            <View style={styles.myActiveUserImageInner}>
              <Ionicons name="add" size={36} color="#004be2" />
            </View>
          </View>
          <Text style={styles.activeUserName}>إضافة</Text>
        </TouchableOpacity>

        {friends.map((friend, index) => {
          const isOnline = getStatusText(friend.last_seen).includes('متصل');
          return (
            <TouchableOpacity 
              key={friend.id} 
              style={styles.activeUserContainer} 
              onPress={() => router.push({ pathname: '/chat/[id]', params: { id: friend.id, username: friend.username } })}
            >
              <View style={styles.activeUserImageWrapper}>
                {friend.avatar_url ? (
                  <Image source={{ uri: friend.avatar_url }} style={styles.activeUserImage} />
                ) : (
                  <View style={[styles.activeUserImage, { backgroundColor: getAvatarColor(index), justifyContent: 'center', alignItems: 'center' }]}>
                    <Text style={{ color: '#ffffff', fontSize: 24, fontWeight: 'bold' }}>{friend.username[0].toUpperCase()}</Text>
                  </View>
                )}
                <View style={styles.imageOverlay} />
                {isOnline && <View style={styles.onlineDot} />}
              </View>
              <Text style={styles.activeUserName} numberOfLines={1}>{friend.username}</Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </View>
  );

  const renderChatItem = ({ item, index }: { item: any; index: number }) => (
    <TouchableOpacity 
      style={styles.chatItem}
      onPress={() => router.push({ pathname: '/chat/[id]', params: { id: item.user.id, username: item.user.username } })}
    >
      <View style={styles.chatAvatarWrapper}>
        {item.user.avatar_url ? (
          <Image source={{ uri: item.user.avatar_url }} style={styles.chatAvatar} />
        ) : (
          <View style={[styles.chatAvatar, { backgroundColor: getAvatarColor(index), justifyContent:'center', alignItems: 'center' }]}>
            <Text style={{ color: '#ffffff', fontSize: 24, fontWeight: 'bold' }}>{item.user.username[0].toUpperCase()}</Text>
          </View>
        )}
      </View>

      <View style={styles.chatItemInfo}>
        <View style={styles.chatItemHeader}>
          <Text style={styles.chatItemName} numberOfLines={1}>{item.user.username}</Text>
          <Text style={[styles.chatItemTime, item.unreadCount > 0 && { color: '#004be2' }]}>
            {formatTime(item.lastMessageTime)}
          </Text>
        </View>
        <Text style={[styles.chatItemLastMessage, item.unreadCount > 0 ? styles.chatItemUnreadMessage : null]} numberOfLines={1}>
          {item.lastMessage}
        </Text>
      </View>

      {item.unreadCount > 0 && (
         <View style={styles.unreadDot} />
      )}
    </TouchableOpacity>
  );

  const renderFriendItem = ({ item, index }: { item: any, index: number }) => (
    <TouchableOpacity 
      style={styles.chatItem}
      onPress={() => router.push({ pathname: '/chat/[id]', params: { id: item.id, username: item.username } })}
    >
      <View style={styles.chatAvatarWrapper}>
        {item.avatar_url ? (
          <Image source={{ uri: item.avatar_url }} style={styles.chatAvatar} />
        ) : (
          <View style={[styles.chatAvatar, { backgroundColor: getAvatarColor(index), justifyContent:'center', alignItems: 'center' }]}>
            <Text style={{ color: '#ffffff', fontSize: 24, fontWeight: 'bold' }}>{item.username[0].toUpperCase()}</Text>
          </View>
        )}
      </View>

      <View style={styles.chatItemInfo}>
        <View style={styles.chatItemHeader}>
          <Text style={styles.chatItemName} numberOfLines={1}>{item.username}</Text>
        </View>
        <Text style={styles.chatItemLastMessage} numberOfLines={1}>
          {getStatusText(item.last_seen)}
        </Text>
      </View>
      <Ionicons name="chatbubble-outline" size={24} color="#a9a9d7" />
    </TouchableOpacity>
  );

  return (
    <View style={styles.container}>
      {renderTopAppBar()}

      <FlatList
        data={activeTab === 'chats' ? chats : friends}
        keyExtractor={(item) => (activeTab === 'chats' ? item.user.id : item.id)}
        contentContainerStyle={styles.mainContent}
        ListHeaderComponent={activeTab === 'chats' ? renderActiveUsers : null}
        renderItem={activeTab === 'chats' ? renderChatItem : renderFriendItem}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={() => (
          <View style={styles.emptyContainer}>
            {loading ? (
              <ActivityIndicator size="large" color="#004be2" />
            ) : (
              <Text style={styles.emptyText}>لم يتم العثور على أية رسائل</Text>
            )}
          </View>
        )}
      />

      {/* Floating Action Button */}
      <TouchableOpacity style={styles.fab} onPress={() => router.push('/add-friend')}>
        <Ionicons name="create" size={28} color="#ffffff" />
      </TouchableOpacity>

      {/* Bottom Navigation Navbar */}
      <View style={styles.bottomNavContainer}>
        <View style={styles.bottomNav}>
          <TouchableOpacity 
            style={[styles.navItem, activeTab === 'chats' && styles.navItemActive]}
            onPress={() => setActiveTab('chats')}
          >
            <Ionicons name={activeTab === 'chats' ? "chatbubble" : "chatbubble-outline"} size={26} color={activeTab === 'chats' ? "#ffffff" : "#575881"} />
          </TouchableOpacity>
          <TouchableOpacity 
            style={[styles.navItem, activeTab === 'friends' && styles.navItemActive]}
            onPress={() => setActiveTab('friends')}
          >
            <Ionicons name={activeTab === 'friends' ? "people" : "people-outline"} size={28} color={activeTab === 'friends' ? "#ffffff" : "#575881"} />
          </TouchableOpacity>
          <TouchableOpacity 
            style={styles.navItem}
            onPress={() => router.push('/profile')}
          >
            <Ionicons name="person-outline" size={26} color="#575881" />
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

const getAvatarColor = (index: number) => {
  const colors = ['#004be2', '#006575', '#903986', '#0041c7', '#575881', '#2a2b51'];
  return colors[index % colors.length];
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8f5ff',
  },
  topAppBar: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 24,
    paddingTop: Platform.OS === 'ios' ? 60 : 40,
    paddingBottom: 16,
    backgroundColor: 'rgba(248, 245, 255, 0.95)',
    zIndex: 10,
  },
  headerTitleRow: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 16,
  },
  headerAvatarContainer: {
    width: 48,
    height: 48,
    borderRadius: 20, // squircle shape
    overflow: 'hidden',
    backgroundColor: '#e8e6ff',
    marginLeft: 16,
  },
  headerAvatar: {
    width: '100%',
    height: '100%',
    resizeMode: 'cover',
  },
  headerAvatarPlaceholder: {
    width: '100%',
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerAvatarText: {
    color: '#004be2',
    fontSize: 20,
    fontWeight: 'bold',
  },
  headerTitle: {
    fontFamily: Platform.OS === 'ios' ? 'System' : 'sans-serif',
    fontSize: 36, // Huge size like HTML 2.75rem ~ 44px, using 36 for RN standard fit
    fontWeight: '700',
    letterSpacing: -1,
    color: '#2a2b51',
  },
  searchIconBtn: {
    padding: 8,
    borderRadius: 16,
    backgroundColor: 'transparent',
  },
  
  // Main Content
  mainContent: {
    paddingHorizontal: 24,
    paddingBottom: 160, // Leave space for FAB and BottomNav
  },

  // Active Users (Stories)
  activeUsersSection: {
    marginBottom: 24,
    marginTop: 8,
  },
  activeUsersScroll: {
    flexDirection: 'row-reverse',
    gap: 16,
    paddingVertical: 10,
  },
  activeUserContainer: {
    alignItems: 'center',
    marginLeft: 20, // Space from left neighbor in RTL
  },
  myActiveUserImageWrapper: {
    width: 64,
    height: 64,
    borderRadius: 24,
    padding: 3, // Simulate the gradient border thickness
    backgroundColor: '#004be2', // Gradient fallback
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 8,
  },
  myActiveUserImageInner: {
    width: '100%',
    height: '100%',
    backgroundColor: '#f8f5ff',
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  activeUserImageWrapper: {
    width: 64,
    height: 64,
    borderRadius: 24,
    backgroundColor: '#e1e0ff',
    marginBottom: 8,
    position: 'relative',
  },
  activeUserImage: {
    width: '100%',
    height: '100%',
    borderRadius: 24,
  },
  imageOverlay: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 24,
    backgroundColor: 'rgba(0,0,0,0.03)',
  },
  onlineDot: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: '#4ade80',
    borderWidth: 3,
    borderColor: '#f8f5ff',
  },
  activeUserName: {
    fontSize: 11,
    fontWeight: '600',
    color: '#575881',
    textTransform: 'uppercase',
    letterSpacing: 1,
    textAlign: 'center',
  },

  // Chat/Friend List Items
  chatItem: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    backgroundColor: '#ffffff', // surface-container-lowest
    padding: 16,
    borderRadius: 24,
    marginBottom: 10,
  },
  chatAvatarWrapper: {
    width: 60,
    height: 60,
    borderRadius: 22,
    overflow: 'hidden',
    backgroundColor: '#e8e6ff',
    marginLeft: 16, // In RTL, separates from text
  },
  chatAvatar: {
    width: '100%',
    height: '100%',
    resizeMode: 'cover',
  },
  chatItemInfo: {
    flex: 1,
    alignItems: 'flex-end',
  },
  chatItemHeader: {
    flexDirection: 'row-reverse',
    justifyContent: 'space-between',
    width: '100%',
    alignItems: 'baseline',
    marginBottom: 4,
  },
  chatItemName: {
    fontSize: 18,
    fontWeight: '700',
    color: '#2a2b51',
  },
  chatItemTime: {
    fontSize: 11,
    fontWeight: '700',
    color: '#575881', // or primary tracking-widest
    textTransform: 'uppercase',
  },
  chatItemLastMessage: {
    fontSize: 14,
    color: '#575881', // on-surface-variant
    lineHeight: 22,
    textAlign: 'right',
  },
  chatItemUnreadMessage: {
    fontWeight: '700',
    color: '#2a2b51',
  },
  unreadDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#004be2',
    marginRight: 16,
  },

  // Empty State
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 40,
  },
  emptyText: {
    color: '#a9a9d7',
    fontSize: 16,
    fontWeight: '600',
  },

  // FAB
  fab: {
    position: 'absolute',
    bottom: 120,
    right: 24,
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#004be2',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#004be2',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.3,
    shadowRadius: 20,
    elevation: 8,
    zIndex: 40,
  },

  // Bottom Navigation NavBar
  bottomNavContainer: {
    position: 'absolute',
    bottom: 24,
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 50,
  },
  bottomNav: {
    flexDirection: 'row-reverse',
    justifyContent: 'space-around',
    alignItems: 'center',
    width: '90%',
    maxWidth: 400,
    height: 80,
    backgroundColor: 'rgba(219, 217, 255, 0.85)', // translucent light purple #dbd9ff
    borderRadius: 40, // pill
    paddingHorizontal: 8,
    shadowColor: '#2a2b51',
    shadowOffset: { width: 0, height: 20 },
    shadowOpacity: 0.08,
    shadowRadius: 30,
    elevation: 10,
  },
  navItem: {
    justifyContent: 'center',
    alignItems: 'center',
    width: 56,
    height: 56,
    borderRadius: 28,
  },
  navItemActive: {
    backgroundColor: '#004be2',
  }
});
