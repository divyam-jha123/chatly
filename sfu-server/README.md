# SFU Server

Standalone Node.js SFU server built with `mediasoup` for room-based conferencing.

## What it does

- Creates mediasoup workers and one router per room
- Lets peers join a room over WebSocket signaling
- Creates send/recv WebRTC transports
- Supports producing audio/video into the SFU
- Supports consuming remote producers from the SFU
- Notifies peers when producers are added or removed

## Install

```bash
cd sfu-server
npm install
```

## Run

```bash
npm run dev
```

By default the signaling server listens on `ws://localhost:4000`.

## Environment

Copy [.env.example](/Users/divyamjha/Desktop/web-dev%20cohort/websockets/sfu-server/.env.example) to `.env` and adjust:

- `SFU_PORT`: signaling server port
- `SFU_ANNOUNCED_IP`: public IP/domain the browser should use for ICE candidates
- `MEDIASOUP_MIN_PORT`
- `MEDIASOUP_MAX_PORT`

## Signaling actions

All messages are JSON with:

```json
{
  "action": "joinRoom",
  "requestId": "optional-client-id",
  "data": {}
}
```

The server answers with:

```json
{
  "type": "response",
  "requestId": "same-id",
  "ok": true,
  "data": {}
}
```

Or:

```json
{
  "type": "event",
  "event": "producerAdded",
  "data": {}
}
```

### Supported actions

- `joinRoom`
- `createWebRtcTransport`
- `connectTransport`
- `produce`
- `consume`
- `resumeConsumer`
- `closeProducer`
- `leaveRoom`

### Example `joinRoom`

```json
{
  "action": "joinRoom",
  "requestId": "1",
  "data": {
    "roomId": "room-1",
    "peerId": "peer-a"
  }
}
```

Response includes router RTP capabilities and the current producer list:

```json
{
  "type": "response",
  "requestId": "1",
  "ok": true,
  "data": {
    "roomId": "room-1",
    "routerRtpCapabilities": {},
    "existingProducers": []
  }
}
```

## Notes

- This is the SFU signaling/media plane server only.
- Your React client still needs to use `mediasoup-client` to connect to it.
- For production you should add auth, HTTPS/WSS, proper logging, and cleanup metrics.
