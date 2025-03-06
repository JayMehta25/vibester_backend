const socketIo = require('socket.io');

function setupSocket(server) {
  const io = socketIo(server, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST']
    }
  });

  const rooms = new Map();

  io.on('connection', (socket) => {
    console.log('New client connected');

    socket.on('createRoom', (username, callback) => {
      try {
        // Generate a random 6-character room code
        const roomCode = Math.random().toString(36).substring(2, 8).toUpperCase();
        
        // Create room data structure
        rooms.set(roomCode, {
          users: [{ id: socket.id, username }],
          messages: []
        });
        
        // Join socket to the room
        socket.join(roomCode);
        
        // Send room code back to client
        callback(roomCode);
        
        // Notify room of new user
        io.to(roomCode).emit('message', {
          username: 'System',
          message: `${username} has created the room`,
          timestamp: new Date().toLocaleTimeString()
        });
        
        console.log(`Room ${roomCode} created by ${username}`);
      } catch (error) {
        console.error('Error creating room:', error);
        callback({ error: 'Failed to create room' });
      }
    });

    socket.on('joinRoom', ({ roomCode, username }, callback) => {
      try {
        const room = rooms.get(roomCode);
        
        if (!room) {
          callback({ error: 'Room not found' });
          return;
        }
        
        // Add user to room
        room.users.push({ id: socket.id, username });
        
        // Join socket to the room
        socket.join(roomCode);
        
        // Store room code for disconnection handling
        socket.roomCode = roomCode;
        
        // Notify room of new user
        io.to(roomCode).emit('message', {
          username: 'System',
          message: `${username} has joined the room`,
          timestamp: new Date().toLocaleTimeString()
        });
        
        callback({ success: true });
        
        console.log(`${username} joined room ${roomCode}`);
      } catch (error) {
        console.error('Error joining room:', error);
        callback({ error: 'Failed to join room' });
      }
    });

    socket.on('chatMessage', ({ roomCode, message }) => {
      try {
        const room = rooms.get(roomCode);
        
        if (!room) {
          console.error(`Room ${roomCode} not found`);
          return;
        }
        
        // Log message type
        console.log(`Message with ${message.audioBase64 ? 'audio' : ''} ${message.attachmentBase64 ? 'attachment' : ''} in room ${roomCode}`);
        
        // Limit base64 data size for very large files if needed
        if (message.audioBase64 && message.audioBase64.length > 10 * 1024 * 1024) { // 10MB limit
          console.warn('Audio too large, truncating');
          message.audioBase64 = message.audioBase64.substring(0, 10 * 1024 * 1024);
        }
        
        if (message.attachmentBase64 && message.attachmentBase64.length > 10 * 1024 * 1024) { // 10MB limit
          console.warn('Attachment too large, truncating');
          message.attachmentBase64 = message.attachmentBase64.substring(0, 10 * 1024 * 1024);
        }
        
        // Store message in room history (with attachments)
        room.messages.push(message);
        
        // Broadcast to all users in the room except sender
        socket.to(roomCode).emit('message', message);
        
      } catch (error) {
        console.error('Error sending message:', error);
      }
    });

    socket.on('disconnect', () => {
      try {
        console.log('Client disconnected');
        
        // Handle user leaving rooms
        const roomCode = socket.roomCode;
        
        if (roomCode && rooms.has(roomCode)) {
          const room = rooms.get(roomCode);
          
          // Find user in room
          const userIndex = room.users.findIndex(user => user.id === socket.id);
          
          if (userIndex !== -1) {
            const user = room.users[userIndex];
            
            // Remove user from room
            room.users.splice(userIndex, 1);
            
            // Notify room that user has left
            io.to(roomCode).emit('message', {
              username: 'System',
              message: `${user.username} has left the room`,
              timestamp: new Date().toLocaleTimeString()
            });
            
            // If room is empty, delete it
            if (room.users.length === 0) {
              rooms.delete(roomCode);
              console.log(`Room ${roomCode} deleted (empty)`);
            }
          }
        }
      } catch (error) {
        console.error('Error handling disconnect:', error);
      }
    });
  });

  return io;
}

module.exports = setupSocket; 