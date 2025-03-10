import mongoose from 'mongoose';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Debug: Print all environment variables
console.log('Loaded Environment Variables:', process.env);

// Debug: Check if MONGODB_URI is loaded
if (!process.env.MONGODB_URI) {
  console.error('❌ MONGODB_URI is undefined! Check your .env file.');
  process.exit(1); // Stop execution
}

const testConnection = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log('✅ Connected to MongoDB successfully!');
    mongoose.connection.close(); // Close the connection
  } catch (error) {
    console.error('❌ MongoDB connection error:', error.message);
  }
};

testConnection();
