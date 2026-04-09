import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, FlatList, Image } from 'react-native';
import { supabase } from '../lib/supabase';
import { useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useCallback } from 'react';

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

    // Fetch Friends (bidirectionally)
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

    // Remove duplicates in case of two-way inserts
    formattedFriends = Array.from(new Map(formattedFriends.map(item => [item.id, item])).values());
    setFriends(formattedFriends);

    // Fetch Chats (Messages to group by user)
    const { data: messagesData } = await supabase
      .from('messages')
      .select(`
        id, content, created_at, is_read, sender_id, receiver_id,
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
            lastMessage: msg.content,
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

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  const getStatusText = (lastSeen: string) => {
    if (!lastSeen) return 'غير متصل';
    const numLastSeen = new Date(lastSeen).getTime();
    const now = new Date().getTime();
    const diffMin = (now - numLastSeen) / 1000 / 60;
    
    if (diffMin < 2) return 'متصل 🟢';
    
    const date = new Date(lastSeen);
    return `آخر ظهور ${date.getHours()}:${date.getMinutes().toString().padStart(2, '0')}`;
  };

  const renderHeader = () => (
    <View style={styles.header}>
      <TouchableOpacity style={styles.userInfoHeader} onPress={() => router.push('/profile')}>
        {currentUser?.avatar_url ? (
          <Image source={{ uri: currentUser.avatar_url }} style={styles.myAvatarImage} />
        ) : (
          <View style={styles.myAvatar}>
            <Text style={styles.avatarText}>{currentUser?.username?.[0]?.toUpperCase() || 'U'}</Text>
          </View>
        )}
        <View style={styles.myInfo}>
          <Text style={styles.myName}>{currentUser?.username || 'مستخدم'}</Text>
          <Text style={styles.myStatus}>متصل الآن</Text>
        </View>
      </TouchableOpacity>
      <View style={styles.headerActions}>
        <TouchableOpacity style={styles.actionButton} onPress={() => router.push('/add-friend')}>
          <Ionicons name="search" size={22} color="#38BDF8" />
        </TouchableOpacity>
        <TouchableOpacity style={styles.actionButton} onPress={signOut}>
          <Ionicons name="log-out" size={24} color="#F87171" />
        </TouchableOpacity>
      </View>
    </View>
  );

  const renderTabs = () => (
    <View style={styles.tabsContainer}>
      <TouchableOpacity 
        style={[styles.tab, activeTab === 'friends' && styles.activeTab]}
        onPress={() => setActiveTab('friends')}
      >
        <Text style={[styles.tabText, activeTab === 'friends' && styles.activeTabText]}>الأصدقاء</Text>
      </TouchableOpacity>
      <TouchableOpacity 
        style={[styles.tab, activeTab === 'chats' && styles.activeTab]}
        onPress={() => setActiveTab('chats')}
      >
        <Text style={[styles.tabText, activeTab === 'chats' && styles.activeTabText]}>المراسلات</Text>
        {chats.some(c => c.unreadCount > 0) && (
          <View style={styles.badgeDot} />
        )}
      </TouchableOpacity>
    </View>
  );

  const renderChatItem = ({ item, index }: { item: any; index: number }) => (
    <TouchableOpacity 
      style={styles.listItem}
      onPress={() => router.push({ pathname: '/chat/[id]', params: { id: item.user.id, username: item.user.username } })}
    >
      {item.user.avatar_url ? (
        <Image source={{ uri: item.user.avatar_url }} style={styles.avatarImage} />
      ) : (
        <View style={[styles.avatar, { backgroundColor: getAvatarColor(index) }]}>
          <Text style={styles.avatarText}>{item.user.username[0].toUpperCase()}</Text>
        </View>
      )}
      <View style={styles.listInfo}>
        <View style={styles.chatRow}>
          <Text style={styles.timeText}>
            {new Date(item.lastMessageTime).getHours()}:{new Date(item.lastMessageTime).getMinutes().toString().padStart(2, '0')}
          </Text>
          <Text style={styles.usernameText}>{item.user.username}</Text>
        </View>
        <View style={styles.chatRow}>
          {item.unreadCount > 0 && (
            <View style={styles.unreadBadge}>
              <Text style={styles.unreadText}>{item.unreadCount}</Text>
            </View>
          )}
          <Text style={[styles.subtitleText, item.unreadCount > 0 && styles.unreadSubtitle]} numberOfLines={1}>
            {item.lastMessage}
          </Text>
        </View>
      </View>
    </TouchableOpacity>
  );

  const renderFriendItem = ({ item, index }: { item: any, index: number }) => (
    <TouchableOpacity 
      style={styles.listItem}
      onPress={() => router.push({ pathname: '/chat/[id]', params: { id: item.id, username: item.username } })}
    >
      {item.avatar_url ? (
        <Image source={{ uri: item.avatar_url }} style={styles.avatarImage} />
      ) : (
        <View style={[styles.avatar, { backgroundColor: getAvatarColor(index) }]}>
          <Text style={styles.avatarText}>{item.username[0].toUpperCase()}</Text>
        </View>
      )}
      <View style={styles.listInfo}>
        <Text style={styles.usernameText}>{item.username}</Text>
        <Text style={styles.statusText}>{getStatusText(item.last_seen)}</Text>
      </View>
      <Ionicons name="chatbubble-ellipses-outline" size={24} color="#D1D5DB" />
    </TouchableOpacity>
  );

  return (
    <View style={styles.container}>
      {renderHeader()}
      {renderTabs()}

      {loading ? (
        <ActivityIndicator size="large" color="#4F46E5" style={{ marginTop: 40 }} />
      ) : activeTab === 'chats' ? (
        <FlatList
          data={chats}
          keyExtractor={(item) => item.user.id}
          contentContainerStyle={styles.listContainer}
          renderItem={renderChatItem}
          ListEmptyComponent={() => (
            <View style={styles.emptyContainer}>
              <Ionicons name="chatbubbles-outline" size={60} color="#D1D5DB" />
              <Text style={styles.emptyText}>لا توجد مراسلات حتى الآن</Text>
            </View>
          )}
        />
      ) : (
        <FlatList
          data={friends}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContainer}
          renderItem={renderFriendItem}
          ListEmptyComponent={() => (
            <View style={styles.emptyContainer}>
              <Ionicons name="people-outline" size={60} color="#D1D5DB" />
              <Text style={styles.emptyText}>قائمة الأصدقاء فارغة</Text>
              <TouchableOpacity style={styles.addFriendBtn} onPress={() => router.push('/add-friend')}>
                <Text style={styles.addFriendText}>البحث عن أصدقاء</Text>
              </TouchableOpacity>
            </View>
          )}
        />
      )}
    </View>
  );
}

const getAvatarColor = (index: number) => {
  const colors = ['#4F46E5', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899'];
  return colors[index % colors.length];
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0F172A', // Deep dark background
  },
  header: {
    flexDirection: 'row-reverse',
    padding: 20,
    paddingTop: 60,
    backgroundColor: 'rgba(30, 41, 59, 0.8)', // Glassmorphism-ish
    justifyContent: 'space-between',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: '#334155',
  },
  userInfoHeader: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
  },
  myAvatar: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: '#6366F1', // Indigo accent
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 12,
    borderWidth: 2,
    borderColor: '#38BDF8', // Azure glow
  },
  myAvatarImage: {
    width: 44,
    height: 44,
    borderRadius: 22,
    marginLeft: 12,
    borderWidth: 2,
    borderColor: '#4F46E5',
  },
  avatarText: {
    color: '#FFF',
    fontSize: 18,
    fontWeight: 'bold',
  },
  myInfo: {
    alignItems: 'flex-end',
  },
  myName: {
    fontSize: 20,
    fontWeight: '800',
    color: '#F8FAFC',
  },
  myStatus: {
    fontSize: 12,
    color: '#38BDF8',
    fontWeight: 'bold',
    letterSpacing: 0.5,
  },
  headerActions: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 12,
  },
  actionButton: {
    padding: 10,
    borderRadius: 14,
    backgroundColor: '#1E293B',
    borderWidth: 1,
    borderColor: '#334155',
  },
  tabsContainer: {
    flexDirection: 'row-reverse',
    backgroundColor: '#1E293B',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#334155',
  },
  tab: {
    flex: 1,
    paddingVertical: 8,
    alignItems: 'center',
    position: 'relative',
  },
  activeTab: {
    borderBottomWidth: 2,
    borderBottomColor: '#4F46E5',
  },
  tabText: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#94A3B8',
  },
  activeTabText: {
    color: '#38BDF8',
  },
  badgeDot: {
    position: 'absolute',
    top: 6,
    right: '25%',
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#EF4444',
  },
  listContainer: {
    padding: 16,
  },
  listItem: {
    flexDirection: 'row-reverse',
    backgroundColor: '#1E293B',
    padding: 20,
    borderRadius: 24,
    marginBottom: 16,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.3,
    shadowRadius: 15,
    elevation: 8,
    borderWidth: 1,
    borderColor: '#334155',
  },
  avatar: {
    width: 60,
    height: 60,
    borderRadius: 30,
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 16,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  avatarImage: {
    width: 60,
    height: 60,
    borderRadius: 30,
    marginLeft: 16,
    borderWidth: 2,
    borderColor: '#38BDF8',
  },
  listInfo: {
    flex: 1,
    alignItems: 'flex-end',
  },
  chatRow: {
    flexDirection: 'row-reverse',
    justifyContent: 'space-between',
    width: '100%',
    alignItems: 'center',
    marginBottom: 2,
  },
  timeText: {
    fontSize: 11,
    color: '#9CA3AF',
  },
  usernameText: {
    fontSize: 18,
    fontWeight: '800',
    color: '#F8FAFC',
  },
  subtitleText: {
    fontSize: 14,
    color: '#94A3B8',
    textAlign: 'right',
    flex: 1,
    marginRight: 8,
  },
  unreadSubtitle: {
    color: '#38BDF8',
    fontWeight: '700',
  },
  statusText: {
    fontSize: 13,
    color: '#10B981',
  },
  unreadBadge: {
    backgroundColor: '#EF4444',
    borderRadius: 10,
    paddingHorizontal: 6,
    paddingVertical: 2,
    minWidth: 20,
    alignItems: 'center',
  },
  unreadText: {
    color: '#FFF',
    fontSize: 11,
    fontWeight: 'bold',
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 60,
  },
  emptyText: {
    marginTop: 16,
    color: '#6B7280',
    fontSize: 16,
    marginBottom: 16,
  },
  addFriendBtn: {
    backgroundColor: '#4F46E5',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
  },
  addFriendText: {
    color: '#FFFFFF',
    fontWeight: 'bold',
  }
});
