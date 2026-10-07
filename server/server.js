const express = require("express");
const http = require("http");
const cors = require("cors");
const { Server } = require("socket.io");

const app = express();

const sessions = new Map();
const SESSION_TIMEOUT = 10 * 60 * 1000;
const MAX_RECEIVERS = 5;

function isSessionExpired(session) {
  return Date.now() - session.createdAt > SESSION_TIMEOUT;
}

function isSessionMember(session, socketId) {
  return session.sender === socketId || session.receivers.includes(socketId);
}

app.use(
  cors({
    origin: "http://localhost:3000",
  }),
);

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "http://localhost:3000",
  },
});

function generateCode() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

app.get("/", (req, res) => {
  res.send("P2P Server is running");
});

app.get("/create-session", (req, res) => {
  const code = generateCode();

  sessions.set(code, {
    sender: null,
    receivers: [],
    ready: false,
    createdAt: Date.now(),
  });

  res.json({
    code: code,
  });

  console.log(`Session created: ${code}`);
});

app.get("/join-session/:code", (req, res) => {
  const code = req.params.code.trim().toUpperCase();

  if (!/^[A-Z0-9]{6}$/.test(code)) {
    return res.status(400).json({
      error: "Invalid session code",
    });
  }

  const session = sessions.get(code);

  if (!session) {
    return res.status(404).json({
      error: "Session not found",
    });
  }

  if (isSessionExpired(session)) {
    sessions.delete(code);

    return res.status(410).json({
      error: "Session has expired",
    });
  }

  res.json({
    message: "Session available",
    code: code,
  });
});

io.on("connection", (socket) => {
  console.log("Client connected:", socket.id);

  socket.on("join-session", (code) => {
    if (!code || typeof code !== "string") {
      socket.emit("session-error", "Invalid session code");
      return;
    }

    code = code.trim().toUpperCase();

    if (!/^[A-Z0-9]{6}$/.test(code)) {
      socket.emit("session-error", "Invalid session code");
      return;
    }

    const session = sessions.get(code);

    if (!session) {
      socket.emit("session-error", "Session not found");
      return;
    }

    if (isSessionExpired(session)) {
      sessions.delete(code);

      socket.emit("session-error", "Session has expired");

      console.log(`Session ${code} expired`);

      return;
    }

    if (isSessionMember(session, socket.id)) {
      console.log(`Socket already joined session ${code}:`, socket.id);

      return;
    }

    if (!session.sender) {
      session.sender = socket.id;

      socket.join(code);

      console.log(`Sender joined session ${code}`);

      console.log(`Sender: ${session.sender}`);

      console.log(`Receivers: ${session.receivers.length}`);

      return;
    }

    if (session.receivers.length >= MAX_RECEIVERS) {
      socket.emit("session-error", "Session is full");

      return;
    }

    session.receivers.push(socket.id);

    socket.join(code);

    console.log(`Receiver joined session ${code}`);

    console.log(`Sender: ${session.sender}`);

    console.log(`Receivers: ${session.receivers.length}`);

    session.ready = true;

    io.to(session.sender).emit("receiver-joined", {
      code: code,
      receiverId: socket.id,
    });

    console.log(`Receiver ${socket.id} notified sender`);
  });

  socket.on("webrtc-offer", ({ code, receiverId, offer }) => {
    console.log(`Offer received for receiver ${receiverId}`);

    const session = sessions.get(code);

    if (!session) {
      console.log("Session not found:", code);
      return;
    }

    if (session.sender !== socket.id) {
      console.log("Invalid offer sender");
      return;
    }

    if (!session.receivers.includes(receiverId)) {
      console.log("Receiver not found in session");
      return;
    }

    io.to(receiverId).emit("webrtc-offer", {
      code: code,
      offer: offer,
    });

    console.log(`Offer forwarded to receiver ${receiverId}`);
  });

  socket.on("webrtc-answer", ({ code, answer }) => {
    console.log(`Answer received from ${socket.id}`);

    const session = sessions.get(code);

    if (!session) {
      console.log("Session not found:", code);
      return;
    }

    if (!session.receivers.includes(socket.id)) {
      console.log("Invalid answer sender");
      return;
    }

    if (!session.sender) {
      console.log("Sender is no longer connected");
      return;
    }

    io.to(session.sender).emit("webrtc-answer", {
      receiverId: socket.id,
      answer: answer,
    });

    console.log(`Answer forwarded to sender for receiver ${socket.id}`);
  });

  socket.on("ice-candidate", ({ code, targetId, candidate }) => {
    const session = sessions.get(code);

    if (!session) {
      console.log("Session not found:", code);
      return;
    }

    if (!candidate) {
      console.log("Invalid ICE candidate");
      return;
    }

    if (session.sender === socket.id && session.receivers.includes(targetId)) {
      io.to(targetId).emit("ice-candidate", {
        candidate: candidate,
      });

      console.log(`ICE candidate sent to receiver ${targetId}`);

      return;
    }

    if (session.receivers.includes(socket.id)) {
      if (!session.sender) {
        console.log("Sender is no longer connected");

        return;
      }

      io.to(session.sender).emit("ice-candidate", {
        receiverId: socket.id,
        candidate: candidate,
      });

      console.log(`ICE candidate sent from receiver ${socket.id} to sender`);

      return;
    }

    console.log("Invalid ICE candidate sender");
  });

  socket.on("disconnect", () => {
    console.log("Client disconnected:", socket.id);

    for (const [code, session] of sessions.entries()) {
      if (session.sender === socket.id) {
        console.log(`Sender disconnected from session ${code}`);

        for (const receiverId of session.receivers) {
          io.to(receiverId).emit("peer-disconnected");
        }

        sessions.delete(code);

        console.log(`Session ${code} deleted because sender disconnected`);

        continue;
      }

      const receiverIndex = session.receivers.indexOf(socket.id);

      if (receiverIndex !== -1) {
        session.receivers.splice(receiverIndex, 1);

        console.log(`Receiver ${socket.id} disconnected from session ${code}`);

        console.log(`Remaining receivers: ${session.receivers.length}`);

        if (session.sender) {
          io.to(session.sender).emit("peer-disconnected", {
            receiverId: socket.id,
          });
        }

        if (session.receivers.length === 0) {
          session.ready = false;
        }

        if (!session.sender && session.receivers.length === 0) {
          sessions.delete(code);

          console.log(`Session ${code} deleted`);
        }
      }
    }
  });
});

const PORT = 5000;

server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
