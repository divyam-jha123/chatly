import { initializeApp } from "firebase/app";
import { getMessaging, getToken, isSupported } from "firebase/messaging";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

const vapidKey = import.meta.env.VITE_FIREBASE_VAPID_KEY;

function hasMessagingEnvConfig() {
  return (
    !!firebaseConfig.apiKey &&
    !!firebaseConfig.projectId &&
    !!firebaseConfig.messagingSenderId &&
    !!firebaseConfig.appId &&
    !!vapidKey
  );
}

const firebaseApp = initializeApp(firebaseConfig);

export async function getFcmToken() {
  if (!hasMessagingEnvConfig()) {
    console.warn("FCM env vars are missing. Skipping push setup.");
    return null;
  }

  const supported = await isSupported();
  if (!supported) return null;

  if (!("Notification" in window)) return null;

  const permission = await Notification.requestPermission();
  if (permission !== "granted") return null;

  if (!("serviceWorker" in navigator)) return null;

  const swUrl = `/firebase-messaging-sw.js?apiKey=${encodeURIComponent(firebaseConfig.apiKey ?? "")}&authDomain=${encodeURIComponent(firebaseConfig.authDomain ?? "")}&projectId=${encodeURIComponent(firebaseConfig.projectId ?? "")}&storageBucket=${encodeURIComponent(firebaseConfig.storageBucket ?? "")}&messagingSenderId=${encodeURIComponent(firebaseConfig.messagingSenderId ?? "")}&appId=${encodeURIComponent(firebaseConfig.appId ?? "")}`;
  const serviceWorkerRegistration = await navigator.serviceWorker.register(swUrl);

  const messaging = getMessaging(firebaseApp);
  const fcmToken = await getToken(messaging, {
    vapidKey,
    serviceWorkerRegistration,
  });

  return fcmToken || null;
}
