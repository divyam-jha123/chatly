import { useEffect, useRef, useState, type MutableRefObject } from "react";
import { useParams } from "react-router-dom";

interface ConferenceRoomProps {
    socketRef: MutableRefObject<WebSocket | null>;
}

interface ConferenceParticipantsPayload {
    roomId: string;
    participants: string[];
}

interface ConferenceOfferPayload {
    roomId: string;
    fromUserId: string;
    offer: RTCSessionDescriptionInit;
}

interface ConferenceAnswerPayload {
    roomId: string;
    fromUserId: string;
    answer: RTCSessionDescriptionInit;
}

interface ConferenceIcePayload {
    roomId: string;
    fromUserId: string;
    candidate: RTCIceCandidateInit;
}

export const ConferenceRoom = ({ socketRef }: ConferenceRoomProps) => {
    const localVideo = useRef<HTMLVideoElement | null>(null);
    const remoteVideo = useRef<HTMLVideoElement | null>(null);
    const localStreamRef = useRef<MediaStream | null>(null);
    const peerConnectionsRef = useRef<Map<string, RTCPeerConnection>>(new Map());
    const pendingIceCandidatesRef = useRef<Map<string, RTCIceCandidateInit[]>>(new Map());
    const openListenerRef = useRef<(() => void) | null>(null);
    const joinedConferenceRef = useRef(false);
    const { chatId } = useParams();
    const [isJoining, setIsJoining] = useState(false);
    const [hasJoinedConference, setHasJoinedConference] = useState(false);

    const userId = (() => {
        let storedUserId = localStorage.getItem("chat_userId");

        if (!storedUserId) {
            storedUserId = Math.random().toString(36).substring(2, 15);
            localStorage.setItem("chat_userId", storedUserId);
        }

        return storedUserId;
    })();

    const flushPendingIceCandidates = async (remoteUserId: string, pc: RTCPeerConnection) => {
        const pendingCandidates = pendingIceCandidatesRef.current.get(remoteUserId) ?? [];

        for (const candidate of pendingCandidates) {
            await pc.addIceCandidate(new RTCIceCandidate(candidate));
        }

        pendingIceCandidatesRef.current.delete(remoteUserId);
    };

    const createPeerConnection = (remoteUserId: string) => {
        const existingPeerConnection = peerConnectionsRef.current.get(remoteUserId);
        if (existingPeerConnection) {
            return existingPeerConnection;
        }

        const pc = new RTCPeerConnection({
            iceServers: [
                {
                    urls: "stun:stun.l.google.com:19302",
                },
            ],
        });

        const localStream = localStreamRef.current;
        if (localStream) {
            localStream.getTracks().forEach((track) => {
                pc.addTrack(track, localStream);
            });
        }

        pc.ontrack = (event) => {
            if (remoteVideo.current) {
                remoteVideo.current.srcObject = event.streams[0];
            }
        };

        pc.onicecandidate = (event) => {
            const socket = socketRef.current;

            if (!event.candidate || !socket || socket.readyState !== WebSocket.OPEN || !chatId) {
                return;
            }

            socket.send(
                JSON.stringify({
                    type: "ice",
                    payload: {
                        roomId: chatId,
                        targetUserId: remoteUserId,
                        candidate: event.candidate.toJSON(),
                    },
                }),
            );
        };

        peerConnectionsRef.current.set(remoteUserId, pc);
        return pc;
    };

    const startMedia = async () => {
        if (localStreamRef.current) return;

        const mediaStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        localStreamRef.current = mediaStream;

        if (localVideo.current) {
            localVideo.current.srcObject = mediaStream;
        }

        return localStreamRef.current;

    };

    

    const createOfferFor = async (remoteUserId: string) => {
        if (!chatId) return;

        const socket = socketRef.current;
        if (!socket || socket.readyState !== WebSocket.OPEN) return;

        const pc = createPeerConnection(remoteUserId);
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);

        socket.send(
            JSON.stringify({
                type: "offer",
                payload: {
                    roomId: chatId,
                    targetUserId: remoteUserId,
                    offer,
                },
            }),
        );
    };

    const handleOffer = async (payload: ConferenceOfferPayload) => {
        if (!chatId) return;

        const socket = socketRef.current;
        if (!socket || socket.readyState !== WebSocket.OPEN) return;

        const pc = createPeerConnection(payload.fromUserId);
        await pc.setRemoteDescription(new RTCSessionDescription(payload.offer));
        await flushPendingIceCandidates(payload.fromUserId, pc);

        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);

        socket.send(
            JSON.stringify({
                type: "answer",
                payload: {
                    roomId: chatId,
                    targetUserId: payload.fromUserId,
                    answer,
                },
            }),
        );
    };

    const handleAnswer = async (payload: ConferenceAnswerPayload) => {
        const pc = peerConnectionsRef.current.get(payload.fromUserId);
        if (!pc) return;

        await pc.setRemoteDescription(new RTCSessionDescription(payload.answer));
        await flushPendingIceCandidates(payload.fromUserId, pc);
    };

    const handleIce = async (payload: ConferenceIcePayload) => {
        const pc = peerConnectionsRef.current.get(payload.fromUserId);
        if (!pc || !pc.remoteDescription) {
            const queuedCandidates =
                pendingIceCandidatesRef.current.get(payload.fromUserId) ?? [];
            queuedCandidates.push(payload.candidate);
            pendingIceCandidatesRef.current.set(payload.fromUserId, queuedCandidates);
            return;
        }

        await pc.addIceCandidate(new RTCIceCandidate(payload.candidate));
    };

    const joinConference = async () => {
        if (!chatId || hasJoinedConference || isJoining) return;

        setIsJoining(true);

        try {

            const ans = await startMedia();

            console.log("ans", ans);

            const socket = socketRef.current;
            if (!socket) return;

            const sendJoinMessages = () => {
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

                socket.send(
                    JSON.stringify({
                        type: "conference:join",
                        payload: {
                            roomId: chatId,
                            userId,
                        },
                    }),
                );

                setHasJoinedConference(true);
                joinedConferenceRef.current = true;
                console.log("new joined", userId);
            };

            if (socket.readyState === WebSocket.OPEN) {
                sendJoinMessages();
            } else if (socket.readyState === WebSocket.CONNECTING) {
                const handleOpen = () => {
                    sendJoinMessages();
                };

                openListenerRef.current = handleOpen;
                socket.addEventListener("open", handleOpen, { once: true });
            }
        } finally {
            setIsJoining(false);
        }
    };

    useEffect(() => {
        const socket = socketRef.current;
        if (!socket) return;

        const handleMessage = async (event: MessageEvent<string>) => {
            const data = JSON.parse(event.data);

            if (data.type === "conference:participants") {
                const payload = data.payload as ConferenceParticipantsPayload;
                if (payload.roomId !== chatId) return;

                for (const participantId of payload.participants) {
                    await createOfferFor(participantId);
                }
            }

            if (data.type === "offer") {
                const payload = data.payload as ConferenceOfferPayload;
                if (payload.roomId !== chatId) return;
                await handleOffer(payload);
            }

            if (data.type === "answer") {
                const payload = data.payload as ConferenceAnswerPayload;
                if (payload.roomId !== chatId) return;
                await handleAnswer(payload);
            }

            if (data.type === "ice") {
                const payload = data.payload as ConferenceIcePayload;
                if (payload.roomId !== chatId) return;
                await handleIce(payload);
            }
        };

        socket.addEventListener("message", handleMessage);

        return () => {
            socket.removeEventListener("message", handleMessage);
        };
    }, [chatId, socketRef]);

    useEffect(() => {
        joinedConferenceRef.current = hasJoinedConference;
    }, [hasJoinedConference]);

    useEffect(() => {
        return () => {
            const socket = socketRef.current;

            if (socket && openListenerRef.current) {
                socket.removeEventListener("open", openListenerRef.current);
            }

            if (socket && socket.readyState === WebSocket.OPEN && chatId && joinedConferenceRef.current) {
                socket.send(
                    JSON.stringify({
                        type: "conference:leave",
                        payload: {
                            roomId: chatId,
                            userId,
                        },
                    }),
                );
            }

            for (const pc of peerConnectionsRef.current.values()) {
                pc.close();
            }

            peerConnectionsRef.current.clear();
            pendingIceCandidatesRef.current.clear();

            if (localStreamRef.current) {
                localStreamRef.current.getTracks().forEach((track) => {
                    track.stop();
                });
                localStreamRef.current = null;
            }
        };
    }, [chatId, socketRef, userId]);

    return (
        <div className="mx-auto flex min-h-[calc(100vh-2rem)] w-full max-w-5xl flex-col gap-4">
            <div className="flex items-center justify-between rounded-2xl border border-gray-200 bg-white px-4 py-3">
                <div>
                    <div className="text-lg font-semibold">Conference Room</div>
                    <div className="text-sm text-gray-500">Room: {chatId}</div>
                </div>
                <button
                    className="rounded-md border border-gray-300 px-4 py-2 cursor-pointer disabled:cursor-not-allowed disabled:opacity-60"
                    onClick={joinConference}
                    disabled={isJoining || hasJoinedConference}
                >
                    {hasJoinedConference ? "Joined" : isJoining ? "Joining..." : "Join"}
                </button>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
                <div className="overflow-hidden rounded-2xl border border-gray-200 bg-black">
                    <video className="h-[260px] w-full object-cover md:h-[420px]" autoPlay muted playsInline ref={localVideo} />
                </div>
                <div className="overflow-hidden rounded-2xl border border-gray-200 bg-black">
                    <video className="h-[260px] w-full object-cover md:h-[420px]" autoPlay playsInline ref={remoteVideo} />
                </div>
            </div>
        </div>
    );
};
