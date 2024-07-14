import { Server as SocketIOServer, Socket } from "socket.io";
import { UserService } from "../services/UserService";

export class SocketManager {
  private io: SocketIOServer;
  private userService: UserService;

  constructor(io: SocketIOServer, userService: UserService) {
    this.io = io;
    this.userService = userService;
  }

  async handleConnection(socket: Socket): Promise<void> {
    await this.userService.addUser(socket.id);
    await this.updateActiveUserCount();

    socket.on("start", (id: string) => this.handleStart(socket, id));
    socket.on("newMessageToServer", (msg: string) => this.handleNewMessage(socket, msg));
    socket.on("typing", (msg: string) => this.handleTyping(socket, msg));
    socket.on("doneTyping", () => this.handleDoneTyping(socket));
    socket.on("stop", () => this.handleStop(socket));
    socket.on("disconnecting", () => this.handleDisconnecting(socket));
    socket.on("disconnect", () => this.updateActiveUserCount());
  }

  private async handleStart(socket: Socket, id: string): Promise<void> {
    await this.userService.updateUserStatus(id, 'searching');
    await this.userService.updateUserActivity(id);
    await this.tryMatchSockets(socket, id);
  }

  private async tryMatchSockets(socket: Socket, id: string): Promise<void> {
    const peerId = await this.userService.findSearchingUser(id);
    if (peerId) {
      const peerSocket = this.io.sockets.sockets.get(peerId);
      if (peerSocket) {
        await this.matchSockets(socket, peerSocket, id);
      }
    } else {
      socket.emit("searching", "Searching...");
    }
  }

  private async matchSockets(socket: Socket, peer: Socket, id: string): Promise<void> {
    const roomName: string = `${id}#${peer.id}`;
    await this.userService.updateUserStatus(id, 'chatting', roomName);
    await this.userService.updateUserStatus(peer.id, 'chatting', roomName);
    socket.join(roomName);
    peer.join(roomName);
    this.io.to(roomName).emit("chatStart", "You are now chatting with a random stranger");
  }

  private handleNewMessage(socket: Socket, msg: string): void {
    const roomName: string = Array.from(socket.rooms)[1];
    if (roomName) {
      this.io.to(roomName).emit("newMessageToClient", { id: socket.id, msg });
    }
  }

  private handleTyping(socket: Socket, msg: string): void {
    const roomName: string = Array.from(socket.rooms)[1];
    if (roomName) {
      socket.to(roomName).emit("strangerIsTyping", msg);
    }
  }

  private handleDoneTyping(socket: Socket): void {
    const roomName: string = Array.from(socket.rooms)[1];
    if (roomName) {
      socket.to(roomName).emit("strangerIsDoneTyping");
    }
  }

  private async handleStop(socket: Socket): Promise<void> {
    const roomName: string = Array.from(socket.rooms)[1];
    if (roomName) {
      await this.disconnectChat(socket, roomName);
    } else {
      socket.emit("endChat", "You have disconnected");
      await this.userService.removeUser(socket.id);
    }
  }

  private async handleDisconnecting(socket: Socket): Promise<void> {
    const roomName: string = Array.from(socket.rooms)[1];
    if (roomName) {
      this.io.to(roomName).emit("goodBye", "Stranger has disconnected");
      await this.disconnectChat(socket, roomName);
    }
    await this.userService.removeUser(socket.id);
  }

  private async disconnectChat(socket: Socket, roomName: string): Promise<void> {
    const [id1, id2] = roomName.split("#");
    const peerId: string = id1 === socket.id ? id2 : id1;
    const peerSocket = this.io.sockets.sockets.get(peerId);

    if (peerSocket) {
      peerSocket.leave(roomName);
      peerSocket.emit("strangerDisconnected", "Stranger has disconnected");
      await this.userService.updateUserStatus(peerId, 'available');
    }

    socket.leave(roomName);
    socket.emit("endChat", "You have disconnected");
    await this.userService.updateUserStatus(socket.id, 'available');
  }

  private async updateActiveUserCount(): Promise<void> {
    const count = await this.userService.getActiveUserCount();
    this.io.emit("numberOfOnline", count);
  }

  async cleanupInactiveUsers(): Promise<void> {
    console.log('Running inactive user cleanup');
    const removedUsers = await this.userService.removeInactiveUsers(1); // 1 hour threshold

    removedUsers.forEach(socketId => {
      const socket = this.io.sockets.sockets.get(socketId);
      if (socket) {
        socket.disconnect(true);
      }
    });

    console.log(`Removed ${removedUsers.length} inactive users`);
    await this.updateActiveUserCount();
  }
}