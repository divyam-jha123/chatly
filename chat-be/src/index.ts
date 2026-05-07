import { WebSocketServer, WebSocket } from "ws";
import { db, messaging } from "./firebaseAdmin.js";
import { FieldValue } from "firebase-admin/firestore";

const port = process.env.PORT ? parseInt(process.env.PORT) : 8080;
const wss = new WebSocketServer({ port });

interface User {
  socket: WebSocket;
  room: string;
  userId: string;
}

const allSockets: User[] = [];
const conferenceRooms = new Map<string, Set<string>>();
const conferenceMembership = new Map<WebSocket, { roomId: string; userId: string }>();

async function registerFcmToken(userId: string, token: string) {
  await db
    .collection("users")
    .doc(userId)
    .set(
      {
        fcmTokens: FieldValue.arrayUnion(token),
      },
      { merge: true },
    );
}

async function removeFcmTokenForUsers(token: string, candidateUserIds: string[]) {
  if (candidateUserIds.length === 0) return;

  await Promise.all(
    candidateUserIds.map(async (candidateUserId) => {
      await db
        .collection("users")
        .doc(candidateUserId)
        .set(
          {
            fcmTokens: FieldValue.arrayRemove(token),
          },
          { merge: true },
        );
    }),
  );
}

async function sendChatNotifications(roomId: string, senderUserId: string, messageText: string) {
  const targetUserIds = Array.from(
    new Set(
      allSockets
        .filter((user) => user.room === roomId && user.userId !== senderUserId)
        .map((user) => user.userId),
    ),
  );

  if (targetUserIds.length === 0) return;

  const userSnapshots = await Promise.all(
    targetUserIds.map((targetUserId) => db.collection("users").doc(targetUserId).get()),
  );

  const allTokens = Array.from(
    new Set(
      userSnapshots.flatMap((snapshot) => {
        const tokens = snapshot.data()?.["fcmTokens"];
        if (!Array.isArray(tokens)) return [];
        return tokens.filter((token): token is string => typeof token === "string");
      }),
    ),
  );

  if (allTokens.length === 0) return;

  const response = await messaging.sendEachForMulticast({
    tokens: allTokens,
    notification: {
      title: `New message in room ${roomId}`,
      body: messageText,
    },
    data: {
      roomId,
      senderUserId,
      type: "chat:new-message",
    },
  });

  const invalidTokens: string[] = [];
  response.responses.forEach((result, idx) => {
    const token = allTokens[idx];
    if (typeof token !== "string") return;

    if (
      !result.success &&
      (result.error?.code === "messaging/registration-token-not-registered" ||
        result.error?.code === "messaging/invalid-registration-token")
    ) {
      invalidTokens.push(token);
    }
  });

  if (invalidTokens.length > 0) {
    await Promise.all(
      invalidTokens.map((invalidToken) =>
        removeFcmTokenForUsers(invalidToken, targetUserIds),
      ),
    );
  }
}

function getSocketUser(ws: WebSocket) {
  return allSockets.find((user) => user.socket === ws);
}

function upsertSocketUser(ws: WebSocket, room: string, userId: string) {
  const existingUser = getSocketUser(ws);

  if (existingUser) {
    existingUser.room = room;
    existingUser.userId = userId;
    return existingUser;
  }

  const nextUser = {
    socket: ws,
    room,
    userId,
  };

  allSockets.push(nextUser);
  return nextUser;
}

function getRoomSocket(roomId: string, targetUserId: string) {
  return allSockets.find(
    (user) => user.room === roomId && user.userId === targetUserId,
  );
}

function leaveConference(ws: WebSocket) {
  const membership = conferenceMembership.get(ws);
  console.log("membership",membership);

  if (!membership) return;

  const roomParticipants = conferenceRooms.get(membership.roomId);


  if (!roomParticipants) {
    conferenceMembership.delete(ws);
    return;
  }

  roomParticipants.delete(membership.userId);

  for (const user of allSockets) {
    if (
      user.room === membership.roomId &&
      user.socket !== ws &&
      roomParticipants.has(user.userId)
    ) {
      user.socket.send(
        JSON.stringify({
          type: "conference:user-left",
          payload: {
            roomId: membership.roomId,
            userId: membership.userId,
          },
        }),
      );
    }
  }

  if (roomParticipants.size === 1) {
    conferenceRooms.delete(membership.roomId);
  }

  conferenceMembership.delete(ws);
}

