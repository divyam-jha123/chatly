import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { Device } from "mediasoup-client";
import { MicIcon, MicOffIcon, CameraIcon, CameraOffIcon } from "../icons";

interface JoinRoomResponse {
    roomId: string;
    routerRtpCapabilities: Record<string, unknown>;
    existingProducers: Array<{
        producerId: string;
        peerId: string;
        kind: string;
    }>;
}

interface TransportResponse {
    id: string;
    iceParameters: Record<string, unknown>;
    iceCandidates: Array<Record<string, unknown>>;
    dtlsParameters: Record<string, unknown>;
}

interface ProduceResponse {
    producerId: string;
}

interface ConsumeResponse {
    id: string;
    producerId: string;
    producerPeerId: string;
    kind: "audio" | "video";
    rtpParameters: Record<string, unknown>;
}

interface SfuEventMessage {
    type: "event";
    event: string;
    data: Record<string, unknown>;
}

interface SfuResponseMessage {
    type: "response";
    requestId?: string;
    ok: boolean;
    data: unknown;
}

type SendTransport = ReturnType<Device["createSendTransport"]>;
type RecvTransport = ReturnType<Device["createRecvTransport"]>;
type ProducerType = Awaited<ReturnType<SendTransport["produce"]>>;
type ConsumerType = Awaited<ReturnType<RecvTransport["consume"]>>;
type RemoteParticipant = {
    peerId: string;
    stream: MediaStream;
};

const RemoteVideoTile = ({
    peerId,
    stream,
    className,
}: {
    peerId: string;
    stream: MediaStream;
    className: string;
}) => {
    const videoRef = useRef<HTMLVideoElement | null>(null);

    useEffect(() => {
        if (videoRef.current) {
            videoRef.current.srcObject = stream;
        }
    }, [stream]);

    return (
        <div className={`relative w-full overflow-hidden rounded-2xl border border-gray-200 bg-black ${className}`}>
            <video ref={videoRef} className="h-full w-full object-cover" autoPlay playsInline />
            <div className="absolute left-3 top-3 rounded-full bg-black/60 px-3 py-1 text-xs text-white">
                Guest {peerId.slice(0, 6)}
            </div>
        </div>
    );
};

function getConferencePeerId(roomId: string) {
    const storageKey = `conference_peer_id:${roomId}`;
    let peerId = sessionStorage.getItem(storageKey);

    if (!peerId) {
        peerId = crypto.randomUUID();
        sessionStorage.setItem(storageKey, peerId);
    }

    return peerId;
}

