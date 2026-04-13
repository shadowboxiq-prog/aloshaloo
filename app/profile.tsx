import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator, Alert, Image, ScrollView, Platform, Dimensions } from 'react-native';
import { supabase } from '../lib/supabase';
import { useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Radius, Spacing, Shadow, Gradients } from '../constants/theme';
import { LinearGradient } from 'expo-linear-gradient';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

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

    const { data: profile } = await supabase.from('profiles').select('username, avatar_url').eq('id', session.user.id).single();
    if (profile) {
      setUsername(profile.username || '');
      setOriginalUsername(profile.username || '');
      setAvatarUrl(profile.avatar_url || null);
    }

    const { data: friendsData } = await supabase
      .from('friends')
      .select(`user_id, friend_id, status, user:profiles!friends_user_id_fkey(id, username, last_seen, avatar_url), friend:profiles!friends_friend_id_fkey(id, username, last_seen, avatar_url)`)
      .or(`user_id.eq.${session.user.id},friend_id.eq.${session.user.id}`)
      .eq('status', 'accepted');
    
    let fList = friendsData?.map((f: any) => f.user_id === session.user.id ? f.friend : f.user) || [];
    fList = Array.from(new Map(fList.map(item => [item.id, item])).values());
    setFriends(fList);
    setLoading(false);
  };

  useFocusEffect(useCallback(() => { fetchProfileData(); }, []));

  const saveProfile = async () => {
    if (!username.trim() || !userId) return;
    setSaving(true);
    const { error } = await supabase.from('profiles').update({ username: username.trim() }).eq('id', userId);
    setSaving(false);
    if (error) Alert.alert('خطأ', 'حدث خطأ أثناء الحفظ'); else setOriginalUsername(username.trim());
  };

  const pickAndUploadImage = async () => {
    if (!userId) return;
    if (Platform.OS === 'web') {
      const input = document.createElement('input');
      input.type = 'file'; input.accept = 'image/*';
      input.onchange = async (e: any) => {
        const file = e.target.files[0]; if (!file) return;
        setUploading(true);
        const formData = new FormData();
        formData.append('upload_preset', 'chat_app_unsigned');
        formData.append('file', file);
        try {
          const res = await fetch('https://api.cloudinary.com/v1_1/dy8sl8fzs/image/upload', { method: 'POST', body: formData });
          const data = await res.json();
          await supabase.from('profiles').update({ avatar_url: data.secure_url }).eq('id', userId);
          setAvatarUrl(data.secure_url);
        } catch {}
        setUploading(false);
      };
      input.click();
    } else {
      Alert.alert('تنبيه', 'رفع الصور متاح حالياً من الويب فقط');
    }
  };

  const hasChanges = username.trim() !== originalUsername;

  if (loading) return <View style={styles.loading}><ActivityIndicator color={Colors.primary} size="large" /></View>;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.push('/settings')} style={styles.iconBtn}>
           <Ionicons name="settings-outline" size={26} color={Colors.primary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>العالم الشخصي</Text>
        <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn}>
           <Ionicons name="chevron-forward" size={28} color={Colors.primary} />
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <View style={styles.heroSection}>
           <View style={styles.avatarGlow}>
              <View style={[styles.squircleAvatar, { backgroundColor: Colors.white }]}>
                 {avatarUrl ? <Image source={{ uri: avatarUrl }} style={styles.avatarImg} /> : <Text style={styles.avatarText}>{username?.[0]?.toUpperCase()}</Text>}
                 <TouchableOpacity style={styles.editBadge} onPress={pickAndUploadImage}>
                    {uploading ? <ActivityIndicator size="small" color={Colors.white} /> : <Ionicons name="camera" size={20} color={Colors.white} />}
                 </TouchableOpacity>
              </View>
           </View>
           <Text style={styles.usernameDisplay}>{originalUsername}</Text>
           <Text style={styles.statusLabel}>متصل عبر CHAT UP</Text>
        </View>

        <View style={styles.statsRow}>
           <View style={styles.statBox}>
              <Text style={styles.statValue}>{friends.length}</Text>
              <Text style={styles.statLabel}>صديق</Text>
           </View>
           <View style={styles.statDivider} />
           <View style={styles.statBox}>
              <Text style={styles.statValue}>120</Text>
              <Text style={styles.statLabel}>رسالة</Text>
           </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>تعديل البيانات</Text>
          <View style={styles.card}>
             <Text style={styles.inputLabel}>اسم العرض</Text>
             <TextInput style={styles.input} value={username} onChangeText={setUsername} textAlign="right" />
             {hasChanges && (
               <TouchableOpacity style={styles.saveBtn} onPress={saveProfile}>
                  {saving ? <ActivityIndicator color={Colors.white} /> : <Text style={styles.saveBtnText}>تحديث الملف</Text>}
               </TouchableOpacity>
             )}
          </View>
        </View>

        <View style={styles.section}>
           <Text style={styles.sectionTitle}>الأصدقاء المقربون</Text>
           <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.friendsList}>
              {friends.map((friend, idx) => (
                <TouchableOpacity key={friend.id} style={styles.friendItem} onPress={() => router.push(`/chat/${friend.id}?username=${friend.username}`)}>
                   <View style={[styles.friendSquicle, { backgroundColor: Colors.surfaceContainerHigh }]}>
                      {friend.avatar_url ? <Image source={{ uri: friend.avatar_url }} style={styles.avatarImg} /> : <Text style={styles.friendInitial}>{friend.username[0].toUpperCase()}</Text>}
                   </View>
                   <Text style={styles.friendName} numberOfLines={1}>{friend.username}</Text>
                </TouchableOpacity>
              ))}
              <TouchableOpacity style={styles.addFriendBtn} onPress={() => router.push('/add-friend')}>
                 <Ionicons name="add" size={32} color={Colors.primary} />
              </TouchableOpacity>
           </ScrollView>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  loading: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: { flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: Spacing.lg, paddingTop: Platform.OS === 'ios' ? 60 : 40, paddingBottom: 20 },
  iconBtn: { width: 44, height: 44, borderRadius: Radius.md, backgroundColor: Colors.white, justifyContent: 'center', alignItems: 'center', ...Shadow.ambient },
  headerTitle: { fontSize: 22, fontWeight: '900', color: Colors.onSurface },
  scrollContent: { paddingBottom: 100 },

  heroSection: { alignItems: 'center', marginTop: 20 },
  avatarGlow: { padding: 4, borderRadius: Radius.xl + 4, backgroundColor: Colors.white, ...Shadow.premium },
  squircleAvatar: { width: 120, height: 120, borderRadius: Radius.xl, overflow: 'hidden', justifyContent: 'center', alignItems: 'center' },
  avatarImg: { width: '100%', height: '100%' },
  avatarText: { fontSize: 48, fontWeight: '900', color: Colors.primary },
  editBadge: { position: 'absolute', bottom: 0, right: 0, width: 36, height: 36, borderRadius: 18, backgroundColor: Colors.primary, justifyContent: 'center', alignItems: 'center', borderWidth: 3, borderColor: Colors.white },
  usernameDisplay: { fontSize: 26, fontWeight: '900', color: Colors.onSurface, marginTop: 16 },
  statusLabel: { fontSize: 13, color: Colors.primary, fontWeight: '600', backgroundColor: Colors.surfaceContainer, paddingHorizontal: 16, paddingVertical: 4, borderRadius: Radius.full, marginTop: 8 },

  statsRow: { flexDirection: 'row-reverse', justifyContent: 'center', alignItems: 'center', marginVertical: 32, gap: 40 },
  statBox: { alignItems: 'center' },
  statValue: { fontSize: 22, fontWeight: '900', color: Colors.onSurface },
  statLabel: { fontSize: 12, color: Colors.onSurfaceVariant, marginTop: 2 },
  statDivider: { width: 1, height: 30, backgroundColor: Colors.outlineVariant },

  section: { paddingHorizontal: Spacing.lg, marginBottom: 32 },
  sectionTitle: { fontSize: 18, fontWeight: '800', color: Colors.onSurface, textAlign: 'right', marginBottom: 16 },
  card: { backgroundColor: Colors.white, borderRadius: Radius.lg, padding: 20, ...Shadow.ambient },
  inputLabel: { fontSize: 12, color: Colors.onSurfaceVariant, textAlign: 'right', marginBottom: 8 },
  input: { fontSize: 18, fontWeight: '700', color: Colors.onSurface, borderBottomWidth: 0, ...(Platform.OS === 'web' && { outlineStyle: 'none' } as any) },
  saveBtn: { backgroundColor: Colors.primary, borderRadius: Radius.full, paddingVertical: 14, alignItems: 'center', marginTop: 20 },
  saveBtnText: { color: Colors.white, fontWeight: 'bold' },

  friendsList: { flexDirection: 'row-reverse', paddingBottom: 10 },
  friendItem: { alignItems: 'center', marginLeft: 16, width: 70 },
  friendSquicle: { width: 70, height: 70, borderRadius: Radius.lg, overflow: 'hidden', justifyContent: 'center', alignItems: 'center', marginBottom: 8 },
  friendInitial: { fontSize: 24, fontWeight: '900', color: Colors.primary },
  friendName: { fontSize: 12, fontWeight: '700', color: Colors.onSurface },
  addFriendBtn: { width: 70, height: 70, borderRadius: Radius.lg, backgroundColor: Colors.white, justifyContent: 'center', alignItems: 'center', borderStyle: 'dotted', borderWidth: 2, borderColor: Colors.primary }
});
