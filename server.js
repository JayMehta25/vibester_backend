import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { fileURLToPath } from 'url';
import nodemailer from 'nodemailer';
import bodyParser from 'body-parser';
import dotenv from 'dotenv';
import crypto from 'crypto';
import connectDB from './config/db.js'; // Import the connectDB function
import pkg from 'node-nlp'; // Import the entire package
import axios from 'axios';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';
ffmpeg.setFfmpegPath(ffmpegInstaller.path);
import timeout from 'connect-timeout';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- GLOBAL CORS HEADERS FOR ALL ROUTES AND STATIC FILES ---
// This ensures all responses have the correct CORS headers for uploads, audio, and any other resource
const app = express();
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, HEAD');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Accept, Origin, Range');
  res.setHeader('Accept-Ranges', 'bytes');
  next();
});

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: ['http://localhost:3000', 'http://localhost:5173'],
    methods: ["GET", "POST"],
    credentials: true,
    allowedHeaders: ["Content-Type", "Authorization", "Accept", "Origin"]
  },
  transports: ['websocket', 'polling'],
  path: '/socket.io/'
});

// CORS configuration (allow all origins for global access)
app.use(cors({
  origin: '*',
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Accept', 'Origin']
}));

const { NlpManager } = pkg; // Destructure to get NlpManager

// Load environment variables
dotenv.config();

// A map from an interest to the room that serves it.
const interestToRoomMap = new Map();

app.enable('trust proxy');
io.engine.on("initial_headers", (headers, req) => {
  const origin = req.headers.origin;
  if (origin) {
    headers["Access-Control-Allow-Origin"] = origin;
  }
});

// Function to generate a unique room code
const generateRoomCode = () => {
  return Math.random().toString(36).substring(2, 8); // Generates a random string of 6 characters
};
const allowedOrigins = [
  'http://localhost:3000',
  // /https:\/\/(.*\.)?chatroullete-x-frontend-stage-7\.vercel\.app/,
  // 'https://chatroullete-x-frontend.vercel.app' // Your production domain
];
// Initialize socket.io with CORS and buffer size for attachments


// Database setup
const PORT = process.env.PORT || 5000;
const JWT_SECRET = process.env.JWT_SECRET || 'Xn2r5u8x/A?D(G+KbPeShVmYp3s6v9y$';
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb+srv://Jay:Jaymehta10@chatroulletex.hqjno.mongodb.net/?retryWrites=true&w=majority&appName=chatRoulleteX';

// Load environment variables
console.log('Environment check:');
console.log('- NODE_ENV:', process.env.NODE_ENV);
console.log('- EMAIL_USER exists:', !!process.env.EMAIL_USER);
console.log('- EMAIL_PASS exists:', !!process.env.EMAIL_PASS);

// Connect to MongoDB
await connectDB(); // Ensure this is awaited in an async context

// WARNING: This will delete all users - only do this in development
if (process.env.NODE_ENV === 'development') {
  try {
    await mongoose.connection.db.dropCollection('users'); // Ensure this is awaited
    console.log('Dropped users collection to reset indexes');
  } catch (error) {
    // Collection might not exist yet
    console.log('No users collection to drop or other error:', error.message);
  }
}

// Define the User model
const UserSchema = new mongoose.Schema({
  username: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    minlength: 3
  },
  email: {
    type: String,
    required: true,
    unique: true,
    trim: true
  },
  password: {
    type: String,
    required: true,
    minlength: 6
  },
  isVerified: {
    type: Boolean,
    default: false
  },
  verificationToken: String,
  verificationTokenExpires: Date,
  createdAt: {
    type: Date,
    default: Date.now
  },
  resetPasswordToken: String,
  resetPasswordExpires: Date
});

// Create the User model
const User = mongoose.model('User', UserSchema);

// Maps for active users and rooms
const userSocketMap = new Map();
const socketToUserMap = new Map(); // Map socket ID to username
const activeRooms = new Map();
const waitingUsersByInterest = new Map();


app.use(bodyParser.json());
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Add a timeout middleware for uploads and API requests
app.use(timeout('30s'));
app.use((req, res, next) => {
  if (!req.timedout) next();
});

// Serve static files from the 'uploads' directory
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Serve static files from the React app (if applicable)
app.use(express.static(path.join(__dirname, 'client/build')));

// File upload configuration
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, 'uploads');
    if (!fs.existsSync(uploadDir)){
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    // Generate unique filename with original extension
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    let fileExt = path.extname(file.originalname) || '';
    
    // For audio files, ensure we have a proper extension
    if (file.mimetype.startsWith('audio/')) {
      if (!fileExt) {
        // Map MIME types to extensions
        const mimeToExt = {
          'audio/webm': '.webm',
          'audio/mpeg': '.mp3',
          'audio/mp3': '.mp3',
          'audio/wav': '.wav',
          'audio/ogg': '.ogg',
          'audio/mp4': '.m4a',
          'audio/aac': '.aac',
          'audio/flac': '.flac'
        };
        fileExt = mimeToExt[file.mimetype] || '.webm';
      }
      console.log(`Audio file upload: ${file.originalname} -> ${fileExt} (${file.mimetype})`);
    }
    
    cb(null, 'file-' + uniqueSuffix + fileExt);
  }
});

// Set up file filter for uploads
const fileFilter = (req, file, cb) => {
  const allowedTypes = [
    // Images
    'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml',
    // Videos
    'video/mp4', 'video/webm', 'video/quicktime', 'video/x-ms-wmv', 'video/x-msvideo',
    // Audio
    'audio/mpeg', 'audio/mp3', 'audio/mp4', 'audio/ogg', 'audio/wav', 'audio/webm',
    // Documents
    'application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'text/plain', 'application/json'
  ];
  
  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    console.log(`Rejected file with mimetype: ${file.mimetype}`);
    cb(null, false);
  }
};

// Update multer config to reduce max file size
const upload = multer({ 
  storage,
  fileFilter,
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB max file size
});

