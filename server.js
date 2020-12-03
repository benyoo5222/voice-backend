const dotenv = require('dotenv');
const WebSocket = require('ws');
dotenv.config(); // For Google JSON
const speech = require('@google-cloud/speech').v1p1beta1;

const cookieSession = require('cookie-session');
const express = require('express');
const app = express();
const port = 4000;
const passport = require('passport');
const passportSetup = require('./passport-setup');
const session = require('express-session');
const authRoutes = require('./auth-routes');
const keys = require('./keys');
const cors = require('cors');
const cookieParser = require('cookie-parser'); // parse cookie header
const TwitterActions = require('./twitterActions');

app.use(
  cookieSession({
    name: 'session',
    keys: [keys.COOKIE_KEY],
    maxAge: 24 * 60 * 60 * 100
  })
);

// parse cookies
app.use(cookieParser());
// initalize passport
app.use(passport.initialize());
// deserialize cookie from the browser
app.use(passport.session());

// set up cors to allow us to accept requests from our client
app.use(
  cors({
    origin: 'http://localhost:3000', // allow to server to accept request from different origin
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
    credentials: true // allow session cookie from browser to pass through
  })
);

// set up routes
app.use('/auth', authRoutes);

const authCheck = (req, res, next) => {
  if (!req.user) {
    res.status(401).json({
      authenticated: false,
      message: 'user has not been authenticated'
    });
  } else {
    next();
  }
};

// if it's already login, send the profile response,
// otherwise, send a 401 response that the user is not authenticated
// authCheck before navigating to home page
app.get('/', authCheck, (req, res) => {
    console.log("Check");
  res.status(200).json({
    authenticated: true,
    message: 'user successfully authenticated',
    user: req.user,
    cookies: req.cookies
  });
});

app.get('/home-timeline-tweets', (req, res) => {
    if (!req.user) {
        res.status(401).json({
            authenticated: false,
            message: 'No info on user',
        });
    }
    
    TwitterActions.getHomeTweets(req.user, res);
});

// connect react to nodejs express server
app.listen(port, () => console.log(`Server is running on port ${port}!`));

// Creates a client
const client = new speech.SpeechClient();
const encoding = 'LINEAR16';
const sampleRateHertz = 16000;
const languageCode = 'en-US';

const request = {
  config: {
    encoding: encoding,
    sampleRateHertz: sampleRateHertz,
    languageCode: languageCode,
    enableWordTimeOffsets: true,
    enableWordConfidence: true,
    enableAutomaticPunctuation: false,
    diarizationConfig: {
        enableSpeakerDiarization: true,
        minSpeakerCount: 1,
        maxSpeakerCount: 6,
    },
  },
  interimResults: true, // If you want interim results, set this to true
};

const wss = new WebSocket.Server({ port: 8000 });
const connectionsManager = {};

const parseTranscription = (data, connectionID) => {
    // 1) Only track speaker if they use the wake word
    // 2) diarization returns the entire list of words spoken but the speaker tag might have changed for the said word
    // 3) Need to keep track of the speaker by:
    //      A) index of the first time the speaker said the wake word
    //      B) Status of the Bot  
    const results = data.results[0];
    const regex = new RegExp('\\bbob\\b', 'gi');
    const startingIndex = connectionsManager[connectionID].lastWordIndex || connectionsManager[connectionID].lastWordIndex == 0
        ? connectionsManager[connectionID].lastWordIndex + 1
        : 0;

    // TODO: Using interm results, need to check if the user says 'Hey Bob', to silence the app (if talking) and stop the function all together

    if (results && results.isFinal) {
        console.log('Last word incex', connectionsManager[connectionID].lastWordIndex)
        results.alternatives[0].words.slice(startingIndex).some((wordObj, index) => {
            if (regex.test(wordObj.word)) {
                !connectionsManager[connectionID].botInDialog
                    ? connectionsManager[connectionID] = 
                        {
                            ...connectionsManager[connectionID],
                            botInDialog: true,
                            invokerIndex: index + startingIndex,
                        } 
                    : connectionsManager[connectionID];
                
                console.log('checking invoker index', connectionsManager[connectionID].invokerIndex)

                if ((index + startingIndex) == results.alternatives[0].words.length - 1) {
                    return true;
                }
            }

            if (connectionsManager[connectionID].botInDialog) {
                const initialSpeaker = results.alternatives[0].words[connectionsManager[connectionID].invokerIndex].speakerTag; 
                // Since google speech constantly updates the speaker tag, we want to only listen to the person who initially invoked the bot

                const slicePosition = (index + startingIndex) == results.alternatives[0].words.length - 1 
                    ? index + startingIndex
                    : startingIndex + index + 1;

                const filteredCommands = results.alternatives[0].words.slice(slicePosition).filter((speakerInfo) => {
                    return speakerInfo.speakerTag == initialSpeaker;
                })
                console.log('Filtered commands', filteredCommands);

                const finalStringToLex = filteredCommands.length > 0
                    ? (
                        filteredCommands.length > 1
                            ? filteredCommands.reduce((finalString, currentWordObj, currentIndex) => {
                                return currentIndex == 1 
                                ? `${finalString.word} ${currentWordObj.word}`
                                : `${finalString} ${currentWordObj.word}`;
                                })
                            : filteredCommands[0].word
                        )
                    : null;
                
                console.log('Invoked bot - commands: ', finalStringToLex);
                
                if (finalStringToLex) {
                    // TODO: Send commands to Lex
                    connectionsManager[connectionID].botInDialog = false; // Only a place holder, need to use Lex as state management + Only erase the Invoker Index position if the session is over
                } 

                return true;
            }
        });
        connectionsManager[connectionID].lastWordIndex = results.alternatives[0].words.length - 1;
    }
};

const createRecognitionStream = (connectionID) => {
    return client
      .streamingRecognize(request)
      .on('error', console.error)
      .on('data', (data) => parseTranscription(data, connectionID));
};

wss.on('connection', function connection(ws) { 
    ws.on('message', function incoming(messageInfo) { 
        const message = JSON.parse(messageInfo);
        const newAudio = Buffer.from(Int16Array.from(message.audio).buffer);

        if (!connectionsManager[message.connectionID]) { // if the connection doesnt exist
            ws.uid =  message.connectionID;
            let recognitionStream = createRecognitionStream(message.connectionID);
            connectionsManager[message.connectionID] = {
                wsConnection: ws,
                [`recognitionStream${message.connectionID}`]: recognitionStream
            };
            connectionsManager[message.connectionID][`recognitionStream${message.connectionID}`].write(newAudio);
        } 

        connectionsManager[message.connectionID][`recognitionStream${message.connectionID}`].write(newAudio);
    });
    
    ws.send('Connected');
});