import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyDk6CTTpcYr9unTVJY-OZ--kQNSJDZpww8",
  authDomain: "sunriko-whiteboard.firebaseapp.com",
  projectId: "sunriko-whiteboard",
  storageBucket: "sunriko-whiteboard.firebasestorage.app",
  messagingSenderId: "668014548267",
  appId: "1:668014548267:web:04f9f85efe522be52fa16e",
  measurementId: "G-BRF0F27EN6"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