// Add OPTIONS handler for /upload endpoint
app.options('/upload', cors({
  origin: function(origin, callback) {
    if (!origin) return callback(null, true);
    if (origin.endsWith('.ngrok-free.app')) return callback(null, true);
    if (origin.startsWith('http://localhost:')) return callback(null, true);
    callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Accept', 'Origin']
}));

// Update the upload endpoint with explicit CORS
app.post('/upload', cors({
  origin: function(origin, callback) {
    if (!origin) return callback(null, true);
    if (origin.endsWith('.ngrok-free.app')) return callback(null, true);
    if (origin.startsWith('http://localhost:')) return callback(null, true);
    callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Accept', 'Origin']
}), upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      console.error('No file received in upload request');
      return res.status(400).json({ message: 'No file uploaded' });
    }
    
    const filePath = req.file.path;
    const ext = path.extname(req.file.filename).toLowerCase();
    // Only convert audio files (webm, ogg, wav, m4a)
    const audioExts = ['.webm', '.ogg', '.wav', '.m4a'];
    if (audioExts.includes(ext)) {
      // Convert to MP3
      const mp3Filename = req.file.filename.replace(ext, '.mp3');
      const mp3Path = path.join(path.dirname(filePath), mp3Filename);
      await new Promise((resolve, reject) => {
        ffmpeg(filePath)
          .toFormat('mp3')
          .on('end', resolve)
          .on('error', reject)
          .save(mp3Path);
      });
      // Optionally, delete the original file if you want
      // fs.unlinkSync(filePath);
      // Respond with the MP3 file URL
      const fileUrl = `/uploads/${mp3Filename}`;
      return res.json({
        url: fileUrl,
        filename: mp3Filename,
        mimetype: 'audio/mp3'
      });
    }
    // For non-audio files, just return as before
    const fileUrl = `/uploads/${req.file.filename}`;
    res.json({
      url: fileUrl,
      filename: req.file.filename,
      mimetype: req.file.mimetype
    });
  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ message: 'Upload failed', error: error.message });
  }
});

// Update the static file serving middleware
app.use('/uploads', express.static(path.join(__dirname, 'uploads'), {
  setHeaders: (res, filePath) => {
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, Accept, Origin, Range');
    res.set('Accept-Ranges', 'bytes');
    
    // Set correct MIME type for images
    const imageExtensions = {
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.gif': 'image/gif',
      '.webp': 'image/webp',
      '.svg': 'image/svg+xml'
    };
    const ext = filePath.toLowerCase().substring(filePath.lastIndexOf('.'));
    if (imageExtensions[ext]) {
      res.set('Content-Type', imageExtensions[ext]);
      res.set('Cache-Control', 'public, max-age=31536000');
    }

    // Enhanced audio file handling with better MIME type detection
    const audioExtensions = {
      '.webm': 'audio/webm',
      '.mp3': 'audio/mpeg',
      '.wav': 'audio/wav',
      '.ogg': 'audio/ogg',
      '.m4a': 'audio/mp4',
      '.aac': 'audio/aac',
      '.flac': 'audio/flac'
    };
    if (audioExtensions[ext]) {
      res.set('Content-Type', audioExtensions[ext]);
      res.set('Cache-Control', 'public, max-age=31536000');
      console.log(`Audio file requested: ${filePath} with MIME type: ${audioExtensions[ext]}`);
    }
    
    // Handle files without extensions (check file content)
    if (!ext || ext === path) {
      // Try to detect audio files by reading first few bytes
      const fs = require('fs');
      const filePath = path.join(__dirname, 'uploads', path.substring(path.lastIndexOf('/') + 1));
      
      try {
        if (fs.existsSync(filePath)) {
          const buffer = fs.readFileSync(filePath, { start: 0, end: 12 });
          
          // Check for WebM signature
          if (buffer.toString('hex').startsWith('1a45dfa3')) {
            res.set('Content-Type', 'audio/webm');
            console.log(`Detected WebM audio file: ${path}`);
          }
          // Check for MP3 signature
          else if (buffer.toString('hex').startsWith('494433') || buffer.toString('hex').startsWith('fffb')) {
            res.set('Content-Type', 'audio/mpeg');
            console.log(`Detected MP3 audio file: ${path}`);
          }
          // Check for WAV signature
          else if (buffer.toString('hex').startsWith('52494646')) {
            res.set('Content-Type', 'audio/wav');
            console.log(`Detected WAV audio file: ${path}`);
          }
          // Default to audio/webm for unknown audio files
          else {
            res.set('Content-Type', 'audio/webm');
            console.log(`Defaulting to audio/webm for: ${path}`);
          }
          
          res.set('Cache-Control', 'public, max-age=31536000');
        }
      } catch (error) {
        console.log(`Error reading file for MIME detection: ${error.message}`);
      }
    }
  }
}));

// Add a test endpoint for audio files
app.get('/test-audio/:filename', (req, res) => {
  const filename = req.params.filename;
  const filePath = path.join(__dirname, 'uploads', filename);
  
  console.log(`Testing audio file: ${filename}`);
  console.log(`Full path: ${filePath}`);
  
  if (fs.existsSync(filePath)) {
    const stats = fs.statSync(filePath);
    console.log(`File exists, size: ${stats.size} bytes`);
    
    // Set proper headers
    res.set('Content-Type', 'audio/webm');
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Accept-Ranges', 'bytes');
    
    // Send the file
    res.sendFile(filePath);
  } else {
    console.log(`File not found: ${filePath}`);
    res.status(404).json({ error: 'Audio file not found' });
  }
});

// Add an endpoint to get audio in different formats for iOS compatibility
app.get('/audio/:filename', (req, res) => {
  const filename = req.params.filename;
  const filePath = path.join(__dirname, 'uploads', filename);
  const userAgent = req.headers['user-agent'] || '';
  const isIOS = /iPad|iPhone|iPod/.test(userAgent);
  const isSafari = /Safari/.test(userAgent) && !/Chrome/.test(userAgent);
  
  console.log(`Audio request for: ${filename}, iOS: ${isIOS}, Safari: ${isSafari}`);
  
  if (fs.existsSync(filePath)) {
    const stats = fs.statSync(filePath);
    console.log(`File exists, size: ${stats.size} bytes`);
    
    // For iOS/Safari devices, serve with more compatible headers
    if (isIOS || isSafari) {
      if (filename.endsWith('.webm')) {
        // Try to serve WebM as MP4 for iOS compatibility
        res.set('Content-Type', 'audio/mp4');
        console.log('Serving WebM as MP4 for iOS/Safari compatibility');
      } else {
        // Set content type based on file extension
        const ext = path.extname(filename).toLowerCase();
        const mimeTypes = {
          '.webm': 'audio/webm',
          '.mp3': 'audio/mpeg',
          '.wav': 'audio/wav',
          '.ogg': 'audio/ogg',
          '.m4a': 'audio/mp4',
          '.mp4': 'audio/mp4'
        };
        res.set('Content-Type', mimeTypes[ext] || 'audio/mp4');
      }
      
      // Add additional headers for iOS compatibility
      res.set('Access-Control-Allow-Origin', '*');
      res.set('Accept-Ranges', 'bytes');
      res.set('Cache-Control', 'public, max-age=31536000');
      res.set('X-Content-Type-Options', 'nosniff');
      
      // For iOS, try to force the browser to treat it as audio
      if (isIOS) {
        res.set('Content-Disposition', 'inline');
      }
    } else {
      // Standard headers for other browsers
      const ext = path.extname(filename).toLowerCase();
      const mimeTypes = {
        '.webm': 'audio/webm',
        '.mp3': 'audio/mpeg',
        '.wav': 'audio/wav',
        '.ogg': 'audio/ogg',
        '.m4a': 'audio/mp4',
        '.mp4': 'audio/mp4'
      };
      res.set('Content-Type', mimeTypes[ext] || 'audio/webm');
      res.set('Access-Control-Allow-Origin', '*');
      res.set('Accept-Ranges', 'bytes');
      res.set('Cache-Control', 'public, max-age=31536000');
    }
    
    // Send the file
    res.sendFile(filePath);
  } else {
    console.log(`File not found: ${filePath}`);
    res.status(404).json({ error: 'Audio file not found' });
  }
});

