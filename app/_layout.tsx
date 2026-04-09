import { useEffect, useState } from 'react';
import { Stack, useRouter, useSegments } from 'expo-router';
import { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { View, ActivityIndicator } from 'react-native';

export default function RootLayout() {
  const [session, setSession] = useState<Session | null>(null);
  const [initialized, setInitialized] = useState(false);
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setInitialized(true);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });

    return () => {
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

  if (!initialized) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#F9FAFB' }}>
        <ActivityIndicator size="large" color="#4F46E5" />
      </View>
    );
  }

  return (
    <Stack>
      <Stack.Screen 
        name="index" 
        options={{ 
          title: 'الرئيسية',
          headerTitleStyle: { fontWeight: 'bold' },
          headerTintColor: '#111827',
          headerShadowVisible: false,
          headerStyle: { backgroundColor: '#FFFFFF' }
        }} 
      />
      <Stack.Screen name="auth" options={{ title: 'تسجيل الدخول', headerShown: false }} />
      <Stack.Screen 
        name="chat/[id]" 
        options={{ 
          title: 'المراسلة',
          headerTitleStyle: { fontWeight: 'bold' },
          headerTintColor: '#111827',
          headerShadowVisible: false,
          headerStyle: { backgroundColor: '#FFFFFF' },
          headerBackTitleVisible: false
        }} 
      />
      <Stack.Screen 
        name="profile" 
        options={{ 
          title: 'الملف الشخصي',
          headerTitleStyle: { fontWeight: 'bold' },
          headerTintColor: '#111827',
          headerShadowVisible: false,
          headerStyle: { backgroundColor: '#FFFFFF' },
          headerBackTitleVisible: false
        }} 
      />
      <Stack.Screen 
        name="add-friend" 
        options={{ 
          title: 'إضافة صديق',
          headerTitleStyle: { fontWeight: 'bold' },
          headerTintColor: '#111827',
          headerShadowVisible: false,
          headerStyle: { backgroundColor: '#FFFFFF' },
          headerBackTitleVisible: false
        }} 
      />
    </Stack>
  );
}
