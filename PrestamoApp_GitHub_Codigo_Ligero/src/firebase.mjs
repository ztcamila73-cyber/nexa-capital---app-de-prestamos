import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getDatabase } from 'firebase/database';
import { getFunctions } from 'firebase/functions';
const env = import.meta.env;
export const enabled = !!(env.VITE_FIREBASE_API_KEY && env.VITE_FIREBASE_PROJECT_ID && env.VITE_FIREBASE_DATABASE_URL);
const config = enabled ? {
  apiKey:env.VITE_FIREBASE_API_KEY,
  authDomain:env.VITE_FIREBASE_AUTH_DOMAIN,
  databaseURL:env.VITE_FIREBASE_DATABASE_URL,
  projectId:env.VITE_FIREBASE_PROJECT_ID,
  storageBucket:env.VITE_FIREBASE_STORAGE_BUCKET,
  appId:env.VITE_FIREBASE_APP_ID
} : null;
export const firebaseApp = enabled ? initializeApp(config) : null;
export const auth = enabled ? getAuth(firebaseApp) : null;
export const database = enabled ? getDatabase(firebaseApp) : null;
export const functions = enabled ? getFunctions(firebaseApp,env.VITE_FIREBASE_FUNCTIONS_REGION||'us-central1') : null;
