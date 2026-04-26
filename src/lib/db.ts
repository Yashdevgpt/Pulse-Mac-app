import { firestore, auth } from './firebase';
import { collection, doc, getDocs, getDoc, setDoc, deleteDoc, query, orderBy, writeBatch } from 'firebase/firestore';

export interface DSP {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  // When true, the Fleet page pins this DSP to the top of the list.
  starred?: boolean;
}

export interface Tag {
  id: string;
  name: string;
  color: string;
}

export interface LogFile {
  name: string;
  type: string;
  data: string; // Base64 data
}

export interface Log {
  id: string;
  dspId: string;
  content: string;
  tags: string[]; // tag ids
  status: 'Ongoing' | 'Completed' | 'None';
  createdAt: number;
  updatedAt: number;
  file?: LogFile;
  resolutionNote?: string;
  resolutionFile?: LogFile;
}

export interface BrainCard {
  id: string;
  title: string;
  content: string;
  createdAt: number;
  updatedAt: number;
}

export interface BrainChatMessage {
  id: string;
  role: 'user' | 'brain';
  content: string;
  createdAt: number;
  // Optional citations attached to assistant replies so saved chats can
  // restore the original "Sources" footer with clickable links.
  sources?: Array<{ title: string; type: string }>;
  webSources?: Array<{ title: string; uri?: string }>;
  // 'summary' marks a synthetic message that compresses older history.
  kind?: 'summary';
  compressedCount?: number;
}

export interface BrainChat {
  id: string;
  title: string;
  mode: 'work' | 'work_web' | 'web';
  messages: BrainChatMessage[];
  createdAt: number;
  updatedAt: number;
}

const DEFAULT_TAGS: Tag[] = [
  { id: 'tag_monitoring', name: 'Monitoring', color: 'bg-blue-500' },
  { id: 'tag_manager', name: 'Manager Update', color: 'bg-purple-500' },
  { id: 'tag_positive', name: 'Positive', color: 'bg-green-500' },
  { id: 'tag_negative', name: 'Negative', color: 'bg-red-500' },
  { id: 'tag_action', name: 'Action Required', color: 'bg-orange-500' },
];

// Configure via VITE_BOOTSTRAP_ADMIN_EMAIL. Fallback preserves existing
// production deployments. Must match the email allowlisted in firestore.rules.
const BOOTSTRAP_ADMIN_EMAIL = (
  import.meta.env.VITE_BOOTSTRAP_ADMIN_EMAIL || 'sagargpt23@gmail.com'
).trim().toLowerCase();

const getUid = () => {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error("User not authenticated");
  return uid;
};

export interface AppUser {
  uid: string;
  email: string;
  name: string;
  status: 'pending' | 'approved' | 'admin' | 'rejected';
  createdAt: number;
}

export interface WatchtowerPreferences {
  visibleTagIds: string[];
  updatedAt: number;
}

