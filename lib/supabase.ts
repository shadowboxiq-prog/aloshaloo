import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import { Platform } from 'react-native';

const supabaseUrl = 'https://hnwszlrkudniajcyques.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imhud3N6bHJrdWRuaWFqY3lxdWVzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU2NTUxNDAsImV4cCI6MjA5MTIzMTE0MH0.TbkOcZQ2-gMXaxsAGfBQVYd22PiraovazkXSrDvJvE0';

// Mock storage for SSR on web
const ExpoServerStorage = {
  getItem: (key: string) => Promise.resolve(null),
  setItem: (key: string, value: string) => Promise.resolve(),
  removeItem: (key: string) => Promise.resolve(),
};

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: Platform.OS === 'web' && typeof window === 'undefined' ? ExpoServerStorage : AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});
