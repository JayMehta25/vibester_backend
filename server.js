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
const PORT = process.env.PORT || 5000; // Ensure the server listens to the correct port
app.get("/", (req, res) => {
  res.send("Chat server is running...");
});

// Ensure the "uploads" folder exists
// -----------------------------
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const uploadDir = path.join(__dirname, "uploads");

if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir);
  console.log(`Created uploads folder at ${uploadDir}`);
}

// Enable CORS for frontend communication (ensure the frontend is allowed to access the server)
app.use(
  cors({
    origin: "*", // Allow all origins for the demo; for production, restrict this
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
    cb(null, uploadDir); // Save files to 'uploads' folder
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, uniqueSuffix + "-" + file.originalname); // Generate unique file names
  },
});
const upload = multer({ storage });

// Serve static files from the uploads folder (to allow frontend access)
app.use("/uploads", express.static(uploadDir));

// -----------------------------
// API Endpoint for File Uploads
// -----------------------------
app.post("/upload", upload.single("file"), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "No file uploaded." });
  }

  // For deployed environments like Railway, dynamically construct the URL
  const fileUrl = `https://${req.get("host")}/uploads/${req.file.filename}`; // Use deployed hostname
  const fileType = req.file.mimetype; // Get the file type (image, video, etc.)
  
  // Return the file URL and type to the client
  res.json({ url: fileUrl, type: fileType });
});

// =====================
// NLP Chatbot Setup (node-nlp)
// =====================
// (Add documents and answers here as you did earlier)
const manager = new NlpManager({ languages: ["en"], forceNER: true });

// Add expanded training data... (similar to what you already have)
// Ensure the training data and responses are defined properly
manager.addDocument("en", "hello", "greeting.hello");
manager.addDocument("en", "hi", "greeting.hello");
manager.addDocument("en", "hey", "greeting.hello");
manager.addDocument("en", "good morning", "greeting.morning");
manager.addDocument("en", "good afternoon", "greeting.afternoon");
manager.addDocument("en", "good evening", "greeting.evening");
manager.addDocument("en", "how are you?", "greeting.howAreYou");
manager.addDocument("en", "how's it going?", "greeting.howAreYou");
manager.addDocument("en", "what's up?", "greeting.howAreYou");
manager.addDocument("en", "how are you doing?", "greeting.howAreYou");
manager.addDocument("en", "what's going on?", "greeting.howAreYou");
manager.addDocument("en", "how do you do?", "greeting.howAreYou");

// Responses to "how are you?"
manager.addDocument("en", "I'm good", "response.howAreYouGood");
manager.addDocument("en", "I'm doing well", "response.howAreYouGood");
manager.addDocument("en", "I'm fine", "response.howAreYouGood");
manager.addDocument("en", "I'm great", "response.howAreYouGood");
manager.addDocument("en", "I'm doing okay", "response.howAreYouGood");
manager.addDocument("en", "I'm alright", "response.howAreYouGood");
manager.addDocument("en", "I'm feeling good", "response.howAreYouGood");
manager.addDocument("en", "I'm feeling great", "response.howAreYouGood");

// Asking about the bot
manager.addDocument("en", "what is your name?", "askName");
manager.addDocument("en", "who are you?", "askName");
manager.addDocument("en", "what do you go by?", "askName");
manager.addDocument("en", "what should I call you?", "askName");
manager.addDocument("en", "who am I speaking to?", "askName");
manager.addDocument("en", "tell me your name", "askName");
manager.addDocument("en", "what are you called?", "askName");

// Asking what the bot does
manager.addDocument("en", "what do you do?", "askWhatDoYouDo");
manager.addDocument("en", "what can you do?", "askWhatDoYouDo");
manager.addDocument("en", "what are your capabilities?", "askWhatDoYouDo");
manager.addDocument("en", "what's your job?", "askWhatDoYouDo");
manager.addDocument("en", "what are you capable of?", "askWhatDoYouDo");
manager.addDocument("en", "what's your function?", "askWhatDoYouDo");

// Room and chat functionalities
manager.addDocument("en", "how can I create a room?", "askCreateRoom");
manager.addDocument("en", "how do i get started", "asknewbie");
manager.addDocument("en", "how do I start chatting?", "askStartChatting");
manager.addDocument("en", "how do I join a room?", "askJoinRoom");
manager.addDocument("en", "can I create a private room?", "askCreateRoom");
manager.addDocument("en", "can I chat with people privately?", "askPrivateChat");
manager.addDocument("en", "how do I join a chat?", "askJoinRoom");
manager.addDocument("en", "how can I find a room to join?", "askJoinRoom");

// Asking for help with features
manager.addDocument("en", "I need help", "askHelp");
manager.addDocument("en", "help me with the chat", "askHelp");
manager.addDocument("en", "how do I use the chat?", "askHelp");
manager.addDocument("en", "can you help me with room creation?", "askHelp");

