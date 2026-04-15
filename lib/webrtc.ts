import { Platform } from 'react-native';

let RTCPeerConnection: any;
let RTCIceCandidate: any;
let RTCSessionDescription: any;
let mediaDevices: any;
let RTCView: any;

if (Platform.OS === 'web' && typeof window !== 'undefined') {
  RTCPeerConnection = window.RTCPeerConnection || (window as any).webkitRTCPeerConnection || (window as any).mozRTCPeerConnection;
  RTCIceCandidate = window.RTCIceCandidate || (window as any).webkitRTCIceCandidate || (window as any).mozRTCIceCandidate;
  RTCSessionDescription = window.RTCSessionDescription || (window as any).webkitRTCSessionDescription || (window as any).mozRTCSessionDescription;
  mediaDevices = navigator.mediaDevices;
  // RTCView is not used on web (we use <video>)
  RTCView = null;
} else if (Platform.OS !== 'web') {
  // Native
  try {
    const WebRTC = require('react-native-webrtc');
    RTCPeerConnection = WebRTC.RTCPeerConnection;
    RTCIceCandidate = WebRTC.RTCIceCandidate;
    RTCSessionDescription = WebRTC.RTCSessionDescription;
    mediaDevices = WebRTC.mediaDevices;
    RTCView = WebRTC.RTCView;
  } catch (e) {
    console.error('Failed to load react-native-webrtc', e);
  }
}

export {
  RTCPeerConnection,
  RTCIceCandidate,
  RTCSessionDescription,
  mediaDevices,
  RTCView,
};
