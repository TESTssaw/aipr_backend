const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

const connectDB = require('./config/database');
const authRoutes = require('./routes/auth');
const githubRoutes = require('./routes/github');
const prRoutes = require('./routes/pr');

const app = express();
const server = http.createServer(app);

// CORS configuration
const allowedOrigins = process.env.NODE_ENV === 'production' 
  ? [process.env.FRONTEND_URL] 
  : ['http://localhost:5173', 'http://localhost:5174', 'http://localhost:5175', process.env.FRONTEND_URL];


const io = new Server(server, {
  cors: {
    origin: allowedOrigins,
    credentials: true,
  }
});

const PORT = process.env.PORT || 5000;

// Connect to database
connectDB();

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: process.env.NODE_ENV === 'production' ? 50 : 100, // stricter limit in production
  message: {
    error: 'Too many requests from this IP, please try again later.',
    retryAfter: '15 minutes'
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Trust proxy for rate limiting and proper IP detection
app.set('trust proxy', 1);


// Middleware
app.use(cors({
  origin: allowedOrigins,
  credentials: true,
}));

// Enable rate limiting in production
if (process.env.NODE_ENV === 'production') {
  app.use(limiter);
}
app.use(express.json());
app.use(cookieParser());

// Make io available to routes
app.set('io', io);

// Socket.IO connection handling
io.on('connection', (socket) => {
  console.log('User connected:', socket.id);
  
  // Join user to their personal room for targeted updates
  socket.on('join-user-room', (userId) => {
    socket.join(`user-${userId}`);
    console.log(`User ${userId} joined their room`);
  });

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
  });
});

// Routes
app.get('/', (req, res) => {
  res.json({ message: 'Welcome to the GitHub Auth API!' });
});

app.use('/auth', authRoutes);
app.use('/github', githubRoutes);
app.use('/pr', prRoutes);

// Start server
server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
  console.log(`Socket.IO server ready`);
});