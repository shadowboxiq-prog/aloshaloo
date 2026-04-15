import React from 'react';
import { View, Text, StyleSheet, Modal, TouchableOpacity, Dimensions } from 'react-native';
import { BlurView } from 'expo-blur';
import { Ionicons } from '@expo/vector-icons';
import { useFileTransfer } from '../context/FileTransferProvider';
import { Colors, Radius, Spacing, Shadow } from '../constants/theme';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

export const FileTransferOverlay: React.FC = () => {
  const { transferStatus, currentTransfer, progress, acceptTransfer, rejectTransfer, cancelTransfer } = useFileTransfer();

  if (transferStatus === 'idle') return null;

  return (
    <Modal visible={transferStatus !== 'idle'} transparent animationType="fade">
      <View style={styles.container}>
        <BlurView intensity={100} tint="dark" style={styles.blur}>
          
          {/* INCOMING REQUEST MODAL */}
          {transferStatus === 'receiving' && currentTransfer && (
            <View style={styles.card}>
              <TouchableOpacity style={styles.closeBtn} onPress={cancelTransfer}>
                <Ionicons name="close" size={24} color={Colors.onSurfaceVariant} />
              </TouchableOpacity>
              <View style={styles.iconCircle}>
                <Ionicons name="document-attach" size={32} color={Colors.primary} />
              </View>
              <Text style={styles.title}>طلب استلام ملف P2P</Text>
              <Text style={styles.subtitle}>
                يريد الطرف الآخر إرسال: {"\n"}
                <Text style={{fontWeight: '900'}}>{currentTransfer.file_name}</Text> {"\n"}
                ({(currentTransfer.file_size / (1024 * 1024)).toFixed(2)} MB)
              </Text>
              
              <View style={styles.row}>
                <TouchableOpacity 
                  style={[styles.btn, styles.rejectBtn]} 
                  onPress={() => rejectTransfer(currentTransfer.id)}
                >
                  <Text style={styles.btnText}>رفض</Text>
                </TouchableOpacity>
                <TouchableOpacity 
                  style={[styles.btn, styles.acceptBtn]} 
                  onPress={() => acceptTransfer(currentTransfer.id)}
                >
                  <Text style={styles.btnText}>قبول</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}

          {/* PROGRESS VIEW (For both Sender and Receiver) */}
          {(transferStatus === 'in_progress' || transferStatus === 'requesting') && (
            <View style={styles.card}>
              <TouchableOpacity style={styles.closeBtn} onPress={cancelTransfer}>
                <Ionicons name="close" size={24} color={Colors.onSurfaceVariant} />
              </TouchableOpacity>
              <View style={styles.iconCircle}>
                <Ionicons 
                  name={transferStatus === 'requesting' ? "hourglass" : "cloud-upload"} 
                  size={32} 
                  color={Colors.primary} 
                />
              </View>
              <Text style={styles.title}>
                {transferStatus === 'requesting' ? 'بانتظار الموافقة...' : 'جاري النقل المباشر...'}
              </Text>
              
              {transferStatus === 'in_progress' && (
                <View style={styles.progressContainer}>
                  <View style={styles.progressBarBg}>
                    <View style={[styles.progressBarFill, { width: `${progress * 100}%` }]} />
                  </View>
                  <Text style={styles.progressText}>{Math.round(progress * 100)}%</Text>
                </View>
              )}
              
              <Text style={styles.warningText}>⚠️ يرجى عدم إغلاق التطبيق حتى اكتمال النقل</Text>
            </View>
          )}

          {/* COMPLETED / FAILED VIEW */}
          {transferStatus === 'completed' && (
            <View style={styles.card}>
              <TouchableOpacity style={styles.closeBtn} onPress={cancelTransfer}>
                <Ionicons name="close" size={24} color={Colors.onSurfaceVariant} />
              </TouchableOpacity>
              <Ionicons name="checkmark-circle" size={60} color="#00c853" />
              <Text style={styles.title}>تم النقل بنجاح!</Text>
            </View>
          )}

        </BlurView>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  blur: { ...StyleSheet.absoluteFillObject, justifyContent: 'center', alignItems: 'center' },
  card: {
    width: SCREEN_WIDTH * 0.85,
    backgroundColor: Colors.white,
    borderRadius: Radius.xl,
    padding: Spacing.xl,
    alignItems: 'center',
    ...Shadow.ambient,
  },
  iconCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: Colors.surfaceContainer,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  title: { fontSize: 18, fontWeight: '800', color: Colors.onSurface, marginBottom: 8, textAlign: 'center' },
  subtitle: { fontSize: 14, color: Colors.onSurfaceVariant, textAlign: 'center', lineHeight: 20, marginBottom: 24 },
  row: { flexDirection: 'row', gap: 12, width: '100%' },
  btn: { flex: 1, height: 50, borderRadius: Radius.md, justifyContent: 'center', alignItems: 'center' },
  rejectBtn: { backgroundColor: '#ff4b4b' },
  acceptBtn: { backgroundColor: '#00c853' },
  btnText: { color: Colors.white, fontWeight: 'bold', fontSize: 16 },
  progressContainer: { width: '100%', alignItems: 'center', marginVertical: 20 },
  progressBarBg: { width: '100%', height: 10, backgroundColor: Colors.surfaceContainer, borderRadius: 5, overflow: 'hidden' },
  progressBarFill: { height: '100%', backgroundColor: Colors.primary },
  progressText: { marginTop: 8, fontSize: 14, fontWeight: 'bold', color: Colors.primary },
  progressBarFill: { height: '100%', backgroundColor: Colors.primary },
  progressText: { marginTop: 8, fontSize: 14, fontWeight: 'bold', color: Colors.primary },
  warningText: { fontSize: 12, color: '#ff4b4b', fontStyle: 'italic', textAlign: 'center' },
  closeBtn: {
    position: 'absolute',
    top: 16,
    right: 16,
    padding: 4,
    zIndex: 10,
  }
});
