require('dotenv').config(); // For environment variables
const express = require('express');
const passport = require('passport');
const session = require('express-session');
const YouTubeV3Strategy = require('passport-youtube-v3').Strategy;
const GitHubStrategy = require('passport-github').Strategy;
const axios = require('axios');
const path = require('path');

// Initialize Express
const app = express();
const port = process.env.PORT || 3000;

// Serve static files (like CSS, images) if needed
app.use(express.static('public'));

// Mock User model (replace with actual database logic)
const User = {
  usersDb: {}, // Simulating a DB
  
  findOrCreate: (query, callback) => {
    const userId = query.userId || query.githubId;
    
    // If user exists, return it
    if (User.usersDb[userId]) {
      return callback(null, User.usersDb[userId]);
    } 
    
    // If user doesn't exist, create and save a new user
    const newUser = { id: userId };
    User.usersDb[userId] = newUser;
    return callback(null, newUser);
  }
};

// Passport configuration for YouTube
passport.use(new YouTubeV3Strategy({
  clientID: process.env.YOUTUBE_APP_ID,
  clientSecret: process.env.YOUTUBE_APP_SECRET,
  callbackURL: `http://localhost:${port}/auth/youtube/callback`,
  scope: ['https://www.googleapis.com/auth/youtube.readonly']
},
async function(accessToken, refreshToken, profile, done) {
  try {
    console.log('Access Token:', accessToken);
    let response = await axios.get('https://www.googleapis.com/youtube/v3/subscriptions', {
      headers: {
        'Authorization': `Bearer ${accessToken}`
      },
      params: {
        part: 'snippet',
        mine: true,
        maxResults: 50
      }
    });

    console.log('Subscriptions Response:', response.data);

    const subscriptions = response.data.items;
    const requiredChannelId = 'UCgIzTPYitha6idOdrr7M8sQ'; // Replace with actual channel ID
    const isSubscribed = subscriptions.some(sub => sub.snippet.resourceId.channelId === requiredChannelId);

    if (isSubscribed) {
      User.findOrCreate({ userId: profile.id }, function (err, user) {
        return done(err, user);
      });
    } else {
      console.log('User is not subscribed to the required channel.');
      return done(null, false, { message: 'You need to be subscribed to the specific channel to proceed.' });
    }
  } catch (err) {
    console.error(`YouTube API Request Error: ${err.message}`);
    console.error(`Full Error Response: ${JSON.stringify(err.response ? err.response.data : 'No response data')}`);
    return done(err);
  }
}));

// Passport configuration for GitHub
passport.use(new GitHubStrategy({
  clientID: process.env.GITHUB_CLIENT_ID,
  clientSecret: process.env.GITHUB_CLIENT_SECRET,
  callbackURL: `http://localhost:${process.env.PORT || 3000}/auth/github/callback`
},
async function(accessToken, refreshToken, profile, done) {
  try {
    const knownUsername = 'bytemait'; // The GitHub user to check for following

    // Fetch whether the authenticated user follows 'bytemait'
    const response = await axios.get(`https://api.github.com/user/following/${knownUsername}`, {
      headers: {
        'Authorization': `token ${accessToken}` // Authenticated user's token
      }
    });

    // If the response status is 204, the user follows 'bytemait'
    if (response.status === 204) {
      // Proceed with authentication
      User.findOrCreate({ githubId: profile.id }, function (err, user) {
        if (err) {
          return done(err);
        }
        return done(null, user);
      });
    } else {
      return done(null, false, { message: 'You need to follow the specified user on GitHub to proceed.' });
    }

  } catch (err) {
    // If the user is not following 'bytemait' (404 error)
    if (err.response && err.response.status === 404) {
      return done(null, false, { message: 'You need to follow the specified user on GitHub to proceed.' });
    } else {
      // Log and handle any other errors (network, token issues, etc.)
      console.error(`GitHub API Request Error: ${err.message}`);
      return done(err);
    }
  }
}));
// Session configuration
app.use(session({ secret: 'YOUR_SECURE_SESSION_SECRET', resave: false, saveUninitialized: true }));

// Initialize Passport
app.use(passport.initialize());
app.use(passport.session());

// Serialize and deserialize user
passport.serializeUser((user, done) => {
  if (!user) {
    return done(new Error('User object is undefined'));
  }
  done(null, user.id);
});

passport.deserializeUser((id, done) => {
  if (!id) {
    return done(new Error('User ID is undefined'));
  }
  done(null, { id: id, username: 'exampleUser' });
});

// Routes
app.use(express.static(path.join(__dirname, 'public')));

// Changed root route to send a simple HTML response
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});
// User friendly message to subscribe or follow
app.get('/notautherised', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'notautherised.html'));
});
// YouTube authentication routes
app.get('/auth/youtube', passport.authenticate('youtube'));

app.get('/auth/youtube/callback',
  passport.authenticate('youtube', { failureRedirect: '/notautherised' }),
  (req, res) => {
    res.redirect('/profile');
  }
);

// GitHub authentication routes
app.get('/auth/github', passport.authenticate('github'));

app.get('/auth/github/callback', 
  passport.authenticate('github', { failureRedirect: '/notautherised' }),
  function(req, res) {
    res.redirect('/profile');
  }
);

// Profile route (accessible only when authenticated)
app.get('/profile', (req, res) => {
  if (req.isAuthenticated()) {
    res.sendFile(path.join(__dirname, 'public', 'protected.html'));
  } else {
    console.log("user need to subscribe or follow")
    res.sendFile(path.join(__dirname, 'public', 'notautherised.html'));
  }
});
// Logout route
app.get('/logout', (req, res) => {
  const userId = req.user ? req.user.id : null; // Get user ID

  req.logout((err) => {
    if (err) {
      console.error('Logout error:', err);
      return res.redirect('/'); // Redirect to home on error
    }
    
    // Remove user from temporary database
    if (userId) {
      delete User.usersDb[userId]; 
      console.log(`User ${userId} logged out and removed from temp DB.`);
    }

    res.redirect('/'); // Redirect to home after logout
  });
});


// Start the server
app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});
