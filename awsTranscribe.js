const dotenv = require('dotenv');
const WebSocket = require('ws');
const crypto = require("crypto");
const v4 = require("./aws-signature-v4");
const marshaller = require("@aws-sdk/eventstream-marshaller"); // for converting binary event stream messages to and from JSON
const util_utf8_node = require("@aws-sdk/util-utf8-node"); // utilities for encoding and decoding UTF8
const audioUtils = require("./audioUtils");
const BSON = require('bson');
dotenv.config();
const speech = require('@google-cloud/speech').v1p1beta1;

const speakers = {};

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
    enableAutomaticPunctuation: true,
    diarizationConfig: {
        "enableSpeakerDiarization": true,
        "minSpeakerCount": 1,
        "maxSpeakerCount": 6,
    },
  },
  interimResults: false, // If you want interim results, set this to true
};

// Create a recognize stream
// const recognizeStream = client
//   .streamingRecognize(request)
//   .on('error', (err) => {
//       console.log("ERROR", err)
//   })
//   .on('data', (data) => {
//     console.log("DATA", data)
//     data.results[0].alternatives[0].words.forEach(info => {
//         speakers[info.speakerTag] 
//             ? speakers[info.speakerTag].message += ` ${info.word}`
//             : speakers[info.speakerTag] = {
//                 message: info.word
//             }
//     })
//     console.log(data.results[0].alternatives) 
//     console.log(data.results[0].alternatives[0].words) 
//     console.log(data.results[0] && data.results[0].alternatives[0] ? `Transcription: ${data.results[0].alternatives[0].transcript}\n` : '\n\nReached transcription time limit, press Ctrl+C\n')
//     console.log("Speaker obj", speakers);
// });

dotenv.config();
const key = process.env.KEY;
const secret_key = process.env.SECRET_KEY;
const region = process.env.REGION;
const language = process.env.LANGUAGE;
const sampleRate = process.env.SAMPLE_RATE;

const eventStreamMarshaller = new marshaller.EventStreamMarshaller(util_utf8_node.toUtf8, util_utf8_node.fromUtf8);

const wss = new WebSocket.Server({ port: 8000 });
const connectionsManager = {};

const createPresignedUrl = () => {
  const endpoint = "transcribestreaming." + region + ".amazonaws.com:8443";

  // get a preauthenticated URL that we can use to establish our WebSocket
  return v4.createPresignedURL(
      'GET',
      endpoint,
      '/stream-transcription-websocket',
      'transcribe',
      crypto.createHash('sha256').update('', 'utf8').digest('hex'), {
          'key': key,
          'secret': secret_key,
          //'sessionToken': session_token,
          'protocol': 'wss',
          'expires': 15,
          'region': region,
          'query': "language-code=" + language + "&media-encoding=pcm&sample-rate=" + sampleRate + "&show-speaker-label=true"
      }
  );
};

function createRecognitionStream() {
    return client
      .streamingRecognize(request)
      .on('error', console.error)
      .on('data', (data) => {
        console.log("DATA", data)
            data.results[0].alternatives[0].words.forEach(info => {
                speakers[info.speakerTag] 
                    ? speakers[info.speakerTag].message += ` ${info.word}`
                    : speakers[info.speakerTag] = {
                        message: info.word
                    }
            })
        console.log(data.results[0].alternatives) 
        console.log(data.results[0].alternatives[0].words) 
        console.log(data.results[0] && data.results[0].alternatives[0] ? `Transcription: ${data.results[0].alternatives[0].transcript}\n` : '\n\nReached transcription time limit, press Ctrl+C\n')
        console.log("Speaker obj", speakers);
      });
  }

