import { initializeApp } from "https://esm.sh/firebase@10.12.0/app";
import { getAuth } from "https://esm.sh/firebase@10.12.0/auth";
import { getFirestore } from "https://esm.sh/firebase@10.12.0/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyCul5Hv4vy-FfH-IMafdOP3fs8ikP2WvIE",
  authDomain: "image-generation-web-app.firebaseapp.com",
  projectId: "image-generation-web-app",
  storageBucket: "image-generation-web-app.firebasestorage.app",
  messagingSenderId: "981800995254",
  appId: "1:981800995254:web:279635b177ecbee3ead917",
  measurementId: "G-5Q693PZNBW"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
