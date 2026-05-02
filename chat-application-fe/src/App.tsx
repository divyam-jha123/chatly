import { useEffect, useRef } from "react";
import { Chat } from "./components/chat";
import { Home } from "./components/home";
import { Navigate, Route, Routes } from "react-router-dom";
import { ConferenceRoom } from "./components/conferenceRoom";

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
