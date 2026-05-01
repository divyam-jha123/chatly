import { Chat } from "./components/chat";
import { Home } from "./components/home";

import { Navigate, Route, Routes } from "react-router-dom";
import { ConferenceRoom } from "./components/conferenceRoom";

function App() {
  return (
    <div className="min-h-screen w-full bg-white">
      <div className="mx-auto min-h-screen w-full max-w-6xl px-4 py-4 sm:px-6 sm:py-6">
        <Routes>
          <Route path="/" element={<Home />} /> 
          <Route path="/chat/:chatId" element={<Chat />} />
          <Route path="/room/:roomId" element={<ConferenceRoom />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </div>
    </div>
  );
}

export default App;
