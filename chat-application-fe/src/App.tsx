import { useState } from "react";
import { Chat } from "./components/chat";
import { Home } from "./components/home";
import { SideBar } from "./components/sideBar";

import { Navigate, Route, Routes } from "react-router-dom";

function App() {
  const [chatId , setChatId] = useState<string>("");

  return (
    <div className="flex min-h-screen w-full">
      <div className="w-1/5 border-r p-4">
        <SideBar chatId={chatId} setChatId={setChatId} />
      </div>

      <div className="w-4/5 p-6">
        <Routes>
          <Route path="/" element={<Home />} /> 
          <Route path="/chat/:chatId" element={<Chat />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </div>
    </div>
  );
}

export default App;
