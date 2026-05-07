import { useEffect, useRef } from "react";
import { Chat } from "./components/chat";
import { Home } from "./components/home";
import { Navigate, Route, Routes } from "react-router-dom";
import { ConferenceRoom } from "./components/conferenceRoom";
import { getFcmToken } from "./lib/firebaseMessaging";

function App() {
  const socketRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    const wsUrl = import.meta.env.VITE_WS_URL || "ws://localhost:8080";
    const socket = new WebSocket(wsUrl);

    socketRef.current = socket;

    return () => {
      socket.close();

      if (socketRef.current === socket) {
        socketRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    const socket = socketRef.current;
    if (!socket) return;

    let userId = localStorage.getItem("chat_userId");
    if (!userId) {
      userId = Math.random().toString(36).substring(2, 15);
      localStorage.setItem("chat_userId", userId);
    }

    const registerToken = async () => {
      try {
        const token = await getFcmToken();
        if (!token) return;

        const sendToken = () => {
          if (socket.readyState !== WebSocket.OPEN) return;

          socket.send(
            JSON.stringify({
              type: "notifications:register-token",
              payload: {
                userId,
                token,
              },
            }),
          );
        };

        if (socket.readyState === WebSocket.OPEN) {
          sendToken();
          return;
        }

        if (socket.readyState === WebSocket.CONNECTING) {
          socket.addEventListener("open", sendToken, { once: true });
        }
      } catch (error) {
        console.error("Unable to register push token:", error);
      }
    };

    void registerToken();
  }, []);

  return (
    <div className="min-h-screen w-full bg-white">
      <div className="mx-auto min-h-screen w-full max-w-6xl px-4 py-4 sm:px-6 sm:py-6">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/chat/:chatId" element={<Chat socketRef={socketRef} />} />
          <Route path="/room/:chatId" element={<ConferenceRoom socketRef={socketRef} />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </div>
    </div>
  );
}

export default App;
