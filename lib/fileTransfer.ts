import * as FileSystem from 'expo-file-system';
import { Platform } from 'react-native';

const CHUNK_SIZE = 64 * 1024; // 64KB per chunk for optimal RTC stability

export interface FileMetadata {
  name: string;
  size: number;
  type: string;
  totalChunks: number;
}

export type TransferMessage = 
  | { type: 'METADATA', metadata: FileMetadata }
  | { type: 'CHUNK', data: string, index: number }
  | { type: 'END' }
  | { type: 'ERROR', message: string };

/**
 * Reads a file in chunks and executes a callback for each chunk.
 */
export async function sendFileInChunks(
  fileUri: string, 
  onChunk: (chunk: TransferMessage) => Promise<void>,
  onProgress: (progress: number) => void
) {
  try {
    const fileInfo = await FileSystem.getInfoAsync(fileUri);
    if (!fileInfo.exists) throw new Error('File does not exist');

    const totalSize = fileInfo.size;
    const totalChunks = Math.ceil(totalSize / CHUNK_SIZE);

    // 1. Send Metadata
    await onChunk({
      type: 'METADATA',
      metadata: {
        name: fileUri.split('/').pop() || 'file',
        size: totalSize,
        type: 'application/octet-stream', // Generic, can be improved
        totalChunks
      }
    });

    // 2. Read and send chunks
    for (let i = 0; i < totalChunks; i++) {
      const position = i * CHUNK_SIZE;
      const length = Math.min(CHUNK_SIZE, totalSize - position);

      const chunkBase64 = await FileSystem.readAsStringAsync(fileUri, {
        encoding: FileSystem.EncodingType.Base64,
        position,
        length
      });

      await onChunk({
        type: 'CHUNK',
        data: chunkBase64,
        index: i
      });

      onProgress((i + 1) / totalChunks);
    }

    // 3. Send End
    await onChunk({ type: 'END' });
  } catch (error: any) {
    console.error('[FileTransfer] Sender error:', error);
    await onChunk({ type: 'ERROR', message: error.message });
  }
}

/**
 * Receives chunks and assembles them into a local file.
 */
export class FileReceiver {
  private tempUri: string;
  private metadata: FileMetadata | null = null;
  private receivedChunks = 0;
  private onComplete: (uri: string) => void;
  private onProgress: (progress: number) => void;

  constructor(onComplete: (uri: string) => void, onProgress: (progress: number) => void) {
    this.tempUri = FileSystem.cacheDirectory + 'p2p_tmp_' + Date.now();
    this.onComplete = onComplete;
    this.onProgress = onProgress;
  }

  async handleMessage(message: TransferMessage) {
    switch (message.type) {
      case 'METADATA':
        this.metadata = message.metadata;
        this.receivedChunks = 0;
        // Ensure old temp file is gone
        try { await FileSystem.deleteAsync(this.tempUri, { idempotent: true }); } catch {}
        break;

      case 'CHUNK':
        if (!this.metadata) return;
        await FileSystem.writeAsStringAsync(this.tempUri, message.data, {
          encoding: FileSystem.EncodingType.Base64,
          append: true
        });
        this.receivedChunks++;
        this.onProgress(this.receivedChunks / this.metadata.totalChunks);
        break;

      case 'END':
        if (this.metadata) {
          const finalUri = FileSystem.documentDirectory + this.metadata.name;
          await FileSystem.moveAsync({ from: this.tempUri, to: finalUri });
          this.onComplete(finalUri);
        }
        break;

      case 'ERROR':
        console.error('[FileTransfer] Receiver error:', message.message);
        break;
    }
  }
}
