// server.js
import express from "express";
import http from "http";
import { Server } from "socket.io";
import cors from "cors";
import { NlpManager } from "node-nlp";
import multer from "multer"; // Import multer for file uploads
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const app = express();
const PORT = 5000;

// -----------------------------
// Ensure the "uploads" folder exists
// -----------------------------
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const uploadDir = path.join(__dirname, "uploads");

if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir);
  console.log(`Created uploads folder at ${uploadDir}`);
}

// Enable CORS for frontend communication
app.use(
  cors({
    origin: "*", // Allow all origins
    methods: ["GET", "POST"],
  })
);

// Use express.json middleware to parse JSON bodies
app.use(express.json());

// -----------------------------
// Multer Setup for File Uploads
// -----------------------------
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, "uploads/"); // Save files to 'uploads' folder
  },
  filename: (req, file, cb) => {
    // Generate a unique filename with a timestamp and random number
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, uniqueSuffix + "-" + file.originalname);
  },
});
const upload = multer({ storage });

// Serve static files from the uploads folder
app.use("/uploads", express.static("uploads"));

// -----------------------------
// API Endpoint for File Uploads
// -----------------------------
app.post("/upload", upload.single("file"), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "No file uploaded." });
  }
  // Construct the URL to access the uploaded file.
  const fileUrl = `http://localhost:${PORT}/uploads/${req.file.filename}`;
  res.json({ url: fileUrl });
});

// =====================
// NLP Chatbot Setup (node-nlp)
// =====================
const manager = new NlpManager({ languages: ["en"], forceNER: true });

// Add training data...
manager.addDocument("en", "hello", "greeting.hello");
manager.addDocument("en", "hi", "greeting.hello");
manager.addDocument("en", "hey", "greeting.hello");
// ... (other training data and answers)
manager.addAnswer("en", "greeting.hello", "Hello! How can I help you today?");
manager.addAnswer("en", "None", "I'm not sure I understand. Could you please rephrase your question?");

// Train the NLP model (runs on server start)
(async () => {
  await manager.train();
  manager.save(); // Optional: persist the model
  console.log("NLP Manager trained and ready.");
})();

// =====================
// API Endpoints
// =====================
app.post("/api/chatbot", async (req, res) => {
  const { message } = req.body;
  if (!message || typeof message !== "string") {
    return res.status(400).json({ reply: "Invalid message." });
  }
  try {
    const result = await manager.process("en", message);
    const reply =
      result.answer ||
      "I'm not sure I understand. Could you please rephrase your question?";
    return res.json({ reply });
  } catch (error) {
    console.error("Error processing NLP:", error);
    return res.status(500).json({
      reply: "Sorry, an error occurred while processing your request.",
    });
  }
});

app.post("/test", (req, res) => {
  console.log("Received POST /test with body:", req.body);
  res.json({ reply: "Test successful!" });
});

app.get("/", (req, res) => {
  res.send("Chat server is running...");
});
app.get("/favicon.ico", (req, res) => {
  res.status(204).send();
});

// =====================
// Socket.io: Chat Room & User Management
// =====================
let chatRooms = {}; // { roomCode: [{ socketId, username }] }
let connectedUsers = new Set();

const generateRoomCode = () =>
  Math.floor(10000 + Math.random() * 90000).toString();

console.log("🧹 Clearing previous session data...");
chatRooms = {};
connectedUsers.clear();

// Create HTTP server
const server = http.createServer(app);

// Attach Socket.io server with CORS settings
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

io.on("connection", (socket) => {
  console.log(`🔵 New user connected: ${socket.id}`);
  connectedUsers.add(socket.id);

  // Create a new chat room with acknowledgement callback
  socket.on("createRoom", (username, callback) => {
    if (!username || typeof username !== "string" || username.trim() === "") {
      if (callback) callback({ error: "Username is required to create a room." });
      return;
    }
    const roomCode = generateRoomCode();
    chatRooms[roomCode] = [{ socketId: socket.id, username }];
    socket.join(roomCode);
    console.log(`✅ Room created: ${roomCode} by ${username}`);
    if (callback) callback(roomCode);
    io.to(roomCode).emit("userCount", chatRooms[roomCode].length);
  });

  // Join an existing chat room with acknowledgement callback
  socket.on("joinRoom", (data, callback) => {
    if (!data || !data.roomCode || !data.username) {
      if (callback) callback({ error: "Room code and username are required to join." });
      return;
    }
    const trimmedRoomCode = data.roomCode.trim();
    const username = data.username.trim();
    console.log(`🔍 Join request received for room: ${trimmedRoomCode}`);
    if (chatRooms[trimmedRoomCode]) {
      chatRooms[trimmedRoomCode].push({ socketId: socket.id, username });
      socket.join(trimmedRoomCode);
      console.log(`✅ User ${username} joined room: ${trimmedRoomCode}`);
      if (callback) callback(trimmedRoomCode);
      io.to(trimmedRoomCode).emit("userCount", chatRooms[trimmedRoomCode].length);
      io.to(trimmedRoomCode).emit("receiveMessage", {
        username: "System",
        message: `${username} has joined the room!`,
      });
    } else {
      console.log(`❌ Room ${trimmedRoomCode} does not exist!`);
      if (callback) callback({ error: "Room does not exist." });
      socket.emit("error", "Room does not exist.");
    }
  });

  // Handle real-time messages (with attachment and audio support)
  socket.on("sendMessage", (data) => {
    const { roomCode, username, message, attachment, audio } = data;
    const trimmedMessage = message ? message.trim() : "";
    if (!roomCode || !username) return;
    // Allow message if there's either text, an attachment, or audio
    if (!trimmedMessage && !attachment && !audio) return;
    console.log(
      `📨 Message from ${username} in Room ${roomCode}: ${trimmedMessage} ${
        attachment ? "[with attachment]" : ""
      } ${audio ? "[with audio]" : ""}`
    );
    io.to(roomCode).emit("receiveMessage", {
      username,
      message: trimmedMessage,
      attachment, // URL returned from /upload if provided
      audio,      // Audio data in a serializable format, if provided
      timestamp: new Date().toLocaleTimeString(),
    });
  });

  // Typing indicator
  socket.on("typing", (data) => {
    const { roomCode, username } = data;
    socket.to(roomCode).emit("userTyping", { username });
  });

  // Handle user disconnection
  socket.on("disconnect", () => {
    console.log(`🔴 User disconnected: ${socket.id}`);
    connectedUsers.delete(socket.id);
    for (const roomCode in chatRooms) {
      const userIndex = chatRooms[roomCode].findIndex(
        (user) => user.socketId === socket.id
      );
      if (userIndex !== -1) {
        const username = chatRooms[roomCode][userIndex].username;
        chatRooms[roomCode].splice(userIndex, 1);
        io.to(roomCode).emit("userCount", chatRooms[roomCode].length);
        io.to(roomCode).emit("receiveMessage", {
          username: "System",
          message: `${username} has left the room.`,
        });
        if (chatRooms[roomCode].length === 0) {
          delete chatRooms[roomCode];
          console.log(`🚪 Room ${roomCode} deleted as it is empty.`);
        }
        break;
      }
    }
  });

  socket.on("forceDisconnect", () => {
    console.log(`🛑 Forcing disconnection for socket: ${socket.id}`);
    socket.disconnect(true);
  });
});

server.listen(PORT, () => {
  console.log(`🚀 Server is running on http://localhost:${PORT}`);
});
