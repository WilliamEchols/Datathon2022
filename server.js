import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import express from 'express';
import crypto from 'crypto';
import twilio from 'twilio';
import cohere from 'cohere-ai'
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';

dotenv.config();

// app config
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const app = express();
const port = process.env.PORT || 8080;
const server = http.createServer(app);

// current livestream information
var currentStreams = [];

// socket
const io = new Server (server, { 
  cors: {
    origins: ["http://localhost"],
    methods: ["GET", "POST"],
    optionsSuccessStatus: 200,
  }
});
io.on('connection', (socket) => {
  socket.on('new_chat', (data) => {
    //console.log(JSON.stringify(data['streamId'], 4, null));

    io.sockets.emit('update_all_chats', data);
  });
});

app.use(cors());


// auth
const AccessToken = twilio.jwt.AccessToken;
const VideoGrant = AccessToken.VideoGrant;
const PlaybackGrant = AccessToken.PlaybackGrant;

const accountSid = process.env.TWILIO_ACCOUNT_SID;
const apiKey = process.env.TWILIO_API_KEY_SID;
const apiKeySecret = process.env.TWILIO_API_KEY_SECRET;
const cohereApiKeySecret = process.env.COHERE_API_KEY_SECRET;

const twilioClient = twilio(apiKey, apiKeySecret, { accountSid: accountSid });

// routing
app.use(express.json());
app.use(express.static('public'));


app.get('/', (req, res) => {
  res.sendFile('public/index.html', { root: __dirname });
});
app.get('/stream', (req, res) => {
  res.sendFile('public/streamer.html', { root: __dirname });
});
app.get('/watch', (req, res) => {
  res.sendFile('public/audience.html', { root: __dirname });
});


// cohere classification
cohere.init(`${cohereApiKeySecret}`); 

app.post('/classify', async (req, res) => {
  const text = req.body.text;
  
  const response = await cohere.classify({ 
    model: 'cohere-toxicity', 
    inputs: [text] 
  }); 

  return res.send({
    'classification': response.body.classifications
  });

});



app.post('/start', async (req, res) => {
    const streamName  = req.body.streamName;
  
  try {
    // Create the WebRTC Go video room, PlayerStreamer, and MediaProcessors
    const room = await twilioClient.video.rooms.create({
      uniqueName: streamName,
      type: 'go'
    });

    const playerStreamer = await twilioClient.media.playerStreamer.create();

    const mediaProcessor = await twilioClient.media.mediaProcessor.create({
      extension: 'video-composer-v1',
      extensionContext: JSON.stringify({
        identity: 'video-composer-v1',
        room: {
          name: room.sid
        },
        outputs: [
          playerStreamer.sid
        ],
      })
    })

    // new object for server tracking and to send to client
    currentStreams.push({
        streamName: streamName,
        positiveNum: 0,
        negativeNum: 0
      })

    return res.status(200).send({
        roomId: room.sid,
        streamName: streamName,
        playerStreamerId: playerStreamer.sid,
        mediaProcessorId: mediaProcessor.sid
      });

  } catch(error) {
    return res.status(400).send({
      message: `Unable to create livestream`,
      error
    });
  }
})

app.post('/end', async (req, res) => {
  const streamDetails = req.body.streamDetails;

  // End the player streamer, media processor, and video room
  const streamName  = streamDetails.streamName;
  const roomId  = streamDetails.roomId;
  const playerStreamerId = streamDetails.playerStreamerId;
  const mediaProcessorId = streamDetails.mediaProcessorId;

  try {
    await twilioClient.media.mediaProcessor(mediaProcessorId).update({status: 'ended'});
    await twilioClient.media.playerStreamer(playerStreamerId).update({status: 'ended'});
    await twilioClient.video.rooms(roomId).update({status: 'completed'});

    // remove from storage
    currentStreams = currentStreams.filter(function( stream ) {
        return stream['streamName'] !== streamName;
    });

    return res.status(200).send({
      message: `Successfully ended stream ${streamName}`
    });

  } catch (error) {
    return res.status(400).send({
      message: `Unable to end stream`,
      error
    });
  }
});

app.post('/streamerToken', async (req, res) => {
  if (!req.body.identity || !req.body.room) {
    return res.status(400).send({ message: `Missing identity or stream name` });
  }

  // Get the user's identity and the room name from the request
  const identity  = req.body.identity;
  const roomName  = req.body.room;

  try {
    // Create a video grant for this specific room
    const videoGrant = new VideoGrant({
      room: roomName,
    });

    // Create an access token
    const token = new AccessToken(accountSid, apiKey, apiKeySecret);

    // Add the video grant and the user's identity to the token
    token.addGrant(videoGrant);
    token.identity = identity;

    // Serialize the token to a JWT and return it to the client side
    return res.send({
      token: token.toJwt()
    });

  } catch (error) {
    return res.status(400).send({error});
  }
});

app.post('/audienceToken', async (req, res) => {
  // Generate a random string for the identity
  const identity = crypto.randomBytes(20).toString('hex');

  var playerStreamer = req.body['streamId']

  try {
    // Get the first player streamer
    //const playerStreamerList = await twilioClient.media.playerStreamer.list({status: 'started'});
    //const playerStreamer = playerStreamerList.length ? playerStreamerList[0] : null;

    // If no one is streaming, return a message
    if (!playerStreamer){
      return res.status(200).send({
        message: `No one is streaming right now`,
      })
    }

    // Otherwise create an access token with a PlaybackGrant for the livestream
    const token = new AccessToken(accountSid, apiKey, apiKeySecret);

    // Create a playback grant and attach it to the access token
    const playbackGrant = await twilioClient.media.playerStreamer(playerStreamer).playbackGrant().create({ttl: 60});

    const wrappedPlaybackGrant = new PlaybackGrant({
      grant: playbackGrant.grant
    });

    token.addGrant(wrappedPlaybackGrant);
    token.identity = identity;

    // Serialize the token to a JWT and return it to the client side
    return res.send({
      token: token.toJwt()
    });

  } catch (error) {
    res.status(400).send({
      message: `Unable to view livestream`,
      error
    });
  }
});

// custom
app.post('/currentlive', async (req, res) => { // returns list of playerStreamer tokens for live streams
  const playerStreamerList = await twilioClient.media.playerStreamer.list({status: 'started'});

  // If no one is streaming, return a message
  if (playerStreamerList.length == 0){
    return res.status(200).send({ message: `No one is streaming right now` })
  }

  var liveSIDs = []
  for (var i = 0; i < playerStreamerList.length; i++) {
    liveSIDs.push(playerStreamerList[i].sid)
  }

  return res.send({
    liveSIDs: liveSIDs, currentStreams: currentStreams
  });

});


server.listen(port, async () => {
  console.log(`Express server running on port ${port}`);
});
