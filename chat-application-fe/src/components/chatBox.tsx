
export const ChatBox = ({
    message,
    sender,
}: {
    message: string;
    sender: "self" | "other";
}) => {
    const isSelf = sender === "self";

    return (
        <div className={`flex ${isSelf ? "justify-end" : "justify-start"} mb-3`}>
            <div
                className={`w-fit max-w-sm px-4 py-3 rounded-2xl text-white ${
                    isSelf
                        ? "bg-purple-700 rounded-br-sm"
                        : "bg-gray-600 rounded-bl-sm"
                }`}
            >
                {message}
            </div>
        </div>
    );
};