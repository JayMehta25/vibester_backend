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
import { v4 as uuidv4 } from 'uuid';
import nodemailer from 'nodemailer';
import bodyParser from 'body-parser';
import dotenv from 'dotenv';
import crypto from 'crypto';
import connectDB from './config/db.js'; // Import the connectDB function
import pkg from 'node-nlp'; // Import the entire package
const { NlpManager } = pkg; // Destructure to get NlpManager

// Load environment variables
dotenv.config();

// ES modules fix for __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const server = http.createServer(app);

// Function to generate a unique room code
const generateRoomCode = () => {
  return Math.random().toString(36).substring(2, 8); // Generates a random string of 6 characters
};

// Initialize socket.io with CORS and buffer size for attachments
const io = new Server(server, {
  cors: {
    origin: "http://localhost:3001",
    methods: ["GET", "POST"]
  },
  maxHttpBufferSize: 50 * 1024 * 1024 // 50MB
});

// Database setup
const PORT = process.env.PORT || 5000;
const JWT_SECRET = process.env.JWT_SECRET || 'your_jwt_secret';
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/chatapp';

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
const activeRooms = new Map();

// Middleware
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "http://localhost:3000"); // Update this to your frontend URL
  res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") {
    return res.sendStatus(200); // Respond to preflight requests
  }
  next();
});

app.use(cors({
  origin: '*', // Allow all origins
}));
app.use(bodyParser.json());
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

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
    const fileExt = path.extname(file.originalname) || '';
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

const upload = multer({ 
  storage,
  fileFilter,
  limits: { fileSize: 50 * 1024 * 1024 }
});

// Serve uploaded files with proper headers
app.use('/uploads', (req, res, next) => {
  const filePath = path.join(__dirname, 'uploads', req.url);
  const ext = path.extname(filePath).toLowerCase();
  
  // MIME type mapping
  const mimeTypes = {
    '.mp4': 'video/mp4',
    '.webm': 'video/webm',
    '.mov': 'video/quicktime',
    '.wmv': 'video/x-ms-wmv',
    '.avi': 'video/x-msvideo',
    '.mp3': 'audio/mpeg',
    '.ogg': 'audio/ogg',
    '.wav': 'audio/wav',
    '.m4a': 'audio/mp4',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
    '.pdf': 'application/pdf',
    '.doc': 'application/msword',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.txt': 'text/plain'
  };
  
  if (mimeTypes[ext]) {
    res.setHeader('Content-Type', mimeTypes[ext]);
  }
  
  // Headers for range requests (important for video/audio)
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Cache-Control', 'public, max-age=86400');
  next();
}, express.static(path.join(__dirname, 'uploads')));

// File upload endpoint
app.post('/upload', (req, res) => {
  upload.single('file')(req, res, function(err) {
    if (err) {
      console.error('Upload error:', err);
      return res.status(500).json({ success: false, message: err.message });
    }
    
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No file uploaded or file type not allowed' });
    }
    
    // Log file details
    console.log('File uploaded successfully:');
    console.log('- Original name:', req.file.originalname);
    console.log('- Saved as:', req.file.filename);
    console.log('- Size:', req.file.size, 'bytes');
    console.log('- MIME type:', req.file.mimetype);
    
    // Create URL for client
    const fileUrl = `http://localhost:${PORT}/uploads/${req.file.filename}`;
    
    res.json({
      success: true,
      fileUrl,
      fileName: req.file.originalname,
      fileType: req.file.mimetype
    });
  });
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

app.get('/verify/:token', async (req, res) => {
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

// Route to request password reset
app.post('/forgot-password', async (req, res) => {
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
io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);
  
  // Register user with socket ID
  socket.on('register', (userId) => {
    userSocketMap.set(userId, socket.id);
    console.log(`User ${userId} registered with socket ${socket.id}`);
  });
  
  // Join room
  socket.on('joinRoom', ({ room, username }) => {
    socket.join(room);
    
    // Create room if doesn't exist
    if (!activeRooms.has(room)) {
      activeRooms.set(room, {
        name: room,
        users: []
      });
    }
    
    // Add user to room
    const roomData = activeRooms.get(room);
    if (!roomData.users.includes(username)) {
      roomData.users.push(username);
    }
    
    console.log(`${username} joined room: ${room}`);
    
    // Notify room of new user
    socket.to(room).emit('userJoined', { room, username });
    
    // Send room users to everyone
    io.to(room).emit('roomUsers', {
      room,
      users: roomData.users
    });
  });
  
  // Leave room
  socket.on('leaveRoom', ({ room, username }) => {
    socket.leave(room);
    
    if (activeRooms.has(room)) {
      const roomData = activeRooms.get(room);
      const index = roomData.users.indexOf(username);
      
      if (index !== -1) {
        roomData.users.splice(index, 1);
      }
      
      // Remove empty rooms
      if (roomData.users.length === 0) {
        activeRooms.delete(room);
      } else {
        // Notify room of user leaving
        io.to(room).emit('userLeft', { room, username });
        
        // Update user list
        io.to(room).emit('roomUsers', {
          room,
          users: roomData.users
        });
      }
    }
    
    console.log(`${username} left room: ${room}`);
  });
  
  // Handle messages including attachments
  socket.on('sendMessage', (message) => {
    console.log(`Message received from ${message.sender} in room ${message.room}`);
    
    if (message.type && message.type !== 'text') {
      console.log(`Message contains ${message.type}: ${message.content}`);
    }
    
    // Broadcast to everyone in the room
    io.to(message.room).emit('message', message);
  });
  
  // Typing indicator
  socket.on('typing', ({ room, username, isTyping }) => {
    socket.to(room).emit('userTyping', { username, isTyping });
  });
  
  // Disconnect
  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
    
    // Remove from all rooms
    for (const [userId, socketId] of userSocketMap.entries()) {
      if (socketId === socket.id) {
        userSocketMap.delete(userId);
        break;
      }
    }
  });

  socket.on("createRoom", (username, callback) => {
    // Logic to create a room
    const roomCode = generateRoomCode(); // Your logic to generate a room code
    callback(roomCode); // Send the room code back to the client
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

const startServer = async () => {
  // Load environment variables
  dotenv.config();

  // Connect to MongoDB
  await connectDB();

  // Start the server
  server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
};

startServer(); // Call the async function to start the server

export default app;