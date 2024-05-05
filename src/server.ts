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

io.on('connection', (socket) => {
    console.log('a user connected');
    socket.emit('hello', 'world');
});

httpServer.listen(8000, () => console.log('Server is running on port 8000'));
