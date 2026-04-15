import React from 'react';
import { View, StyleSheet, Dimensions } from 'react-native';

export default function Player({ videoId, playing, onReady }: any) {
  // onReady is called immediately for iframe
  React.useEffect(() => {
    if (onReady) onReady();
  }, []);

  return (
    <View style={styles.wrapper}>
      <iframe
        width="100%"
        height={Dimensions.get('window').width * 0.5}
        src={`https://www.youtube.com/embed/${videoId}?autoplay=${playing ? 1 : 0}`}
        frameBorder="0"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        allowFullScreen
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { backgroundColor: '#000', width: '100%' }
});
