const Twitter = require('twitter');
const keys = require('./keys');

const getHomeTweets = (userInfo, res) => {
    const twitterClient = new Twitter({
        consumer_key: keys.TWITTER_CONSUMER_KEY,
        consumer_secret: keys.TWITTER_CONSUMER_SECRET,
        access_token_key: userInfo.access_token_key,
        access_token_secret: userInfo.access_token_secret,
    });

    twitterClient.get('statuses/home_timeline', { screen_name: 'nodejs', count: 12, tweet_mode: "extended", include_entities: true }, (error, tweets, response) => {
        if (error) {
            res.status(500).json({ error: error });
        }
        
        //console.log("tweets", JSON.stringify(tweets));
        res.status(200).json({
            homeTimeLineTweets: tweets,
        });
    });


    // twitterClient.get('trends/place.json', { screen_name: 'nodejs', tweet_mode: "extended", include_entities: true, id: 4118 }, (error, tweets, response) => {
    //     if (error) {
    //         console.log("Error", JSON.stringify(error));
    //     }
        
    //     console.log("trends", JSON.stringify(tweets));
    // });
};

module.exports = {
    getHomeTweets,
};