// Add an endpoint to validate audio files
app.get('/validate-audio/:filename', (req, res) => {
  const filename = req.params.filename;
  const filePath = path.join(__dirname, 'uploads', filename);
  
  console.log(`Validating audio file: ${filename}`);
  
  if (fs.existsSync(filePath)) {
    const stats = fs.statSync(filePath);
    console.log(`File exists, size: ${stats.size} bytes`);
    
    // Read first few bytes to check file signature
    try {
      const buffer = fs.readFileSync(filePath, { start: 0, end: 12 });
      const hex = buffer.toString('hex');
      
      let format = 'unknown';
      if (hex.startsWith('1a45dfa3')) {
        format = 'webm';
      } else if (hex.startsWith('494433') || hex.startsWith('fffb')) {
        format = 'mp3';
      } else if (hex.startsWith('52494646')) {
        format = 'wav';
      } else if (hex.startsWith('66747970')) {
        format = 'mp4';
      }
      
      res.json({
        valid: true,
        size: stats.size,
        format: format,
        path: filePath
      });
    } catch (error) {
      console.error('Error reading file:', error);
      res.status(500).json({ error: 'Error reading file' });
    }
  } else {
    console.log(`File not found: ${filePath}`);
    res.status(404).json({ error: 'Audio file not found' });
  }
});

// Updated registration endpoint to handle existing users
app.post('/register', async (req, res) => {
  try {
    const { username, email, password } = req.body;
    
    // Validate input
    if (!username || !email || !password) {
      return res.status(400).json({ message: 'Username, email, and password are required' });
    }
    
    // Check if email already exists
    const existingUser = await User.findOne({ email });
    
    if (existingUser) {
      // User with this email already exists
      if (existingUser.isVerified) {
        // User is already verified, redirect to login
        return res.status(400).json({ 
          message: 'This email is already registered and verified. Please login instead.',
          redirectTo: '/login'
        });
      } else {
        // User exists but not verified - update their details
        console.log('Updating existing unverified user:', existingUser.username);
        
        // Update username and password
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);
        
        existingUser.username = username;
        existingUser.password = hashedPassword;
        await existingUser.save();
        
        // Generate a new verification token/OTP
        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        existingUser.verificationToken = otp;
        existingUser.verificationTokenExpires = Date.now() + 3600000; // 1 hour
        await existingUser.save();
        
        // Send OTP email logic here...
        // (existing email sending code)
        
        return res.status(200).json({
          message: 'Account already exists but not verified. We\'ve sent a new verification code.',
          email: existingUser.email,
          redirectTo: '/verify-email'
        });
      }
    }
    
    // This is a new user - create account
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);
    
    // Create new user
    const newUser = new User({
      username,
      email,
      password: hashedPassword,
      isVerified: false
    });
    
    // Save user to database
    await newUser.save();
    
    console.log(`User registered successfully: ${username} (${email})`);
    
    // Generate a verification token/OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    newUser.verificationToken = otp;
    newUser.verificationTokenExpires = Date.now() + 3600000; // 1 hour
    await newUser.save();
    
    // Send OTP email (your existing email code here)
    
    // Return success 
    res.status(201).json({
      message: 'Registration successful! Please verify your email.',
      email: newUser.email,
      redirectTo: '/verify-email'
    });
    
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ message: 'Server error during registration' });
  }
});


app.options('/login', (req, res) => {
  res.sendStatus(200);
});

// Updated login endpoint to check verification status
app.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    
    // Validate input
    if (!email || !password) {
      return res.status(400).json({ message: 'Email and password are required' });
    }
    
    // Find user by email
    const user = await User.findOne({ email });
    
    // Check if user exists
    if (!user) {
      return res.status(404).json({ 
        message: 'User not found. Please register first.',
        redirectTo: '/register'
      });
    }
    
    // Check if password is correct
    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      return res.status(401).json({ message: 'Invalid password' });
    }
    
    // Check if user is verified
    if (!user.isVerified) {
      // Generate a new OTP for verification
      const otp = Math.floor(100000 + Math.random() * 900000).toString();
      user.verificationToken = otp;
      user.verificationTokenExpires = Date.now() + 3600000; // 1 hour
      await user.save();
      
      // Send OTP email (your existing email code here)
      
      return res.status(403).json({ 
        message: 'Please verify your email before logging in.',
        email: user.email,
        redirectTo: '/verify-email'
      });
    }
    
    // Create JWT token
    const token = jwt.sign(
      { id: user._id, username: user.username },
      JWT_SECRET,
      { expiresIn: '24h' }
    );
    
    // Return success with token
    return res.status(200).json({
      message: 'Login successful',
      token,
      username: user.username,
      email: user.email,
      redirectTo: '/chatlanding',
      isVerified: true
    });
    
  } catch (error) {
    console.error('Login error:', error);
    return res.status(500).json({ message: 'Server error during login' });
  }
});

app.get('/verify/:token', cors({
  origin: ['http://localhost:3000', 'http://localhost:5173'],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}), async (req, res) => {
  const user = await User.findOne({ verificationToken: req.params.token });
  if (!user) {
    return res.status(400).send('Invalid verification token');
  }

  user.isVerified = true;
  user.verificationToken = null; // Clear the token
  await user.save();

  res.send('Email verified successfully! You can now log in.');
});

