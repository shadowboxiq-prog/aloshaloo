import React, { useState, useEffect } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator, Alert, Image, ScrollView, Platform } from 'react-native';
import { supabase } from '../lib/supabase';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

export default function ProfileScreen() {
  const [username, setUsername] = useState('');
  const [originalUsername, setOriginalUsername] = useState('');
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const router = useRouter();

  useEffect(() => {
    fetchProfile();
  }, []);

  const fetchProfile = async () => {
    setLoading(true);
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;

    setUserId(session.user.id);

    const { data, error } = await supabase
      .from('profiles')
      .select('username, avatar_url')
      .eq('id', session.user.id)
      .single();

    if (data) {
      setUsername(data.username || '');
      setOriginalUsername(data.username || '');
      setAvatarUrl(data.avatar_url || null);
    }
    setLoading(false);
  };

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
      Alert.alert('نجاح', 'تم تحديث الملف الشخصي بنجاح');
    }
  };

  const pickAndUploadImage = async () => {
    if (!userId) return;

    // For web: create a file input element
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
          Alert.alert('نجاح', 'تم تحديث الصورة الشخصية بنجاح');
        }
        setUploading(false);
      };
      input.click();
    } else {
      Alert.alert('تنبيه', 'اختيار الصور متاح على الويب حالياً');
    }
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#4F46E5" />
      </View>
    );
  }

  const hasChanges = username.trim() !== originalUsername;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.contentContainer}>
      {/* Avatar Section */}
      <View style={styles.avatarSection}>
        <TouchableOpacity style={styles.avatarContainer} onPress={pickAndUploadImage} disabled={uploading}>
          {avatarUrl ? (
            <Image source={{ uri: avatarUrl }} style={styles.avatarImage} />
          ) : (
            <View style={styles.avatarPlaceholder}>
              <Text style={styles.avatarPlaceholderText}>{username?.[0]?.toUpperCase() || 'U'}</Text>
            </View>
          )}
          <View style={styles.cameraIcon}>
            {uploading ? (
              <ActivityIndicator size="small" color="#FFF" />
            ) : (
              <Ionicons name="camera" size={18} color="#FFF" />
            )}
          </View>
        </TouchableOpacity>
        <Text style={styles.changePhotoText}>
          {uploading ? 'جاري الرفع...' : 'اضغط لتغيير الصورة'}
        </Text>
      </View>

      {/* Form Section */}
      <View style={styles.formSection}>
        <Text style={styles.label}>اسم المستخدم</Text>
        <View style={styles.inputContainer}>
          <TextInput
            style={styles.input}
            value={username}
            onChangeText={setUsername}
            placeholder="أدخل اسم المستخدم الجديد"
            placeholderTextColor="#9CA3AF"
            autoCapitalize="none"
          />
          <Ionicons name="person-outline" size={20} color="#9CA3AF" />
        </View>
      </View>

      {/* Save Button */}
      <TouchableOpacity 
        style={[styles.saveButton, !hasChanges && styles.saveButtonDisabled]} 
        onPress={saveProfile} 
        disabled={!hasChanges || saving}
      >
        {saving ? (
          <ActivityIndicator size="small" color="#FFF" />
        ) : (
          <>
            <Ionicons name="checkmark-circle-outline" size={20} color="#FFF" style={{ marginLeft: 8 }} />
            <Text style={styles.saveButtonText}>حفظ التغييرات</Text>
          </>
        )}
      </TouchableOpacity>

      {/* Info Card */}
      <View style={styles.infoCard}>
        <Ionicons name="information-circle-outline" size={20} color="#6B7280" />
        <Text style={styles.infoText}>
          يمكنك تغيير اسم المستخدم والصورة الشخصية. اسم المستخدم يجب أن يكون فريداً.
        </Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F9FAFB',
  },
  contentContainer: {
    padding: 24,
    alignItems: 'center',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#F9FAFB',
  },
  avatarSection: {
    alignItems: 'center',
    marginBottom: 32,
    marginTop: 16,
  },
  avatarContainer: {
    position: 'relative',
    width: 120,
    height: 120,
  },
  avatarImage: {
    width: 120,
    height: 120,
    borderRadius: 60,
    borderWidth: 3,
    borderColor: '#4F46E5',
  },
  avatarPlaceholder: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: '#4F46E5',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 3,
    borderColor: '#818CF8',
  },
  avatarPlaceholderText: {
    color: '#FFFFFF',
    fontSize: 42,
    fontWeight: 'bold',
  },
  cameraIcon: {
    position: 'absolute',
    bottom: 4,
    right: 4,
    backgroundColor: '#4F46E5',
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 3,
    borderColor: '#FFFFFF',
  },
  changePhotoText: {
    marginTop: 12,
    fontSize: 14,
    color: '#4F46E5',
    fontWeight: '500',
  },
  formSection: {
    width: '100%',
    maxWidth: 400,
    marginBottom: 24,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: '#374151',
    marginBottom: 8,
    textAlign: 'right',
  },
  inputContainer: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    paddingHorizontal: 16,
    height: 52,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  input: {
    flex: 1,
    fontSize: 16,
    color: '#1F2937',
    textAlign: 'right',
    marginRight: 8,
  },
  saveButton: {
    flexDirection: 'row-reverse',
    backgroundColor: '#4F46E5',
    paddingHorizontal: 24,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    maxWidth: 400,
    marginBottom: 24,
    shadowColor: '#4F46E5',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  saveButtonDisabled: {
    backgroundColor: '#A5B4FC',
    shadowOpacity: 0,
    elevation: 0,
  },
  saveButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: 'bold',
  },
  infoCard: {
    flexDirection: 'row-reverse',
    backgroundColor: '#FFFFFF',
    padding: 16,
    borderRadius: 12,
    width: '100%',
    maxWidth: 400,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#F3F4F6',
  },
  infoText: {
    flex: 1,
    fontSize: 13,
    color: '#6B7280',
    textAlign: 'right',
    marginRight: 8,
    lineHeight: 20,
  }
});
