import React, { useState, useEffect, useCallback } from 'react';
import { View, TextInput, FlatList, Text, TouchableOpacity, StyleSheet, ActivityIndicator, Alert, Platform } from 'react-native';
import { supabase } from '../lib/supabase';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Radius, Spacing, Shadow } from '../constants/theme';
import { Image } from 'expo-image';
import { formatLastSeenArabic } from '../lib/date-utils';

export default function AddFriendScreen() {
  const [searchQuery, setSearchQuery] = useState('');
  const [users, setUsers] = useState<any[]>([]);
  const [pendingRequests, setPendingRequests] = useState<any[]>([]);
  const [acceptedFriends, setAcceptedFriends] = useState<any[]>([]);
  const [myFriendIds, setMyFriendIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [requestingId, setRequestingId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [feedback, setFeedback] = useState<{ msg: string, type: 'success' | 'error' } | null>(null);
  const [onlineUsers, setOnlineUsers] = useState<Set<string>>(new Set());
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const router = useRouter();

  const showFeedback = (msg: string, type: 'success' | 'error' = 'success') => {
    setFeedback({ msg, type });
    setTimeout(() => setFeedback(null), 3000);
  };

  useEffect(() => {
    fetchInitialData();
  }, []);

  const fetchInitialData = async () => {
    setLoading(true);
    const { data: { session } } = await supabase.auth.getSession();
    if (session) {
      setCurrentUserId(session.user.id);
      await Promise.all([
        fetchPendingRequests(session.user.id),
        fetchMyFriends(session.user.id)
      ]);
    }
    setLoading(false);
  };

  useEffect(() => {
    if (!currentUserId) return;
    
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      const handleSync = (e: any) => {
        setOnlineUsers(new Set(e.detail.ids));
      };

      window.addEventListener('presence-sync', handleSync);

      return () => {
        window.removeEventListener('presence-sync', handleSync);
      };
    }
  }, [currentUserId]);

  const fetchMyFriends = async (userId: string) => {
    const { data, error } = await supabase
      .from('friends')
      .select(`
        id,
        user_id,
        friend_id,
        profile_as_friend:profiles!friends_friend_id_fkey(id, username, avatar_url, last_seen),
        profile_as_user:profiles!friends_user_id_fkey(id, username, avatar_url, last_seen)
      `)
      .eq('status', 'accepted')
      .or(`user_id.eq.${userId},friend_id.eq.${userId}`);
    
    if (data) {
      const friendsList = data.map(f => {
        const profile = f.user_id === userId ? f.profile_as_friend : f.profile_as_user;
        return { ...profile, friendship_id: f.id };
      });
      setAcceptedFriends(friendsList);
      setMyFriendIds(friendsList.map(f => (f as any).id));
    }
  };

  const fetchPendingRequests = async (userId: string) => {
    const { data, error } = await supabase
      .from('friends')
      .select(`
        id,
        user_id,
        profiles!friends_user_id_fkey(id, username, avatar_url)
      `)
      .eq('friend_id', userId)
      .eq('status', 'pending');

    if (!error) {
      setPendingRequests(data || []);
    }
  };

  const searchUsers = async (text: string) => {
    setSearchQuery(text);
    if (text.length < 2) {
      setUsers([]);
      return;
    }

    setLoading(true);
    const { data: { session } } = await supabase.auth.getSession();
    const currentUserId = session?.user.id;

    if (!currentUserId) {
      setLoading(false);
      return;
    }

    const { data, error } = await supabase
      .from('profiles')
      .select('id, username, avatar_url')
      .ilike('username', `%${text}%`)
      .neq('id', currentUserId)
      .limit(10);

    if (error) {
      console.error(error);
    } else {
      setUsers(data || []);
    }
    setLoading(false);
  };

  const addFriend = async (friendId: string, username: string) => {
    const { data: { session } } = await supabase.auth.getSession();
    const currentUserId = session?.user.id;
    if (!currentUserId) return;

    setRequestingId(friendId);
    try {
      // Use a simpler query if .or with .and is failing in this environment
      const { data: list, error: checkError } = await supabase
        .from('friends')
        .select('id, status, user_id, friend_id')
        .or(`user_id.eq.${currentUserId},friend_id.eq.${currentUserId}`);

      const existing = list?.find(f => f.user_id === friendId || f.friend_id === friendId);
        
      if (existing) {
        if (existing.status === 'accepted') {
          showFeedback('أنت وهذا الشخص أصدقاء بالفعل', 'success');
        } else if (existing.status === 'pending') {
          if (existing.user_id === currentUserId) {
            showFeedback('لقد أرسلت طلباً بالفعل لـ ' + username, 'error');
          } else {
            showFeedback('هذا الشخص أرسل لك طلباً بالفعل', 'success');
          }
        }
        setRequestingId(null);
        return;
      }

      const { error: insertError } = await supabase
        .from('friends')
        .insert({ user_id: currentUserId, friend_id: friendId, status: 'pending' });

      if (insertError) {
        showFeedback('فشل الإرسال: ' + insertError.message, 'error');
      } else {
        showFeedback('تم إرسال طلب الصداقة بنجاح إلى ' + username, 'success');
        fetchInitialData();
      }
    } catch (e) {
      showFeedback('حدث خطأ غير متوقع في النظام', 'error');
    } finally {
      setRequestingId(null);
    }
  };

  const isOnline = (lastSeen: string) => {
    if (!lastSeen) return false;
    const diff = (new Date().getTime() - new Date(lastSeen).getTime()) / 1000 / 60;
    return diff < 4;
  };

  const startChat = async (friendId: string, username: string) => {
    // In this app, the chat screen uses the friend's profile ID as the 'id' parameter.
    // There is no separate 'chats' table; it simply queries messages between users.
    router.push({
      pathname: `/chat/${friendId}` as any,
      params: { username: username }
    });
  };

  const handleRequest = async (requestId: string, action: 'accepted' | 'decline') => {
    setLoading(true);
    if (action === 'accepted') {
      const { error } = await supabase
        .from('friends')
        .update({ status: 'accepted' })
        .eq('id', requestId);
      
      if (!error) {
        showFeedback('تم قبول الطلب، أنتم أصدقاء الآن ✨');
        await fetchInitialData();
      } else {
        showFeedback('فشل قبول الطلب', 'error');
      }
    } else {
      const { error } = await supabase
        .from('friends')
        .delete()
        .eq('id', requestId);
      
      if (!error) {
        setPendingRequests(prev => prev.filter(r => r.id !== requestId));
        showFeedback('تم تجاهل الطلب بنجاح');
      }
    }
    setLoading(false);
  };

  const [mutualCounts, setMutualCounts] = useState<Record<string, number>>({});

  useEffect(() => {
    if (pendingRequests.length > 0 || users.length > 0) {
      const targets = [...pendingRequests.map(r => r.user_id), ...users.map(u => u.id)];
      targets.forEach(tid => {
        if (tid && !mutualCounts[tid]) {
          calculateMutual(tid);
        }
      });
    }
  }, [pendingRequests, users]);

  const calculateMutual = async (theirId: string) => {
    const { data: theirFriends } = await supabase
      .from('friends')
      .select('user_id, friend_id')
      .eq('status', 'accepted')
      .or(`user_id.eq.${theirId},friend_id.eq.${theirId}`);

    if (theirFriends) {
      const tIds = theirFriends.map(f => f.user_id === theirId ? f.friend_id : f.user_id);
      const intersection = tIds.filter(id => myFriendIds.includes(id));
      setMutualCounts(prev => ({ ...prev, [theirId]: intersection.length }));
    }
  };

  // Combine data for the list
  const getListData = () => {
    if (searchQuery.length > 0) return users;
    
    const combined: any[] = [];
    if (pendingRequests.length > 0) {
      combined.push({ type: 'header', title: 'طلبات صداقة' });
      combined.push(...pendingRequests.map(r => ({ ...r, itemType: 'request' })));
    }
    if (acceptedFriends.length > 0) {
      combined.push({ type: 'header', title: 'أصدقائي' });
      combined.push(...acceptedFriends.map(f => ({ ...f, itemType: 'friend' })));
    }
    return combined;
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
         <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
            <Ionicons name="chevron-forward" size={28} color={Colors.primary} />
         </TouchableOpacity>
         <Text style={styles.headerTitle}>بحث عن أصدقاء</Text>
         <View style={{ width: 44 }} />
      </View>

      <View style={styles.searchSection}>
        <View style={styles.searchPill}>
          <TextInput
            style={styles.searchInput}
            placeholder="ابحث بالاسم هنا..."
            placeholderTextColor={Colors.onSurfaceVariant}
            value={searchQuery}
            onChangeText={searchUsers}
            autoFocus={false}
            textAlign="right"
          />
          <Ionicons name="search" size={22} color={Colors.primary} style={styles.searchIcon} />
        </View>
      </View>

      {feedback && (
        <View style={[styles.feedbackBanner, feedback.type === 'error' ? styles.errorBanner : styles.successBanner]}>
          <Text style={styles.feedbackText}>{feedback.msg}</Text>
        </View>
      )}

      {loading ? (
        <ActivityIndicator size="large" color={Colors.primary} style={{ marginTop: 40 }} />
      ) : (
        <FlatList
          data={getListData()}
          keyExtractor={(item) => item.type === 'header' ? `header-${item.title}` : item.id}
          contentContainerStyle={styles.listContainer}
          renderItem={({ item, index }) => {
            if (item.type === 'header') {
              return <Text style={styles.sectionTitle}>{item.title}</Text>;
            }

            const isRequest = item.itemType === 'request';
            const isFriend = item.itemType === 'friend';
            const profile = isRequest ? item.profiles : item;
            
            return (
              <TouchableOpacity 
                style={[styles.userItem, index % 2 === 0 ? styles.itemEven : styles.itemOdd]}
                onPress={() => isFriend ? startChat(item.id, profile.username) : null}
                activeOpacity={isFriend ? 0.7 : 1}
              >
                <View style={[styles.avatar, { backgroundColor: getAvatarColor(index) }]}>
                  {profile.avatar_url ? (
                    <Image source={{ uri: profile.avatar_url }} style={styles.fullImg} />
                  ) : (
                    <Text style={styles.avatarText}>{profile.username[0].toUpperCase()}</Text>
                  )}
                  {isFriend && (
                    <View style={[styles.statusDot, { backgroundColor: onlineUsers.has(profile.id) ? '#00f2ff' : '#ff4b4b' }]} />
                  )}
                </View>
                <View style={styles.userInfo}>
                  <Text style={styles.usernameText}>{profile.username}</Text>
                  <Text style={styles.userSubtitle}>
                    {isFriend ? (onlineUsers.has(profile.id) ? 'متصل الآن' : formatLastSeenArabic(profile.last_seen)) : `${mutualCounts[profile.id] || 0} أصدقاء مشتركين`}
                  </Text>
                </View>
                
                {isRequest ? (
                  <View style={styles.requestActions}>
                    <TouchableOpacity 
                      style={styles.acceptBtn} 
                      onPress={() => handleRequest(item.id, 'accepted')}
                    >
                      <Ionicons name="checkmark" size={20} color={Colors.white} />
                    </TouchableOpacity>
                    <TouchableOpacity 
                      style={styles.ignoreBtn} 
                      onPress={() => handleRequest(item.id, 'decline')}
                    >
                      <Ionicons name="close" size={20} color={Colors.onSurfaceVariant} />
                    </TouchableOpacity>
                  </View>
                ) : isFriend ? (
                  <TouchableOpacity 
                    style={styles.chatActionBtn}
                    onPress={() => startChat(item.id, profile.username)}
                  >
                    <Ionicons name="chatbubble-ellipses" size={22} color={Colors.primary} />
                  </TouchableOpacity>
                ) : (
                  <TouchableOpacity 
                    style={styles.addCircle}
                    onPress={() => addFriend(item.id, item.username)}
                    disabled={requestingId === item.id}
                  >
                    {requestingId === item.id ? (
                      <ActivityIndicator size="small" color={Colors.primary} />
                    ) : (
                      <Ionicons name="person-add" size={20} color={Colors.primary} />
                    )}
                  </TouchableOpacity>
                )}
              </TouchableOpacity>
            );
          }}
          ListEmptyComponent={() => (
            <View style={styles.emptyContainer}>
              <View style={styles.emptyIconBox}>
                <Ionicons name={searchQuery ? "search-outline" : "people-outline"} size={60} color={Colors.surface} />
              </View>
              <Text style={styles.emptyText}>
                {searchQuery.length > 0 && searchQuery.length < 2 
                  ? 'اكتب حرفين أو أكثر للبحث' 
                  : searchQuery.length >= 2 
                    ? 'لم نعثر على أحد بهذا الاسم' 
                    : 'لا يوجد طلبات صداقة حالياً'}
              </Text>
            </View>
          )}
        />
      )}
    </View>
  );
}

const getAvatarColor = (index: number) => {
  const colors = ['#6a1cf6', '#ac8eff', '#4af8e3', '#b41340', '#38274c'];
  return colors[index % colors.length];
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: { flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: Spacing.lg, paddingTop: Platform.OS === 'ios' ? 60 : 40, paddingBottom: 10 },
  backBtn: { width: 44, height: 44, borderRadius: Radius.md, backgroundColor: Colors.white, justifyContent: 'center', alignItems: 'center' },
  headerTitle: { fontSize: 20, fontWeight: '800', color: Colors.onSurface },
  searchSection: { padding: Spacing.lg },
  searchPill: { flexDirection: 'row-reverse', alignItems: 'center', backgroundColor: Colors.white, borderRadius: Radius.full, height: 60, paddingHorizontal: 20, shadowColor: '#000', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.05, shadowRadius: 15, elevation: 4 },
  searchInput: { flex: 1, fontSize: 17, fontWeight: '600', color: Colors.onSurface, ...(Platform.OS === 'web' && { outlineStyle: 'none' } as any) },
  searchIcon: { marginLeft: 12 },
  listContainer: { paddingHorizontal: Spacing.lg },
  userItem: { flexDirection: 'row-reverse', alignItems: 'center', padding: 16, borderRadius: Radius.lg, marginBottom: 8 },
  itemEven: { backgroundColor: Colors.white },
  itemOdd: { backgroundColor: Colors.surfaceContainerLow },
  avatar: { width: 50, height: 50, borderRadius: Radius.md, overflow: 'hidden', justifyContent: 'center', alignItems: 'center', marginLeft: 16, position: 'relative' },
  fullImg: { width: '100%', height: '100%' },
  statusDot: { position: 'absolute', bottom: -1, left: -1, width: 14, height: 14, borderRadius: 7, borderWidth: 2, borderColor: Colors.white },
  avatarText: { color: Colors.white, fontSize: 22, fontWeight: 'bold' },
  userInfo: { flex: 1, alignItems: 'flex-end' },
  usernameText: { fontSize: 17, fontWeight: '800', color: Colors.onSurface },
  userSubtitle: { fontSize: 12, color: Colors.onSurfaceVariant, marginTop: 2 },
  addCircle: { width: 44, height: 44, borderRadius: 22, backgroundColor: Colors.surface, justifyContent: 'center', alignItems: 'center' },
  chatActionBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: Colors.surfaceContainerLow, justifyContent: 'center', alignItems: 'center' },
  sectionTitle: { fontSize: 18, fontWeight: '900', color: Colors.onSurface, textAlign: 'right', marginBottom: 16, marginTop: 12 },
  requestActions: { flexDirection: 'row-reverse', gap: 10 },
  acceptBtn: { width: 40, height: 40, borderRadius: 12, backgroundColor: Colors.primary, justifyContent: 'center', alignItems: 'center' },
  ignoreBtn: { width: 40, height: 40, borderRadius: 12, backgroundColor: Colors.surface, justifyContent: 'center', alignItems: 'center' },
  emptyContainer: { alignItems: 'center', marginTop: 80, paddingHorizontal: 40 },
  emptyIconBox: { width: 120, height: 120, borderRadius: 60, backgroundColor: Colors.white, justifyContent: 'center', alignItems: 'center', marginBottom: 20 },
  emptyText: { textAlign: 'center', color: Colors.onSurfaceVariant, fontSize: 16, lineHeight: 24, fontWeight: '600' },
  feedbackBanner: { position: 'absolute', top: Platform.OS === 'ios' ? 120 : 100, left: 20, right: 20, padding: 16, borderRadius: Radius.md, zIndex: 999, ...Shadow.premium },
  successBanner: { backgroundColor: '#4caf50' },
  errorBanner: { backgroundColor: '#f44336' },
  feedbackText: { color: Colors.white, fontWeight: '700', textAlign: 'center', fontSize: 14 }
});