wss.on('connection', function connection(ws) { 
    //let recognizeStream = null;

    // client.on('startGoogleCloudStream', function (data) {
    //     startRecognitionStream(this, data);
    // });

    // client.on('binaryData', function (data) {
    //     // console.log(data); //log binary data
    //     if (recognizeStream !== null) {
    //       recognizeStream.write(data);
    //     }
    // });

    ws.on('message', function incoming(messageInfo) {
        //ws.binaryType = "arraybuffer";
        //console.log("Original", messageInfo);
        const message = JSON.parse(messageInfo);
        let newAudio = Buffer.from(Int16Array.from(message.audio).buffer);
        //console.log("new audio", newAudio);
       // console.log("buffer read", Buffer.from(newAudio.buffer));
        // console.log("Message", messageInfo);
        // // let newAudio = messageInfo;
        // const message = BSON.deserialize(messageInfo);
        // console.log("Message", message.audio);
        //recognizeStream.write(Buffer.from(newAudio.buffer));
        //console.log("recognizestream", recognizeStream);
        if (!connectionsManager[message.connectionID]) { // if the connection doesnt exist
            ws.uid =  message.connectionID;
            let recognitionStream = createRecognitionStream();
            connectionsManager[message.connectionID] = {
                wsConnection: ws,
                recognitionStream
            };

            connectionsManager[message.connectionID].recognitionStream.write(newAudio);
            // establish new websocket connection to AWS Transcribe
            // ws.uid =  message.connectionID;
            // const url = createPresignedUrl();
            // const awsTranscribeSocket = new WebSocket(url);

            // connectionsManager[message.connectionID] = {
            //     awsTranscribeSocket,
            //     wsConnection: ws,
            // };

            // connectionsManager[message.connectionID].awsTranscribeSocket.onopen = () => {
            //     console.log(`Connection1 ${message.connectionID}: Connected`);
            //     console.log(connectionsManager[message.connectionID].awsTranscribeSocket.readyState)
            //     connectionsManager[message.connectionID].awsTranscribeSocket.send(message.audio.buffer);
            // };
        } 

        connectionsManager[message.connectionID].recognitionStream.write(newAudio);
        // if (connectionsManager[message.connectionID].awsTranscribeSocket.readyState == connectionsManager[message.connectionID].awsTranscribeSocket.OPEN) {
        //     connectionsManager[message.connectionID].awsTranscribeSocket.send(message.audio.buffer);
        // }

        // connectionsManager[message.connectionID].awsTranscribeSocket.onerror = () => {
        //     console.log("aws websocket connection err");
        // };

        // connectionsManager[message.connectionID].awsTranscribeSocket.onmessage = (transcribeData) => {
        //     //console.log("transcribeData", transcribeData)
        //     let messageWrapper = eventStreamMarshaller.unmarshall(Buffer(transcribeData.data));
        //     //console.log("message warpper", messageWrapper);
        //     let messageBody = JSON.parse(String.fromCharCode.apply(String, messageWrapper.body));
        //     //console.log("message body", messageBody);
        //     if (messageWrapper.headers[":message-type"].value === "event") {
        //         //handleEventStreamMessage(messageBody); // TODO: Parse message and add object to connection manager

        //         const results = messageBody.Transcript.Results;

        //         if (results.length > 0) {
        //             if (results[0].Alternatives.length > 0) {
        //                 const contentInfo = results[0].Alternatives[0].Items;

        //                 contentInfo.forEach((content, index) => {
        //                     console.log("Speaker Check", content);
        //                     if ((content.Type === "pronunciation" && content.Speaker)) {
        //                         const spokenContent = decodeURIComponent(escape(content.Content));
        //                         connectionsManager[message.connectionID].speakers
        //                             ? (
        //                                 connectionsManager[message.connectionID].speakers[content.Speaker]
        //                                 ? connectionsManager[message.connectionID].speakers[content.Speaker].message += spokenContent
        //                                 : connectionsManager[message.connectionID].speakers[content.Speaker] = {
        //                                     message: spokenContent
        //                                 }
        //                             )        
        //                             : connectionsManager[message.connectionID].speakers = {
        //                                 [content.Speaker] : {
        //                                     message: spokenContent
        //                                 }
        //                             };
        //                     }
        //                 });

        //                 // if this transcript segment is final
        //                 if (!results[0].IsPartial) {
        //                     // TODO: Check for "wake" word + either send it to Lex or ignore it
        //                     // Clear speaker messages
        //                     console.log("End of Speech", connectionsManager[message.connectionID].speakers);
        //                     connectionsManager[message.connectionID].speakers = {};
        //                 }
        //             }
        //         }
        //     } else {
        //         console.log("Error", messageBody.Message);
        //     }
        // };
    });
    
    ws.send('Connected');
});