// Asking about chat functionality
manager.addDocument("en", "how do I send a message?", "askSendMessage");
manager.addDocument("en", "how do I chat with someone?", "askSendMessage");
manager.addDocument("en", "can I send files?", "askSendFiles");
manager.addDocument("en", "can I send images?", "askSendFiles");
manager.addDocument("en", "how do I share my screen?", "askShareScreen");
manager.addDocument("en", "can I use audio in the chat?", "askAudioChat");
manager.addDocument("en", "how do I use voice chat?", "askAudioChat");

// Asking about app functionality or usage
manager.addDocument("en", "tell me more about this app", "askAppInfo");
manager.addDocument("en", "what is ChatRouletteX?", "askAppInfo");
manager.addDocument("en", "how does this app work?", "askAppInfo");
manager.addDocument("en", "what can I do on ChatRouletteX?", "askAppInfo");

// Add answers for the intents
manager.addAnswer("en", "greeting.hello", "Hello! How can I assist you today?");
manager.addAnswer("en", "asknewbie", "To get started with ChatRouletteX, simply follow these steps:Start Chatting: Click on the 'Start Chatting' button to immediately join a room and start chatting with people. Create a Room: If you'd like to create a private room, click the 'Create Room' button to generate a unique room code. Join a Room: If someone shared a room code with you, simply click 'Join Room' and enter the code to connect with them. Chat Privately: You can create or join private rooms and connect with others instantly. No sign-up required!?");
manager.addAnswer("en", "greeting.morning", "Good morning! How are you today?");
manager.addAnswer("en", "greeting.afternoon", "Good afternoon! How's your day going?");
manager.addAnswer("en", "greeting.evening", "Good evening! How was your day?");
manager.addAnswer("en", "greeting.howAreYou", "I'm just a chatbot, but I'm doing well, thank you!");
manager.addAnswer("en", "response.howAreYouGood", "That's great to hear! How can I help you today?");
manager.addAnswer("en", "askName", "I'm Chatbot, your friendly assistant.");
manager.addAnswer("en", "askWhatDoYouDo", "I'm here to chat with you and assist with various tasks.");
manager.addAnswer("en", "askCreateRoom", "You can create a room by clicking the 'Create Room' button on the homepage.");
manager.addAnswer("en", "askStartChatting", "You can start chatting by clicking the 'Start Chatting' button to join a room and meet people.");
manager.addAnswer("en", "askJoinRoom", "To join a room, enter the room code or click on a room if it's available.");
manager.addAnswer("en", "askPrivateChat", "Yes, you can create private rooms and chat privately with others.");
manager.addAnswer("en", "askHelp", "Just ask me anything! I can help you create a room, join a room, or start chatting.");
manager.addAnswer("en", "askSendMessage", "To send a message, just type it in the chat box and press 'Send'.");
manager.addAnswer("en", "askSendFiles", "Yes, you can send images or files by using the attachment option in the chat.");
manager.addAnswer("en", "askShareScreen", "You can share your screen through the settings menu if enabled.");
manager.addAnswer("en", "askAudioChat", "You can use voice chat by clicking the audio icon in the chat window.");
manager.addAnswer("en", "askAppInfo", "ChatRouletteX lets you create or join private chat rooms and connect with people instantly.");

// Ensure that the model is trained and saved
(async () => {
  await manager.train();
  manager.save(); // Optional: persist the model
  console.log("NLP Manager trained and ready.");
})();

// =====================
// API Endpoints for Chatbot
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

// --------------------
// Socket.io Setup for Chat
// --------------------
let chatRooms = {}; // Store room info
let connectedUsers = new Set();

// Function to generate room code
const generateRoomCode = () =>
  Math.floor(10000 + Math.random() * 90000).toString();

console.log("🧹 Clearing previous session data...");
chatRooms = {};
connectedUsers.clear();

// Create HTTP server and attach socket.io
const server = http.createServer(app);

// Attach Socket.io server with CORS settings
const io = new Server(server, {
  cors: {
    origin: "*", // Allow all origins for the demo; restrict this for production
    methods: ["GET", "POST"],
  },
});

io.on("connection", (socket) => {
  console.log(`🔵 New user connected: ${socket.id}`);
  connectedUsers.add(socket.id);

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

  socket.on("sendMessage", (data) => {
    const { roomCode, username, message, attachment, audio } = data;
    const trimmedMessage = message ? message.trim() : "";

    if (!roomCode || !username) return;

    if (!trimmedMessage && !attachment && !audio) return;

    console.log(`📨 Message from ${username} in Room ${roomCode}: ${trimmedMessage} ${
      attachment ? "[with attachment]" : ""
    } ${audio ? "[with audio]" : ""}`);

    io.to(roomCode).emit("receiveMessage", {
      username,
      message: trimmedMessage,
      attachment,
      audio,
      timestamp: new Date().toLocaleTimeString(),
    });
  });

  socket.on("typing", (data) => {
    const { roomCode, username } = data;
    socket.to(roomCode).emit("userTyping", { username });
  });

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
