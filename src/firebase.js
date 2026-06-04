import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';

// Configuración de Firebase fija para despliegue en GitHub Pages
const firebaseConfig = {
  apiKey: "AIzaSyAbTG6YI2EbYQkcOrrRB9oPMSS7l92biQo",
  authDomain: "gestor-informe.firebaseapp.com",
  projectId: "gestor-informe",
  storageBucket: "gestor-informe.firebasestorage.app",
  messagingSenderId: "803040546369",
  appId: "1:803040546369:web:c0009487879ab1c21a00c0",
  measurementId: "G-L15B0YDC13"
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
export const db = getFirestore(app);
export const storage = getStorage(app);
