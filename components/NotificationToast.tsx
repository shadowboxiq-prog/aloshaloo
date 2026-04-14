import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Platform } from 'react-native';
import Animated, { FadeInUp, FadeOutUp, SlideInUp, SlideOutUp, runOnJS } from 'react-native-reanimated';
import { Image } from 'expo-image';
import { Colors } from '../constants/theme';
import { useRouter } from 'expo-router';

interface ToastProps {
  id: string;
  sender_id: string;
  sender_name: string;
  sender_avatar: string;
  content: string;
  onDismiss: () => void;
}

export const NotificationToast: React.FC<ToastProps> = ({ id, sender_id, sender_name, sender_avatar, content, onDismiss }) => {
  const router = useRouter();

  useEffect(() => {
    const timer = setTimeout(() => {
      onDismiss();
    }, 4000); // Autodismiss after 4 seconds
    return () => clearTimeout(timer);
  }, []);

  const handlePress = () => {
    onDismiss();
    router.push(`/chat/${sender_id}`);
  };

  return (
    <Animated.View 
      entering={SlideInUp.duration(400).springify()} 
      exiting={SlideOutUp.duration(300)} 
      style={styles.container}
    >
      <TouchableOpacity activeOpacity={0.9} onPress={handlePress} style={styles.content}>
        <View style={styles.textContainer}>
          <Text style={styles.name} numberOfLines={1}>{sender_name || 'رسالة جديدة'}</Text>
          <Text style={styles.message} numberOfLines={1}>{content}</Text>
        </View>
        <Image 
          source={{ uri: sender_avatar || 'https://ui-avatars.com/api/?name=User&background=random' }} 
          style={styles.avatar}
          contentFit="cover"
        />
      </TouchableOpacity>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 50 : 20,
    left: 16,
    right: 16,
    zIndex: 9999,
    elevation: 10,
    backgroundColor: '#ffffff',
    borderRadius: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.05)',
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    marginLeft: 12, // RTL support
  },
  textContainer: {
    flex: 1,
    alignItems: 'flex-end', // RTL
  },
  name: {
    fontFamily: 'Tajawal-Bold',
    fontSize: 16,
    color: '#000',
    marginBottom: 4,
  },
  message: {
    fontFamily: 'Tajawal-Regular',
    fontSize: 14,
    color: '#666',
  }
});
