import express, { Express, Request, Response } from "express";
import cors from "cors";
import { createServer, Server as HttpServer } from "http";
import { Server as SocketIOServer, Socket } from "socket.io";
import dotenv from "dotenv";

// Configuration
dotenv.config({ path: ".env" });
const PORT: number = parseInt(process.env.PORT || "8000", 10);
const FRONTEND_URL: string = 'http://localhost:3000';

// Express app setup
const app: Express = setupExpressApp();
const httpServer: HttpServer = createServer(app);
const io: SocketIOServer = setupSocketServer(httpServer);

// Socket management
let sockets: Socket[] = [];
let searching: Socket[] = [];
let notAvailable: Socket[] = [];

// Start server
httpServer.listen(PORT, () => console.log(`Server is running on port ${PORT}`));

// Setup functions
function setupExpressApp(): Express {
  const app: Express = express();
  app.use(cors({ origin: FRONTEND_URL, credentials: true }));
  app.use(express.json({ limit: "50kb" }));
  app.get("/", (req: Request, res: Response) => res.send("Hello World!"));
  return app;
}

function setupSocketServer(httpServer: HttpServer): SocketIOServer {
  const io: SocketIOServer = new SocketIOServer(httpServer, {
    cors: { origin: FRONTEND_URL, methods: ['GET', 'POST'] },
  });
  io.on("connection", handleSocketConnection);
  return io;
}

// Event handlers
async function handleSocketConnection(socket: Socket): Promise<void> {
  sockets.push(socket);
  await updateOnlineCount();

  socket.on("start", (id: string) => handleStart(socket, id));
  socket.on("newMessageToServer", (msg: string) => handleNewMessage(socket, msg));
  socket.on("typing", (msg: string) => handleTyping(socket, msg));
  socket.on("doneTyping", () => handleDoneTyping(socket));
  socket.on("stop", () => handleStop(socket));
  socket.on("disconnecting", () => handleDisconnecting(socket));
  socket.on("disconnect", updateOnlineCount);
}

function handleStart(socket: Socket, id: string): void {
  moveSocketToSearching(socket, id);
  tryMatchSockets(socket, id);
}

function handleNewMessage(socket: Socket, msg: string): void {
  const roomName: string | null = getRoomName(socket);
  if (roomName) {
    io.of("/").to(roomName).emit("newMessageToClient", { id: socket.id, msg });
  }
}

function handleTyping(socket: Socket, msg: string): void {
  const roomName: string | null = getRoomName(socket);
  if (!roomName) return;
  const peer: Socket | undefined = getPeer(socket, roomName);
  if (peer) {
    peer.emit("strangerIsTyping", msg);
  }
}

function handleDoneTyping(socket: Socket): void {
  const roomName: string | null = getRoomName(socket);
  if (!roomName) return;
  const peer: Socket | undefined = getPeer(socket, roomName);
  if (peer) {
    peer.emit("strangerIsDoneTyping");
  }
}

function handleStop(socket: Socket): void {
  const roomName: string | null = getRoomName(socket);
  if (!roomName) return;
  const peer: Socket | undefined = getPeer(socket, roomName);
  if (peer) {
    disconnectChat(socket, peer, roomName);
  } else {
    socket.emit("endChat", "You have disconnected");
    removeSocket(socket);
  }
}

function handleDisconnecting(socket: Socket): void {
  const roomName: string | null = getRoomName(socket);
  if (roomName) {
    io.of("/").to(roomName).emit("goodBye", "Stranger has disconnected");
    const peer: Socket | undefined = getPeer(socket, roomName);
    if (peer) {
      disconnectChat(socket, peer, roomName);
    }
  }
  removeSocket(socket);
}

// Helper functions
async function updateOnlineCount(): Promise<void> {
  const allSockets: Socket[] = Array.from(io.sockets.sockets.values());
  io.emit("numberOfOnline", allSockets.length);
}

function moveSocketToSearching(socket: Socket, id: string): void {
  sockets = sockets.filter(s => s.id !== id);
  searching.push(socket);
}

function tryMatchSockets(socket: Socket, id: string): void {
  for (let i = 0; i < searching.length; i++) {
    const peer: Socket = searching[i];
    if (peer.id !== id) {
      matchSockets(socket, peer, id);
      return;
    }
  }
  socket.emit("searching", "Searching...");
}

function matchSockets(socket: Socket, peer: Socket, id: string): void {
  searching = searching.filter(s => s.id !== peer.id && s.id !== id);
  notAvailable.push(socket, peer);
  const roomName: string = `${id}#${peer.id}`;
  socket.leave([...socket.rooms][1]);
  peer.leave([...peer.rooms][1]);
  socket.join(roomName);
  peer.join(roomName);
  io.of("/").to(roomName).emit("chatStart", "You are now chatting with a random stranger");
}

function getRoomName(socket: Socket): string | null {
  const rooms: string[] = Array.from(socket.rooms);
  return rooms.length > 1 ? rooms[1] : null;
}

function getPeer(socket: Socket, roomName: string): Socket | undefined {
  if (!roomName) {
    console.log("No room found for socket:", socket.id);
    return undefined;
  }
  const [id1, id2] = roomName.split("#");
  const peerId: string = id1 === socket.id ? id2 : id1;
  return notAvailable.find(user => user.id === peerId);
}

function disconnectChat(socket: Socket, peer: Socket, roomName: string): void {
  peer.leave(roomName);
  socket.leave(roomName);
  peer.emit("strangerDisconnected", "Stranger has disconnected");
  socket.emit("endChat", "You have disconnected");
  notAvailable = notAvailable.filter(user => user.id !== socket.id && user.id !== peer.id);
  sockets.push(socket, peer);
}

function removeSocket(socket: Socket): void {
  sockets = sockets.filter(user => user.id !== socket.id);
  searching = searching.filter(user => user.id !== socket.id);
  notAvailable = notAvailable.filter(user => user.id !== socket.id);
}