wss.on("connection", (ws) => {
  let userId: string;

  // message receive handler
  ws.on("message", async (message) => {
    const parsedMessage = JSON.parse(message.toString());

    if (parsedMessage.type === "join") {
      userId = parsedMessage.payload.userId;
      upsertSocketUser(ws, parsedMessage.payload.roomId, userId);

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

    if (parsedMessage.type === "chat") {
      const currentUserRoom = getSocketUser(ws)?.room;

      if (currentUserRoom === undefined) return;

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

        await sendChatNotifications(
          currentUserRoom,
          userId,
          parsedMessage.payload.message,
        );
      } catch (err) {
        console.error("Error saving message:", err);
      }

      for (const user of allSockets) {
        if (user.room === currentUserRoom) {
          user.socket.send(
            JSON.stringify({
              type: "chat",
              payload: {
                message: parsedMessage.payload.message,
                sender: user.socket === ws ? "self" : "other",
              },
            }),
          );
        }
      }
    }

    if (parsedMessage.type === "notifications:register-token") {
      try {
        const payload = parsedMessage.payload;
        if (
          payload &&
          typeof payload.userId === "string" &&
          typeof payload.token === "string" &&
          payload.userId.length > 0 &&
          payload.token.length > 0
        ) {
          await registerFcmToken(payload.userId, payload.token);
        }
      } catch (error) {
        console.error("Error registering FCM token:", error);
      }
    }

    if (parsedMessage.type === "conference:join") {
      try {
        const roomId = parsedMessage.payload.roomId;
        const participantUserId = parsedMessage.payload.userId;
        const existingParticipants = Array.from(
          conferenceRooms.get(roomId) ?? new Set<string>(),
        ).filter((roomUserId) => roomUserId !== participantUserId);

        const roomParticipants =
          conferenceRooms.get(roomId) ?? new Set<string>();
        roomParticipants.add(participantUserId);
        conferenceRooms.set(roomId, roomParticipants);
        conferenceMembership.set(ws, { roomId, userId: participantUserId });

        ws.send(
          JSON.stringify({
            type: "conference:participants",
            payload: {
              roomId,
              participants: existingParticipants,
            },
          }),
        );

        for (const user of allSockets) {
          if (
            user.room === roomId &&
            user.socket !== ws &&
            roomParticipants.has(user.userId)
          ) {
            user.socket.send(
              JSON.stringify({
                type: "conference:user-joined",
                payload: {
                  roomId,
                  userId: participantUserId,
                },
              }),
            );
          }
        }
      } catch (error) {
        console.error("Error joining conference:", error);
      }
    }

    if (parsedMessage.type === "conference:leave") {
      leaveConference(ws);
    }

    if (parsedMessage.type === "offer") {
      try {
        const sender = getSocketUser(ws);
        if (!sender) return;

        const roomId = parsedMessage.payload.roomId;
        const targetUserId = parsedMessage.payload.targetUserId;
        const targetUser = getRoomSocket(roomId, targetUserId);
        if (!targetUser || targetUser.socket === ws) return;

        targetUser.socket.send(
          JSON.stringify({
            type: "offer",
            payload: {
              roomId,
              fromUserId: sender.userId,
              offer: parsedMessage.payload.offer,
            },
          }),
        );
      } catch (error) {
        console.error("Error sending offer:", error);
      }
    }

    if (parsedMessage.type === "answer") {
      try {
        const sender = getSocketUser(ws);
        if (!sender) return;

        const roomId = parsedMessage.payload.roomId;
        const targetUserId = parsedMessage.payload.targetUserId;
        const targetUser = getRoomSocket(roomId, targetUserId);
        if (!targetUser || targetUser.socket === ws) return;

        targetUser.socket.send(
          JSON.stringify({
            type: "answer",
            payload: {
              roomId,
              fromUserId: sender.userId,
              answer: parsedMessage.payload.answer,
            },
          }),
        );
      } catch (error) {
        console.error("Error sending answer:", error);
      }
    }

    if (parsedMessage.type === "ice") {
      try {
        const sender = getSocketUser(ws);
        if (!sender) return;

        const roomId = parsedMessage.payload.roomId;
        const targetUserId = parsedMessage.payload.targetUserId;
        const targetUser = getRoomSocket(roomId, targetUserId);
        if (!targetUser || targetUser.socket === ws) return;

        targetUser.socket.send(
          JSON.stringify({
            type: "ice",
            payload: {
              roomId,
              fromUserId: sender.userId,
              candidate: parsedMessage.payload.candidate,
            },
          }),
        );
      } catch (error) {
        console.error("Error sending ICE candidate:", error);
      }
    }
  });

  ws.on("close", () => {
    leaveConference(ws);
    const idx = allSockets.findIndex((u) => u.socket === ws);
    if (idx !== -1) allSockets.splice(idx, 1);
  });
});
