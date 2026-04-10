import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator, Alert, Image, ScrollView, Platform } from 'react-native';
import { supabase } from '../lib/supabase';
import { useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

type TabType = 'chats' | 'friends' | 'profile';

export default function ProfileScreen() {
  const [username, setUsername] = useState('');
  const [originalUsername, setOriginalUsername] = useState('');
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [friends, setFriends] = useState<any[]>([]);
  const router = useRouter();

  const fetchProfileData = async () => {
    setLoading(true);
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;
    setUserId(session.user.id);

    const { data: profile } = await supabase
      .from('profiles')
      .select('username, avatar_url')
      .eq('id', session.user.id)
      .single();

    if (profile) {
      setUsername(profile.username || '');
      setOriginalUsername(profile.username || '');
      setAvatarUrl(profile.avatar_url || null);
    }

    const { data: friendsData } = await supabase
      .from('friends')
      .select(`
        user_id, friend_id,
        user:profiles!friends_user_id_fkey(id, username, last_seen, avatar_url),
        friend:profiles!friends_friend_id_fkey(id, username, last_seen, avatar_url)
      `)
      .or(`user_id.eq.${session.user.id},friend_id.eq.${session.user.id}`);
    
    let fList = friendsData?.map((f: any) => {
      return f.user_id === session.user.id ? f.friend : f.user;
    }) || [];

    fList = Array.from(new Map(fList.map(item => [item.id, item])).values());
    setFriends(fList);

    setLoading(false);
  };

  useFocusEffect(
    useCallback(() => {
      fetchProfileData();
    }, [])
  );

  const saveProfile = async () => {
    if (!username.trim()) {
      Alert.alert('تنبيه', 'اسم المستخدم لا يمكن أن يكون فارغاً');
      return;
    }
    if (!userId) return;

    setSaving(true);
    const { error } = await supabase
      .from('profiles')
      .update({ username: username.trim() })
      .eq('id', userId);

    setSaving(false);

    if (error) {
      if (error.code === '23505') {
        Alert.alert('خطأ', 'اسم المستخدم هذا مستخدم بالفعل، اختر اسماً آخر');
      } else {
        Alert.alert('خطأ', 'حدث خطأ أثناء حفظ التغييرات');
        console.error(error);
      }
    } else {
      setOriginalUsername(username.trim());
    }
  };

  const pickAndUploadImage = async () => {
    if (!userId) return;

    if (Platform.OS === 'web') {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.onchange = async (e: any) => {
        const file = e.target.files[0];
        if (!file) return;

        setUploading(true);
        const fileExt = file.name.split('.').pop();
        const fileName = `${userId}_${Date.now()}.${fileExt}`;
        const filePath = `${fileName}`;

        const { error: uploadError } = await supabase.storage
          .from('avatars')
          .upload(filePath, file, { upsert: true });

        if (uploadError) {
          Alert.alert('خطأ', 'فشل رفع الصورة');
          console.error(uploadError);
          setUploading(false);
          return;
        }

        const { data: urlData } = supabase.storage
          .from('avatars')
          .getPublicUrl(filePath);

        const publicUrl = urlData.publicUrl;

        const { error: updateError } = await supabase
          .from('profiles')
          .update({ avatar_url: publicUrl })
          .eq('id', userId);

        if (updateError) {
          Alert.alert('خطأ', 'فشل تحديث الصورة الشخصية');
          console.error(updateError);
        } else {
          setAvatarUrl(publicUrl);
        }
        setUploading(false);
      };
      input.click();
    } else {
      Alert.alert('تنبيه', 'اختيار الصور متاح على الويب حالياً');
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

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  const hasChanges = username.trim() !== originalUsername;

  const renderTopAppBar = () => (
    <View style={styles.topAppBar}>
      <View style={styles.headerTitleRow}>
        <View style={styles.headerAvatarContainer}>
          {avatarUrl ? (
            <Image source={{ uri: avatarUrl }} style={styles.headerAvatar} />
          ) : (
            <View style={styles.headerAvatarPlaceholder}>
              <Text style={styles.headerAvatarText}>{originalUsername?.[0]?.toUpperCase() || 'U'}</Text>
            </View>
          )}
        </View>
        <Text style={styles.headerTitle}>حسابي</Text>
      </View>
      <TouchableOpacity 
        style={styles.searchIconBtn} 
        onPress={hasChanges ? saveProfile : () => {}}
      >
        {saving ? (
          <ActivityIndicator size="small" color="#004be2" />
        ) : hasChanges ? (
          <Ionicons name="checkmark-done" size={28} color="#004be2" />
        ) : (
          <Ionicons name="search" size={28} color="#004be2" />
        )}
      </TouchableOpacity>
    </View>
  );

  if (loading) {
    return (
      <View style={[styles.container, { justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator size="large" color="#004be2" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {renderTopAppBar()}

      <ScrollView contentContainerStyle={styles.mainContent} showsVerticalScrollIndicator={false}>
        
        {/* Profile Large Avatar & Input */}
        <View style={styles.profileSection}>
          <View style={styles.avatarWrapper}>
            <View style={styles.largeAvatarContainer}>
              {avatarUrl ? (
                <Image source={{ uri: avatarUrl }} style={styles.largeAvatarImage} />
              ) : (
                <View style={styles.largeAvatarPlaceholder}>
                  <Text style={styles.largeAvatarText}>{originalUsername?.[0]?.toUpperCase() || 'U'}</Text>
                </View>
              )}
            </View>
            <TouchableOpacity style={styles.editFab} onPress={pickAndUploadImage} disabled={uploading}>
              {uploading ? (
                <ActivityIndicator size="small" color="#FFF" />
              ) : (
                <Ionicons name="pencil" size={20} color="#FFF" />
              )}
            </TouchableOpacity>
          </View>

          <View style={styles.inputWrapper}>
            <Text style={styles.inputLabel}>اسم العرض</Text>
            <View style={styles.inputBox}>
              <TextInput
                style={styles.input}
                value={username}
                onChangeText={setUsername}
                placeholder="أدخل اسمك"
                placeholderTextColor="#9ca3af"
                autoCapitalize="none"
                onBlur={() => { if(hasChanges) saveProfile() }}
              />
            </View>
          </View>
        </View>

        {/* Stats Bento Section */}
        <View style={styles.bentoGrid}>
          <View style={styles.bentoCardWhite}>
            <Text style={styles.bentoLabelWhite}>الأصدقاء</Text>
            <Text style={styles.bentoNumberBlue}>{friends.length}</Text>
          </View>
          
          <View style={styles.bentoCardCyan}>
            <View>
              <Text style={styles.bentoLabelCyan}>الحالة</Text>
              <Text style={styles.bentoTextCyan}>متصل الآن</Text>
            </View>
            <Ionicons name="flash" size={80} color="rgba(0,0,0,0.06)" style={styles.bentoIcon} />
          </View>
        </View>

        {/* Friends List Section */}
        <View style={styles.friendsSection}>
          <View style={styles.friendsHeaderRow}>
            <Text style={styles.friendsHeaderTitle}>أصدقائي</Text>
            <TouchableOpacity style={styles.addFriendBtn} onPress={() => router.push('/add-friend')}>
              <Ionicons name="person-add" size={18} color="#FFF" />
              <Text style={styles.addFriendBtnText}>إضافة صديق</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.friendsListWrapper}>
            {friends.map((friend, index) => {
              const isOnline = getStatusText(friend.last_seen).includes('متصل');
              return (
                <TouchableOpacity key={friend.id} style={styles.friendRow} onPress={() => router.push({ pathname: '/chat/[id]', params: { id: friend.id, username: friend.username } })}>
                  <View style={styles.friendRowLeft}>
                    <View style={styles.friendAvatarWrapper}>
                      {friend.avatar_url ? (
                        <Image source={{ uri: friend.avatar_url }} style={styles.friendAvatarImage} />
                      ) : (
                        <View style={[styles.friendAvatarPlaceholder, { backgroundColor: getAvatarColor(index) }]}>
                          <Text style={{ color: '#ffffff', fontSize: 24, fontWeight: 'bold' }}>{friend.username[0].toUpperCase()}</Text>
                        </View>
                      )}
                      {isOnline && <View style={styles.friendOnlineDot} />}
                    </View>
                    <View style={styles.friendInfo}>
                      <Text style={styles.friendTitle}>{friend.username}</Text>
                      <Text style={styles.friendSubtitle}>{isOnline ? 'متصل الآن' : 'غير متصل'}</Text>
                    </View>
                  </View>
                  <Ionicons name="ellipsis-vertical" size={24} color="#575881" style={{ opacity: 0.5 }} />
                </TouchableOpacity>
              )
            })}
            {friends.length === 0 && (
              <Text style={styles.emptyFriendsText}>لا يوجد أصدقاء بعد.</Text>
            )}
          </View>
        </View>

        {/* Log Out Button */}
        <TouchableOpacity style={styles.logoutButton} onPress={signOut}>
          <Ionicons name="log-out-outline" size={20} color="#b41340" />
          <Text style={styles.logoutButtonText}>تسجيل الخروج</Text>
        </TouchableOpacity>

      </ScrollView>

      {/* Bottom Navigation */}
      <View style={styles.bottomNavContainer}>
        <View style={styles.bottomNav}>
          <TouchableOpacity 
            style={styles.navItem} 
            onPress={() => router.replace('/')}
          >
            <Ionicons name="chatbubble-outline" size={26} color="#575881" />
          </TouchableOpacity>
          <TouchableOpacity 
            style={styles.navItem} 
            onPress={() => router.replace('/')}
          >
            <Ionicons name="people-outline" size={28} color="#575881" />
          </TouchableOpacity>
          <TouchableOpacity style={[styles.navItem, styles.navItemActive]}>
            <Ionicons name="person" size={26} color="#ffffff" />
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
    width: 40,
    height: 40,
    borderRadius: 16, // squircle 
    overflow: 'hidden',
    backgroundColor: '#809bff', // primary-container
    justifyContent: 'center',
    alignItems: 'center',
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
    color: '#001b61', // on-primary-container
    fontSize: 18,
    fontWeight: 'bold',
  },
  headerTitle: {
    fontFamily: Platform.OS === 'ios' ? 'System' : 'sans-serif',
    fontSize: 36, // Huge size 2.75rem ~ 44px
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
    paddingTop: 16,
    paddingBottom: 160,
  },

  // Profile Section
  profileSection: {
    alignItems: 'center',
    marginBottom: 32,
  },
  avatarWrapper: {
    position: 'relative',
    marginBottom: 24,
  },
  largeAvatarContainer: {
    width: 160,
    height: 160,
    borderRadius: 50, // Squircle-like roundness
    overflow: 'hidden',
    borderWidth: 4,
    borderColor: '#ffffff', // surface-container-lowest
    backgroundColor: '#dbd9ff', // surface-container-highest
    shadowColor: '#2a2b51',
    shadowOffset: { width: 0, height: 20 },
    shadowOpacity: 0.15,
    shadowRadius: 30,
    elevation: 15,
  },
  largeAvatarImage: {
    width: '100%',
    height: '100%',
    resizeMode: 'cover',
  },
  largeAvatarPlaceholder: {
    width: '100%',
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
  },
  largeAvatarText: {
    fontSize: 60,
    fontWeight: '900',
    color: '#575881',
  },
  editFab: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#004be2', // primary
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 3,
    borderColor: '#f8f5ff',
    shadowColor: '#004be2',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.4,
    shadowRadius: 10,
    elevation: 8,
  },
  inputWrapper: {
    width: '100%',
  },
  inputLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#575881', // on-surface-variant
    textTransform: 'uppercase',
    letterSpacing: 1.5,
    textAlign: 'right',
    paddingHorizontal: 16,
    marginBottom: 8,
  },
  inputBox: {
    width: '100%',
    backgroundColor: '#f2efff', // surface-container-low
    borderRadius: 24,
    paddingVertical: 4,
    paddingHorizontal: 16,
  },
  input: {
    width: '100%',
    height: 56,
    fontSize: 20,
    fontWeight: '700',
    color: '#2a2b51',
    textAlign: 'right',
  },

  // Bento Stats
  bentoGrid: {
    flexDirection: 'row-reverse',
    justifyContent: 'space-between',
    gap: 16,
    marginBottom: 36,
  },
  bentoCardWhite: {
    flex: 1,
    backgroundColor: '#ffffff', // surface-container-lowest
    borderRadius: 24,
    padding: 24,
    borderWidth: 1,
    borderColor: 'rgba(114, 115, 158, 0.1)',
  },
  bentoLabelWhite: {
    fontSize: 11,
    fontWeight: '700',
    color: '#575881',
    textTransform: 'uppercase',
    letterSpacing: 1.5,
    marginBottom: 4,
    textAlign: 'right',
  },
  bentoNumberBlue: {
    fontSize: 32,
    fontWeight: '900',
    color: '#004be2',
    textAlign: 'right',
  },
  bentoCardCyan: {
    flex: 1,
    backgroundColor: '#5be2ff', // secondary-container
    borderRadius: 24,
    padding: 24,
    justifyContent: 'space-between',
    position: 'relative',
    overflow: 'hidden',
  },
  bentoLabelCyan: {
    fontSize: 11,
    fontWeight: '700',
    color: '#004f5c', // on-secondary-container
    textTransform: 'uppercase',
    letterSpacing: 1.5,
    marginBottom: 4,
    textAlign: 'right',
    zIndex: 2,
  },
  bentoTextCyan: {
    fontSize: 20,
    fontWeight: '800',
    color: '#004f5c',
    textAlign: 'right',
    zIndex: 2,
  },
  bentoIcon: {
    position: 'absolute',
    bottom: -16,
    left: -16, // Reversed alignment
    zIndex: 1,
  },

  // Friends Section
  friendsSection: {
    marginBottom: 16,
  },
  friendsHeaderRow: {
    flexDirection: 'row-reverse',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
    paddingHorizontal: 8,
  },
  friendsHeaderTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: '#2a2b51',
  },
  addFriendBtn: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    backgroundColor: '#004be2',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 100, // pill
    shadowColor: '#004be2',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 4,
    gap: 8,
  },
  addFriendBtnText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '700',
  },
  friendsListWrapper: {
    gap: 4,
  },
  friendRow: {
    flexDirection: 'row-reverse',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderRadius: 16,
    backgroundColor: 'transparent',
  },
  friendRowLeft: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 16,
  },
  friendAvatarWrapper: {
    width: 56,
    height: 56,
    borderRadius: 20,
    backgroundColor: '#dbd9ff', // surface-container-highest
    overflow: 'hidden',
    position: 'relative',
    marginLeft: 16,
  },
  friendAvatarImage: {
    width: '100%',
    height: '100%',
    resizeMode: 'cover',
  },
  friendAvatarPlaceholder: {
    width: '100%',
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
  },
  friendOnlineDot: {
    position: 'absolute',
    bottom: -2,
    right: -2,
    width: 14,
    height: 14,
    backgroundColor: '#4ade80',
    borderRadius: 7,
    borderWidth: 2,
    borderColor: '#ffffff',
  },
  friendInfo: {
    alignItems: 'flex-end',
  },
  friendTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#2a2b51',
    marginBottom: 2,
  },
  friendSubtitle: {
    fontSize: 14,
    color: '#575881',
  },
  emptyFriendsText: {
    textAlign: 'center',
    color: '#575881',
    marginTop: 20,
  },

  // Logout
  logoutButton: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
    marginTop: 32,
    gap: 8,
  },
  logoutButtonText: {
    color: '#b41340', // error source color
    fontSize: 16,
    fontWeight: '700',
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
