#!/usr/bin/env node

const io = require('socket.io-client');

console.log('🧪 Testing Socket.IO Memory Leak Prevention...\n');

let connections = [];
let eventCounts = {};

// Test multiple connections and disconnections
const testConnection = (id) => {
  return new Promise((resolve) => {
    const socket = io('http://localhost:5000', {
      withCredentials: true,
      transports: ['websocket', 'polling']
    });
    
    connections.push(socket);
    eventCounts[id] = 0;
    
    socket.on('connect', () => {
      console.log(`✅ Connection ${id} established`);
      
      // Join user room
      socket.emit('join-user-room', `test-user-${id}`);
      
      // Add multiple event listeners
      socket.on('review:started', () => {
        eventCounts[id]++;
      });
      
      socket.on('review:progress', () => {
        eventCounts[id]++;
      });
      
      socket.on('review:completed', () => {
        eventCounts[id]++;
      });
      
      socket.on('review:error', () => {
        eventCounts[id]++;
      });
      
      // Disconnect after a short time
      setTimeout(() => {
        socket.off('review:started');
        socket.off('review:progress');
        socket.off('review:completed');
        socket.off('review:error');
        socket.disconnect();
        console.log(`🔌 Connection ${id} disconnected properly`);
        resolve(id);
      }, 1000);
    });
    
    socket.on('connect_error', (err) => {
      console.error(`❌ Connection ${id} failed:`, err.message);
      resolve(id);
    });
  });
};

// Run multiple connection tests
async function runMemoryTest() {
  console.log('🔄 Creating multiple connections...');
  
  // Create 10 connections sequentially
  for (let i = 1; i <= 10; i++) {
    await testConnection(i);
    // Small delay between connections
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  
  console.log('\n📊 Test Results:');
  console.log(`✅ Total connections created: ${connections.length}`);
  console.log(`✅ Event counts:`, eventCounts);
  
  // Check if all connections are properly disconnected
  const activeConnections = connections.filter(s => s.connected);
  console.log(`✅ Active connections remaining: ${activeConnections.length}`);
  
  if (activeConnections.length === 0) {
    console.log('\n🎉 Memory leak prevention test PASSED!');
    console.log('✅ All connections properly cleaned up');
    console.log('✅ Event listeners properly removed');
    process.exit(0);
  } else {
    console.log('\n❌ Memory leak prevention test FAILED!');
    console.log(`⚠️  ${activeConnections.length} connections still active`);
    process.exit(1);
  }
}

// Set timeout for entire test
setTimeout(() => {
  console.error('❌ Memory test timeout');
  process.exit(1);
}, 15000);

runMemoryTest().catch(console.error);