import mongoose from 'mongoose';
import dotenv from 'dotenv';

// Load environment variables from .env file
dotenv.config();

const connectDB = async () => {
  try {
    // Modern Mongoose (v6+) doesn't need the options
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB');

    // Optional: Add connection event listeners
    mongoose.connection.on('connected', () => {
      console.log('Mongoose connected to DB');
    });

    mongoose.connection.on('error', (err) => {
      console.error('Mongoose connection error:', err);
    });

  } catch (error) {
    console.error('Initial MongoDB connection error:', error.message);
    process.exit(1);
  }
};

export default connectDB;