import { auth, db } from "./firebase-config.js";
import {
  GoogleAuthProvider,
  FacebookAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged
} from "https://esm.sh/firebase@10.12.0/auth";
import {
  doc, getDoc, setDoc, updateDoc, serverTimestamp
} from "https://esm.sh/firebase@10.12.0/firestore";

const PLAN_LIMITS = {
  free: 15,
  starter: 200,
  pro: 1000,
  agency: 5000,
  enterprise: 15000
};

async function ensureUserDoc(user) {
  const ref = doc(db, "users", user.uid);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    const renewalDate = new Date();
    renewalDate.setDate(renewalDate.getDate() + 30);
    await setDoc(ref, {
      email: user.email,
      name: user.displayName,
      photoURL: user.photoURL,
      plan: "free",
      imagesAllowance: PLAN_LIMITS.free,
      imagesUsed: 0,
      imagesUsedAllTime: 0,
      createdAt: serverTimestamp(),
      lastLoginAt: serverTimestamp(),
      planStartDate: serverTimestamp(),
      planRenewalDate: renewalDate
    });
  } else {
    await updateDoc(ref, { lastLoginAt: serverTimestamp() });
  }
}

export async function signInWithGoogle() {
  const provider = new GoogleAuthProvider();
  const result = await signInWithPopup(auth, provider);
  await ensureUserDoc(result.user);
  return result.user;
}

export async function signInWithFacebook() {
  const provider = new FacebookAuthProvider();
  const result = await signInWithPopup(auth, provider);
  await ensureUserDoc(result.user);
  return result.user;
}

export async function logout() {
  await signOut(auth);
}

export async function getUserData(uid) {
  const snap = await getDoc(doc(db, "users", uid));
  return snap.exists() ? snap.data() : null;
}

export async function canGenerate(uid) {
  const data = await getUserData(uid);
  if (!data) return false;
  return data.imagesUsed < data.imagesAllowance;
}

export async function consumeImage(uid) {
  const ref = doc(db, "users", uid);
  const snap = await getDoc(ref);
  if (!snap.exists()) return;
  const { imagesUsed, imagesUsedAllTime } = snap.data();
  await updateDoc(ref, {
    imagesUsed: imagesUsed + 1,
    imagesUsedAllTime: (imagesUsedAllTime || 0) + 1
  });
}

export async function upgradePlan(uid, newPlan) {
  const ref = doc(db, "users", uid);
  const renewalDate = new Date();
  renewalDate.setDate(renewalDate.getDate() + 30);
  await updateDoc(ref, {
    plan: newPlan,
    imagesAllowance: PLAN_LIMITS[newPlan] || PLAN_LIMITS.free,
    imagesUsed: 0,
    planStartDate: serverTimestamp(),
    planRenewalDate: renewalDate
  });
}

export { onAuthStateChanged, auth, PLAN_LIMITS };
