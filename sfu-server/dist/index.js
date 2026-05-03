import http from "node:http";
import os from "node:os";
import process from "node:process";
import { WebSocketServer, WebSocket } from "ws";
import * as mediasoup from "mediasoup";
const PORT = Number(process.env.SFU_PORT ?? 4000);
const ANNOUNCED_IP = process.env.SFU_ANNOUNCED_IP ?? "127.0.0.1";
const MEDIASOUP_MIN_PORT = Number(process.env.MEDIASOUP_MIN_PORT ?? 40000);
const MEDIASOUP_MAX_PORT = Number(process.env.MEDIASOUP_MAX_PORT ?? 49999);
const mediaCodecs = [
    {
        kind: "audio",
        mimeType: "audio/opus",
        clockRate: 48000,
        channels: 2,
        preferredPayloadType: 111,
    },
    {
        kind: "video",
        mimeType: "video/VP8",
        clockRate: 90000,
        parameters: {},
        preferredPayloadType: 96,
    },
];
const workers = [];
const rooms = new Map();
const peers = new Map();
let nextWorkerIndex = 0;
function send(socket, payload) {
    if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify(payload));
    }
}
function sendResponse(socket, requestId, ok, data) {
    send(socket, {
        type: "response",
        requestId,
        ok,
        data,
    });
}
function sendError(socket, requestId, error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    sendResponse(socket, requestId, false, { message });
}
function sendEvent(socket, event, data) {
    send(socket, {
        type: "event",
        event,
        data,
    });
}
function getNextWorker() {
    const worker = workers[nextWorkerIndex % workers.length];
    nextWorkerIndex += 1;
    return worker;
}
async function ensureRoom(roomId) {
    const existingRoom = rooms.get(roomId);
    if (existingRoom)
        return existingRoom;
    const worker = getNextWorker();
    const router = await worker.createRouter({ mediaCodecs });
    const room = {
        id: roomId,
        router,
        peers: new Set(),
    };
    rooms.set(roomId, room);
    return room;
}
function getPeer(peerId) {
    const peer = peers.get(peerId);
    if (!peer) {
        throw new Error(`Peer ${peerId} not found`);
    }
    return peer;
}
function getTransport(peer, transportId) {
    const transport = peer.transports.get(transportId);
    if (!transport) {
        throw new Error(`Transport ${transportId} not found`);
    }
    return transport;
}
function getProducer(peerId, producerId) {
    const peer = getPeer(peerId);
    const producer = peer.producers.get(producerId);
    if (!producer) {
        throw new Error(`Producer ${producerId} not found`);
    }
    return producer;
}
function getAllOtherProducers(roomId, peerId) {
    return Array.from(peers.values())
        .filter((peer) => peer.roomId === roomId && peer.id !== peerId)
        .flatMap((peer) => Array.from(peer.producers.values()).map((producer) => ({
        producerId: producer.id,
        peerId: peer.id,
        kind: producer.kind,
    })));
}
function broadcastToRoom(roomId, excludePeerId, event, data) {
    for (const peer of peers.values()) {
        if (peer.roomId !== roomId)
            continue;
        if (excludePeerId && peer.id === excludePeerId)
            continue;
        sendEvent(peer.socket, event, data);
    }
}
async function createWorkers() {
    const workerCount = Math.max(1, Math.min(os.cpus().length, 2));
    for (let index = 0; index < workerCount; index += 1) {
        const worker = await mediasoup.createWorker({
            logLevel: "warn",
            rtcMinPort: MEDIASOUP_MIN_PORT,
            rtcMaxPort: MEDIASOUP_MAX_PORT,
        });
        worker.on("died", () => {
            console.error(`mediasoup worker died [pid:${worker.pid}]`);
            setTimeout(() => process.exit(1), 2000);
        });
        workers.push(worker);
    }
}
async function handleJoinRoom(socket, requestId, data) {
    const roomId = String(data.roomId ?? "");
    const peerId = String(data.peerId ?? "");
    if (!roomId || !peerId) {
        throw new Error("roomId and peerId are required");
    }
    const room = await ensureRoom(roomId);
    const existingPeer = peers.get(peerId);
    if (existingPeer) {
        cleanupPeer(existingPeer.id);
    }
    const peer = {
        id: peerId,
        roomId,
        socket,
        transports: new Map(),
        producers: new Map(),
        consumers: new Map(),
    };
    peers.set(peerId, peer);
    room.peers.add(peerId);
    socket.peerId = peerId;
    sendResponse(socket, requestId, true, {
        roomId,
        routerRtpCapabilities: room.router.rtpCapabilities,
        existingProducers: getAllOtherProducers(roomId, peerId),
    });
    broadcastToRoom(roomId, peerId, "peerJoined", {
        peerId,
        roomId,
    });
}
async function handleCreateWebRtcTransport(socket, requestId, data) {
    const peerId = String(data.peerId ?? "");
    const peer = getPeer(peerId);
    const room = rooms.get(peer.roomId);
    if (!room) {
        throw new Error(`Room ${peer.roomId} not found`);
    }
    const transport = await room.router.createWebRtcTransport({
        listenInfos: [
            {
                protocol: "udp",
                ip: "0.0.0.0",
                announcedAddress: ANNOUNCED_IP,
            },
            {
                protocol: "tcp",
                ip: "0.0.0.0",
                announcedAddress: ANNOUNCED_IP,
            },
        ],
        enableUdp: true,
        enableTcp: true,
        preferUdp: true,
    });
    peer.transports.set(transport.id, transport);
    transport.on("dtlsstatechange", (dtlsState) => {
        if (dtlsState === "closed") {
            transport.close();
            peer.transports.delete(transport.id);
        }
    });
    transport.observer.on("close", () => {
        peer.transports.delete(transport.id);
    });
    sendResponse(socket, requestId, true, {
        id: transport.id,
        iceParameters: transport.iceParameters,
        iceCandidates: transport.iceCandidates,
        dtlsParameters: transport.dtlsParameters,
    });
}
async function handleConnectTransport(socket, requestId, data) {
    const peerId = String(data.peerId ?? "");
    const transportId = String(data.transportId ?? "");
    const dtlsParameters = data.dtlsParameters;
    if (!dtlsParameters) {
        throw new Error("dtlsParameters are required");
    }
    const peer = getPeer(peerId);
    const transport = getTransport(peer, transportId);
    await transport.connect({ dtlsParameters });
    sendResponse(socket, requestId, true, { connected: true });
}
async function handleProduce(socket, requestId, data) {
    const peerId = String(data.peerId ?? "");
    const transportId = String(data.transportId ?? "");
    const kind = data.kind;
    const rtpParameters = data.rtpParameters;
    const appData = (data.appData ?? {});
    if (!kind || !rtpParameters) {
        throw new Error("kind and rtpParameters are required");
    }
    const peer = getPeer(peerId);
    const transport = getTransport(peer, transportId);
    const producer = await transport.produce({
        kind,
        rtpParameters,
        appData,
    });
    peer.producers.set(producer.id, producer);
    producer.on("transportclose", () => {
        peer.producers.delete(producer.id);
    });
    producer.observer.on("close", () => {
        peer.producers.delete(producer.id);
        broadcastToRoom(peer.roomId, peer.id, "producerClosed", {
            peerId: peer.id,
            producerId: producer.id,
        });
    });
    sendResponse(socket, requestId, true, {
        producerId: producer.id,
    });
    broadcastToRoom(peer.roomId, peer.id, "producerAdded", {
        peerId: peer.id,
        producerId: producer.id,
        kind: producer.kind,
    });
}
async function handleConsume(socket, requestId, data) {
    const peerId = String(data.peerId ?? "");
    const transportId = String(data.transportId ?? "");
    const producerId = String(data.producerId ?? "");
    const producerPeerId = String(data.producerPeerId ?? "");
    const rtpCapabilities = data.rtpCapabilities;
    if (!rtpCapabilities) {
        throw new Error("rtpCapabilities are required");
    }
    const peer = getPeer(peerId);
    const room = rooms.get(peer.roomId);
    if (!room) {
        throw new Error(`Room ${peer.roomId} not found`);
    }
    if (!room.router.canConsume({ producerId, rtpCapabilities })) {
        throw new Error(`Router cannot consume producer ${producerId}`);
    }
    const transport = getTransport(peer, transportId);
    const consumer = await transport.consume({
        producerId,
        rtpCapabilities,
        paused: true,
    });
    peer.consumers.set(consumer.id, consumer);
    consumer.on("transportclose", () => {
        peer.consumers.delete(consumer.id);
    });
    consumer.on("producerclose", () => {
        peer.consumers.delete(consumer.id);
        sendEvent(peer.socket, "consumerClosed", {
            consumerId: consumer.id,
            producerId,
            producerPeerId,
        });
    });
    sendResponse(socket, requestId, true, {
        producerId,
        producerPeerId,
        id: consumer.id,
        kind: consumer.kind,
        rtpParameters: consumer.rtpParameters,
        type: consumer.type,
        producerPaused: consumer.producerPaused,
    });
}
async function handleResumeConsumer(socket, requestId, data) {
    const peerId = String(data.peerId ?? "");
    const consumerId = String(data.consumerId ?? "");
    const peer = getPeer(peerId);
    const consumer = peer.consumers.get(consumerId);
    if (!consumer) {
        throw new Error(`Consumer ${consumerId} not found`);
    }
    await consumer.resume();
    sendResponse(socket, requestId, true, { resumed: true });
}
async function handleCloseProducer(socket, requestId, data) {
    const peerId = String(data.peerId ?? "");
    const producerId = String(data.producerId ?? "");
    const producer = getProducer(peerId, producerId);
    producer.close();
    sendResponse(socket, requestId, true, { closed: true });
}
function maybeDeleteRoom(roomId) {
    const room = rooms.get(roomId);
    if (!room)
        return;
    if (room.peers.size > 0)
        return;
    room.router.close();
    rooms.delete(roomId);
}
function cleanupPeer(peerId) {
    const peer = peers.get(peerId);
    if (!peer)
        return;
    for (const consumer of peer.consumers.values()) {
        consumer.close();
    }
    for (const producer of peer.producers.values()) {
        producer.close();
    }
    for (const transport of peer.transports.values()) {
        transport.close();
    }
    const room = rooms.get(peer.roomId);
    room?.peers.delete(peer.id);
    peers.delete(peer.id);
    broadcastToRoom(peer.roomId, peer.id, "peerLeft", {
        peerId: peer.id,
        roomId: peer.roomId,
    });
    maybeDeleteRoom(peer.roomId);
}
async function handleRequest(socket, message) {
    const { action, requestId, data = {} } = message;
    switch (action) {
        case "joinRoom":
            return handleJoinRoom(socket, requestId, data);
        case "createWebRtcTransport":
            return handleCreateWebRtcTransport(socket, requestId, data);
        case "connectTransport":
            return handleConnectTransport(socket, requestId, data);
        case "produce":
            return handleProduce(socket, requestId, data);
        case "consume":
            return handleConsume(socket, requestId, data);
        case "resumeConsumer":
            return handleResumeConsumer(socket, requestId, data);
        case "closeProducer":
            return handleCloseProducer(socket, requestId, data);
        case "leaveRoom": {
            const peerId = String(data.peerId ?? "");
            cleanupPeer(peerId);
            return sendResponse(socket, requestId, true, { left: true });
        }
        default:
            throw new Error(`Unsupported action: ${action}`);
    }
}
async function bootstrap() {
    await createWorkers();
    const server = http.createServer();
    const wss = new WebSocketServer({ server });
    wss.on("connection", (socket) => {
        socket.on("message", async (rawMessage) => {
            try {
                const message = JSON.parse(rawMessage.toString());
                await handleRequest(socket, message);
            }
            catch (error) {
                const parsed = (() => {
                    try {
                        return JSON.parse(rawMessage.toString());
                    }
                    catch {
                        return {};
                    }
                })();
                sendError(socket, parsed.requestId, error);
            }
        });
        socket.on("close", () => {
            const peerId = socket.peerId;
            if (peerId) {
                cleanupPeer(peerId);
            }
        });
    });
    server.listen(PORT, () => {
        console.log(`SFU signaling server listening on ws://localhost:${PORT}`);
        console.log(`mediasoup announced IP: ${ANNOUNCED_IP}`);
    });
}
bootstrap().catch((error) => {
    console.error("Failed to start SFU server", error);
    process.exit(1);
});
