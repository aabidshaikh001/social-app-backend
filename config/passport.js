const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const FacebookStrategy = require('passport-facebook').Strategy;
const User = require('../models/users');
const tokenService = require('../utils/tokenService');

// Google Strategy
passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: "/api/auth/google/callback",
    passReqToCallback: true
  },
  async (req, accessToken, refreshToken, profile, done) => {
    try {
      // Check if user exists with this googleId
      let user = await User.findByEmail(profile.emails[0].value);
      
      if (!user) {
        // Create new user
        const newUser = {
          email: profile.emails[0].value,
          name: profile.displayName,
          googleId: profile.id,
          image: profile.photos[0].value
        };
        
        const result = await User.createUser(newUser);
        if (!result.success) {
          return done(null, false, { message: result.message });
        }
        
        user = await User.findByEmail(profile.emails[0].value);
      } else if (!user.googleId) {
        // Update existing user with googleId
        await User.updateProfile(user.id, { googleId: profile.id });
      }
      
      return done(null, user);
    } catch (error) {
      return done(error, null);
    }
  }
));

// Facebook Strategy
passport.use(new FacebookStrategy({
    clientID: process.env.FACEBOOK_APP_ID,
    clientSecret: process.env.FACEBOOK_APP_SECRET,
    callbackURL: "/api/auth/facebook/callback",
    profileFields: ['id', 'emails', 'name', 'displayName', 'photos'],
    passReqToCallback: true
  },
  async (req, accessToken, refreshToken, profile, done) => {
    try {
      // Check if user exists with this facebookId
      let user = await User.findByEmail(profile.emails[0].value);
      
      if (!user) {
        // Create new user
        const newUser = {
          email: profile.emails[0].value,
          name: profile.displayName,
          facebookId: profile.id,
          image: profile.photos[0].value
        };
        
        const result = await User.createUser(newUser);
        if (!result.success) {
          return done(null, false, { message: result.message });
        }
        
        user = await User.findByEmail(profile.emails[0].value);
      } else if (!user.facebookId) {
        // Update existing user with facebookId
        await User.updateProfile(user.id, { facebookId: profile.id });
      }
      
      return done(null, user);
    } catch (error) {
      return done(error, null);
    }
  }
));

// Serialize/Deserialize user
passport.serializeUser((user, done) => {
  done(null, user.id);
});

passport.deserializeUser(async (id, done) => {
  try {
    const user = await User.findById(id);
    done(null, user);
  } catch (error) {
    done(error, null);
  }
});

module.exports = passport;