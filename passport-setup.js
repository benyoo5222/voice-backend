passport = require('passport');
const TwitterStrategy = require('passport-twitter').Strategy;
const keys = require('./keys');
const Twitter = require('twitter');

// serialize the user.id to save in the cookie session
// so the browser will remember the user when login
passport.serializeUser((user, done) => {
    console.log("user", user);
    done(null, user);
});

// deserialize the cookieUserId to user in the database
passport.deserializeUser((user, done) => {
    done(null, user);
});

passport.use(
  new TwitterStrategy(
    {
      consumerKey: keys.TWITTER_CONSUMER_KEY,
      consumerSecret: keys.TWITTER_CONSUMER_SECRET,
      callbackURL: 'auth/twitter/callback'
    },
    async (token, tokenSecret, profile, done) => {
        done(null, {
            name: profile._json.name,
            screenName: profile._json.screen_name,
            twitterId: profile._json.id_str,
            profileImageUrl: profile._json.profile_image_url,
            access_token_key: token,
            access_token_secret: tokenSecret,
        });
    }
  )
);