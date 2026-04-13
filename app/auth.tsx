import React, { useState } from 'react';
import { Alert, StyleSheet, View, TextInput, Text, TouchableOpacity, ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
import { supabase } from '../lib/supabase';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Radius, Spacing } from '../constants/theme';

export default function Auth() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [loading, setLoading] = useState(false);
  const [isLogin, setIsLogin] = useState(true);

  async function signInWithEmail() {
    if (!email || !password) {
      Alert.alert('تنبيه', 'يرجى إدخال البريد الإلكتروني وكلمة المرور');
      return;
    }
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    if (error) Alert.alert('خطأ', error.message);
    setLoading(false);
  }

  async function signUpWithEmail() {
    if (!username || !email || !password) {
      Alert.alert('تنبيه', 'يرجى تعبئة جميع الحقول');
      return;
    }
    setLoading(true);
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
    });
    if (error) {
      Alert.alert('خطأ', error.message);
    } else {
      if (data.user) {
        const { error: profileError } = await supabase.from('profiles').insert([
          { id: data.user.id, username: username }
        ]);
        if (profileError) {
          Alert.alert('حدث خطأ أثناء حفظ اسم المستخدم', profileError.message);
        } else {
            Alert.alert('نجاح', 'تم التسجيل بنجاح، يمكنك الآن تسجيل الدخول');
            setIsLogin(true);
        }
      }
    }
    setLoading(false);
  }

  return (
    <KeyboardAvoidingView 
      style={styles.container} 
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={styles.scrollContainer} keyboardShouldPersistTaps="handled">
        <View style={styles.headerContainer}>
          <View style={styles.logoBadge}>
            <Ionicons name="flash" size={40} color={Colors.white} />
          </View>
          <Text style={styles.brandTitle}>CHAT UP</Text>
          <Text style={styles.title}>{isLogin ? 'تسجيل الدخول' : 'حساب جديد'}</Text>
          <Text style={styles.subtitle}>
            {isLogin ? 'مرحباً بعودتك! الرجاء إدخال بياناتك' : 'انضم إلينا الآن وتواصل مع أصدقائك'}
          </Text>
        </View>
        
        <View style={styles.formContainer}>
          {!isLogin && (
            <View style={styles.inputContainer}>
              <Ionicons name="person-outline" size={20} color={Colors.onSurfaceVariant} style={styles.inputIcon} />
              <TextInput
                style={styles.input}
                onChangeText={setUsername}
                value={username}
                placeholder="اسم المستخدم"
                placeholderTextColor={Colors.onSurfaceVariant + '80'}
                autoCapitalize="none"
              />
            </View>
          )}

          <View style={styles.inputContainer}>
            <Ionicons name="mail-outline" size={20} color={Colors.onSurfaceVariant} style={styles.inputIcon} />
            <TextInput
              style={styles.input}
              onChangeText={setEmail}
              value={email}
              placeholder="البريد الإلكتروني"
              placeholderTextColor={Colors.onSurfaceVariant + '80'}
              autoCapitalize="none"
              keyboardType="email-address"
            />
          </View>
          
          <View style={styles.inputContainer}>
            <Ionicons name="lock-closed-outline" size={20} color={Colors.onSurfaceVariant} style={styles.inputIcon} />
            <TextInput
              style={styles.input}
              onChangeText={setPassword}
              value={password}
              secureTextEntry
              placeholder="كلمة المرور"
              placeholderTextColor={Colors.onSurfaceVariant + '80'}
              autoCapitalize="none"
            />
          </View>

          <TouchableOpacity 
            style={styles.button}
            disabled={loading}
            onPress={() => isLogin ? signInWithEmail() : signUpWithEmail()}
          >
            {loading ? (
              <ActivityIndicator color={Colors.white} />
            ) : (
              <Text style={styles.buttonText}>{isLogin ? 'دخول' : 'إنشاء حساب'}</Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity style={styles.toggleButton} onPress={() => setIsLogin(!isLogin)}>
            <Text style={styles.toggleText}>
              {isLogin ? 'ليس لديك حساب؟ ' : 'لديك حساب؟ '}
              <Text style={styles.toggleTextBold}>{isLogin ? 'قم بالتسجيل الان' : 'سجل دخولك'}</Text>
            </Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  scrollContainer: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: Spacing.lg,
  },
  headerContainer: {
    alignItems: 'center',
    marginBottom: Spacing.xl,
  },
  logoBadge: {
    width: 80,
    height: 80,
    backgroundColor: Colors.primary,
    borderRadius: Radius.xl,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: Spacing.md,
    shadowColor: Colors.primary,
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.3,
    shadowRadius: 20,
    elevation: 10,
  },
  brandTitle: {
    fontSize: 48,
    fontWeight: '900',
    color: Colors.primary,
    letterSpacing: -2,
    marginBottom: Spacing.xs,
  },
  title: {
    fontSize: 24,
    fontWeight: '800',
    color: Colors.onSurface,
    marginBottom: Spacing.xs,
  },
  subtitle: {
    fontSize: 16,
    color: Colors.onSurfaceVariant,
    textAlign: 'center',
    lineHeight: 24,
    paddingHorizontal: 20,
  },
  formContainer: {
    backgroundColor: Colors.white,
    padding: 32,
    borderRadius: Radius.xl,
    // Ambient Shadow Implementation (Premium)
    shadowColor: Colors.onSurface,
    shadowOffset: { width: 0, height: 15 },
    shadowOpacity: 0.05,
    shadowRadius: 30,
    elevation: 5,
  },
  inputContainer: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    backgroundColor: Colors.surfaceContainerLow,
    borderRadius: Radius.full,
    marginBottom: Spacing.md,
    paddingHorizontal: 20,
    height: 64,
  },
  inputIcon: {
    marginLeft: 12,
  },
  input: {
    flex: 1,
    fontSize: 16,
    color: Colors.onSurface,
    textAlign: 'right',
    fontWeight: '500',
    ...(Platform.OS === 'web' && { outlineStyle: 'none' } as any),
  },
  button: {
    backgroundColor: Colors.primary,
    borderRadius: Radius.full,
    height: 64,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: Spacing.sm,
    shadowColor: Colors.primary,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.25,
    shadowRadius: 15,
    elevation: 8,
  },
  buttonText: {
    color: Colors.white,
    fontSize: 18,
    fontWeight: 'bold',
  },
  toggleButton: {
    marginTop: Spacing.xl,
    alignItems: 'center',
  },
  toggleText: {
    color: Colors.onSurfaceVariant,
    fontSize: 15,
  },
  toggleTextBold: {
    color: Colors.primary,
    fontWeight: 'bold',
  }
});
