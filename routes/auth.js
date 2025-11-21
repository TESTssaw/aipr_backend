const express = require('express');
const axios = require('axios');
const jwt = require('jsonwebtoken');
const User = require('../models/User');

const router = express.Router();

// GitHub OAuth configuration
const GITHUB_CLIENT_ID = process.env.GITHUB_CLIENT_ID;
const GITHUB_CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET;
const JWT_SECRET = process.env.JWT_SECRET;

// GET /auth/github - Redirect to GitHub OAuth
router.get('/github', (req, res) => {
  const scope = 'repo user:email';
  const authUrl = `https://github.com/login/oauth/authorize?client_id=${GITHUB_CLIENT_ID}&scope=${scope}`;
  res.redirect(authUrl);
});

// GET /auth/github/callback - Handle GitHub OAuth callback
router.get('/github/callback', async (req, res) => {
  const { code } = req.query;

  try {
    // Exchange code for access token
    const tokenResponse = await axios.post('https://github.com/login/oauth/access_token', {
      client_id: GITHUB_CLIENT_ID,
      client_secret: GITHUB_CLIENT_SECRET,
      code: code,
    }, {
      headers: {
        'Accept': 'application/json',
      },
    });

    const accessToken = tokenResponse.data.access_token;

    console.log(accessToken);

    // Fetch user profile
    const userResponse = await axios.get('https://api.github.com/user', {
      headers: {
        'Authorization': `token ${accessToken}`,
      },
    });

    const githubUser = userResponse.data;

    // Fetch user emails if primary email is null
    let email = githubUser.email;
    if (!email) {
      const emailsResponse = await axios.get('https://api.github.com/user/emails', {
        headers: {
          'Authorization': `token ${accessToken}`,
        },
      });
      
      const primaryEmail = emailsResponse.data.find(email => email.primary && email.verified);
      email = primaryEmail ? primaryEmail.email : emailsResponse.data[0]?.email;
    }

    // Check if user exists in database
    let user = await User.findOne({ githubId: githubUser.id });
    
    if (user) {
      // Update existing user
      user.email = email || user.email;
      user.name = githubUser.login;
      user.avatar = githubUser.avatar_url;
      user.githubToken = accessToken;
      user.githubUsername = githubUser.login;
      await user.save();
    } else {
      // Create new user
      user = new User({
        githubId: githubUser.id,
        email: email || `${githubUser.login}@github.local`,
        name: githubUser.login,
        avatar: githubUser.avatar_url,
        githubToken: accessToken,
        githubUsername: githubUser.login,
      });
      await user.save();
    }

    // Create JWT token
    const token = jwt.sign(
      { userId: user._id, githubId: user.githubId },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    // Set token in HTTP-only cookie
    res.cookie('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    });

    // Redirect to frontend with success
    res.redirect(`${process.env.FRONTEND_URL}/callback?success=true`);

  } catch (error) {
    console.error('GitHub OAuth error:', error);
    res.redirect(`${process.env.FRONTEND_URL}/login?error=auth_failed`);
  }
});

// GET /auth/me - Get current user
router.get('/me', async (req, res) => {
  try {
    const token = req.cookies.token;
    
    if (!token) {
      return res.status(401).json({ message: 'No token provided' });
    }

    const decoded = jwt.verify(token, JWT_SECRET);
    const user = await User.findById(decoded.userId).select('-__v');
    
    if (!user) {
      return res.status(401).json({ message: 'User not found' });
    }

    res.json({
      id: user._id,
      githubId: user.githubId,
      email: user.email,
      name: user.name,
      avatar: user.avatar,
      createdAt: user.createdAt,
    });
  } catch (error) {
    console.error('Auth me error:', error);
    res.status(401).json({ message: 'Invalid token' });
  }
});

// POST /auth/logout - Logout user
router.post('/logout', (req, res) => {
  res.clearCookie('token');
  res.json({ message: 'Logged out successfully' });
});

module.exports = router;