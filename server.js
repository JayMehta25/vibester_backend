const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");

const app = express();
const PORT = 5000;

// Enable CORS for frontend communication
app.use(
    cors({
        origin: "*", // Allow all origins (frontend URL from ngrok or localhost)
        methods: ["GET", "POST"],
    })
);

// Create HTTP server
const server = http.createServer(app);

// Attach WebSocket Server with increased maxHttpBufferSize (if needed)
const io = new Server(server, {
    cors: {
        origin: "*", // Allow WebSocket connections from any origin
        methods: ["GET", "POST"],
    },
});

// **STORE ROOMS & USERS**
let chatRooms = {}; // { roomCode: [{ socketId, username }] }
let connectedUsers = new Set(); // Track all connected users to remove old ones

// **Function to Generate a 5-digit Room Code**
const generateRoomCode = () => Math.floor(10000 + Math.random() * 90000).toString();

// **Clear Old Users on Startup**
console.log("🧹 Clearing previous session data...");
chatRooms = {}; // Reset chat rooms
connectedUsers.clear(); // Reset users

// **Test Endpoint to Verify Server is Running**
app.get("/", (req, res) => {
    res.send("Chat server is running...");
});

app.get("/favicon.ico", (req, res) => {
    res.status(204).send(); // Respond with "No Content"
});

// **Handle WebSocket Connections**
io.on("connection", (socket) => {
    console.log(`🔵 New user connected: ${socket.id}`);
    connectedUsers.add(socket.id); // Add user to active session

    // **Create a New Chat Room**
    socket.on("createRoom", (username) => {
        if (!username || typeof username !== "string" || username.trim() === "") {
            socket.emit("error", "Username is required to create a room.");
            return;
        }

        const roomCode = generateRoomCode();
        chatRooms[roomCode] = [{ socketId: socket.id, username }]; // Store room with first user
        socket.join(roomCode);

        console.log(`✅ Room created: ${roomCode} by ${username}`);
        socket.emit("roomCreated", roomCode); // Send room code to client
        io.to(roomCode).emit("userCount", chatRooms[roomCode].length);
    });

    // **Join an Existing Chat Room**
    socket.on("joinRoom", (data) => {
        if (!data || !data.roomCode || !data.username) {
            socket.emit("error", "Room code and username are required to join.");
            return;
        }

        const trimmedRoomCode = data.roomCode.trim();
        const username = data.username.trim();

        console.log(`🔍 Join request received for room: ${trimmedRoomCode}`);

        if (chatRooms[trimmedRoomCode]) {
            chatRooms[trimmedRoomCode].push({ socketId: socket.id, username });
            socket.join(trimmedRoomCode);

            console.log(`✅ User ${username} joined room: ${trimmedRoomCode}`);
            socket.emit("roomJoined", trimmedRoomCode);
            io.to(trimmedRoomCode).emit("userCount", chatRooms[trimmedRoomCode].length);
            io.to(trimmedRoomCode).emit("receiveMessage", {
                username: "System",
                message: `${username} has joined the room!`,
            });
        } else {
            console.log(`❌ Room ${trimmedRoomCode} does not exist!`);
            socket.emit("error", "Room does not exist.");
        }
    });

    // **Handle Real-time Messages**
    socket.on("sendMessage", (data) => {
        const { roomCode, username, message } = data;
        if (!roomCode || !username || !message.trim()) return;

        console.log(`📨 Message from ${username} in Room ${roomCode}: ${message}`);
        io.to(roomCode).emit("receiveMessage", { username, message });
    });

    // **Typing Indicator**
    socket.on("typing", (data) => {
        const { roomCode, username } = data;
        socket.to(roomCode).emit("userTyping", { username });
    });

    // **Handle User Disconnection**
    socket.on("disconnect", () => {
        console.log(`🔴 User disconnected: ${socket.id}`);

        // **Remove User from the Connected Users List**
        connectedUsers.delete(socket.id);

        // **Find and Remove the User from their Room**
        for (const roomCode in chatRooms) {
            const userIndex = chatRooms[roomCode].findIndex((user) => user.socketId === socket.id);

            if (userIndex !== -1) {
                const username = chatRooms[roomCode][userIndex].username;
                chatRooms[roomCode].splice(userIndex, 1); // Remove user from the room

                // Notify remaining users
                io.to(roomCode).emit("userCount", chatRooms[roomCode].length);
                io.to(roomCode).emit("receiveMessage", {
                    username: "System",
                    message: `${username} has left the room.`,
                });

                // **Delete the Room if Empty**
                if (chatRooms[roomCode].length === 0) {
                    delete chatRooms[roomCode];
                    console.log(`🚪 Room ${roomCode} deleted as it is empty.`);
                }
                break;
            }
        }
    });

    // **Force Disconnect Users from Previous Sessions when Server Restarts**
    socket.on("forceDisconnect", () => {
        console.log(`🛑 Forcing disconnection for socket: ${socket.id}`);
        socket.disconnect(true);
    });
});

// **Start the Backend Server**
server.listen(PORT, () => {
    console.log(`🚀 Server is running on http://localhost:${PORT}`);
});
