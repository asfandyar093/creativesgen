import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

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
