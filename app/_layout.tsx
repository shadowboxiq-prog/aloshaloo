import { useEffect, useState } from 'react';
import { Stack, useRouter, useSegments } from 'expo-router';
import { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { View, ActivityIndicator, Text, Platform } from 'react-native';
import * as SplashScreen from 'expo-splash-screen';
import { useFonts } from 'expo-font';
import { Ionicons, MaterialIcons } from '@expo/vector-icons';
import { Colors } from '../constants/theme';
import { CallProvider } from '../context/CallProvider';
import { VoiceCallModal } from '../components/VoiceCallModal';
import { NotificationProvider } from '../context/NotificationProvider';
import { PresenceProvider } from '../context/PresenceProvider';

// Keep the splash screen visible while we fetch resources
SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [session, setSession] = useState<Session | null>(null);
  const [initialized, setInitialized] = useState(false);
  const segments = useSegments();
  const router = useRouter();

  const [loaded, error] = useFonts({
    'Ionicons': require('../assets/fonts/Ionicons.ttf'),
    'MaterialIcons': require('../assets/fonts/MaterialIcons.ttf'),
  });

  useEffect(() => {
    if (error) throw error;
  }, [error]);

  useEffect(() => {
    if (loaded && initialized) {
      SplashScreen.hideAsync();
    }
  }, [loaded, initialized]);

  useEffect(() => {
    const timeout = setTimeout(() => {
      if (!initialized) {
        setInitialized(true);
      }
    }, 3000);

    const handleInitialSession = async () => {
      try {
        const { data: { session }, error } = await supabase.auth.getSession();
        if (error) {
          console.error('Session error:', error.message);
          if (error.message.includes('refresh_token') || error.message.includes('not found')) {
            await supabase.auth.signOut();
          }
        }
        setSession(session);
      } catch (err) {
        console.error('Fatal Auth Error:', err);
      } finally {
        clearTimeout(timeout);
        setInitialized(true);
      }
    };

    handleInitialSession();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === 'TOKEN_REFRESHED' || event === 'SIGNED_IN' || event === 'SIGNED_OUT') {
        setSession(session);
      } else if (event === 'USER_UPDATED' && !session) {
        // Handle cases where user might have been deleted or invalid session
        setSession(null);
      }
    });

    return () => {
      clearTimeout(timeout);
      subscription.unsubscribe();
    };
  }, []);


  useEffect(() => {
    if (!initialized || !loaded) return;

    const inAuthGroup = segments[0] === 'auth';

    console.log('[Auth Guard] Session:', !!session, 'Path:', segments[0]);

    if (!session && !inAuthGroup) {
      router.replace('/auth');
    } else if (session && inAuthGroup) {
      router.replace('/');
    }
  }, [session, initialized, loaded, segments]);


  if (!initialized || !loaded) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: Colors.background }}>
        <ActivityIndicator size="large" color={Colors.primary} />
        <Text style={{ marginTop: 15, color: Colors.primary, fontWeight: '900', fontSize: 24 }}>CHAT UP</Text>
      </View>
    );
  }

  return (
    <CallProvider>
      <NotificationProvider>
        <PresenceProvider>
          <Stack screenOptions={{ headerShown: false, animation: 'fade_from_bottom' }}>
            <Stack.Screen name="index" options={{ title: 'Home' }} />
            <Stack.Screen name="auth" options={{ title: 'Welcome' }} />
            <Stack.Screen name="chat/[id]" options={{ title: 'Chat' }} />
            <Stack.Screen name="profile" options={{ title: 'Profile' }} />
            <Stack.Screen name="settings" options={{ title: 'Settings' }} />
            <Stack.Screen name="add-friend" options={{ title: 'Add Friend' }} />
          </Stack>
          <VoiceCallModal />
        </PresenceProvider>
      </NotificationProvider>
    </CallProvider>
  );
}