// Updated send-verification-otp endpoint with better credential handling
app.post('/send-verification-otp', async (req, res) => {
  try {
    const { email } = req.body;
    
    console.log('Sending verification OTP to:', email);
    
    if (!email) {
      return res.status(400).json({ message: 'Email is required' });
    }
    
    // Find the user by email
    const user = await User.findOne({ email });
    
    if (!user) {
      console.log('User not found for email:', email);
      return res.status(404).json({ message: 'User not found' });
    }
    
    // Generate a 6-digit OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    console.log('Generated OTP:', otp);
    
    // Store OTP in user record
    user.verificationToken = otp;
    user.verificationTokenExpires = Date.now() + 3600000; // 1 hour
    await user.save();
    
    // IMPORTANT: Check that credentials exist and log them (securely)
    const emailUser = process.env.EMAIL_USER;
    const emailPass = process.env.EMAIL_PASS;
    
    console.log('Email credentials check:');
    console.log('- Username provided:', emailUser ? 'YES' : 'NO');
    console.log('- Password provided:', emailPass ? 'YES' : 'NO');
    
    if (!emailUser || !emailPass) {
      console.error('❌ EMAIL CREDENTIALS NOT PROVIDED - Check your .env file');
      return res.status(500).json({ 
        message: 'Email service configuration error. Please contact support.'
      });
    }
    
    // Create transporter with explicit credentials
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: emailUser,
        pass: emailPass
      },
      debug: true // Enable debugging output
    });
    
    // Verify the connection configuration
    try {
      await transporter.verify();
      console.log('✅ SMTP connection verified successfully');
    } catch (verifyError) {
      console.error('❌ SMTP verification failed:', verifyError);
      return res.status(500).json({ 
        message: 'Email service not available. Please try again later.'
      });
    }
    
    // Configure mail options
    const mailOptions = {
      from: `"Chat App" <${emailUser}>`,
      to: email,
      subject: 'Your Verification Code',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #ddd; border-radius: 5px;">
          <h2 style="color: #333;">Your Verification Code</h2>
          <p>Please use the following code to verify your account:</p>
          <div style="background-color: #f5f5f5; padding: 15px; font-size: 24px; text-align: center; letter-spacing: 5px; font-weight: bold;">
            ${otp}
          </div>
          <p style="margin-top: 20px;">This code will expire in 1 hour.</p>
          <p>If you didn't request this code, please ignore this email.</p>
        </div>
      `
    };
    
    // Send email
    try {
      const info = await transporter.sendMail(mailOptions);
      console.log('✅ Email sent successfully:', info.messageId);
      
      return res.status(200).json({
        message: 'Verification code sent to your email'
      });
    } catch (emailError) {
      console.error('❌ Failed to send email:', emailError);
      return res.status(500).json({ 
        message: 'Failed to send verification email. Please try again later.'
      });
    }
    
  } catch (error) {
    console.error('❌ Error in send-verification-otp:', error);
    return res.status(500).json({ message: 'Server error' });
  }
});

// Updated verify-otp endpoint to include showAlert flag for SweetAlert
app.post('/verify-otp', async (req, res) => {
  try {
    const { email, otp } = req.body;
    
    console.log('Verifying OTP -', 'Email:', email, 'Submitted OTP:', otp);
    
    if (!email || !otp) {
      console.log('Missing required fields');
      return res.status(400).json({ message: 'Email and OTP are required' });
    }
    
    // Find user
    const user = await User.findOne({ email });
    if (!user) {
      console.log('User not found');
      return res.status(404).json({ message: 'User not found' });
    }
    
    console.log('User found:', user.username);
    console.log('Stored token:', user.verificationToken);
    console.log('Token expires:', user.verificationTokenExpires);
    
    // Check if OTP exists
    if (!user.verificationToken) {
      console.log('No verification token found');
      return res.status(400).json({ 
        message: 'No verification code found. Please request a new one.' 
      });
    }
    
    // Convert both to strings for comparison
    const submittedOtp = String(otp);
    const storedToken = String(user.verificationToken);
    
    console.log('Comparing:', submittedOtp, 'vs', storedToken);
    
    // Check if OTP matches
    if (submittedOtp !== storedToken) {
      console.log('Invalid OTP');
      return res.status(400).json({ message: 'Invalid verification code' });
    }
    
    // Check if token is expired
    if (user.verificationTokenExpires < Date.now()) {
      console.log('Token expired');
      return res.status(400).json({ 
        message: 'Verification code expired. Please request a new one.' 
      });
    }
    
    // Mark user as verified
    user.isVerified = true;
    user.verificationToken = undefined;
    user.verificationTokenExpires = undefined;
    await user.save();
    
    console.log('User verified successfully');
    
    // Create token
    const token = jwt.sign(
      { id: user._id, username: user.username },
      JWT_SECRET,
      { expiresIn: '24h' }
    );
    
    // Return token with showAlert flag for SweetAlert
    return res.status(200).json({
      message: 'Email verified successfully',
      token,
      username: user.username,
      nextStep: 'chatlanding',
      redirectTo: '/chatlanding',
      showAlert: true,
      alertTitle: 'Verification Successful!',
      alertText: 'Your email has been verified. Welcome to the app!',
      alertIcon: 'success'
    });
    
  } catch (error) {
    console.error('OTP verification error:', error);
    return res.status(500).json({ message: 'Server error' });
  }
});

// Add a verification status check endpoint
app.post('/check-verification-status', async (req, res) => {
  try {
    const { email } = req.body;
    
    if (!email) {
      return res.status(400).json({ message: 'Email is required' });
    }
    
    const user = await User.findOne({ email });
    
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    
    res.status(200).json({
      hasVerificationToken: !!user.verificationToken,
      tokenExpired: user.verificationTokenExpires < Date.now(),
      isVerified: user.isVerified
    });
    
  } catch (error) {
    console.error('Error checking verification status:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Add a route to generate a test OTP for any email
app.post('/generate-test-otp', async (req, res) => {
  try {
    const { email } = req.body;
    
    if (!email) {
      return res.status(400).json({ message: 'Email is required' });
    }
    
    const user = await User.findOne({ email });
    
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    
    // Generate a test OTP
    const otp = "123456";
    
    // Save it to the user
    user.verificationToken = otp;
    user.verificationTokenExpires = Date.now() + 3600000; // 1 hour
    await user.save();
    
    return res.status(200).json({
      message: 'Test OTP generated',
      email,
      otp
    });
  } catch (error) {
    console.error('Error generating test OTP:', error);
    return res.status(500).json({ message: 'Server error' });
  }
});

// DEBUGGING UTILITY - Add endpoint to check all existing routes
app.get('/debug/routes', (req, res) => {
  const routes = [];
  
  app._router.stack.forEach((middleware) => {
    if (middleware.route) {
      // Routes registered directly on the app
      routes.push({
        path: middleware.route.path,
        methods: Object.keys(middleware.route.methods).join(', ')
      });
    } else if (middleware.name === 'router') {
      // Routes added via router
      middleware.handle.stack.forEach((handler) => {
        if (handler.route) {
          routes.push({
            path: handler.route.path,
            methods: Object.keys(handler.route.methods).join(', ')
          });
        }
      });
    }
  });
  
  res.json(routes);
});

// COMPLETELY REWRITE the verification endpoints with a simplified approach
app.post('/debug-verify', async (req, res) => {
  try {
    const { email } = req.body;
    
    if (!email) {
      return res.status(400).json({ message: 'Email is required' });
    }
    
    console.log('Debug verification requested for:', email);
    
    // Find user
    const user = await User.findOne({ email });
    
    if (!user) {
      return res.status(404).json({ message: 'User not found with email: ' + email });
    }
    
    // Force verify this user
    user.isVerified = true;
    await user.save();
    
    // Create token
    const token = jwt.sign(
      { id: user._id, username: user.username },
      JWT_SECRET,
      { expiresIn: '24h' }
    );
    
    console.log('User verified via debug endpoint:', user.username);
    
    return res.status(200).json({
      message: 'Debug verification successful',
      token,
      username: user.username
    });
  } catch (error) {
    console.error('Debug verification error:', error);
    return res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Add a simple version that handles everything in one request
app.post('/simple-verify', async (req, res) => {
  try {
    const { email } = req.body;
    
    if (!email) {
      return res.status(400).json({ message: 'Email is required' });
    }
    
    console.log('Simple verification requested for:', email);
    
    // Find user
    const user = await User.findOne({ email });
    
    if (!user) {
      return res.status(404).json({ message: 'User not found with email: ' + email });
    }
    
    // Generate a code and save it immediately
    const code = "123456";
    user.verificationToken = code;
    user.verificationTokenExpires = Date.now() + 3600000;
    await user.save();
    
    console.log('Generated and saved verification code for user:', user.username);
    
    // Now verify this user with the same code
    if (user.verificationToken !== code) {
      return res.status(400).json({ 
        message: 'Verification failed - token mismatch',
        savedToken: user.verificationToken,
        generatedCode: code
      });
    }
    
    // Verify user
    user.isVerified = true;
    await user.save();
    
    // Create token
    const token = jwt.sign(
      { id: user._id, username: user.username },
      JWT_SECRET,
      { expiresIn: '24h' }
    );
    
    console.log('User verified via simple endpoint:', user.username);
    
    return res.status(200).json({
      message: 'Simple verification successful',
      token,
      username: user.username
    });
  } catch (error) {
    console.error('Simple verification error:', error);
    return res.status(500).json({ message: 'Server error', error: error.message });
  }
});

app.get('/test', (req, res) => {
  res.json({ message: 'Backend is alive' });
});


// Route to request password reset
app.post('/forgot-password', async (req, res) => {
  console.log('✅ Hit /forgot-password')
  try {
    const { email } = req.body;
    
    if (!email) {
      return res.status(400).json({ message: 'Email is required' });
    }
    
    // Find user by email
    const user = await User.findOne({ email });
    
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    
    // Generate reset token (random string)
    const resetToken = crypto.randomBytes(32).toString('hex');
    
    // Hash the token for security before storing
    const hashedToken = crypto
      .createHash('sha256')
      .update(resetToken)
      .digest('hex');
    
    // Set token and expiration on user document
    user.resetPasswordToken = hashedToken;
    user.resetPasswordExpires = Date.now() + 3600000; // 1 hour
    await user.save();
    
    // Create reset URL - adjusted for React frontend
    const resetUrl = `http://localhost:3000/reset-password/${resetToken}`;
    
    // Configure email transporter
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
      },
      debug: true // Enable debugging output
    });
    
    // Verify email configuration
    try {
      await transporter.verify();
      console.log('✅ SMTP connection verified successfully for password reset');
    } catch (verifyError) {
      console.error('❌ SMTP verification failed:', verifyError);
      return res.status(500).json({ 
        message: 'Email service not available. Please try again later.'
      });
    }
    
    // Create email
    const mailOptions = {
      from: `"Chat App" <${process.env.EMAIL_USER}>`,
      to: email,
      subject: 'Password Reset Request',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #ddd; border-radius: 5px;">
          <h2 style="color: #333;">Password Reset Request</h2>
          <p>You requested a password reset for your Chat App account. Click the button below to reset your password:</p>
          <div style="text-align: center; margin: 30px 0;">
            <a href="${resetUrl}" style="background-color: #4CAF50; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; display: inline-block; font-weight: bold;">Reset Password</a>
          </div>
          <p>If you didn't request this, please ignore this email and your password will remain unchanged.</p>
          <p>This link is valid for 1 hour.</p>
        </div>
      `
    };
    
    // Send email
    try {
      const info = await transporter.sendMail(mailOptions);
      console.log('✅ Password reset email sent successfully:', info.messageId);
      
      return res.status(200).json({
        message: 'Password reset link sent to your email'
      });
    } catch (emailError) {
      console.error('❌ Failed to send password reset email:', emailError);
      return res.status(500).json({ 
        message: 'Failed to send reset email. Please try again later.'
      });
    }
    
  } catch (error) {
    console.error('Error sending password reset email:', error);
    return res.status(500).json({ message: 'Server error' });
  }
});

// Route to handle password reset
app.post('/reset-password/:token', async (req, res) => {
  console.log('✅ Hit /reset-password/:token')
  try {
    const { password } = req.body;
    const { token } = req.params;
    
    if (!password) {
      return res.status(400).json({ message: 'New password is required' });
    }
    
    // Hash the token from URL to compare with stored one
    const hashedToken = crypto
      .createHash('sha256')
      .update(token)
      .digest('hex');
    
    // Find user with the token and check if token is still valid
    const user = await User.findOne({
      resetPasswordToken: hashedToken,
      resetPasswordExpires: { $gt: Date.now() }
    });
    
    if (!user) {
      return res.status(400).json({ 
        message: 'Password reset token is invalid or has expired' 
      });
    }
    
    // Hash the new password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);
    
    // Update user's password and clear reset token fields
    user.password = hashedPassword;
    user.resetPasswordToken = undefined;
    user.resetPasswordExpires = undefined;
    await user.save();
    
    console.log('Password reset successfully for user:', user.username);
    
    return res.status(200).json({
      message: 'Password has been reset successfully',
      redirectTo: '/login'
    });
    
  } catch (error) {
    console.error('Error resetting password:', error);
    return res.status(500).json({ message: 'Server error' });
  }
});

// Socket.io event handlers
// Helper to get username from socket or event
function getUsername(socket, data) {
  return socket.username || (data && data.username) || null;
}

// Robust joinRoom
io.on('connection', (socket) => {
  console.log(`User connected: ${socket.id}`);

  socket.on('joinInterestRoom', ({ username, interests }) => {
    if (!Array.isArray(interests) || interests.length === 0) {
      console.error(`Invalid interests for user ${username}:`, interests);
      return;
    }

    let roomToJoin = null;

    // Find if a room already exists for any of the user's interests.
    for (const interest of interests) {
      if (interestToRoomMap.has(interest)) {
        roomToJoin = interestToRoomMap.get(interest);
        break;
      }
    }

    if (!roomToJoin) {
      // No room found, create a new one.
      roomToJoin = `interest-room-${crypto.randomBytes(8).toString('hex')}`;
      console.log(`Creating new room ${roomToJoin} for user ${username} with interests: ${interests}`);
    } else {
      console.log(`User ${username} found existing room ${roomToJoin} for interests: ${interests}`);
    }
    
    socket.join(roomToJoin);

    // Update the map so all of the new user's interests point to this room.
    for (const interest of interests) {
      interestToRoomMap.set(interest, roomToJoin);
    }
    
    // Let the client know which room they've been assigned to.
    socket.emit('interestRoomAssigned', { roomName: roomToJoin });
    
    const room = io.sockets.adapter.rooms.get(roomToJoin);
    if (room) {
      io.to(roomToJoin).emit('interestRoomUserCount', { count: room.size });
    }
  });

  socket.on('leaveInterestRoom', ({ username, roomName }) => {
    if (!roomName) return; 
    
    socket.leave(roomName);
    console.log(`${username} left interest room: ${roomName}`);
    const room = io.sockets.adapter.rooms.get(roomName);
    const userCount = room ? room.size : 0;
    
    if (room) {
      io.to(roomName).emit('interestRoomUserCount', { count: userCount });
    }

    if (userCount === 0) {
      console.log(`Room ${roomName} is empty. Cleaning up interest map.`);
      for (const [interest, mappedRoom] of interestToRoomMap.entries()) {
        if (mappedRoom === roomName) {
          interestToRoomMap.delete(interest);
        }
      }
    }
  });

  socket.on('sendInterestMessage', (msg) => {
    // Ensure msg has id and likes
    if (!msg.id) msg.id = Date.now() + Math.random().toString(36).substr(2, 9);
    if (!msg.likes) msg.likes = [];
    io.to(msg.roomName).emit('receiveInterestMessage', msg);
  });

  socket.on('likeInterestMessage', ({ roomName, msgId, username }) => {
    console.log('Received likeInterestMessage:', roomName, msgId, username); // Debug log
    const room = activeRooms.get(roomName);
    if (room && room.messages) {
      const msg = room.messages.find(m => m.id === msgId);
      console.log('Found message:', msg); // Debug log
      if (msg) {
        msg.likes = msg.likes || [];
        if (!msg.likes.includes(username)) {
          msg.likes.push(username);
        } else {
          // Optionally, allow unliking
          msg.likes = msg.likes.filter(u => u !== username);
        }
        io.to(roomName).emit('interestMessageLiked', { msgId, likes: msg.likes });
      }
    }
  });

  // --- Private Room Logic ---
  socket.on('register', (username) => {
    userSocketMap.set(socket.id, username);
    socketToUserMap.set(socket.id, username); // Map socket ID to username
    console.log(`User ${username} registered with socket ID ${socket.id}`);
  });

  // Add connection error logging
  socket.on('error', (error) => {
    console.error(`Socket error for ${socket.id}:`, error);
  });

  // Add reconnection logging
  socket.on('reconnect_attempt', (attemptNumber) => {
    console.log(`Socket ${socket.id} attempting to reconnect (attempt ${attemptNumber})`);
  });

  // Add disconnection logging with reason
  socket.on('disconnect', (reason) => {
    console.log(`Socket ${socket.id} disconnected. Reason: ${reason}`);
    
    // Remove from all rooms
    for (const [userId, socketId] of userSocketMap.entries()) {
      if (socketId === socket.id) {
        userSocketMap.delete(userId);
        socketToUserMap.delete(socket.id); // Remove from socketToUserMap
        console.log(`Removed user ${userId} from socket mapping`);
        break;
      }
    }
  });
  
  // Create room
  socket.on('createRoom', (username, callback) => {
    const roomCode = generateRoomCode();
    
    // Create room if doesn't exist
    activeRooms.set(roomCode, {
      name: roomCode,
      users: [username],
      messages: [] // Initialize messages array
    });
    
    // Join socket to room
    socket.join(roomCode);
    
    console.log(`Room ${roomCode} created by ${username}`);
    callback(roomCode);
  });
  
  // Join room request
  socket.on('joinRoom', ({ roomCode, username }) => {
    console.log(`Join request received for room ${roomCode} from ${username}`);
    const room = activeRooms.get(roomCode);
    
    if (!room) {
      console.log(`Room ${roomCode} not found`);
      socket.emit('joinError', { message: 'Room not found' });
      return;
    }
    
    // Allow direct room access
    console.log(`Allowing ${username} to join room ${roomCode}`);
    socket.join(roomCode);
    
    // Add user to room if not already present
    if (!room.users.includes(username)) {
      room.users.push(username);
    }
    
    // Send room history to the user
    socket.emit("roomHistory", { messages: room.messages || [] });
    
    // Notify room of new user
    io.in(roomCode).emit("userJoined", { 
      username,
      users: room.users
    });
    
    // Send room users to everyone
    io.in(roomCode).emit("roomUsers", {
      room: roomCode,
      users: room.users
    });
  });
  
  // Handle messages including attachments
  socket.on('sendMessage', (message) => {
    console.log(`Message received from ${message.username} in room ${message.roomCode}`);
    
    // Store message in room history
    const room = activeRooms.get(message.roomCode);
    if (room) {
      if (!room.messages) {
        room.messages = [];
      }
      room.messages.push(message);
    }
    
    // Broadcast to everyone in the room including sender
    io.in(message.roomCode).emit('receiveMessage', message);
  });
  
  // Typing indicator
  socket.on('typing', ({ room, username, isTyping }) => {
    socket.to(room).emit('userTyping', { username, isTyping });
  });

  // Voice Call Handlers - Enhanced for room-wide calls
  socket.on('callRequest', ({ roomCode, from, participants }) => {
    console.log(`Call request from ${from} in room ${roomCode} with participants:`, participants);
    
    // Store call state for the room
    if (!activeRooms.has(roomCode)) {
      activeRooms.set(roomCode, { users: [], callState: 'idle', callInitiator: null });
    }
    
    const room = activeRooms.get(roomCode);
    room.callState = 'ringing';
    room.callInitiator = from;
    room.callParticipants = participants || [];
    
    // Send call request to all users in the room except the caller
    socket.to(roomCode).emit('callRequest', { 
      from, 
      roomCode, 
      participants,
      callType: 'voice', // Indicate this is a voice call
      message: `${from} is starting a voice call. Join the call?`
    });
    
    console.log(`Call notification sent to room ${roomCode}`);
  });

  socket.on('callAccepted', ({ from, roomCode }) => {
    console.log(`Call accepted by ${from} in room ${roomCode}`);
    
    const room = activeRooms.get(roomCode);
    if (room) {
      // Add user to call participants if not already there
      if (!room.callParticipants.includes(from)) {
        room.callParticipants.push(from);
      }
      
      // If this is the first acceptance, change call state to connected
      if (room.callState === 'ringing' && room.callParticipants.length > 1) {
        room.callState = 'connected';
      }
    }
    
    // Notify all users in the room about the acceptance
    io.in(roomCode).emit('callAccepted', { 
      from, 
      roomCode,
      callParticipants: room?.callParticipants || [],
      callState: room?.callState || 'connected'
    });
    
    // Notify all participants that someone joined the call
    io.in(roomCode).emit('userJoinedCall', { 
      username: from, 
      roomCode,
      callParticipants: room?.callParticipants || []
    });
  });

  socket.on('callRejected', ({ from, roomCode }) => {
    console.log(`Call rejected by ${from} in room ${roomCode}`);
    
    // Notify the call initiator that their call was rejected
    const room = activeRooms.get(roomCode);
    if (room && room.callInitiator) {
      socket.to(room.callInitiator).emit('callRejected', { from, roomCode });
    }
  });

  socket.on('callEnded', ({ roomCode, from }) => {
    console.log(`Call ended by ${from} in room ${roomCode}`);
    
    // Reset call state for the room
    const room = activeRooms.get(roomCode);
    if (room) {
      room.callState = 'idle';
      room.callInitiator = null;
      room.callParticipants = [];
    }
    
    // Notify all users in the room that the call has ended
    io.in(roomCode).emit('callEnded', { 
      from, 
      roomCode,
      message: `${from} ended the voice call`
    });
  });

  // Robust userJoinedCall
  socket.on('userJoinedCall', ({ username, roomCode }) => {
    const room = activeRooms.get(roomCode);
    if (room) {
      if (!Array.isArray(room.callParticipants)) room.callParticipants = [];
      if (!room.callParticipants.includes(username)) {
        room.callParticipants.push(username);
        io.in(roomCode).emit('userJoinedCall', { username, roomCode, callParticipants: room.callParticipants });
        io.in(roomCode).emit('roomParticipants', { participants: room.users, callParticipants: room.callParticipants });
      }
    }
  });

  // Robust userLeftCall
  function handleLeaveCall(username, roomCode) {
    const room = activeRooms.get(roomCode);
    if (room) {
      room.callParticipants = room.callParticipants.filter(u => u !== username);
      io.in(roomCode).emit('userLeftCall', { username, roomCode, callParticipants: room.callParticipants });
      io.in(roomCode).emit('roomParticipants', { participants: room.users, callParticipants: room.callParticipants });
      if (room.callParticipants.length === 0) {
        room.callState = 'idle';
        room.callInitiator = null;
      }
    }
  }
  socket.on('userLeftCall', ({ username, roomCode }) => handleLeaveCall(username, roomCode));

  // WebRTC Signaling
  socket.on('offer', ({ to, offer }) => {
    console.log(`Offer from ${socket.id} to ${to}`);
    socket.to(to).emit('offer', { from: socket.id, offer });
  });

  socket.on('answer', ({ to, answer }) => {
    console.log(`Answer from ${socket.id} to ${to}`);
    socket.to(to).emit('answer', { from: socket.id, answer });
  });

  socket.on('iceCandidate', ({ to, candidate }) => {
    console.log(`ICE candidate from ${socket.id} to ${to}`);
    socket.to(to).emit('iceCandidate', { from: socket.id, candidate });
  });

  socket.on('videoStateChanged', ({ roomCode, username, isVideoEnabled }) => {
    console.log(`${username} ${isVideoEnabled ? 'enabled' : 'disabled'} video in room ${roomCode}`);
    socket.to(roomCode).emit('videoStateChanged', { username, isVideoEnabled });
  });

  // Get room participants with call state
  socket.on('getRoomParticipants', ({ roomCode }) => {
    const room = activeRooms.get(roomCode);
    if (room && room.users) {
      socket.emit('roomParticipants', { 
        participants: room.users,
        callState: room.callState || 'idle',
        callInitiator: room.callInitiator,
        callParticipants: room.callParticipants || []
      });
    } else {
      socket.emit('roomParticipants', { 
        participants: [],
        callState: 'idle',
        callInitiator: null,
        callParticipants: []
      });
    }
  });

  // Get current call state for a room
  socket.on('getCallState', ({ roomCode }) => {
    const room = activeRooms.get(roomCode);
    if (room) {
      socket.emit('callState', {
        roomCode,
        callState: room.callState || 'idle',
        callInitiator: room.callInitiator,
        callParticipants: room.callParticipants || []
      });
    } else {
      socket.emit('callState', {
        roomCode,
        callState: 'idle',
        callInitiator: null,
        callParticipants: []
      });
    }
  });

  // Get socket ID for a username
  socket.on('getSocketId', ({ username }, callback) => {
    // Find the socket ID for the given username
    for (const [socketId, userData] of userSocketMap.entries()) {
      if (userData.username === username) {
        callback({ socketId });
        return;
      }
    }
    callback({ socketId: null });
  });

  // Get username for a socket ID
  socket.on('getUsername', ({ socketId }, callback) => {
    const username = socketToUserMap.get(socketId);
    callback({ username });
  });
});

// --- Mesh WebRTC Signaling for Voice Calls ---
const meshRooms = {};

io.on('connection', socket => {
  socket.on('join', room => {
    socket.join(room);
    meshRooms[room] = meshRooms[room] || [];
    meshRooms[room].push(socket.id);

    // Send the list of peers to the new user
    io.to(socket.id).emit('peers', { peers: meshRooms[room].filter(id => id !== socket.id) });

    // Notify others in the room about the new peer
    socket.to(room).emit('new-peer', { peerId: socket.id });

    // Emit user count to all in the room
    io.to(room).emit('user-count', meshRooms[room].length);

    // Relay signals
    socket.on('signal', ({ to, data }) => {
      io.to(to).emit('signal', { from: socket.id, data });
    });

    // Clean up on disconnect
    socket.on('disconnect', () => {
      meshRooms[room] = (meshRooms[room] || []).filter(id => id !== socket.id);
      io.to(room).emit('user-count', meshRooms[room].length);
      if (meshRooms[room].length === 0) delete meshRooms[room];
    });
  });
});

// Define a route for the root URL
app.get('/', (req, res) => {
  res.status(200).json({ message: 'Backend is running!' });
});

// Catch-all handler for any request that doesn't match above
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'client/build/index.html')); // Serve your React app
});

// Initialize the NLP Manager
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
  console.log("Received message:", message); // Log the received message
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

// AI-powered icebreaker endpoint (now using Gemini)
app.post('/api/icebreaker', async (req, res) => {
  const { interests } = req.body;
  const prompt = `Give me only one fun, safe, and friendly icebreaker question for a chat between strangers who are interested in: ${interests && interests.length ? interests.join(', ') : 'anything'}. Do not include any preamble or explanation, just output the question itself.`;
  try {
    const geminiApiKey = process.env.GEMINI_API_KEY || 'AIzaSyBE1TKKXkdvk954EF71aTc7TluqckTIjfs';
    const response = await axios.post(
      `https://generativelanguage.googleapis.com/v1/models/gemini-2.5-flash:generateContent?key=${geminiApiKey}`,
      {
        contents: [
          {
            role: "user",
            parts: [{ text: prompt }]
          }
        ]
      }
    );
    const aiIcebreaker = response.data?.candidates?.[0]?.content?.parts?.[0]?.text || "What's something interesting about your favorite hobby?";
    res.json({ icebreaker: aiIcebreaker });
  } catch (err) {
    res.json({ icebreaker: "What's something interesting about your favorite hobby?" });
  }
});