export const db = {
  // User Management
  getUserAccess: async (user: any): Promise<AppUser> => {
    const userRef = doc(firestore, `app_users/${user.uid}`);
    const userSnap = await getDoc(userRef);
    const email = (user.email || '').toLowerCase();
    const isBootstrapAdmin = email === BOOTSTRAP_ADMIN_EMAIL;
    
    if (userSnap.exists()) {
      const existingUser = userSnap.data() as AppUser;
      if (isBootstrapAdmin && existingUser.status !== 'admin') {
        try {
          await setDoc(userRef, { status: 'admin', email }, { merge: true });
        } catch (error) {
          console.error("Failed to persist bootstrap admin status:", error);
        }
        return { ...existingUser, email, status: 'admin' };
      }
      return existingUser;
    }

    const newUser: AppUser = {
      uid: user.uid,
      email,
      name: user.displayName || email.split('@')[0] || 'Unknown User',
      status: isBootstrapAdmin ? 'admin' : 'pending',
      createdAt: Date.now()
    };
    await setDoc(userRef, newUser);
    return newUser;
  },
  getAllUsers: async (): Promise<AppUser[]> => {
    const snapshot = await getDocs(collection(firestore, 'app_users'));
    return snapshot.docs.map(d => d.data() as AppUser);
  },
  updateUserStatus: async (uid: string, status: 'pending' | 'approved' | 'admin' | 'rejected'): Promise<void> => {
    await setDoc(doc(firestore, `app_users/${uid}`), { status }, { merge: true });
  },
  updateUserName: async (uid: string, name: string): Promise<void> => {
    await setDoc(doc(firestore, `app_users/${uid}`), { name }, { merge: true });
  },
  deleteUser: async (uid: string): Promise<void> => {
    const batch = writeBatch(firestore);

    // Delete DSPs
    const dspsSnap = await getDocs(collection(firestore, `users/${uid}/dsps`));
    dspsSnap.forEach(d => batch.delete(d.ref));

    // Delete Logs
    const logsSnap = await getDocs(collection(firestore, `users/${uid}/logs`));
    logsSnap.forEach(d => batch.delete(d.ref));

    // Delete Tags
    const tagsSnap = await getDocs(collection(firestore, `users/${uid}/tags`));
    tagsSnap.forEach(d => batch.delete(d.ref));

    // Delete Brain Cards
    const brainCardsSnap = await getDocs(collection(firestore, `users/${uid}/brainCards`));
    brainCardsSnap.forEach(d => batch.delete(d.ref));

    // Delete Saved Brain Chats
    const brainChatsSnap = await getDocs(collection(firestore, `users/${uid}/brainChats`));
    brainChatsSnap.forEach(d => batch.delete(d.ref));

    // Delete app_user profile
    batch.delete(doc(firestore, `app_users/${uid}`));

    await batch.commit();
  },

  // DSPs
  getDSPs: async (): Promise<DSP[]> => {
    const q = query(collection(firestore, `users/${getUid()}/dsps`), orderBy('updatedAt', 'desc'));
    const snapshot = await getDocs(q);
    return snapshot.docs.map(d => d.data() as DSP);
  },
  getDSP: async (id: string): Promise<DSP | null> => {
    const d = await getDoc(doc(firestore, `users/${getUid()}/dsps/${id}`));
    return d.exists() ? (d.data() as DSP) : null;
  },
  saveDSP: async (dsp: DSP): Promise<DSP> => {
    await setDoc(doc(firestore, `users/${getUid()}/dsps/${dsp.id}`), dsp);
    return dsp;
  },
  deleteDSP: async (id: string): Promise<void> => {
    await deleteDoc(doc(firestore, `users/${getUid()}/dsps/${id}`));
    const logs = await db.getLogsByDSP(id);
    for (const log of logs) {
      await db.deleteLog(log.id);
    }
  },

  // Logs
  getLogs: async (): Promise<Log[]> => {
    const q = query(collection(firestore, `users/${getUid()}/logs`), orderBy('createdAt', 'desc'));
    const snapshot = await getDocs(q);
    return snapshot.docs.map(d => d.data() as Log);
  },
  getLogsByDSP: async (dspId: string): Promise<Log[]> => {
    const logs = await db.getLogs();
    return logs.filter(log => log.dspId === dspId);
  },
  saveLog: async (log: Log): Promise<Log> => {
    await setDoc(doc(firestore, `users/${getUid()}/logs/${log.id}`), log);
    const dsp = await db.getDSP(log.dspId);
    if (dsp) {
      dsp.updatedAt = log.updatedAt;
      await db.saveDSP(dsp);
    }
    return log;
  },
  deleteLog: async (id: string): Promise<void> => {
    await deleteDoc(doc(firestore, `users/${getUid()}/logs/${id}`));
  },

  // Tags
  getTags: async (): Promise<Tag[]> => {
    const snapshot = await getDocs(collection(firestore, `users/${getUid()}/tags`));
    if (snapshot.empty) {
      for (const tag of DEFAULT_TAGS) {
        await setDoc(doc(firestore, `users/${getUid()}/tags/${tag.id}`), tag);
      }
      return DEFAULT_TAGS;
    }
    return snapshot.docs.map(d => d.data() as Tag);
  },
  saveTag: async (tag: Tag): Promise<Tag> => {
    await setDoc(doc(firestore, `users/${getUid()}/tags/${tag.id}`), tag);
    return tag;
  },
  deleteTag: async (id: string): Promise<void> => {
    await deleteDoc(doc(firestore, `users/${getUid()}/tags/${id}`));
  },

  // Brain
  getBrainCards: async (): Promise<BrainCard[]> => {
    const q = query(collection(firestore, `users/${getUid()}/brainCards`), orderBy('updatedAt', 'desc'));
    const snapshot = await getDocs(q);
    return snapshot.docs.map(d => d.data() as BrainCard);
  },
  saveBrainCard: async (card: BrainCard): Promise<BrainCard> => {
    await setDoc(doc(firestore, `users/${getUid()}/brainCards/${card.id}`), card);
    return card;
  },
  deleteBrainCard: async (id: string): Promise<void> => {
    await deleteDoc(doc(firestore, `users/${getUid()}/brainCards/${id}`));
  },
  getBrainChats: async (): Promise<BrainChat[]> => {
    const q = query(collection(firestore, `users/${getUid()}/brainChats`), orderBy('updatedAt', 'desc'));
    const snapshot = await getDocs(q);
    return snapshot.docs.map(d => d.data() as BrainChat);
  },
  saveBrainChat: async (chat: BrainChat): Promise<BrainChat> => {
    await setDoc(doc(firestore, `users/${getUid()}/brainChats/${chat.id}`), chat);
    return chat;
  },
  deleteBrainChat: async (id: string): Promise<void> => {
    await deleteDoc(doc(firestore, `users/${getUid()}/brainChats/${id}`));
  },
  getWatchtowerPreferences: async (): Promise<WatchtowerPreferences | null> => {
    const settingsRef = doc(firestore, `users/${getUid()}/preferences/watchtower`);
    const settingsSnap = await getDoc(settingsRef);
    return settingsSnap.exists() ? (settingsSnap.data() as WatchtowerPreferences) : null;
  },
  saveWatchtowerPreferences: async (preferences: WatchtowerPreferences): Promise<WatchtowerPreferences> => {
    await setDoc(doc(firestore, `users/${getUid()}/preferences/watchtower`), preferences);
    return preferences;
  },
};
