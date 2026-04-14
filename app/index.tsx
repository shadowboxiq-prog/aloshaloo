import React, { useEffect, useState } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, ActivityIndicator, Image as RNImage, Platform, ScrollView, Modal, Dimensions, AppState } from 'react-native';
import { supabase } from '../lib/supabase';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Spacing, Radius, Shadow, Gradients } from '../constants/theme';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import { Image } from 'expo-image';
import { formatLastSeenArabic } from '../lib/date-utils';
import * as ImagePicker from 'expo-image-picker';
import { Video, ResizeMode } from 'expo-av';

export default function HomeScreen() {
  const [chats, setChats] = useState<any[]>([]);
  const [friends, setFriends] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [pendingCount, setPendingCount] = useState(0);
  const [onlineUsers, setOnlineUsers] = useState<Set<string>>(new Set());
  const [stories, setStories] = useState<any[]>([]);
  const [viewingStory, setViewingStory] = useState<{userIndex: number, storyIndex: number} | null>(null);
  const [isUploadingStory, setIsUploadingStory] = useState(false);
  const router = useRouter();

  useEffect(() => {
    fetchInitialData();
  }, []);

  useEffect(() => {
    if (!currentUser) return;

    let isMounted = true;
    const channelId = `user-activity-${currentUser.id}`;
    
    const channel = supabase
      .channel(channelId)
      .on('postgres_changes', { 
        event: '*', 
        schema: 'public', 
        table: 'friends',
        filter: `friend_id=eq.${currentUser.id}` 
      }, () => {
        if (isMounted) fetchPendingCount(currentUser.id);
      })
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'chats'
      }, () => {
        if (isMounted) fetchChats(currentUser.id);
      })
      .subscribe((status) => {
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
           console.log('Home Subscription Status:', status);
           if (isMounted) fetchChats(currentUser.id);
        }
      });

    const appStateListener = AppState.addEventListener('change', (nextAppState) => {
      if (nextAppState === 'active' && isMounted) {
        fetchChats(currentUser.id);
        fetchFriends(currentUser.id);
        fetchPendingCount(currentUser.id);
        fetchStories();
      }
    });

    return () => {
      isMounted = false;
      supabase.removeChannel(channel);
      appStateListener.remove();
    };
  }, [currentUser]);

  const fetchInitialData = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      router.replace('/auth');
      return;
    }
    setCurrentUser(session.user);
    await Promise.all([
      fetchChats(session.user.id), 
      fetchFriends(session.user.id),
      fetchPendingCount(session.user.id),
      fetchStories()
    ]);
    setLoading(false);
  };

  const fetchPendingCount = async (userId: string) => {
    const { count, error } = await supabase
      .from('friends')
      .select('*', { count: 'exact', head: true })
      .eq('friend_id', userId)
      .eq('status', 'pending');
    
    if (!error) setPendingCount(count || 0);
  };

  const fetchChats = async (userId: string) => {
    const { data, error } = await supabase
      .from('chats')
      .select(`
        id,
        last_message,
        updated_at,
        user1_id,
        user2_id,
        user1:profiles!chats_user1_id_fkey(id, username, avatar_url, last_seen),
        user2:profiles!chats_user2_id_fkey(id, username, avatar_url, last_seen)
      `)
      .or(`user1_id.eq.${userId},user2_id.eq.${userId}`)
      .order('updated_at', { ascending: false });

    if (!error) setChats(data || []);
  };

  const fetchFriends = async (userId: string) => {
    const { data: sent, error: e1 } = await supabase
      .from('friends')
      .select('friend_id, profiles!friends_friend_id_fkey(username, avatar_url, last_seen)')
      .eq('user_id', userId)
      .eq('status', 'accepted');

    const { data: rec, error: e2 } = await supabase
      .from('friends')
      .select('user_id, profiles!friends_user_id_fkey(username, avatar_url, last_seen)')
      .eq('friend_id', userId)
      .eq('status', 'accepted');

    if (!e1 && !e2) {
      const f1 = sent?.map(f => ({ friend_id: f.friend_id, profiles: f.profiles })) || [];
      const f2 = rec?.map(f => ({ friend_id: f.user_id, profiles: f.profiles })) || [];
      setFriends([...f1, ...f2]);
    }
  };

  const fetchStories = async () => {
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data, error } = await supabase
      .from('stories')
      .select('*, profiles(username, avatar_url)')
      .gt('created_at', yesterday)
      .order('created_at', { ascending: true });

    if (!error && data) {
      // Group stories by user_id
      const grouped = data.reduce((acc: any, story: any) => {
        if (!acc[story.user_id]) {
          acc[story.user_id] = {
            user: story.profiles,
            items: []
          };
        }
        acc[story.user_id].items.push(story);
        return acc;
      }, {});
      setStories(Object.values(grouped));
    }
  };

  const handleAddStory = async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images', 'videos'],
        quality: 0.7,
      });

      if (!result.canceled) {
        const asset = result.assets[0];
        const caption = Platform.OS === 'web' 
          ? window.prompt('اكتب تعليقاً لقصتك (اختياري)...') 
          : ''; // Native prompt could be added here if needed

        setIsUploadingStory(true);
        const formData = new FormData();
        formData.append('upload_preset', 'chat_unsigned');
        
        if (Platform.OS === 'web') {
          const resp = await fetch(asset.uri);
          const blob = await resp.blob();
          formData.append('file', blob, asset.type === 'video' ? 'video.mp4' : 'image.jpg');
        } else {
          formData.append('file', { uri: asset.uri, name: 'story', type: asset.type === 'video' ? 'video/mp4' : 'image/jpeg' } as any);
        }

        const endpoint = asset.type === 'video' ? 'video' : 'image';
        const res = await fetch(`https://api.cloudinary.com/v1_1/dpdyevp6z/${endpoint}/upload`, { 
          method: 'POST', 
          body: formData 
        });
        
        const data = await res.json();
        if (data.secure_url) {
          const { error } = await supabase.from('stories').insert([{
            user_id: currentUser.id,
            media_url: data.secure_url,
            media_type: asset.type === 'video' ? 'video' : 'image',
            caption: caption || ''
          }]);
          if (!error) fetchStories();
        }
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsUploadingStory(false);
    }
  };

  const renderTopAppBar = () => (
    <BlurView intensity={80} tint="light" style={styles.header}>
      <TouchableOpacity onPress={() => router.push('/profile')} style={styles.profileBtn}>
        <View style={styles.squircleAvatarSm}>
           <Ionicons name="person" size={20} color={Colors.primary} />
        </View>
      </TouchableOpacity>
      
      <View style={styles.logoContainer}>
         <Text style={[styles.logoText, { color: Colors.primary }]}>CHAT</Text>
         <Text style={[styles.logoText, { color: Colors.secondary }]}> UP</Text>
      </View>

      <TouchableOpacity onPress={() => router.push('/add-friend')} style={styles.searchBtn}>
        <Ionicons name="search-outline" size={24} color={Colors.onSurface} />
        {pendingCount > 0 && (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{pendingCount > 9 ? '9+' : pendingCount}</Text>
          </View>
        )}
      </TouchableOpacity>
    </BlurView>
  );

  const renderStoryPulsing = ({ item, index }: { item: any, index: number }) => (
    <TouchableOpacity style={styles.storyItem} onPress={() => setViewingStory({ userIndex: index, storyIndex: 0 })}>
      <LinearGradient
        colors={Gradients.pulse}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.pulseRing}
      >
        <View style={styles.storyAvatarWrap}>
          <View style={[styles.squircleAvatar, { backgroundColor: Colors.surfaceContainerHigh }]}>
            {item.user.avatar_url ? (
              <Image source={{ uri: item.user.avatar_url }} style={styles.fullImg} />
            ) : (
              <Text style={styles.avatarInitial}>{item.user.username[0].toUpperCase()}</Text>
            )}
          </View>
        </View>
      </LinearGradient>
      <Text style={styles.storyName} numberOfLines={1}>{item.user.username}</Text>
    </TouchableOpacity>
  );

  const renderBentoDiscovery = () => (
    <View style={styles.bentoContainer}>
       <View style={styles.bentoHeader}>
          <Text style={styles.bentoTitle}>اكتشف عالمك</Text>
          <TouchableOpacity>
             <Text style={styles.bentoMore}>الكل</Text>
          </TouchableOpacity>
       </View>
       <View style={styles.bentoGrid}>
          <TouchableOpacity style={[styles.bentoBox, styles.bentoLarge]}>
             <LinearGradient colors={Gradients.primary} style={styles.bentoGradient}>
                <Ionicons name="sparkles" size={32} color={Colors.white} />
                <Text style={styles.bentoBoxText}>اعثر على أصدقاء جدد</Text>
             </LinearGradient>
          </TouchableOpacity>
          <View style={styles.bentoCol}>
             <TouchableOpacity style={[styles.bentoBox, styles.bentoSmall, { backgroundColor: Colors.secondaryContainer }]}>
                <Ionicons name="videocam" size={24} color={Colors.onSecondaryContainer} />
                <Text style={[styles.bentoBoxTextSm, { color: Colors.onSecondaryContainer }]}>مكالمة سريعة</Text>
             </TouchableOpacity>
             <TouchableOpacity style={[styles.bentoBox, styles.bentoSmall, { backgroundColor: Colors.surfaceContainerHighest }]}>
                <Ionicons name="images" size={24} color={Colors.primary} />
                <Text style={[styles.bentoBoxTextSm, { color: Colors.primary }]}>المعرض</Text>
             </TouchableOpacity>
          </View>
       </View>
    </View>
  );

  const isOnline = (lastSeen: string) => {
    if (!lastSeen) return false;
    const diff = (new Date().getTime() - new Date(lastSeen).getTime()) / 1000 / 60;
    return diff < 4; // 4 minutes threshold
  };

  const renderChatItem = ({ item, index }: { item: any, index: number }) => {
    const isUser1 = item.user1_id === currentUser?.id;
    const peer = isUser1 ? item.user2 : item.user1;

    if (!peer) return null;
    const online = onlineUsers.has(peer.id);

    return (
      <TouchableOpacity 
        style={[
          styles.chatItem, 
          index % 2 === 0 ? { backgroundColor: Colors.surfaceContainerLow } : { backgroundColor: Colors.surfaceContainerLowest }
        ]} 
        onPress={() => router.push({ pathname: `/chat/${peer.id}`, params: { username: peer.username } })}
      >
        <View style={styles.chatAvatarWrap}>
           <View style={[styles.squircleAvatarMd, { backgroundColor: Colors.primaryContainer }]}>
              {peer.avatar_url ? (
                <Image source={{ uri: peer.avatar_url }} style={styles.fullImg} />
              ) : (
                <Text style={styles.avatarInitialMd}>{peer.username?.[0]?.toUpperCase() || '?'}</Text>
              )}
           </View>
           <View style={[styles.onlineStatus, { backgroundColor: online ? '#00f2ff' : '#ff4b4b' }]} />
        </View>
        <View style={styles.chatInfo}>
          <View style={styles.chatHeaderRow}>
            <Text style={styles.peerName}>{peer.username}</Text>
            <View style={{ alignItems: 'flex-end' }}>
               <Text style={styles.chatTime}>{new Date(item.updated_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</Text>
               <Text style={[styles.chatStatus, { color: online ? '#00f2ff' : Colors.onSurfaceVariant, fontSize: 10 }]}>
                 {online ? 'متصل الآن' : formatLastSeenArabic(peer.last_seen)}
               </Text>
            </View>
          </View>
          <Text style={styles.lastMsg} numberOfLines={1}>{item.last_message || 'ابدأ المحادثة الآن...'}</Text>
        </View>
      </TouchableOpacity>
    );
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={Colors.primary} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {renderTopAppBar()}
      
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
        <View style={styles.storiesContainer}>
          <FlatList
            horizontal
            showsHorizontalScrollIndicator={false}
            data={stories}
            keyExtractor={(item, idx) => idx.toString()}
            renderItem={renderStoryPulsing}
            contentContainerStyle={styles.storiesList}
            ListHeaderComponent={() => (
              <TouchableOpacity style={styles.addStoryItem} onPress={handleAddStory} disabled={isUploadingStory}>
                <View style={[styles.addStoryIcon, isUploadingStory && { opacity: 0.5 }]}>
                  {isUploadingStory ? (
                    <ActivityIndicator color={Colors.white} />
                  ) : (
                    <Ionicons name="add" size={30} color={Colors.white} />
                  )}
                </View>
                <Text style={styles.storyName}>{isUploadingStory ? 'جاري الرفع...' : 'قصتك'}</Text>
              </TouchableOpacity>
            )}
          />
        </View>

        {renderBentoDiscovery()}

        <View style={styles.chatsSection}>
          <Text style={styles.sectionTitle}>المحادثات</Text>
          {chats.length > 0 ? (
            chats.map((item, index) => (
              <View key={item.id}>
                {renderChatItem({ item, index })}
              </View>
            ))
          ) : (
            <View style={styles.emptyContainer}>
               <Ionicons name="chatbubbles-outline" size={80} color={Colors.surfaceContainer} />
               <Text style={styles.emptyText}>لا توجد محادثات بعد. ابحث عن أصدقاء للبدء!</Text>
            </View>
          )}
        </View>
      </ScrollView>

      {/* Floating Bottom Nav */}
      <BlurView intensity={100} tint="light" style={styles.bottomNav}>
         <TouchableOpacity style={styles.navItemActive}>
            <Ionicons name="chatbubble-ellipses" size={26} color={Colors.white} />
         </TouchableOpacity>
         <TouchableOpacity style={styles.navItem} onPress={() => router.push('/add-friend')}>
            <Ionicons name="people-outline" size={26} color={Colors.onSurfaceVariant} />
         </TouchableOpacity>
         <TouchableOpacity style={styles.navItem} onPress={() => router.push('/profile')}>
            <Ionicons name="settings-outline" size={26} color={Colors.onSurfaceVariant} />
         </TouchableOpacity>
      </BlurView>

      {/* Story Viewer Modal */}
      <Modal visible={viewingStory !== null} transparent animationType="fade">
        <StoryViewer 
          stories={stories} 
          viewingState={viewingStory} 
          currentUser={currentUser}
          onClose={() => setViewingStory(null)} 
          onUpdateState={setViewingStory}
          onDelete={async (storyId: string) => {
             const { error } = await supabase.from('stories').delete().eq('id', storyId);
             if (!error) {
                fetchStories();
                setViewingStory(null);
             }
          }}
        />
      </Modal>
    </View>
  );
}

// Internal component for the Story Viewer effect
function StoryViewer({ stories, viewingState, onClose, onUpdateState, currentUser, onDelete }: any) {
  const [progress, setProgress] = useState(0);
  const { userIndex, storyIndex } = viewingState || { userIndex: 0, storyIndex: 0 };
  const userStories = stories[userIndex]?.items || [];
  const currentStory = userStories[storyIndex];

  useEffect(() => {
    if (!viewingState) return;
    
    setProgress(0);
    const duration = 5000; // 5 seconds
    const interval = 50;
    const step = 100 / (duration / interval);

    const timer = setInterval(() => {
      setProgress(p => {
        if (p >= 100) {
          clearInterval(timer);
          handleNext();
          return 100;
        }
        return p + step;
      });
    }, interval);

    return () => clearInterval(timer);
  }, [viewingState]);

  const handleNext = () => {
    if (storyIndex < userStories.length - 1) {
      onUpdateState({ userIndex, storyIndex: storyIndex + 1 });
    } else if (userIndex < stories.length - 1) {
      onUpdateState({ userIndex: userIndex + 1, storyIndex: 0 });
    } else {
      onClose();
    }
  };

  const handlePrev = () => {
    if (storyIndex > 0) {
      onUpdateState({ userIndex, storyIndex: storyIndex - 1 });
    } else if (userIndex > 0) {
      onUpdateState({ userIndex: userIndex - 1, storyIndex: stories[userIndex-1].items.length - 1 });
    }
  };

  if (!currentStory) return null;

  return (
    <View style={styles.viewerFull}>
      <BlurView intensity={100} tint="dark" style={StyleSheet.absoluteFill} />
      
      {/* Interaction Layers */}
      <View style={styles.gestureContainer}>
        <TouchableOpacity style={styles.gestureSide} onPress={handlePrev} />
        <TouchableOpacity style={styles.gestureSide} onPress={handleNext} />
      </View>

      <View style={styles.viewerHeader}>
        <View style={styles.progressRow}>
          {userStories.map((_: any, idx: number) => (
            <View key={idx} style={styles.progressBarBg}>
              <View 
                style={[
                  styles.progressBarFill, 
                  { width: idx < storyIndex ? '100%' : idx === storyIndex ? `${progress}%` : '0%' }
                ]} 
              />
            </View>
          ))}
        </View>
        <View style={styles.viewerUserRow}>
          <Image source={{ uri: stories[userIndex].user.avatar_url }} style={styles.viewerAvatar} />
          <View>
            <Text style={styles.viewerUserName}>{stories[userIndex].user.username}</Text>
            <Text style={styles.viewerTime}>منذ قليل</Text>
          </View>
          
          <View style={{ flex: 1, flexDirection: 'row', justifyContent: 'flex-end', gap: 15 }}>
            {currentStory.user_id === currentUser?.id && (
              <TouchableOpacity onPress={() => onDelete(currentStory.id)} style={styles.viewerDeleteBtn}>
                <Ionicons name="trash-outline" size={24} color="#ff4b4b" />
              </TouchableOpacity>
            )}
            <TouchableOpacity onPress={onClose} style={styles.viewerCloseBtn}>
              <Ionicons name="close" size={28} color="white" />
            </TouchableOpacity>
          </View>
        </View>
      </View>

      <View style={styles.viewerContent}>
        {currentStory.media_type === 'video' ? (
          <Video
            source={{ uri: currentStory.media_url }}
            style={styles.viewerMedia}
            resizeMode={ResizeMode.CONTAIN}
            shouldPlay
            isLooping={false}
            onPlaybackStatusUpdate={(status: any) => {
              if (status.didJustFinish) handleNext();
            }}
          />
        ) : (
          <Image source={{ uri: currentStory.media_url }} style={styles.viewerMedia} contentFit="contain" />
        )}
      </View>

      {currentStory.caption ? (
        <BlurView intensity={20} tint="dark" style={styles.captionArea}>
           <Text style={styles.captionText}>{currentStory.caption}</Text>
        </BlurView>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: Colors.background },
  header: { 
    flexDirection: 'row-reverse', 
    alignItems: 'center', 
    justifyContent: 'space-between', 
    paddingHorizontal: Spacing.lg, 
    paddingTop: Platform.OS === 'ios' ? 50 : 40, 
    paddingBottom: 15,
    zIndex: 100,
    position: 'absolute',
    top: 0, left: 0, right: 0
  },
  logoContainer: { flexDirection: 'row', alignItems: 'center' },
  logoText: { fontSize: 24, fontWeight: '900', letterSpacing: -1 },
  profileBtn: { width: 44, height: 44, borderRadius: Radius.md, justifyContent: 'center', alignItems: 'center' },
  searchBtn: { width: 44, height: 44, borderRadius: Radius.md, justifyContent: 'center', alignItems: 'center' },
  
  scrollContent: { paddingTop: 120, paddingBottom: 100 },
  
  storiesContainer: { paddingVertical: Spacing.md },
  storiesList: { paddingHorizontal: Spacing.lg },
  storyItem: { alignItems: 'center', marginLeft: 16 },
  addStoryItem: { alignItems: 'center', marginLeft: 16 },
  addStoryIcon: { width: 70, height: 70, borderRadius: Radius.lg, backgroundColor: Colors.primary, justifyContent: 'center', alignItems: 'center', marginBottom: 8 },
  pulseRing: { width: 76, height: 76, borderRadius: Radius.lg + 4, padding: 3, marginBottom: 8 },
  storyAvatarWrap: { flex: 1, backgroundColor: Colors.background, borderRadius: Radius.lg + 1, padding: 2, overflow: 'hidden' },
  squircleAvatar: { flex: 1, borderRadius: Radius.lg, justifyContent: 'center', alignItems: 'center', overflow: 'hidden' },
  fullImg: { width: '100%', height: '100%' },
  squircleAvatarSm: { width: 36, height: 36, borderRadius: 10, backgroundColor: Colors.white, justifyContent: 'center', alignItems: 'center' },
  avatarInitial: { fontSize: 24, fontWeight: 'bold', color: Colors.primary },
  storyName: { fontSize: 12, color: Colors.onSurface, fontWeight: '600' },

  bentoContainer: { paddingHorizontal: Spacing.lg, marginBottom: Spacing.xl },
  bentoHeader: { flexDirection: 'row-reverse', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  bentoTitle: { fontSize: 18, fontWeight: '800', color: Colors.onSurface },
  bentoMore: { fontSize: 14, color: Colors.primary, fontWeight: '700' },
  bentoGrid: { flexDirection: 'row-reverse', gap: 12 },
  bentoLarge: { flex: 1.5, height: 160 },
  bentoCol: { flex: 1, gap: 12 },
  bentoSmall: { flex: 1, height: 74 },
  bentoBox: { borderRadius: Radius.lg, overflow: 'hidden', ...Shadow.ambient },
  bentoGradient: { flex: 1, padding: 16, justifyContent: 'flex-end' },
  bentoBoxText: { color: Colors.white, fontSize: 16, fontWeight: '800', marginTop: 8 },
  bentoBoxTextSm: { fontSize: 13, fontWeight: '700', padding: 10, textAlign: 'right' },

  chatsSection: { paddingHorizontal: Spacing.lg },
  sectionTitle: { fontSize: 20, fontWeight: '800', color: Colors.onSurface, marginBottom: 16, textAlign: 'right' },
  chatItem: { flexDirection: 'row-reverse', padding: 16, borderRadius: Radius.lg, marginBottom: 8, alignItems: 'center' },
  chatAvatarWrap: { position: 'relative', marginLeft: 16 },
  squircleAvatarMd: { width: 56, height: 56, borderRadius: Radius.md, justifyContent: 'center', alignItems: 'center', overflow: 'hidden' },
  avatarInitialMd: { fontSize: 22, fontWeight: 'bold', color: Colors.white },
  onlineStatus: { position: 'absolute', bottom: 0, left: 0, width: 16, height: 16, borderRadius: 8, borderWidth: 3, borderColor: Colors.white },
  chatInfo: { flex: 1 },
  chatHeaderRow: { flexDirection: 'row-reverse', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  peerName: { fontSize: 17, fontWeight: '700', color: Colors.onSurface },
  chatTime: { fontSize: 12, color: Colors.onSurfaceVariant },
  lastMsg: { fontSize: 14, color: Colors.onSurfaceVariant, textAlign: 'right' },

  emptyContainer: { alignItems: 'center', paddingVertical: 60 },
  emptyText: { color: Colors.onSurfaceVariant, marginTop: 16, textAlign: 'center' },

  bottomNav: { 
    position: 'absolute', 
    bottom: 30, left: 30, right: 30, 
    height: 70, 
    borderRadius: Radius.full, 
    flexDirection: 'row-reverse', 
    alignItems: 'center', 
    justifyContent: 'space-around', 
    paddingHorizontal: 10,
    ...Shadow.ambient,
    overflow: 'hidden'
  },
  navItem: { width: 50, height: 50, justifyContent: 'center', alignItems: 'center' },
  navItemActive: { width: 54, height: 54, borderRadius: 27, backgroundColor: Colors.primary, justifyContent: 'center', alignItems: 'center', ...Shadow.premium },
  badge: {
    position: 'absolute',
    top: -4,
    right: -4,
    backgroundColor: '#9c27b0', // Electric Purple
    width: 18,
    height: 18,
    borderRadius: 9,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: Colors.surface,
    zIndex: 10
  },
  badgeText: {
    color: Colors.white,
    fontSize: 10,
    fontWeight: '800',
  },

  // Viewer Styles
  viewerFull: { flex: 1, backgroundColor: 'black' },
  viewerHeader: { position: 'absolute', top: 50, left: 0, right: 0, zIndex: 100, paddingHorizontal: 16 },
  progressRow: { flexDirection: 'row', gap: 4, marginBottom: 12 },
  progressBarBg: { flex: 1, height: 2, backgroundColor: 'rgba(255,255,255,0.3)', borderRadius: 1 },
  progressBarFill: { height: 2, backgroundColor: 'white', borderRadius: 1 },
  viewerUserRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  viewerAvatar: { width: 40, height: 40, borderRadius: 20 },
  viewerUserName: { color: 'white', fontWeight: '800', fontSize: 16 },
  viewerTime: { color: 'rgba(255,255,255,0.7)', fontSize: 12 },
  viewerDeleteBtn: { padding: 4 },
  viewerCloseBtn: { padding: 4 },
  viewerContent: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  viewerMedia: { width: '100%', height: '100%' },
  gestureContainer: { ...StyleSheet.absoluteFillObject, flexDirection: 'row', zIndex: 50 },
  gestureSide: { flex: 1 },
  captionArea: { position: 'absolute', bottom: 60, left: 20, right: 20, padding: 16, borderRadius: Radius.lg, alignItems: 'center' },
  captionText: { color: 'white', fontSize: 16, fontWeight: '600', textAlign: 'center' }
});
