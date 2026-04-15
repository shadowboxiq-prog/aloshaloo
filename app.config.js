export default ({ config }) => {
  // Use /aloshaloo/ for production builds (GitHub Pages) and / for local development
  const isProduction = process.env.NODE_ENV === 'production';
  const baseUrl = isProduction ? '/aloshaloo/' : '/';

  return {
    ...config,
    name: "CHAT UP",
    slug: "chat-up",
    version: "1.0.0",
    orientation: "portrait",
    icon: "./assets/images/icon.png",
    scheme: "chatup",
    userInterfaceStyle: "automatic",
    newArchEnabled: true,
    ios: {
      supportsTablet: true
    },
    android: {
      package: "com.shadowboxiq.chatup",
      adaptiveIcon: {
        backgroundColor: "#ffffff",
        foregroundImage: "./assets/images/icon.png",
      },
      permissions: [
        "CAMERA",
        "RECORD_AUDIO",
        "MODIFY_AUDIO_SETTINGS",
        "ACCESS_NETWORK_STATE",
        "INTERNET"
      ],
      edgeToEdgeEnabled: true,
    },
    web: {
      output: "static",
      bundler: "metro",
      favicon: "./assets/images/favicon.png",
      baseUrl: baseUrl
    },
    plugins: [
      "expo-router",
      [
        "expo-splash-screen",
        {
          "image": "./assets/images/splash-icon.png",
          "imageWidth": 200,
          "resizeMode": "contain",
          "backgroundColor": "#ffffff"
        }
      ],
      "@config-plugins/react-native-webrtc"
    ],
    experiments: {
      typedRoutes: true,
      reactCompiler: false
    }
  };
};
