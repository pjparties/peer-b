import 'reflect-metadata';
import express from "express";
import cors from "cors";
import { createServer } from "http";
import { Server as SocketIOServer } from "socket.io";
import { CronJob } from 'cron';
import { Config } from './config/Config';
import { UserService } from './services/UserService';
import { SocketManager } from './managers/SocketManager';

async function startServer() {
  const app = express();
  app.use(cors({ origin: Config.FRONTEND_URL, credentials: true }));
  app.use(express.json({ limit: "50kb" }));
  app.get("/", (req, res) => res.send("Hello World!"));

  const httpServer = createServer(app);
  const io = new SocketIOServer(httpServer, {
    cors: { origin: Config.FRONTEND_URL, methods: ['GET', 'POST'] },
  });

  const userService = new UserService();
  await userService.createUsersTable();

  const socketManager = new SocketManager(io, userService);

  io.on("connection", (socket) => socketManager.handleConnection(socket));

  const cleanupJob = new CronJob('0 * * * *', () => socketManager.cleanupInactiveUsers());
  cleanupJob.start();

  httpServer.listen(Config.PORT, () => console.log(`Server is running on port ${Config.PORT}`));
}

startServer().catch(console.error);