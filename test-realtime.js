#!/usr/bin/env node

const io = require('socket.io-client');

console.log('🧪 Testing Socket.IO Real-Time Connection...\n');

// Connect to the backend
const socket = io('http://localhost:5000', {
  withCredentials: true,
  transports: ['websocket', 'polling']
});

let testPassed = true;

socket.on('connect', () => {
  console.log('✅ Socket connected successfully');
  console.log(`📱 Socket ID: ${socket.id}`);
  
  // Test joining user room
  const testUserId = 'test-user-123';
  socket.emit('join-user-room', testUserId);
  console.log(`📮 Sent join-user-room for user: ${testUserId}`);
  
  // Test disconnect after 2 seconds
  setTimeout(() => {
    socket.disconnect();
    if (testPassed) {
      console.log('\n🎉 All Socket.IO tests passed!');
      process.exit(0);
    }
  }, 2000);
});

socket.on('connect_error', (err) => {
  console.error('❌ Socket connection failed:', err.message);
  testPassed = false;
  process.exit(1);
});

socket.on('disconnect', (reason) => {
  console.log(`🔌 Socket disconnected: ${reason}`);
});

// Set timeout for connection
setTimeout(() => {
  if (!socket.connected) {
    console.error('❌ Connection timeout - Socket.IO server may not be running');
    testPassed = false;
    process.exit(1);
  }
}, 5000);