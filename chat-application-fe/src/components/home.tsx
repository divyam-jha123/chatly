import { useState } from "react";
import { useNavigate } from "react-router-dom";

export const Home = () => {
    const navigate = useNavigate();
    const [roomId, setRoomId] = useState("");

    function enterRoom() {
        const trimmedRoomId = roomId.trim();

        if (!trimmedRoomId) return;

        navigate(`/chat/${trimmedRoomId}`);
    }

    return (
        <div className="flex min-h-[calc(100vh-2rem)] items-center justify-center">
            <div className="w-full max-w-md border border-gray-300 rounded-2xl p-6 shadow-sm sm:p-8">
                <h1 className="text-2xl font-bold mb-2">Join a room</h1>
                <p className="text-gray-600 mb-6">Enter your room ID to continue to the chat.</p>
                <div className="flex flex-col gap-3">
                    <input
                        value={roomId}
                        type="text"
                        placeholder="Enter room ID"
                        className="w-full border border-gray-300 rounded-md p-3"
                        onChange={(e) => {
                            setRoomId(e.target.value);
                        }}
                        onKeyDown={(e) => {
                            if (e.key === "Enter") enterRoom();
                        }}
                    />
                    <button
                        className="border border-gray-300 rounded-md p-3 cursor-pointer"
                        onClick={enterRoom}
                    >
                        Enter
                    </button>
                </div>
            </div>
        </div>
    );
};
