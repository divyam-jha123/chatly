import { initializeApp, cert, type ServiceAccount } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getMessaging } from "firebase-admin/messaging";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load your service account key JSON file
// Place it at chat-be/serviceAccountKey.json
const serviceAccountPath = resolve(__dirname, "../serviceAccountKey.json");

let serviceAccount: ServiceAccount;
try {
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT) as ServiceAccount;
  } else {
    serviceAccount = JSON.parse(
      readFileSync(serviceAccountPath, "utf-8"),
    ) as ServiceAccount;
  }
} catch {
  console.error(
    "❌ Could not find serviceAccountKey.json at:",
    serviceAccountPath,
  );
  console.error(
    "   Download it from Firebase Console → Project Settings → Service Accounts → Generate New Private Key",
  );
  process.exit(1);
}

const app = initializeApp({
  credential: cert(serviceAccount),
});

export const db = getFirestore(app);
export const messaging = getMessaging(app);
