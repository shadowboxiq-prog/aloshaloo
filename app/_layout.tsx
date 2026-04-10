import { useEffect, useState } from 'react';
import { Stack, useRouter, useSegments } from 'expo-router';
import { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { View, ActivityIndicator, Text } from 'react-native';
import * as SplashScreen from 'expo-splash-screen';
import { useFonts } from 'expo-font';
import { Ionicons, MaterialIcons } from '@expo/vector-icons';

// Keep the splash screen visible while we fetch resources
SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [session, setSession] = useState<Session | null>(null);
  const [initialized, setInitialized] = useState(false);
  const segments = useSegments();
  const router = useRouter();

  const [loaded, error] = useFonts({
    ...Ionicons.font,
    ...MaterialIcons.font,
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
    // Safety timeout: If auth takes more than 3 seconds, proceed anyway to show the app
    const timeout = setTimeout(() => {
      if (!initialized) {
        console.warn('Auth initialization timed out, proceeding anyway.');
        setInitialized(true);
      }
    }, 3000);

    supabase.auth.getSession().then(({ data: { session } }) => {
      clearTimeout(timeout);
      setSession(session);
      setInitialized(true);
    }).catch(err => {
      console.error('Auth check error:', err);
      clearTimeout(timeout);
      setInitialized(true);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });

    return () => {
      clearTimeout(timeout);
      subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!initialized) return;

    const inAuthGroup = segments[0] === 'auth';

    if (!session && !inAuthGroup) {
      // Redirect to the login page
      router.replace('/auth');
    } else if (session && inAuthGroup) {
      // Redirect to home if logged in and trying to access auth screen
      router.replace('/');
    }

    // Heartbeat for last_seen
    let interval: NodeJS.Timeout;
    if (session) {
      const updateLastSeen = async () => {
        await supabase
          .from('profiles')
          .update({ last_seen: new Date().toISOString() })
          .eq('id', session.user.id);
      };
      
      updateLastSeen(); // Initial update
      interval = setInterval(updateLastSeen, 60000); // Update every minute
    }

    return () => {
      if (interval) clearInterval(interval);
    }
  }, [session, initialized, segments]);

  if (!initialized || !loaded) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#f8f5ff' }}>
        <ActivityIndicator size="large" color="#004be2" />
        <Text style={{ marginTop: 10, color: '#004be2', fontWeight: 'bold' }}>جاري تشغيل التطبيق...</Text>
      </View>
    );
  }

  return (
    <Stack>
      <Stack.Screen 
        name="index" 
        options={{ 
          title: 'المراسلة', // Adjusted title
          headerTitleStyle: { fontWeight: '800', fontSize: 28, color: '#2a2b51' },
          headerTintColor: '#004be2',
          headerShadowVisible: false,
          headerStyle: { backgroundColor: '#f8f5ff' }
        }} 
      />
      <Stack.Screen name="auth" options={{ title: 'تسجيل الدخول', headerShown: false }} />
      <Stack.Screen 
        name="chat/[id]" 
        options={{ 
          title: 'المحادثة',
          headerTitleStyle: { fontWeight: 'bold', fontSize: 18, color: '#2a2b51' },
          headerTintColor: '#004be2',
          headerShadowVisible: false,
          headerStyle: { backgroundColor: '#f8f5ff' },
          headerBackTitleVisible: false
        }} 
      />
      <Stack.Screen 
        name="profile" 
        options={{ 
          title: 'الملف الشخصي',
          headerTitleStyle: { fontWeight: 'bold', fontSize: 24, color: '#2a2b51' },
          headerTintColor: '#004be2',
          headerShadowVisible: false,
          headerStyle: { backgroundColor: '#f8f5ff' },
          headerBackTitleVisible: false
        }} 
      />
      <Stack.Screen 
        name="add-friend" 
        options={{ 
          title: 'البحث عن أصدقاء',
          headerTitleStyle: { fontWeight: 'bold', fontSize: 24, color: '#2a2b51' },
          headerTintColor: '#004be2',
          headerShadowVisible: false,
          headerStyle: { backgroundColor: '#f8f5ff' },
          headerBackTitleVisible: false
        }} 
      />
    </Stack>
  );
}
