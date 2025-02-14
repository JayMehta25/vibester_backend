import express from "express";
import http from "http";
import { Server } from "socket.io";
import cors from "cors";
import { NlpManager } from "node-nlp";

const app = express();
const PORT = 5000;

// Enable CORS for frontend communication
app.use(
  cors({
    origin: "*", // Allow all origins
    methods: ["GET", "POST"],
  })
);

// Use express.json middleware to parse JSON bodies
app.use(express.json());

// =====================
// NLP Chatbot Setup (node-nlp)
// =====================
const manager = new NlpManager({ languages: ["en"], forceNER: true });

// Add training data
// Greetings
manager.addDocument("en", "hello", "greeting.hello");
manager.addDocument("en", "hi", "greeting.hello");
manager.addDocument("en", "hey", "greeting.hello");
// How are you inquiries
manager.addDocument("en", "how are you", "bot.feelings");
manager.addDocument("en", "how's it going", "bot.feelings");
// Ask about app purpose
manager.addDocument("en", "what is this", "app.purpose");
manager.addDocument("en", "what's this", "app.purpose");
// Features inquiries
manager.addDocument("en", "what features do you have", "app.features");
manager.addDocument("en", "what can you do", "app.features");
// Privacy
manager.addDocument("en", "is my chat secure", "app.privacy");
manager.addDocument("en", "private", "app.privacy");
// How to use the app
manager.addDocument("en", "how do i use this", "app.howto");
manager.addDocument("en", "how to start", "app.howto");
// Account/login
manager.addDocument("en", "login", "app.login");
// Logout
manager.addDocument("en", "logout", "app.logout");
// Support/help
manager.addDocument("en", "help", "app.help");

// Add responses
manager.addAnswer("en", "greeting.hello", "Hello! How can I help you today?");
manager.addAnswer("en", "bot.feelings", "I'm just a bot, but I'm here to assist you!");
manager.addAnswer("en", "app.purpose", "ChatRouletteX connects you with others via private chat rooms and real-time messaging.");
manager.addAnswer("en", "app.features", "Our app offers real-time messaging, voice chats, customizable themes, and more!");
manager.addAnswer("en", "app.privacy", "Your privacy is our priority. All chats remain secure and confidential.");
manager.addAnswer("en", "app.howto", "Getting started is easy! Click on 'Chat Now' to start chatting or create/join a private room.");
manager.addAnswer("en", "app.login", "Simply enter your username on the login page. No complicated registration needed!");
manager.addAnswer("en", "app.logout", "To log out, click the logout button in the navigation bar.");
manager.addAnswer("en", "app.help", "I'm here to help! What do you need assistance with?");

// Default fallback
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

// Chatbot endpoint using node-nlp
app.post("/api/chatbot", async (req, res) => {
  const { message } = req.body;
  if (!message || typeof message !== "string") {
    return res.status(400).json({ reply: "Invalid message." });
  }
  try {
    const result = await manager.process("en", message);
    const reply = result.answer || "I'm not sure I understand. Could you please rephrase your question?";
    return res.json({ reply });
  } catch (error) {
    console.error("Error processing NLP:", error);
    return res.status(500).json({ reply: "Sorry, an error occurred while processing your request." });
  }
});

// Test endpoint to verify POST requests work
app.post("/test", (req, res) => {
  console.log("Received POST /test with body:", req.body);
  res.json({ reply: "Test successful!" });
});

// GET endpoint for root (for quick server verification)
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

const generateRoomCode = () => Math.floor(10000 + Math.random() * 90000).toString();

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

  // Create a new chat room
  socket.on("createRoom", (username) => {
    if (!username || typeof username !== "string" || username.trim() === "") {
      socket.emit("error", "Username is required to create a room.");
      return;
    }
    const roomCode = generateRoomCode();
    chatRooms[roomCode] = [{ socketId: socket.id, username }];
    socket.join(roomCode);
    console.log(`✅ Room created: ${roomCode} by ${username}`);
    socket.emit("roomCreated", roomCode);
    io.to(roomCode).emit("userCount", chatRooms[roomCode].length);
  });

  // Join an existing chat room
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

  // Handle real-time messages
  socket.on("sendMessage", (data) => {
    const { roomCode, username, message } = data;
    if (!roomCode || !username || !message.trim()) return;
    console.log(`📨 Message from ${username} in Room ${roomCode}: ${message}`);
    io.to(roomCode).emit("receiveMessage", { username, message });
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
