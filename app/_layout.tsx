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
    if (!session?.user?.id) return;

    const channel = supabase.channel('online-users', {
      config: {
        presence: {
          key: session.user.id,
        },
      },
    });

    channel
      .on('presence', { event: 'sync' }, () => {
        const state = channel.presenceState();
        const ids = Object.keys(state);
        // Custom event for other components (Web only)
        if (Platform.OS === 'web' && typeof CustomEvent !== 'undefined') {
          window.dispatchEvent(new CustomEvent('presence-sync', { detail: { ids } }));
        }
      })
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          await channel.track({
            id: session.user.id,
            online_at: new Date().toISOString(),
          });
        }
      });

    // Heartbeat to update last_seen in DB
    const updateLastSeen = async () => {
      await supabase
        .from('profiles')
        .update({ last_seen: new Date().toISOString() })
        .eq('id', session.user.id);
    };

    updateLastSeen(); // initial update
    const heartbeat = setInterval(updateLastSeen, 1000 * 60 * 2); // every 2 mins

    return () => {
      supabase.removeChannel(channel);
      clearInterval(heartbeat);
    };
  }, [session?.user?.id]);

  useEffect(() => {
    if (!initialized) return;

    const inAuthGroup = segments[0] === 'auth';

    if (!session && !inAuthGroup) {
      router.replace('/auth');
    } else if (session && inAuthGroup) {
      router.replace('/');
    }

    let interval: NodeJS.Timeout;
    if (session) {
      const updateLastSeen = async () => {
        await supabase.from('profiles').update({ last_seen: new Date().toISOString() }).eq('id', session.user.id);
      };
      updateLastSeen();
      interval = setInterval(updateLastSeen, 60000);
    }

    return () => { if (interval) clearInterval(interval); }
  }, [session, initialized, segments]);

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
        <Stack screenOptions={{ headerShown: false, animation: 'fade_from_bottom' }}>
          <Stack.Screen name="index" options={{ title: 'Home' }} />
          <Stack.Screen name="auth" options={{ title: 'Welcome' }} />
          <Stack.Screen name="chat/[id]" options={{ title: 'Chat' }} />
          <Stack.Screen name="profile" options={{ title: 'Profile' }} />
          <Stack.Screen name="settings" options={{ title: 'Settings' }} />
          <Stack.Screen name="add-friend" options={{ title: 'Add Friend' }} />
        </Stack>
        <VoiceCallModal />
      </NotificationProvider>
    </CallProvider>
  );
}
