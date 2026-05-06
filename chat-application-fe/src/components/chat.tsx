import { useEffect, useRef, useState, type MutableRefObject } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ChatBox } from "./chatBox";

interface ChatMessage {
  text: string;
  sender: "self" | "other";
}

const TopBar = () => {
  const { chatId } = useParams();
  const navigate = useNavigate();
  return (
    <div className="flex items-center justify-between gap-3 border-b border-gray-200 bg-white px-4 py-3 sm:px-6">
      <div className="min-w-0 px-2 py-2">
        <div className="font-bold text-lg">chatly</div>
        <div className="text-sm text-gray-500 truncate">Room: {chatId}</div>
      </div>
      <button className="shrink-0 border border-blue-600 bg-blue-600 text-white rounded-md cursor-pointer px-3 py-2 sm:px-4" onClick={() => {
        navigate(`/room/${chatId}`)
      }}>join call</button>
    </div>
  )
}

export const Chat = ({socketRef}: {socketRef: MutableRefObject<WebSocket | null>}) => {
  const { chatId } = useParams();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    if (!chatId) return;

    let userId = localStorage.getItem("chat_userId");
    if (!userId) {
      userId = Math.random().toString(36).substring(2, 15);
      localStorage.setItem("chat_userId", userId);
    }

    const socket = socketRef.current;
    if (!socket) return;

    setMessages([]);

    const sendJoin = () => {
      if (socket.readyState !== WebSocket.OPEN) return;

      socket.send(
        JSON.stringify({
          type: "join",
          payload: {
            roomId: chatId,
            userId,
          },
        }),
      );
    };

    const handleOpen = () => {
      console.log("connected to the ws server");
      console.log(chatId);
      sendJoin();
    };

    if (socket.readyState === WebSocket.OPEN) {
      sendJoin();
    } else if (socket.readyState === WebSocket.CONNECTING) {
      socket.addEventListener("open", handleOpen);
    }

    const handleMessage = (event: MessageEvent<string>) => {
      const parsedData = JSON.parse(event.data);

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

      const incomingMessage = parsedData?.payload?.message;
      const sender: "self" | "other" =
        parsedData?.payload?.sender === "self" ? "self" : "other";

      if (typeof incomingMessage === "string") {
        setMessages((prev) => [...prev, { text: incomingMessage, sender }]);
      }
    };

    socket.addEventListener("message", handleMessage);

    return () => {
      socket.removeEventListener("open", handleOpen);
      socket.removeEventListener("message", handleMessage);
    };
  }, [chatId, socketRef]);

  function SendMessage() {
    if (!input || !socketRef.current || !chatId) return;
    if (socketRef.current.readyState !== WebSocket.OPEN) return;

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
    <div className="mx-auto flex h-[calc(100vh-2rem)] w-full max-w-4xl flex-col overflow-hidden bg-white">
      <TopBar />
      <div className="flex-1 overflow-y-auto px-3 py-4 sm:px-6">
        {messages.map((msg, idx) => (
          <ChatBox key={`${msg.text} -- ${idx}`} message={msg.text} sender={msg.sender} />
        ))}
        <div ref={messagesEndRef} />
      </div>
      <div className="border-t border-gray-200 bg-white px-3 py-3 sm:px-6">
        <div className="flex items-center gap-2">
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
          className="w-full border border-gray-300 rounded-md p-3"
        />
        <button onClick={SendMessage} className="shrink-0 border border-gray-300 rounded-md px-4 py-3 cursor-pointer">send</button>
        </div>
      </div>
    </div>
  );
};
