import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

// ====================================================================
// TODO: PASTE YOUR FIREBASE CONFIGURATION OBJECT HERE
// You can find this in your Firebase project settings.
// ====================================================================
const firebaseConfig = {
  apiKey: "AIzaSyBCa2KN0SKijyfCBUz1hrZALpZUz-6xBFI",
  authDomain: "miniwabot.firebaseapp.com",
  projectId: "miniwabot",
  storageBucket: "miniwabot.firebasestorage.app",
  messagingSenderId: "204083983779",
  appId: "1:204083983779:web:58b3db06c475204a7f1616"
};
// ====================================================================

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
