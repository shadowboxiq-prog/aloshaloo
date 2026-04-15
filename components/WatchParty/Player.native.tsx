import React from 'react';
import { View, ActivityIndicator, StyleSheet, Dimensions } from 'react-native';
import YoutubePlayer from 'react-native-youtube-iframe';
import { Colors } from '../../constants/theme';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

export default function Player({ videoId, playing, onStateChange, playerRef, onReady }: any) {
  return (
    <View style={styles.wrapper}>
      <YoutubePlayer
        ref={playerRef}
        height={SCREEN_WIDTH * 0.5625}
        play={playing}
        videoId={videoId}
        onChangeState={onStateChange}
        onReady={onReady}
        webViewProps={{
          allowsFullscreenVideo: true,
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { backgroundColor: '#000', width: '100%' }
});
