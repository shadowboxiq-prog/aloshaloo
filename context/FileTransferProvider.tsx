import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import { Alert, Platform } from 'react-native';
import { supabase } from '../lib/supabase';
import { RTCPeerConnection, RTCSessionDescription, RTCIceCandidate } from '../lib/webrtc';
import { sendFileInChunks, FileReceiver, TransferMessage } from '../lib/fileTransfer';

interface FileTransferContextType {
  transferStatus: 'idle' | 'requesting' | 'receiving' | 'in_progress' | 'completed' | 'failed';
  currentTransfer: any | null;
  progress: number;
  requestTransfer: (receptorId: string, fileUri: string, fileName: string, fileSize: number) => Promise<void>;
  acceptTransfer: (transferId: string) => Promise<void>;
  rejectTransfer: (transferId: string) => Promise<void>;
}

const FileTransferContext = createContext<FileTransferContextType | undefined>(undefined);

export const useFileTransfer = () => {
  const context = useContext(FileTransferContext);
  if (!context) throw new Error('useFileTransfer must be used within FileTransferProvider');
  return context;
};

const ICE_SERVERS = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' }, 
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' },
    { urls: 'turn:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' }
  ]
};

function waitForIce(pc: RTCPeerConnection): Promise<{ type: string; sdp: string }> {
  return new Promise((resolve) => {
    const finish = () => {
      if (pc.localDescription) {
        resolve({ type: pc.localDescription.type, sdp: pc.localDescription.sdp });
      }
    };
    if (pc.iceGatheringState === 'complete') { finish(); return; }
    const timer = setTimeout(finish, 3000); 
    pc.addEventListener('icegatheringstatechange', () => {
      if (pc.iceGatheringState === 'complete') { 
        clearTimeout(timer); 
        finish(); 
      }
    });
  });
}

export const FileTransferProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [transferStatus, setTransferStatus] = useState<any>('idle');
  const [currentTransfer, setCurrentTransfer] = useState<any>(null);
  const [progress, setProgress] = useState(0);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dataChannelRef = useRef<any>(null);
  const currentUidRef = useRef<string | null>(null);

  useEffect(() => {
    const init = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        currentUidRef.current = session.user.id;
        setupSignaling(session.user.id);
      }
    };
    init();
  }, []);

  const setupSignaling = (uid: string) => {
    supabase
      .channel(`transfers-${uid}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'p2p_transfers' }, async (payload) => {
        const transfer = payload.new as any;
        if (!transfer) return;

        // INCOMING REQUEST
        if (transfer.receiver_id === uid && payload.eventType === 'INSERT') {
          setCurrentTransfer(transfer);
          setTransferStatus('receiving');
        }

        // SENDER: RECEIPT OF ANSWER
        if (transfer.sender_id === uid && transfer.status === 'accepted' && transfer.answer) {
          if (pcRef.current) {
            await pcRef.current.setRemoteDescription(new RTCSessionDescription(transfer.answer));
          }
        }

        // FAILURES/REJECTIONS
        if (transfer.status === 'rejected' || transfer.status === 'failed') {
          cleanup();
          if (transfer.status === 'rejected') Alert.alert('P2P Transfer', 'The recipient rejected the file.');
        }
      })
      .subscribe();
  };

  const cleanup = () => {
    if (dataChannelRef.current) dataChannelRef.current.close();
    if (pcRef.current) pcRef.current.close();
    dataChannelRef.current = null;
    pcRef.current = null;
    setTransferStatus('idle');
    setCurrentTransfer(null);
    setProgress(0);
  };

  const requestTransfer = async (receiverId: string, fileUri: string, fileName: string, fileSize: number) => {
    try {
      setTransferStatus('requesting');
      const pc = new RTCPeerConnection(ICE_SERVERS);
      pcRef.current = pc;

      const dc = pc.createDataChannel('file-transfer');
      dataChannelRef.current = dc;

      dc.onopen = async () => {
        setTransferStatus('in_progress');
        await sendFileInChunks(fileUri, async (chunk) => {
          if (dc.readyState === 'open') dc.send(JSON.stringify(chunk));
        }, (p) => setProgress(p));
        setTransferStatus('completed');
        setTimeout(cleanup, 3000);
      };

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      
      console.log('[P2P] Gathering ICE for offer...');
      const fullOffer = await waitForIce(pc);

      const { data, error } = await supabase.from('p2p_transfers').insert([{
        sender_id: currentUidRef.current,
        receiver_id: receiverId,
        file_name: fileName,
        file_size: fileSize,
        offer: fullOffer,
        status: 'requested'
      }]).select().single();

      if (error) throw error;
      setCurrentTransfer(data);
    } catch (e) {
      cleanup();
      Alert.alert('Transfer Error', 'Failed to initiate transfer');
    }
  };

  const acceptTransfer = async (transferId: string) => {
    try {
      setTransferStatus('in_progress');
      const transfer = currentTransfer;
      const pc = new RTCPeerConnection(ICE_SERVERS);
      pcRef.current = pc;

      const receiver = new FileReceiver(
        (uri) => {
          setTransferStatus('completed');
          Alert.alert('Success', `File saved to: ${uri}`);
          setTimeout(cleanup, 3000);
        },
        (p) => setProgress(p)
      );

      pc.ondatachannel = (event) => {
        const dc = event.channel;
        dataChannelRef.current = dc;
        dc.onmessage = (msg) => {
          receiver.handleMessage(JSON.parse(msg.data));
        };
      };

      await pc.setRemoteDescription(new RTCSessionDescription(transfer.offer));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      console.log('[P2P] Gathering ICE for answer...');
      const fullAnswer = await waitForIce(pc);

      await supabase.from('p2p_transfers').update({
        answer: fullAnswer,
        status: 'accepted'
      }).eq('id', transferId);

    } catch (e) {
      cleanup();
      Alert.alert('Error', 'Failed to accept transfer');
    }
  };

  const rejectTransfer = async (transferId: string) => {
    await supabase.from('p2p_transfers').update({ status: 'rejected' }).eq('id', transferId);
    cleanup();
  };

  return (
    <FileTransferContext.Provider value={{
      transferStatus, currentTransfer, progress,
      requestTransfer, acceptTransfer, rejectTransfer
    }}>
      {children}
    </FileTransferContext.Provider>
  );
};