// Gemini API test endpoint
app.post('/api/gemini', async (req, res) => {
  const { prompt } = req.body;
  if (!prompt) {
    return res.status(400).json({ error: 'Prompt is required.' });
  }
  try {
    const geminiApiKey = process.env.GEMINI_API_KEY || 'AIzaSyBE1TKKXkdvk954EF71aTc7TluqckTIjfs';
    const response = await axios.post(
      `https://generativelanguage.googleapis.com/v1/models/gemini-2.5-flash:generateContent?key=${geminiApiKey}`,
      {
        contents: [
          {
            role: "user",
            parts: [{ text: prompt }]
          }
        ]
      }
    );
    const geminiText = response.data?.candidates?.[0]?.content?.parts?.[0]?.text || 'No response from Gemini.';
    res.json({ reply: geminiText });
  } catch (error) {
    console.error('Gemini API error:', error.response?.data || error.message);
    res.status(500).json({ error: 'Failed to get response from Gemini.' });
  }
});

// AI suggestion endpoint (Gemini)
app.post('/api/ai-suggest-reply', async (req, res) => {
  const { selected_message, chat_history, participants, interests } = req.body;
  // Compose a prompt for Gemini
  const prompt = `You are WingmanAI, a helpful assistant for chat conversations.\nGiven the following conversation in an interest-based chat room, answer from the perspective of the user who is asking (not as an outsider or general AI).\nUse the chat history and the user's interests to make your reply relevant and personal.\n\nConversation history:\n${(chat_history || []).join('\n')}\n\nLast message from user: '${selected_message}'\nParticipants: ${(participants || []).join(', ')}.\nInterests: ${(interests || []).join(', ')}.\n\nSuggest a smart, friendly, and engaging reply to keep the conversation going. Make it relevant to the interests. Be helpful, positive, and natural.\nJust output the reply, no preamble or explanation.`;

  try {
    const geminiApiKey = process.env.GEMINI_API_KEY || 'AIzaSyBE1TKKXkdvk954EF71aTc7TluqckTIjfs';
    const response = await axios.post(
      `https://generativelanguage.googleapis.com/v1/models/gemini-2.5-flash:generateContent?key=${geminiApiKey}`,
      {
        contents: [
          {
            role: "user",
            parts: [{ text: prompt }]
          }
        ]
      }
    );
    const suggestion = response.data?.candidates?.[0]?.content?.parts?.[0]?.text || "Could not generate a suggestion.";
    res.json({ suggestion });
  } catch (err) {
    res.json({ suggestion: "Could not generate a suggestion." });
  }
});

