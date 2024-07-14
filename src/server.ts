import express, { Express, Request, Response } from "express";
import cors from "cors";
import { createServer, Server as HttpServer } from "http";
import { Server as SocketIOServer, Socket } from "socket.io";
import dotenv from "dotenv";
import { Pool } from 'pg';
import { CronJob } from 'cron';

// Configuration
dotenv.config({ path: ".env.development.local" });
const PORT: number = parseInt(process.env.PORT || "8000", 10);
const FRONTEND_URL: string = 'http://localhost:3000';

// Database setup
const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: parseInt(process.env.DB_PORT || "5432", 10),
});


// Express app setup
const app: Express = setupExpressApp();
const httpServer: HttpServer = createServer(app);
const io: SocketIOServer = setupSocketServer(httpServer);

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

// Database functions
async function createUsersTable() {
  const createTableQuery = `
    CREATE TABLE IF NOT EXISTS users (
      socket_id VARCHAR(255) PRIMARY KEY,
      status VARCHAR(50) NOT NULL,
      room_name VARCHAR(255),
      last_active TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    )
  `;
  await pool.query(createTableQuery);
  await pool.query('CREATE INDEX IF NOT EXISTS idx_users_last_active ON users(last_active)');
}

async function addUser(socketId: string) {
  const query = 'INSERT INTO users (socket_id, status) VALUES ($1, $2)';
  await pool.query(query, [socketId, 'available']);
}

async function updateUserStatus(socketId: string, status: string, roomName?: string) {
  const query = 'UPDATE users SET status = $2, room_name = $3, last_active = CURRENT_TIMESTAMP WHERE socket_id = $1';
  await pool.query(query, [socketId, status, roomName]);
}

async function updateUserActivity(socketId: string) {
  const query = 'UPDATE users SET last_active = CURRENT_TIMESTAMP WHERE socket_id = $1';
  await pool.query(query, [socketId]);
}

async function findSearchingUser(excludeSocketId: string) {
  const query = 'SELECT socket_id FROM users WHERE status = $1 AND socket_id != $2 LIMIT 1';
  const result = await pool.query(query, ['searching', excludeSocketId]);
  return result.rows[0];
}

async function getActiveUserCount() {
  const query = `
    SELECT COUNT(*) 
    FROM users 
    WHERE last_active > NOW() - INTERVAL '1 HOUR'
  `;
  const result = await pool.query(query);
  return parseInt(result.rows[0].count);
}

async function removeUser(socketId: string) {
  const query = 'DELETE FROM users WHERE socket_id = $1';
  await pool.query(query, [socketId]);
}

async function removeInactiveUsers(inactiveThreshold: number) {
  const query = `
    DELETE FROM users 
    WHERE last_active < NOW() - INTERVAL '${inactiveThreshold} HOURS'
    RETURNING socket_id
  `;
  const result = await pool.query(query);
  return result.rows.map(row => row.socket_id);
}

// Event handlers
async function handleSocketConnection(socket: Socket): Promise<void> {
  await addUser(socket.id);
  await updateActiveUserCount();

  socket.on("start", (id: string) => handleStart(socket, id));
  socket.on("newMessageToServer", (msg: string) => handleNewMessage(socket, msg));
  socket.on("typing", (msg: string) => handleTyping(socket, msg));
  socket.on("doneTyping", () => handleDoneTyping(socket));
  socket.on("stop", () => handleStop(socket));
  socket.on("disconnecting", () => handleDisconnecting(socket));
  socket.on("disconnect", updateActiveUserCount);
}

async function handleStart(socket: Socket, id: string): Promise<void> {
  await updateUserStatus(id, 'searching');
  await updateUserActivity(id);
  await tryMatchSockets(socket, id);
}

async function tryMatchSockets(socket: Socket, id: string): Promise<void> {
  const peer = await findSearchingUser(id);
  if (peer) {
    const peerSocket = io.sockets.sockets.get(peer.socket_id);
    if (peerSocket) {
      await matchSockets(socket, peerSocket, id);
    }
  } else {
    socket.emit("searching", "Searching...");
  }
}

async function matchSockets(socket: Socket, peer: Socket, id: string): Promise<void> {
  const roomName: string = `${id}#${peer.id}`;
  await updateUserStatus(id, 'chatting', roomName);
  await updateUserStatus(peer.id, 'chatting', roomName);
  socket.join(roomName);
  peer.join(roomName);
  io.to(roomName).emit("chatStart", "You are now chatting with a random stranger");
}

function handleNewMessage(socket: Socket, msg: string): void {
  const roomName: string = Array.from(socket.rooms)[1];
  if (roomName) {
    io.to(roomName).emit("newMessageToClient", { id: socket.id, msg });
  }
}

function handleTyping(socket: Socket, msg: string): void {
  const roomName: string = Array.from(socket.rooms)[1];
  if (roomName) {
    socket.to(roomName).emit("strangerIsTyping", msg);
  }
}

function handleDoneTyping(socket: Socket): void {
  const roomName: string = Array.from(socket.rooms)[1];
  if (roomName) {
    socket.to(roomName).emit("strangerIsDoneTyping");
  }
}

async function handleStop(socket: Socket): Promise<void> {
  const roomName: string = Array.from(socket.rooms)[1];
  if (roomName) {
    await disconnectChat(socket, roomName);
  } else {
    socket.emit("endChat", "You have disconnected");
    await removeUser(socket.id);
  }
}

async function handleDisconnecting(socket: Socket): Promise<void> {
  const roomName: string = Array.from(socket.rooms)[1];
  if (roomName) {
    io.to(roomName).emit("goodBye", "Stranger has disconnected");
    await disconnectChat(socket, roomName);
  }
  await removeUser(socket.id);
}

async function disconnectChat(socket: Socket, roomName: string): Promise<void> {
  const [id1, id2] = roomName.split("#");
  const peerId: string = id1 === socket.id ? id2 : id1;
  const peerSocket = io.sockets.sockets.get(peerId);

  if (peerSocket) {
    peerSocket.leave(roomName);
    peerSocket.emit("strangerDisconnected", "Stranger has disconnected");
    await updateUserStatus(peerId, 'available');
  }

  socket.leave(roomName);
  socket.emit("endChat", "You have disconnected");
  await updateUserStatus(socket.id, 'available');
}

async function updateActiveUserCount(): Promise<void> {
  const count = await getActiveUserCount();
  io.emit("numberOfOnline", count);
}

// Cron job for cleaning up inactive users
const cleanupJob = new CronJob('0 * * * *', async function () {
  console.log('Running inactive user cleanup');
  const removedUsers = await removeInactiveUsers(1); // 1 hour threshold

  removedUsers.forEach(socketId => {
    const socket = io.sockets.sockets.get(socketId);
    if (socket) {
      socket.disconnect(true);
    }
  });

  console.log(`Removed ${removedUsers.length} inactive users`);
  await updateActiveUserCount();
});

// Initialize
(async () => {
  await createUsersTable();
  cleanupJob.start();
})();