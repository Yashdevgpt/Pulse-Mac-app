import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';
import { getStorage } from 'firebase/storage';

// Firebase web config is loaded from env vars when present so it can be rotated
// and scoped per environment. Fallbacks preserve the existing dev experience.
// In production, set VITE_FIREBASE_* in your hosting environment.
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || "AIzaSyB3lr2P_StJyrJOlyQ56tV_mrbw874x64I",
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || "pulseapp23.firebaseapp.com",
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || "pulseapp23",
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || "pulseapp23.firebasestorage.app",
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || "397073512600",
  appId: import.meta.env.VITE_FIREBASE_APP_ID || "1:397073512600:web:b0e51fe7accf61aaecb8ed",
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID || "G-DLN2C7HC0C"
};

export const app = initializeApp(firebaseConfig);
export const firestore = getFirestore(app);
export const auth = getAuth(app);
export const storage = getStorage(app);
export const googleProvider = new GoogleAuthProvider();
