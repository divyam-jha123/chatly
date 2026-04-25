import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { ChatBox } from "./chatBox";

interface ChatMessage {
  text: string;
  sender: "self" | "other";
}

export const Chat = () => {
  const { chatId } = useParams();
  const socketRef = useRef<WebSocket | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // on new ws conenction
  useEffect(() => {
    if (!chatId) return;

    let userId = localStorage.getItem("chat_userId");
    if (!userId) {
      userId = Math.random().toString(36).substring(2, 15);
      localStorage.setItem("chat_userId", userId);
    }

    const wsUrl = import.meta.env.VITE_WS_URL || "ws://localhost:8080";
    const socket = new WebSocket(wsUrl);
    socketRef.current = socket;

    socket.onopen = () => {
      console.log("connected to the ws server");
      console.log(chatId);

      socket.send(
        JSON.stringify({
          type: "join",
          payload: {
            roomId: chatId,
            userId: userId,
          },
        }),
      );
    };

    socket.onmessage = (event) => {
      const parsedData = JSON.parse(event.data);

      // load chat history on join
      if (parsedData.type === "history") {
        const history: ChatMessage[] = parsedData.payload.map(
          (msg: { message: string; sender: string }) => ({
            text: msg.message,
            sender: msg.sender === "self" ? "self" : "other",
          }),
        );
        setMessages(history);
        return;
      }

      // real-time incoming message
      const incomingMessage = parsedData?.payload?.message;
      const sender: "self" | "other" =
        parsedData?.payload?.sender === "self" ? "self" : "other";

      if (typeof incomingMessage === "string") {
        setMessages((prev) => [...prev, { text: incomingMessage, sender }]);
      }
    };

    return () => {
      socket.close();
    };
  }, [chatId]);

    function SendMessage() {
        if (!input || !socketRef.current || !chatId) return;

        socketRef.current.send(
        JSON.stringify({
            type: "chat",
            payload: {
                roomId: chatId,
                message: input,
            },
        }),
    );

    setInput("");
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto p-4 flex flex-col justify-end">
        {messages.map((msg, idx) => (
            <ChatBox key={`${msg.text} -- ${idx}`} message={msg.text} sender={msg.sender} />
        ))}
        <div ref={messagesEndRef} />
      </div>
      <div className="flex gap-2 p-4">
        <input
          value={input}
          type="text"
          placeholder="messages..."
          onChange={(e) => {
            setInput(e.target.value);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") SendMessage();
          }}
          className="border border-gray-300 rounded-md p-2 w-full"
        />
        <button onClick={SendMessage} className="border border-gray-300 rounded-md p-2 cursor-pointer">send</button>
      </div>
    </div>
  );
};
