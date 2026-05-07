importScripts("https://www.gstatic.com/firebasejs/12.4.0/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/12.4.0/firebase-messaging-compat.js");

const queryParams = new URL(self.location.href).searchParams;

firebase.initializeApp({
  apiKey: queryParams.get("apiKey") || "",
  authDomain: queryParams.get("authDomain") || "",
  projectId: queryParams.get("projectId") || "",
  storageBucket: queryParams.get("storageBucket") || "",
  messagingSenderId: queryParams.get("messagingSenderId") || "",
  appId: queryParams.get("appId") || "",
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  const title = payload.notification?.title || "New message";
  const options = {
    body: payload.notification?.body || "You received a new message.",
    data: payload.data || {},
  };

  self.registration.showNotification(title, options);
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const roomId = event.notification.data?.roomId;
  const targetPath = roomId ? `/chat/${roomId}` : "/";

  event.waitUntil(
    (async () => {
      const allClients = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });

      for (const client of allClients) {
        const clientUrl = new URL(client.url);
        const sameOrigin = clientUrl.origin === self.location.origin;
        if (!sameOrigin) continue;

        if ("focus" in client) {
          if ("navigate" in client && clientUrl.pathname !== targetPath) {
            await client.navigate(targetPath);
          }
          await client.focus();
          return;
        }
      }

      if ("openWindow" in self.clients) {
        await self.clients.openWindow(targetPath);
      }
    })(),
  );
});