// Gemini open chat endpoint
app.post('/api/gemini-chat', async (req, res) => {
  const { prompt } = req.body;
  if (!prompt) {
    return res.status(400).json({ error: 'Prompt is required.' });
  }
  try {
    const geminiApiKey = process.env.GEMINI_API_KEY || 'AIzaSyBE1TKKXkdvk954EF71aTc7TluqckTIjfs';
    const response = await axios.post(
      `https://generativelanguage.googleapis.com/v1/models/gemini-2.5-flash:generateContent?key=${geminiApiKey}`,
      {
        contents: [
          {
            role: "user",
            parts: [{ text: prompt }]
          }
        ]
      }
    );
    const chatResponse = response.data?.candidates?.[0]?.content?.parts?.[0]?.text || 'No response from Gemini.';
    res.json({ response: chatResponse });
  } catch (error) {
    res.status(500).json({ response: 'Could not generate a response.' });
  }
});

// Compatibility Meter endpoint (Gemini)
app.post('/api/compatibility-meter', async (req, res) => {
  const { chat_history, user1_interests, user2_interests } = req.body;
  const prompt = `Analyze the following chat conversation between two users. Based on their shared interests, the tone of their messages, and how well they engaged with each other, give a compatibility score from 0 to 100 and a short, fun label (like “Perfect Vibe!” or “Great Match!”).\n\nChat history:\n${(chat_history || []).join('\n')}\n\nUser 1 interests: ${(user1_interests || []).join(', ')}\nUser 2 interests: ${(user2_interests || []).join(', ')}\n\nRespond in this format:\nScore: [number]%\nLabel: [short phrase]\nReason: [one-sentence explanation]`;

  try {
    const geminiApiKey = process.env.GEMINI_API_KEY || 'YOUR_GEMINI_API_KEY';
    const response = await axios.post(
      `https://generativelanguage.googleapis.com/v1/models/gemini-2.5-flash:generateContent?key=${geminiApiKey}`,
      {
        contents: [
          {
            role: "user",
            parts: [{ text: prompt }]
          }
        ]
      }
    );
    const result = response.data?.candidates?.[0]?.content?.parts?.[0]?.text || "Could not generate a compatibility score.";
    res.json({ result });
  } catch (err) {
    res.json({ result: "Could not generate a compatibility score." });
  }
});

app.get("/favicon.ico", (req, res) => {
  res.status(204).send();
});

// --- CORS middleware for audio files (MOBILE/iOS SAFE) ---
app.use(['/uploads', '/audio'], (req, res, next) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'GET, OPTIONS, HEAD');
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, Accept, Origin, Range');
  res.set('Accept-Ranges', 'bytes');
  next();
});

// Explicit OPTIONS handler for /uploads/* and /audio/* (for mobile/iOS CORS)
app.options(['/uploads/*', '/audio/*'], (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'GET, OPTIONS, HEAD');
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, Accept, Origin, Range');
  res.set('Accept-Ranges', 'bytes');
  res.sendStatus(200);
});

const startServer = async () => {
  // Connect to MongoDB first
  await mongoose.connect(MONGODB_URI)
    .then(() => console.log('Connected to MongoDB'))
    .catch(err => console.error('MongoDB connection error:', err));

  // Then start server
  server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
};

startServer(); // Call the async function to start the server

export default app;