export const ConferenceRoom = () => {
    const { chatId } = useParams();
    const localVideo = useRef<HTMLVideoElement | null>(null);
    const localStreamRef = useRef<MediaStream | null>(null);
    const sfuSocketRef = useRef<WebSocket | null>(null);
    const deviceRef = useRef<Device | null>(null);
    const sendTransportRef = useRef<SendTransport | null>(null);
    const recvTransportRef = useRef<RecvTransport | null>(null);
    const producersRef = useRef<Map<string, ProducerType>>(new Map());
    const consumersRef = useRef<Map<string, ConsumerType>>(new Map());
    const consumerPeerMapRef = useRef(new Map<string, string>());
    const remoteParticipantsRef = useRef<Map<string, MediaStream>>(new Map());
    const pendingRequestsRef = useRef(
        new Map<string, { resolve: (value: any) => void; reject: (reason?: unknown) => void }>(),
    );
    const activeProducerIdsRef = useRef(new Set<string>());
    const joinedConferenceRef = useRef(false);
    const [isJoining, setIsJoining] = useState(false);
    const [hasJoinedConference, setHasJoinedConference] = useState(false);
    const [isMuted, setIsMuted] = useState(false);
    const [isCameraOff, setIsCameraOff] = useState(false);
    const [remoteParticipants, setRemoteParticipants] = useState<RemoteParticipant[]>([]);
    const peerId = useRef(chatId ? getConferencePeerId(chatId) : crypto.randomUUID()).current;
    const totalParticipantTiles = remoteParticipants.length + 1;

    const getVideoTileClassName = () => {
        if (totalParticipantTiles <= 2) {
            return "h-[260px] md:basis-[calc((100%-1rem)/2)] md:h-full";
        }

        if (totalParticipantTiles <= 4) {
            return "h-[260px] md:basis-[calc((100%-1rem)/2)] md:h-[calc((100%-1rem)/2)]";
        }

        return "h-[260px] md:basis-[calc((100%-2rem)/3)] md:h-[calc((100%-1rem)/2)]";
    };

    const videoTileClassName = getVideoTileClassName();

    const sendRequest = async <T,>(action: string, data: Record<string, unknown>) => {
        const socket = sfuSocketRef.current;
        if (!socket || socket.readyState !== WebSocket.OPEN) {
            throw new Error("SFU socket is not connected");
        }

        const requestId = crypto.randomUUID();

        return await new Promise<T>((resolve, reject) => {
            pendingRequestsRef.current.set(requestId, { resolve, reject });

            socket.send(
                JSON.stringify({
                    action,
                    requestId,
                    data,
                }),
            );
        });
    };

    const attachLocalVideo = () => {
        if (localVideo.current && localStreamRef.current) {
            localVideo.current.srcObject = localStreamRef.current;
        }
    };

    const syncRemoteParticipants = () => {
        setRemoteParticipants(
            Array.from(remoteParticipantsRef.current.entries()).map(([remotePeerId, stream]) => ({
                peerId: remotePeerId,
                stream,
            })),
        );
    };

    const addRemoteTrack = (remotePeerId: string, track: MediaStreamTrack) => {
        const participantStream = remoteParticipantsRef.current.get(remotePeerId) ?? new MediaStream();
        participantStream.addTrack(track);
        remoteParticipantsRef.current.set(remotePeerId, participantStream);
        syncRemoteParticipants();
    };

    const removeRemoteTrack = (remotePeerId: string, track: MediaStreamTrack) => {
        const participantStream = remoteParticipantsRef.current.get(remotePeerId);
        if (!participantStream) return;

        participantStream.removeTrack(track);

        if (participantStream.getTracks().length === 0) {
            remoteParticipantsRef.current.delete(remotePeerId);
        }

        syncRemoteParticipants();
    };

    const startMedia = async () => {
        if (localStreamRef.current) {
            attachLocalVideo();
            return localStreamRef.current;
        }

        const mediaStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        localStreamRef.current = mediaStream;
        attachLocalVideo();
        return mediaStream;
    };

    const toggleMic = () => {
        const stream = localStreamRef.current;
        if (!stream) return;

        stream.getAudioTracks().forEach((track) => {
            track.enabled = !track.enabled;
        });

        setIsMuted((prev) => !prev);
    };

    const toggleCamera = () => {
        const stream = localStreamRef.current;
        if (!stream) return;

        stream.getVideoTracks().forEach((track) => {
            track.enabled = !track.enabled;
        });

        setIsCameraOff((prev) => !prev);
    };

    const connectSfuSocket = async () => {
        if (sfuSocketRef.current?.readyState === WebSocket.OPEN) {
            return sfuSocketRef.current;
        }

        const sfuWsUrl = import.meta.env.VITE_SFU_WS_URL || "ws://localhost:4000";

        return await new Promise<WebSocket>((resolve, reject) => {
            const socket = new WebSocket(sfuWsUrl);

            socket.onopen = () => {
                sfuSocketRef.current = socket;
                resolve(socket);
            };

            socket.onerror = () => {
                reject(new Error("Failed to connect to SFU server"));
            };
        });
    };

    const consumeProducer = async (producerId: string, producerPeerId: string) => {
        if (!chatId || !deviceRef.current || !recvTransportRef.current) return;
        if (activeProducerIdsRef.current.has(producerId)) return;

        activeProducerIdsRef.current.add(producerId);

        try {
            const consumerInfo = await sendRequest<ConsumeResponse>("consume", {
                roomId: chatId,
                peerId,
                producerId,
                producerPeerId,
                transportId: recvTransportRef.current.id,
                rtpCapabilities: deviceRef.current.rtpCapabilities,
            });

            const consumer = await recvTransportRef.current.consume({
                id: consumerInfo.id,
                producerId: consumerInfo.producerId,
                kind: consumerInfo.kind,
                rtpParameters: consumerInfo.rtpParameters as any,
            });

            consumersRef.current.set(consumer.id, consumer);
            consumerPeerMapRef.current.set(consumer.id, producerPeerId);
            addRemoteTrack(producerPeerId, consumer.track);

            consumer.on("transportclose", () => {
                removeRemoteTrack(producerPeerId, consumer.track);
                consumerPeerMapRef.current.delete(consumer.id);
                consumersRef.current.delete(consumer.id);
            });

            await sendRequest("resumeConsumer", {
                peerId,
                consumerId: consumer.id,
            });
        } finally {
            activeProducerIdsRef.current.delete(producerId);
        }
    };

    const setupSendTransport = async (device: Device) => {
        if (!chatId) throw new Error("Missing room id");

        const transportInfo = await sendRequest<TransportResponse>("createWebRtcTransport", {
            roomId: chatId,
            peerId,
            direction: "send",
        });

        const transport = device.createSendTransport(transportInfo as any);

        transport.on("connect", async ({ dtlsParameters }, callback, errback) => {
            try {
                await sendRequest("connectTransport", {
                    peerId,
                    transportId: transport.id,
                    dtlsParameters,
                });
                callback();
            } catch (error) {
                errback(error as Error);
            }
        });

        transport.on("produce", async ({ kind, rtpParameters, appData }, callback, errback) => {
            try {
                const response = await sendRequest<ProduceResponse>("produce", {
                    peerId,
                    transportId: transport.id,
                    kind,
                    rtpParameters,
                    appData,
                });
                callback({ id: response.producerId });
            } catch (error) {
                errback(error as Error);
            }
        });

        transport.on("connectionstatechange", (state) => {
            console.log("Send transport state:", state);
        });

        sendTransportRef.current = transport;
        return transport;
    };

    const setupRecvTransport = async (device: Device) => {
        if (!chatId) throw new Error("Missing room id");

        const transportInfo = await sendRequest<TransportResponse>("createWebRtcTransport", {
            roomId: chatId,
            peerId,
            direction: "recv",
        });

        const transport = device.createRecvTransport(transportInfo as any);

        transport.on("connect", async ({ dtlsParameters }, callback, errback) => {
            try {
                await sendRequest("connectTransport", {
                    peerId,
                    transportId: transport.id,
                    dtlsParameters,
                });
                callback();
            } catch (error) {
                errback(error as Error);
            }
        });

        transport.on("connectionstatechange", (state) => {
            console.log("Recv transport state:", state);
        });

        recvTransportRef.current = transport;
        return transport;
    };

    const produceLocalTracks = async () => {
        const stream = localStreamRef.current;
        const transport = sendTransportRef.current;

        if (!stream || !transport) return;

        for (const track of stream.getTracks()) {
            const producer = await transport.produce({
                track,
                appData: {
                    mediaTag: track.kind,
                },
            });

            producersRef.current.set(producer.id, producer);

            producer.on("trackended", () => {
                producer.close();
                producersRef.current.delete(producer.id);
            });

            producer.on("transportclose", () => {
                producersRef.current.delete(producer.id);
            });
        }
    };

    const handleSfuMessage = async (event: MessageEvent<string>) => {
        const message = JSON.parse(event.data) as SfuResponseMessage | SfuEventMessage;

        if (message.type === "response") {
            const requestId = message.requestId;
            if (!requestId) return;

            const pendingRequest = pendingRequestsRef.current.get(requestId);
            if (!pendingRequest) return;

            pendingRequestsRef.current.delete(requestId);

            if (message.ok) {
                pendingRequest.resolve(message.data);
            } else {
                const errorMessage =
                    typeof message.data === "object" &&
                    message.data &&
                    "message" in message.data
                        ? String(message.data.message)
                        : "SFU request failed";
                pendingRequest.reject(new Error(errorMessage));
            }

            return;
        }

        if (message.event === "producerAdded") {
            const producerId = String(message.data.producerId ?? "");
            const producerPeerId = String(message.data.peerId ?? "");

            if (producerId && producerPeerId && producerPeerId !== peerId) {
                await consumeProducer(producerId, producerPeerId);
            }
        }

        if (message.event === "producerClosed") {
            const producerId = String(message.data.producerId ?? "");

            for (const consumer of consumersRef.current.values()) {
                if (consumer.producerId === producerId) {
                    const remotePeerId = consumerPeerMapRef.current.get(consumer.id);
                    if (remotePeerId) {
                        removeRemoteTrack(remotePeerId, consumer.track);
                    }
                    consumerPeerMapRef.current.delete(consumer.id);
                    consumersRef.current.delete(consumer.id);
                    consumer.close();
                    break;
                }
            }
        }

        if (message.event === "consumerClosed") {
            const consumerId = String(message.data.consumerId ?? "");
            const consumer = consumersRef.current.get(consumerId);

            if (consumer) {
                const remotePeerId = consumerPeerMapRef.current.get(consumerId);
                if (remotePeerId) {
                    removeRemoteTrack(remotePeerId, consumer.track);
                }
                consumerPeerMapRef.current.delete(consumerId);
                consumersRef.current.delete(consumerId);
                consumer.close();
            }
        }
    };

    const joinConference = async () => {
        if (!chatId || hasJoinedConference || isJoining) return;

        setIsJoining(true);

        try {
            await startMedia();
            const socket = await connectSfuSocket();
            socket.onmessage = (event) => {
                void handleSfuMessage(event);
            };

            const joinResponse = await sendRequest<JoinRoomResponse>("joinRoom", {
                roomId: chatId,
                peerId,
            });

            const device = new Device();
            await device.load({
                routerRtpCapabilities: joinResponse.routerRtpCapabilities as any,
            });
            deviceRef.current = device;

            await setupSendTransport(device);
            await setupRecvTransport(device);
            await produceLocalTracks();

            for (const producer of joinResponse.existingProducers) {
                await consumeProducer(producer.producerId, producer.peerId);
            }

            joinedConferenceRef.current = true;
            setHasJoinedConference(true);
        } catch (error) {
            console.error("Failed to join SFU conference", error);
        } finally {
            setIsJoining(false);
        }
    };

    useEffect(() => {
        void startMedia();
    }, []);

    useEffect(() => {
        attachLocalVideo();
    }, [hasJoinedConference]);

    useEffect(() => {
        return () => {
            if (joinedConferenceRef.current && sfuSocketRef.current?.readyState === WebSocket.OPEN) {
                sfuSocketRef.current.send(
                    JSON.stringify({
                        action: "leaveRoom",
                        data: {
                            roomId: chatId,
                            peerId,
                        },
                    }),
                );
            }

            for (const consumer of consumersRef.current.values()) {
                consumer.close();
            }
            consumerPeerMapRef.current.clear();
            remoteParticipantsRef.current.clear();
            setRemoteParticipants([]);

            for (const producer of producersRef.current.values()) {
                producer.close();
            }

            sendTransportRef.current?.close();
            recvTransportRef.current?.close();
            sfuSocketRef.current?.close();
            sfuSocketRef.current = null;

            if (localStreamRef.current) {
                localStreamRef.current.getTracks().forEach((track) => {
                    track.stop();
                });
                localStreamRef.current = null;
            }
        };
    }, [chatId, peerId]);

    return (
        <div className="mx-auto flex h-[calc(100vh-2rem)] w-full max-w-5xl flex-col gap-4">
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

            {!hasJoinedConference ? (
                <div className="grid gap-4 md:grid-cols-2">
                    <div className="flex flex-col gap-3">
                        <div className="relative overflow-hidden rounded-2xl border border-gray-200 bg-black">
                            <video className="h-[260px] w-full object-cover md:h-[420px]" autoPlay muted playsInline ref={localVideo} />
                            {isCameraOff && (
                                <div className="absolute inset-0 flex items-center justify-center bg-gray-900">
                                    <span className="text-sm text-gray-400">Camera Off</span>
                                </div>
                            )}
                        </div>
                        <div className="flex items-center justify-center gap-3">
                            <button
                                onClick={toggleMic}
                                className={`flex h-12 w-12 items-center justify-center rounded-full border cursor-pointer transition-colors ${isMuted
                                    ? "border-red-300 bg-red-50 text-red-600 hover:bg-red-100"
                                    : "border-gray-300 bg-white text-gray-700 hover:bg-gray-100"
                                    }`}
                                title={isMuted ? "Unmute" : "Mute"}
                            >
                                {isMuted ? <MicOffIcon /> : <MicIcon />}
                            </button>
                            <button
                                onClick={toggleCamera}
                                className={`flex h-12 w-12 items-center justify-center rounded-full border cursor-pointer transition-colors ${isCameraOff
                                    ? "border-red-300 bg-red-50 text-red-600 hover:bg-red-100"
                                    : "border-gray-300 bg-white text-gray-700 hover:bg-gray-100"
                                    }`}
                                title={isCameraOff ? "Turn Camera On" : "Turn Camera Off"}
                            >
                                {isCameraOff ? <CameraOffIcon /> : <CameraIcon />}
                            </button>
                        </div>
                    </div>
                    <div className="hidden md:block" />
                </div>
            ) : (
                <div className="flex min-h-0 flex-1 flex-col gap-4">
                    <div className="flex min-h-0 flex-1 flex-wrap content-center items-center justify-center gap-2 overflow-y-auto">
                        <div className={`relative w-full overflow-hidden rounded-2xl border border-gray-200 bg-black ${videoTileClassName}`}>
                            <video className="h-full w-full object-cover" autoPlay muted playsInline ref={localVideo} />
                            <div className="absolute left-3 top-3 rounded-full bg-black/60 px-3 py-1 text-xs text-white">
                                You
                            </div>
                            {isCameraOff && (
                                <div className="absolute inset-0 flex items-center justify-center bg-gray-900">
                                    <span className="text-sm text-gray-400">Camera Off</span>
                                </div>
                            )}
                        </div>
                        {remoteParticipants.length > 0 ? (
                            remoteParticipants.map((participant) => (
                                <RemoteVideoTile
                                    key={participant.peerId}
                                    peerId={participant.peerId}
                                    stream={participant.stream}
                                    className={videoTileClassName}
                                />
                            ))
                        ) : (
                            <div className={`flex w-full items-center justify-center rounded-2xl border border-gray-200 bg-gray-50 text-sm text-gray-500 ${videoTileClassName}`}>
                                Waiting for other participants...
                            </div>
                        )}
                    </div>

                    <div className="shrink-0 flex items-center justify-center gap-3 rounded-2xl border border-gray-200 bg-white px-4 py-4">
                        <button
                            onClick={toggleMic}
                            className={`flex h-12 w-12 items-center justify-center rounded-full border cursor-pointer transition-colors ${isMuted
                                ? "border-red-300 bg-red-50 text-red-600 hover:bg-red-100"
                                : "border-gray-300 bg-white text-gray-700 hover:bg-gray-100"
                                }`}
                            title={isMuted ? "Unmute" : "Mute"}
                        >
                            {isMuted ? <MicOffIcon /> : <MicIcon />}
                        </button>
                        <button
                            onClick={toggleCamera}
                            className={`flex h-12 w-12 items-center justify-center rounded-full border cursor-pointer transition-colors ${isCameraOff
                                ? "border-red-300 bg-red-50 text-red-600 hover:bg-red-100"
                                : "border-gray-300 bg-white text-gray-700 hover:bg-gray-100"
                                }`}
                            title={isCameraOff ? "Turn Camera On" : "Turn Camera Off"}
                        >
                            {isCameraOff ? <CameraOffIcon /> : <CameraIcon />}
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
};
