import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, Switch, Platform, ActivityIndicator } from 'react-native';
import { supabase } from '../lib/supabase';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Spacing, Radius, Shadow, Gradients } from '../constants/theme';
import { LinearGradient } from 'expo-linear-gradient';

export default function SettingsScreen() {
  const router = useRouter();
  const [isDarkMode, setIsDarkMode] = useState(false);
  const [notifications, setNotifications] = useState(true);
  const [username, setUsername] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchProfile();
  }, []);

  const fetchProfile = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (session) {
      const { data } = await supabase.from('profiles').select('username').eq('id', session.user.id).single();
      if (data) setUsername(data.username);
    }
    setLoading(false);
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    router.replace('/auth');
  };

  const renderPremiumCard = () => (
    <LinearGradient colors={Gradients.primary} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.premiumCard}>
      <View style={styles.premiumInfo}>
        <Ionicons name="sparkles" size={32} color={Colors.white} />
        <View style={styles.premiumTextGroup}>
          <Text style={styles.premiumTitle}>CHAT UP المميز</Text>
          <Text style={styles.premiumSub}>احصل على ميزات حصرية وتصميم فريد</Text>
        </View>
      </View>
      <TouchableOpacity style={styles.premiumBtn}>
        <Text style={styles.premiumBtnText}>ترقية الآن</Text>
      </TouchableOpacity>
    </LinearGradient>
  );

  const renderSettingItem = (icon: any, title: string, value: boolean, onToggle: (v: boolean) => void) => (
    <View style={styles.settingItem}>
      <View style={styles.settingLeft}>
        <Switch 
          value={value} 
          onValueChange={onToggle} 
          trackColor={{ false: Colors.surfaceContainer, true: Colors.secondaryContainer }}
          thumbColor={value ? Colors.secondary : Colors.white}
        />
      </View>
      <View style={styles.settingRight}>
        <View style={[styles.iconBox, { backgroundColor: Colors.surfaceContainerLow }]}>
           <Ionicons name={icon} size={22} color={Colors.primary} />
        </View>
        <Text style={styles.settingTitle}>{title}</Text>
      </View>
    </View>
  );

  const renderLinkItem = (icon: any, title: string, destructive = false) => (
    <TouchableOpacity style={styles.settingItem} onPress={title === 'تسجيل الخروج' ? handleSignOut : undefined}>
      <Ionicons name="chevron-back" size={20} color={destructive ? Colors.error : Colors.onSurfaceVariant} />
      <View style={styles.settingRight}>
        <View style={[styles.iconBox, { backgroundColor: destructive ? '#ffefef' : Colors.surfaceContainerLow }]}>
           <Ionicons name={icon} size={22} color={destructive ? Colors.error : Colors.primary} />
        </View>
        <Text style={[styles.settingTitle, destructive && { color: Colors.error }]}>{title}</Text>
      </View>
    </TouchableOpacity>
  );

  if (loading) {
     return (
       <View style={styles.loading}>
          <ActivityIndicator color={Colors.primary} size="large" />
       </View>
     );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="chevron-forward" size={28} color={Colors.primary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>الإعدادات</Text>
        <View style={{ width: 44 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <View style={styles.profileSection}>
           <View style={styles.squircleWrap}>
              <View style={[styles.squircle, { backgroundColor: Colors.primaryContainer }]}>
                 <Text style={styles.avatarText}>{username?.[0]?.toUpperCase()}</Text>
              </View>
           </View>
           <Text style={styles.username}>{username}</Text>
           <Text style={styles.userStatus}>عضو في CHAT UP</Text>
        </View>

        {renderPremiumCard()}

        <View style={styles.section}>
          <Text style={styles.sectionLabel}>التفضيلات</Text>
          {renderSettingItem('moon-outline', 'الوضع الليلي', isDarkMode, setIsDarkMode)}
          {renderSettingItem('notifications-outline', 'التنبيهات', notifications, setNotifications)}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionLabel}>الحساب</Text>
          {renderLinkItem('person-outline', 'تعديل الملف الشخصي')}
          {renderLinkItem('lock-closed-outline', 'الأمان والخصوصية')}
          {renderLinkItem('help-circle-outline', 'المساعدة والدعم')}
        </View>

        <View style={[styles.section, { marginBottom: 40 }]}>
           {renderLinkItem('log-out-outline', 'تسجيل الخروج', true)}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  loading: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: Colors.background },
  header: { 
    flexDirection: 'row-reverse', 
    alignItems: 'center', 
    justifyContent: 'space-between', 
    paddingHorizontal: Spacing.lg, 
    paddingTop: Platform.OS === 'ios' ? 60 : 40, 
    paddingBottom: 20 
  },
  backBtn: { width: 44, height: 44, borderRadius: Radius.md, backgroundColor: Colors.white, justifyContent: 'center', alignItems: 'center', ...Shadow.ambient },
  headerTitle: { fontSize: 20, fontWeight: '800', color: Colors.onSurface },
  
  scrollContent: { paddingHorizontal: Spacing.lg, paddingTop: 10 },
  
  profileSection: { alignItems: 'center', marginBottom: Spacing.xl },
  squircleWrap: { padding: 4, backgroundColor: Colors.white, borderRadius: Radius.lg + 4, ...Shadow.ambient, marginBottom: 12 },
  squircle: { width: 90, height: 90, borderRadius: Radius.lg, justifyContent: 'center', alignItems: 'center' },
  avatarText: { fontSize: 36, fontWeight: 'bold', color: Colors.white },
  username: { fontSize: 22, fontWeight: '800', color: Colors.onSurface },
  userStatus: { fontSize: 13, color: Colors.onSurfaceVariant, marginTop: 4 },

  premiumCard: { padding: 24, borderRadius: Radius.lg, marginBottom: Spacing.xl, ...Shadow.premium },
  premiumInfo: { flexDirection: 'row-reverse', alignItems: 'center', marginBottom: 20 },
  premiumTextGroup: { marginRight: 16, flex: 1 },
  premiumTitle: { color: Colors.white, fontSize: 18, fontWeight: '900' },
  premiumSub: { color: Colors.white, opacity: 0.8, fontSize: 12, marginTop: 2, textAlign: 'right' },
  premiumBtn: { backgroundColor: Colors.white, paddingVertical: 12, borderRadius: Radius.full, alignItems: 'center' },
  premiumBtnText: { color: Colors.primary, fontWeight: '800', fontSize: 15 },

  section: { backgroundColor: Colors.white, borderRadius: Radius.lg, padding: 8, marginBottom: Spacing.lg, ...Shadow.ambient },
  sectionLabel: { fontSize: 14, fontWeight: '700', color: Colors.onSurfaceVariant, marginHorizontal: 16, marginTop: 12, marginBottom: 8, textAlign: 'right' },
  settingItem: { flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between', padding: 12, borderRadius: Radius.md },
  settingLeft: { flexDirection: 'row-reverse', alignItems: 'center' },
  settingRight: { flexDirection: 'row-reverse', alignItems: 'center', flex: 1 },
  iconBox: { width: 40, height: 40, borderRadius: 12, justifyContent: 'center', alignItems: 'center', marginLeft: 16 },
  settingTitle: { fontSize: 16, fontWeight: '600', color: Colors.onSurface, textAlign: 'right' }
});
