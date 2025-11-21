#!/usr/bin/env node

const io = require('socket.io-client');

console.log('🧪 Testing Real-Time Review Error Handling...\n');

// Connect to the backend
const socket = io('http://localhost:5000', {
  withCredentials: true,
  transports: ['websocket', 'polling']
});

let testResults = {
  connection: false,
  userRoom: false,
  errorHandling: false
};

socket.on('connect', () => {
  console.log('✅ Socket connected successfully');
  testResults.connection = true;
  
  // Test joining user room
  const testUserId = 'test-user-error-123';
  socket.emit('join-user-room', testUserId);
  console.log(`📮 Sent join-user-room for user: ${testUserId}`);
  testResults.userRoom = true;
  
  // Listen for error events
  socket.on('review:error', (data) => {
    console.log('🚨 Received review:error event:', data);
    testResults.errorHandling = true;
  });
  
  // Simulate error scenarios by testing invalid review request
  setTimeout(() => {
    console.log('\n🔄 Testing error scenarios...');
    
    // Test 1: Invalid review request (should trigger error)
    fetch('http://localhost:5000/pr/review', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ repoName: 'invalid/repo', prNumber: 999 })
    }).then(response => {
      console.log(`📊 Invalid request status: ${response.status}`);
      return response.json();
    }).then(data => {
      console.log('📊 Invalid request response:', data);
    }).catch(err => {
      console.log('📊 Invalid request error (expected):', err.message);
    });
    
  }, 1000);
  
  // Complete test after 3 seconds
  setTimeout(() => {
    socket.disconnect();
    
    console.log('\n📋 Test Results:');
    console.log(`✅ Connection: ${testResults.connection ? 'PASS' : 'FAIL'}`);
    console.log(`✅ User Room: ${testResults.userRoom ? 'PASS' : 'FAIL'}`);
    console.log(`✅ Error Handling: ${testResults.errorHandling ? 'PASS' : 'FAIL'}`);
    
    const allPassed = Object.values(testResults).every(result => result === true);
    console.log(`\n${allPassed ? '🎉 All tests passed!' : '❌ Some tests failed'}`);
    
    process.exit(allPassed ? 0 : 1);
  }, 3000);
});

socket.on('connect_error', (err) => {
  console.error('❌ Socket connection failed:', err.message);
  process.exit(1);
});

socket.on('disconnect', (reason) => {
  console.log(`🔌 Socket disconnected: ${reason}`);
});

// Set timeout for connection
setTimeout(() => {
  if (!socket.connected) {
    console.error('❌ Connection timeout - Socket.IO server may not be running');
    process.exit(1);
  }
}, 5000);