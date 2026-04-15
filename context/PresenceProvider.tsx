import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { supabase } from '../lib/supabase';

interface PresenceContextType {
  onlineUsers: Set<string>;
}

const PresenceContext = createContext<PresenceContextType>({ onlineUsers: new Set() });

export const usePresence = () => useContext(PresenceContext);

export const PresenceProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [onlineUsers, setOnlineUsers] = useState<Set<string>>(new Set());
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const channelRef = useRef<any>(null);
  const heartbeatRef = useRef<any>(null);

  useEffect(() => {
    // Get initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user?.id) setCurrentUserId(session.user.id);
    });

    // Listen for auth changes
    const { data: authListener } = supabase.auth.onAuthStateChange((event, session) => {
      if (session?.user?.id) setCurrentUserId(session.user.id);
      else setCurrentUserId(null);
    });

    return () => {
      authListener.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!currentUserId) return;

    let isMounted = true;

    const setupPresence = () => {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
      }

      const channelId = 'global-activity';
      const channel = supabase.channel(channelId, {
        config: {
          presence: { key: currentUserId }
        }
      });

      channel
        .on('presence', { event: 'sync' }, () => {
          if (!isMounted) return;
          const state = channel.presenceState();
          const ids = new Set(Object.keys(state));
          setOnlineUsers(ids);
        })
        .subscribe(async (status) => {
          if (status === 'SUBSCRIBED' && isMounted) {
            await channel.track({ id: currentUserId, online_at: new Date().toISOString() });
          }
        });

      channelRef.current = channel;
    };

    const updateLastSeen = async () => {
      if (!currentUserId || !isMounted) return;
      await supabase.from('profiles').update({ last_seen: new Date().toISOString() }).eq('id', currentUserId);
    };

    setupPresence();
    updateLastSeen();
    
    if (heartbeatRef.current) clearInterval(heartbeatRef.current);
    heartbeatRef.current = setInterval(updateLastSeen, 120000); // 2 minutes

    const appStateListener = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active' && isMounted) {
        setupPresence();
        updateLastSeen();
      }
    });

    return () => {
      isMounted = false;
      appStateListener.remove();
      if (heartbeatRef.current) clearInterval(heartbeatRef.current);
      if (channelRef.current) supabase.removeChannel(channelRef.current);
    };
  }, [currentUserId]);

  return (
    <PresenceContext.Provider value={{ onlineUsers }}>
      {children}
    </PresenceContext.Provider>
  );
};
