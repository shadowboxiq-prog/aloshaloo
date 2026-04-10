import React, { useState } from 'react';
import { View, TextInput, FlatList, Text, TouchableOpacity, StyleSheet, ActivityIndicator, Alert } from 'react-native';
import { supabase } from '../lib/supabase';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

export default function AddFriendScreen() {
  const [searchQuery, setSearchQuery] = useState('');
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const searchUsers = async (text: string) => {
    setSearchQuery(text);
    if (text.length < 2) {
      setUsers([]);
      return;
    }

    setLoading(true);
    const { data: { session } } = await supabase.auth.getSession();
    const currentUserId = session?.user.id;

    if (!currentUserId) return;

    // Fetch users that match query AND are not already friends
    const { data, error } = await supabase
      .from('profiles')
      .select('id, username')
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

    try {
      // Check if already exist before insert to avoid ugly postgREST error if possible
      const { data: existing } = await supabase
        .from('friends')
        .select('id')
        .or(`and(user_id.eq.${currentUserId},friend_id.eq.${friendId}),and(user_id.eq.${friendId},friend_id.eq.${currentUserId})`)
        .single();
        
      if (existing) {
        Alert.alert('تنبيه', 'هذا المستخدم موجود في قائمة الأصدقاء بالفعل');
        return;
      }

      const { error } = await supabase
        .from('friends')
        .insert({ user_id: currentUserId, friend_id: friendId });

      if (error) {
        if (error.code === '23505') {
          Alert.alert('تنبيه', 'هذا المستخدم صديق لك بالفعل');
        } else {
          Alert.alert('خطأ', 'حدث خطأ أثناء الإضافة');
          console.error(error);
        }
      } else {
        Alert.alert('نجاح', `تم إضافة ${username} إلى أصدقائك بنجاح`);
        router.replace('/');
      }
    } catch (e) {
      console.error(e);
      Alert.alert('خطأ', 'حدث خطأ في النظام');
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.searchContainer}>
        <Ionicons name="search" size={20} color="#9CA3AF" style={styles.searchIcon} />
        <TextInput
          style={styles.searchInput}
          placeholder="ابحث عن أصدقاء لضافتهم..."
          placeholderTextColor="#9CA3AF"
          value={searchQuery}
          onChangeText={searchUsers}
          autoFocus={true}
        />
      </View>

      {loading ? (
        <ActivityIndicator size="large" color="#4F46E5" style={{ marginTop: 40 }} />
      ) : (
        <FlatList
          data={users}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContainer}
          renderItem={({ item, index }) => (
            <View style={styles.userItem}>
              <View style={[styles.avatar, { backgroundColor: getAvatarColor(index) }]}>
                <Text style={styles.avatarText}>{item.username[0].toUpperCase()}</Text>
              </View>
              <View style={styles.userInfo}>
                <Text style={styles.usernameText}>{item.username}</Text>
              </View>
              <TouchableOpacity 
                style={styles.addButton}
                onPress={() => addFriend(item.id, item.username)}
              >
                <Ionicons name="person-add-outline" size={18} color="#FFFFFF" />
                <Text style={styles.addText}>إضافة</Text>
              </TouchableOpacity>
            </View>
          )}
          ListEmptyComponent={() => (
            <View style={styles.emptyContainer}>
              <Ionicons name="search-circle-outline" size={60} color="#D1D5DB" />
              <Text style={styles.emptyText}>
                {searchQuery.length > 0 && searchQuery.length < 2 
                  ? 'اكتب حرفين أو أكثر للبحث' 
                  : searchQuery.length >= 2 
                    ? 'لم يتم العثور على مستخدمين' 
                    : 'ابحث حسب اسم المستخدم'}
              </Text>
            </View>
          )}
        />
      )}
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
  searchContainer: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    backgroundColor: '#f2efff',
    borderRadius: 100, // pill
    paddingHorizontal: 16,
    margin: 16,
    height: 56,
    borderWidth: 0,
  },
  searchIcon: {
    marginLeft: 12,
  },
  searchInput: {
    flex: 1,
    textAlign: 'right',
    fontSize: 16,
    color: '#2a2b51',
  },
  listContainer: {
    padding: 16,
  },
  userItem: {
    flexDirection: 'row-reverse',
    backgroundColor: '#ffffff',
    padding: 16,
    borderRadius: 24,
    marginBottom: 12,
    alignItems: 'center',
    shadowColor: '#2a2b51',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.05,
    shadowRadius: 10,
    elevation: 2,
    borderWidth: 0,
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 16, // squircle
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 16,
  },
  avatarText: {
    color: '#ffffff',
    fontSize: 20,
    fontWeight: 'bold',
  },
  userInfo: {
    flex: 1,
    alignItems: 'flex-end',
  },
  usernameText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#2a2b51',
  },
  addButton: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    backgroundColor: '#004be2',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 100, // pill
    gap: 6,
    shadowColor: '#004be2',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 3,
  },
  addText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: 'bold',
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 60,
  },
  emptyText: {
    marginTop: 16,
    color: '#a9a9d7',
    fontSize: 16,
  }
});
