import { initializeApp, getApps, getApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getAuth } from "firebase/auth";
import { getDatabase } from "firebase/database";
import { getStorage } from "firebase/storage";

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY!,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN!,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID!,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET!,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID!,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID!,
};

// Avoid "Firebase app already initialized" error
const app = !getApps().length ? initializeApp(firebaseConfig) : getApp();
const db = getFirestore(app);
const auth = getAuth(app);
const realtimeDb = getDatabase(app);
const storage = getStorage(app);

// Export functions for use in hooks and components
export function getFirebaseDb() {
  return db;
}

export function getFirebaseAuth() {
  return auth;
}

export function getFirebaseRealtimeDb() {
  return realtimeDb;
}

export function getFirebaseStorage() {
  return storage;
}

// Also export direct instances for backward compatibility
export { app, db, auth, realtimeDb, storage };

