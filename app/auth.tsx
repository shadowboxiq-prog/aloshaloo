import React, { useState } from 'react';
import { Alert, StyleSheet, View, TextInput, Text, TouchableOpacity, ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
import { supabase } from '../lib/supabase';
import { Ionicons } from '@expo/vector-icons';

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
          <Ionicons name="chatbubbles" size={90} color="#004be2" />
          <Text style={styles.title}>{isLogin ? 'تسجيل الدخول' : 'حساب جديد'}</Text>
          <Text style={styles.subtitle}>
            {isLogin ? 'مرحباً بعودتك! الرجاء إدخال بياناتك' : 'انضم إلينا الآن وتواصل مع أصدقائك'}
          </Text>
        </View>
        
        <View style={styles.formContainer}>
          {!isLogin && (
            <View style={styles.inputContainer}>
              <Ionicons name="person-outline" size={20} color="#575881" style={styles.inputIcon} />
              <TextInput
                style={styles.input}
                onChangeText={setUsername}
                value={username}
                placeholder="اسم المستخدم"
                placeholderTextColor="#a9a9d7"
                autoCapitalize="none"
              />
            </View>
          )}

          <View style={styles.inputContainer}>
            <Ionicons name="mail-outline" size={20} color="#575881" style={styles.inputIcon} />
            <TextInput
              style={styles.input}
              onChangeText={setEmail}
              value={email}
              placeholder="البريد الإلكتروني"
              placeholderTextColor="#a9a9d7"
              autoCapitalize="none"
              keyboardType="email-address"
            />
          </View>
          
          <View style={styles.inputContainer}>
            <Ionicons name="lock-closed-outline" size={20} color="#575881" style={styles.inputIcon} />
            <TextInput
              style={styles.input}
              onChangeText={setPassword}
              value={password}
              secureTextEntry
              placeholder="كلمة المرور"
              placeholderTextColor="#a9a9d7"
              autoCapitalize="none"
            />
          </View>

          <TouchableOpacity 
            style={styles.button}
            disabled={loading}
            onPress={() => isLogin ? signInWithEmail() : signUpWithEmail()}
          >
            {loading ? (
              <ActivityIndicator color="#fff" />
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
    backgroundColor: '#f8f5ff',
  },
  scrollContainer: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: 24,
  },
  headerContainer: {
    alignItems: 'center',
    marginBottom: 40,
  },
  title: {
    fontSize: 34,
    fontWeight: '900',
    color: '#2a2b51',
    marginTop: 16,
    marginBottom: 8,
    letterSpacing: -0.5,
  },
  subtitle: {
    fontSize: 16,
    color: '#575881',
    textAlign: 'center',
    lineHeight: 24,
  },
  formContainer: {
    backgroundColor: '#ffffff',
    padding: 28,
    borderRadius: 32,
    borderWidth: 0,
    // Add subtle ambient shadow
    shadowColor: '#2a2b51',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.06,
    shadowRadius: 40,
    elevation: 4,
  },
  inputContainer: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    backgroundColor: '#f2efff', // surface_container_low
    borderRadius: 100, // full roundedness
    marginBottom: 20,
    paddingHorizontal: 20,
    height: 60,
  },
  inputIcon: {
    marginLeft: 12,
  },
  input: {
    flex: 1,
    fontSize: 16,
    color: '#2a2b51',
    textAlign: 'right',
    fontWeight: '500',
  },
  button: {
    backgroundColor: '#004be2',
    borderRadius: 100,
    height: 60,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 10,
    shadowColor: '#004be2',
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.2,
    shadowRadius: 15,
    elevation: 4,
  },
  buttonText: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: 'bold',
  },
  toggleButton: {
    marginTop: 24,
    alignItems: 'center',
  },
  toggleText: {
    color: '#575881',
    fontSize: 15,
  },
  toggleTextBold: {
    color: '#004be2',
    fontWeight: 'bold',
  }
});
