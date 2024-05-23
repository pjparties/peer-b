import express from "express";
import cors from "cors";    
import { createServer } from "http";
import { Server } from "socket.io";
import dotenv from "dotenv";
dotenv.config({ path: ".env" });

const app = express();
app.use(
    cors({
        origin: 'http://localhost:3000',
        credentials: true,
    })
);
app.use(
    express.json({
        limit: "50kb",
    })
);


app.get("/", (req, res) => {
    res.send("Hello World!");
});

const httpServer = createServer(app);
const io = new Server(httpServer, {
    cors: {
        origin: 'http://localhost:3000',
        methods: ['GET', 'POST'],
    },
});

let sockets = []; // list of all connected sockets
let searching = []; // list of sockets that are searching for a chat (in queue)
let notAvailable = []; // list of sockets that are already chatting

io.on("connection", async (socket) => {
    // console.log("a user connected", socket.id);
    sockets.push(socket);
    // console.log(sockets.length, " total sockets");
    const allSockets = await io.fetchSockets();
    io.emit("numberOfOnline", allSockets.length);

    socket.on("start", (id) => {
        sockets = sockets.filter((s) => {
            if (s.id === id) {
                searching.push(s);
                return;
            } else {
                return s;
            }
        });
        // console.log(searching.length, "searching")
        let i = 0;
        while (i < searching.length) {
            const peer = searching[i];
            if (peer.id !== id) {
                searching = searching.filter((s) => s.id !== peer.id);
                searching = searching.filter((s) => s.id !== id);
                notAvailable.push(socket, peer);
                const socketRoomToLeave = [...socket.rooms][1];
                const peerRoomToLeave = [...peer.rooms][1];
                socket.leave(socketRoomToLeave);
                peer.leave(peerRoomToLeave);
                const roomName = `${id}#${peer.id}`;
                socket.join(roomName);
                peer.join(roomName);
                io.of("/")
                    .to(roomName)
                    .emit("chatStart", "You are now chatting with a random stranger");
                    // console.log("chat started betweem", id, "and", peer.id, "in room", roomName);     
                break;
            }
            socket.emit("searching", "Searching...");
            i++;
        }
    });

    socket.on("newMessageToServer", (msg) => {
        // get room
        const roomName = [...socket.rooms][1];
        // console.log("new message", msg);
        // console.log("room", roomName);
        io.of("/").to(roomName).emit("newMessageToClient", { id: socket.id, msg });
    });

    // TODO: roomname split undefined error
    socket.on("typing", (msg) => {
        const roomName = [...socket.rooms][1];
        if (!roomName) {
            // console.log("no room found");
            return;
        }
        const ids = roomName.split("#");
        const peerId = ids[0] === socket.id ? ids[1] : ids[0];
        const peer = notAvailable.find((user) => user.id === peerId);
        peer.emit("strangerIsTyping", msg);
    });

    socket.on("doneTyping", () => {
        const roomName = [...socket.rooms][1];
        const ids = roomName.split("#");
        const peerId = ids[0] === socket.id ? ids[1] : ids[0];
        const peer = notAvailable.find((user) => user.id === peerId);
        peer.emit("strangerIsDoneTyping");
    });

    socket.on("stop", () => {
        const roomName = [...socket.rooms][1];
        const ids = roomName.split("#");
        const peerId = ids[0] === socket.id ? ids[1] : ids[0];
        const peer = notAvailable.find((user) => user.id === peerId);
        peer.leave(roomName);
        socket.leave(roomName);
        peer.emit("strangerDisconnected", "Stranger has disconnected");
        socket.emit("endChat", "You have disconnected");
        notAvailable = notAvailable.filter((user) => user.id !== socket.id);
        notAvailable = notAvailable.filter((user) => user.id !== peer.id);
        sockets.push(socket, peer);
    });

    socket.on("disconnecting", async () => {
        const roomName = [...socket.rooms][1];
        if (roomName) {
            io.of("/").to(roomName).emit("goodBye", "Stranger has disconnected");
            const ids = roomName.split("#");
            const peerId = ids[0] === socket.id ? ids[1] : ids[0];
            const peer = notAvailable.find((user) => user.id === peerId);
            peer.leave(roomName);
            notAvailable = notAvailable.filter((user) => user.id !== peerId);
            sockets.push(peer);
        }
        sockets = sockets.filter((user) => user.id !== socket.id);
        searching = searching.filter((user) => user.id !== socket.id);
        notAvailable = notAvailable.filter((user) => user.id !== socket.id);
    });

    socket.on("disconnect", async () => {
        const allSockets = await io.fetchSockets();
        io.emit("numberOfOnline", allSockets.length);
    });
});

httpServer.listen(8000, () => console.log('Server is running on port 8000'));
