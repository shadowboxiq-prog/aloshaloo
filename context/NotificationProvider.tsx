import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import { Platform, AppState, View } from 'react-native';
import { supabase } from '../lib/supabase';
import { usePathname } from 'expo-router';
import { Audio } from 'expo-av';
import { NotificationToast } from '../components/NotificationToast';

interface NotificationContextType {}

const NotificationContext = createContext<NotificationContextType>({});

export const useNotification = () => useContext(NotificationContext);

export const NotificationProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [activeToast, setActiveToast] = useState<any | null>(null);
  
  const pathname = usePathname();
  const channelRef = useRef<any>(null);
  // Keep the latest pathname in a ref so the event listener can read it without getting stuck in stale closure
  const pathnameRef = useRef(pathname);

  useEffect(() => {
    pathnameRef.current = pathname;
  }, [pathname]);

  // Load sound objects
  const notificationSound = useRef<Audio.Sound | null>(null);
  const popSound = useRef<Audio.Sound | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user?.id) setCurrentUserId(session.user.id);
    });

    const { data: authListener } = supabase.auth.onAuthStateChange((event, session) => {
        if (session?.user?.id) setCurrentUserId(session.user.id);
        else setCurrentUserId(null);
    });

    const loadSounds = async () => {
      try {
        const { sound: nSound } = await Audio.Sound.createAsync({ uri: 'https://cdn.freesound.org/previews/415/415082_5121236-lq.mp3' }, { shouldPlay: false });
        const { sound: pSound } = await Audio.Sound.createAsync({ uri: 'https://cdn.freesound.org/previews/242/242501_4414994-lq.mp3' }, { shouldPlay: false });
        notificationSound.current = nSound;
        popSound.current = pSound;
      } catch (e) {
        console.warn("Could not load sounds", e);
      }
    };
    loadSounds();

    return () => {
      authListener.subscription.unsubscribe();
      notificationSound.current?.unloadAsync();
      popSound.current?.unloadAsync();
    };
  }, []);

  useEffect(() => {
    if (!currentUserId) return;

    let isMounted = true;

    const setupListener = () => {
      if (channelRef.current) supabase.removeChannel(channelRef.current);
      
      channelRef.current = supabase.channel(`global_notif_${currentUserId}`);
      
      channelRef.current
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `receiver_id=eq.${currentUserId}` }, async (payload: any) => {
          if (!isMounted) return;
          const msg = payload.new;

          // Check if we are currently inside THIS user's chat
          const isActivelyChattingWithSender = pathnameRef.current?.includes(`/chat/${msg.sender_id}`);

          if (isActivelyChattingWithSender) {
            // Play a soft pop sound or nothing
            try {
              if (popSound.current) {
                await popSound.current.replayAsync();
              }
            } catch {}
            return; // Do NOT show toast
          }

          // We are NOT in the chat (either different chat, or home, or out of app if native push worked)
          try {
            if (notificationSound.current) {
              await notificationSound.current.replayAsync();
            }
          } catch {}

          // Fetch sender profile info
          const { data: profile } = await supabase.from('profiles').select('full_name, avatar_url').eq('id', msg.sender_id).single();
          
          if (profile) {
            setActiveToast({
              id: msg.id,
              sender_id: msg.sender_id,
              sender_name: profile.full_name,
              sender_avatar: profile.avatar_url,
              content: msg.message_type === 'image' ? '🖼️ صورة' : msg.message_type === 'audio' ? '🎵 بصمة صوتية' : msg.message_type === 'video' ? '📽️ فيديو' : msg.message_type === 'file' ? '📄 ملف' : msg.content
            });
          }
        })
        .subscribe();
    };

    setupListener();

    const appStateListener = AppState.addEventListener('change', (state) => {
      if (state === 'active' && isMounted) setupListener();
    });

    return () => {
      isMounted = false;
      appStateListener.remove();
      if (channelRef.current) supabase.removeChannel(channelRef.current);
    };
  }, [currentUserId]);

  return (
    <NotificationContext.Provider value={{}}>
      {children}
      {activeToast && (
        <NotificationToast
          key={activeToast.id} // Re-mounts if a new message arrives immediately
          {...activeToast}
          onDismiss={() => setActiveToast(null)}
        />
      )}
    </NotificationContext.Provider>
  );
};
