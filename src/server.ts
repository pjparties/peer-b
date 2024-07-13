import express from "express";
import cors from "cors";
import { createServer } from "http";
import { Server } from "socket.io";
import dotenv from "dotenv";

// Configuration
dotenv.config({ path: ".env" });
const PORT = process.env.PORT || 8000;
const FRONTEND_URL = 'http://localhost:3000';

// Express app setup
const app = setupExpressApp();
const httpServer = createServer(app);
const io = setupSocketServer(httpServer);

// Socket management
let sockets = [];
let searching = [];
let notAvailable = [];

// Start server
httpServer.listen(PORT, () => console.log(`Server is running on port ${PORT}`));

// Setup functions
function setupExpressApp() {
  const app = express();
  app.use(cors({ origin: FRONTEND_URL, credentials: true }));
  app.use(express.json({ limit: "50kb" }));
  app.get("/", (req, res) => res.send("Hello World!"));
  return app;
}

function setupSocketServer(httpServer) {
  const io = new Server(httpServer, {
    cors: { origin: FRONTEND_URL, methods: ['GET', 'POST'] },
  });
  io.on("connection", handleSocketConnection);
  return io;
}

// Event handlers
async function handleSocketConnection(socket) {
  sockets.push(socket);
  updateOnlineCount();

  socket.on("start", (id) => handleStart(socket, id));
  socket.on("newMessageToServer", (msg) => handleNewMessage(socket, msg));
  socket.on("typing", (msg) => handleTyping(socket, msg));
  socket.on("doneTyping", () => handleDoneTyping(socket));
  socket.on("stop", () => handleStop(socket));
  socket.on("disconnecting", () => handleDisconnecting(socket));
  socket.on("disconnect", updateOnlineCount);
}

function handleStart(socket, id) {
  moveSocketToSearching(socket, id);
  tryMatchSockets(socket, id);
}

function handleNewMessage(socket, msg) {
  const roomName: string = getRoomName(socket);
  if (roomName) {
    io.of("/").to(roomName).emit("newMessageToClient", { id: socket.id, msg });
  }
}

function handleTyping(socket, msg) {
  const roomName = getRoomName(socket);
  if (!roomName) return;
  const peer = getPeer(socket, roomName);
  if (peer) {
    peer.emit("strangerIsTyping", msg);
  }
}

function handleDoneTyping(socket) {
  const roomName = getRoomName(socket);
  if (!roomName) return;
  const peer = getPeer(socket, roomName);
  if (peer) {
    peer.emit("strangerIsDoneTyping");
  }
}

function handleStop(socket) {
  const roomName = getRoomName(socket);
  if (!roomName) return;
  const peer = getPeer(socket, roomName);
  if (peer) {
    disconnectChat(socket, peer, roomName);
  } else {
    socket.emit("endChat", "You have disconnected");
    removeSocket(socket);
  }
}

function handleDisconnecting(socket) {
  const roomName = getRoomName(socket);
  if (roomName) {
    io.of("/").to(roomName).emit("goodBye", "Stranger has disconnected");
    const peer = getPeer(socket, roomName);
    if (peer) {
      disconnectChat(socket, peer, roomName);
    }
  }
  removeSocket(socket);
}

// Helper functions
async function updateOnlineCount() {
  const allSockets = await io.fetchSockets();
  io.emit("numberOfOnline", allSockets.length);
}

function moveSocketToSearching(socket, id) {
  sockets = sockets.filter(s => s.id !== id);
  searching.push(socket);
}

function tryMatchSockets(socket, id) {
  for (let i = 0; i < searching.length; i++) {
    const peer = searching[i];
    if (peer.id !== id) {
      matchSockets(socket, peer, id);
      return;
    }
  }
  socket.emit("searching", "Searching...");
}

function matchSockets(socket, peer, id) {
  searching = searching.filter(s => s.id !== peer.id && s.id !== id);
  notAvailable.push(socket, peer);
  const roomName = `${id}#${peer.id}`;
  socket.leave([...socket.rooms][1]);
  peer.leave([...peer.rooms][1]);
  socket.join(roomName);
  peer.join(roomName);
  io.of("/").to(roomName).emit("chatStart", "You are now chatting with a random stranger");
}

function getRoomName(socket): string {
  const rooms = Array.from(socket.rooms);
  return rooms.length > 1 ? rooms[1] as string : null;
}

function getPeer(socket, roomName) {
  if (!roomName) {
    console.log("No room found for socket:", socket.id);
    return null;
  }
  const [id1, id2] = roomName.split("#");
  const peerId = id1 === socket.id ? id2 : id1;
  return notAvailable.find(user => user.id === peerId);
}

function disconnectChat(socket, peer, roomName) {
  peer.leave(roomName);
  socket.leave(roomName);
  peer.emit("strangerDisconnected", "Stranger has disconnected");
  socket.emit("endChat", "You have disconnected");
  notAvailable = notAvailable.filter(user => user.id !== socket.id && user.id !== peer.id);
  sockets.push(socket, peer);
}

function removeSocket(socket) {
  sockets = sockets.filter(user => user.id !== socket.id);
  searching = searching.filter(user => user.id !== socket.id);
  notAvailable = notAvailable.filter(user => user.id !== socket.id);
}