import { WebSocketServer, WebSocket } from "ws";
import { db } from "./firebaseAdmin.js";
import { FieldValue } from "firebase-admin/firestore";

const port = process.env.PORT ? parseInt(process.env.PORT) : 8080;
const wss = new WebSocketServer({ port });

interface User {
  socket: WebSocket;
  room: string;
  userId: string;
}

const allSockets: User[] = [];

// event handler
wss.on("connection", (ws) => {
  let userId: string;

  // message recieve handler
  ws.on("message", async (message) => {
    const parsedMessage = JSON.parse(message.toString());

    if (parsedMessage.type == "join") {
      userId = parsedMessage.payload.userId;
      
      allSockets.push({
        socket: ws,
        room: parsedMessage.payload.roomId,
        userId,
      });

      // load chat history from Firestore
      try {
        const roomId = parsedMessage.payload.roomId;
        const messagesRef = db
          .collection("rooms")
          .doc(roomId)
          .collection("messages")
          .orderBy("timestamp", "asc");

        const snapshot = await messagesRef.get();
        const history = snapshot.docs.map((doc) => {
          const data = doc.data();
          return {
            message: data["text"] as string,
            sender: data["senderId"] === userId ? "self" : "other",
          };
        });

        ws.send(
          JSON.stringify({
            type: "history",
            payload: history,
          }),
        );
      } catch (err) {
        console.error("Error loading history:", err);
      }
    }

    if (parsedMessage.type == "chat") {
      let currentUserRoom: string | undefined;

      for (const user of allSockets) {
        if (user.socket === ws) {
          currentUserRoom = user.room;
          break;
        }
      }

      if (currentUserRoom === undefined) return;

      // save message to Firestore
      try { 
        await db
          .collection("rooms")
          .doc(currentUserRoom)
          .collection("messages")
          .add({
            text: parsedMessage.payload.message,
            senderId: userId,
            timestamp: FieldValue.serverTimestamp(),
          });
      } catch (err) {
        console.error("Error saving message:", err);
      }

      // broadcast to all users in the room
      for (const user of allSockets) {
        if (user.room === currentUserRoom) {
          user.socket.send(JSON.stringify({
            type: "chat",
            payload: {
              message: parsedMessage.payload.message,
              sender: user.socket === ws ? "self" : "other",
            },
          }));
        }
      }
    }
  });

  // clean up on disconnect
  ws.on("close", () => {
    const idx = allSockets.findIndex((u) => u.socket === ws);
    if (idx !== -1) allSockets.splice(idx, 1);
  });
});
