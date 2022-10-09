// socket connection
const socket = io("http://localhost:8080");

// determine streaming id
const queryString = window.location.search;
const urlParams = new URLSearchParams(queryString);

const streamId = urlParams.get('id')

const streamPlayer = document.getElementById('player');
const startEndButton = document.getElementById('streamStartEnd');

var newChat = document.getElementById('newChat');
var newChatButton = document.getElementById('newChatButton');

var chat = document.getElementById('chat');
var chatMessages = []

var togglePositivity = document.getElementById('toggleChatPositivity');
var positiveOnly = true;

let player;
let watchingStream = false;

const watchStream = async () => {
  try {
    const response = await fetch('/audienceToken', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ 'streamId': `${streamId}` })
    });

    const data = await response.json();

    if (data.message) {
      alert(data.message);
      return;
    }

    player = await Twilio.Live.Player.connect(data.token, {playerWasmAssetsPath: '../livePlayer'});
    player.play();
    streamPlayer.appendChild(player.videoElement);

    watchingStream = true;
    startEndButton.innerHTML = 'exit stream';
    startEndButton.classList.replace('bg-purple-500', 'bg-red-500');
    startEndButton.classList.replace('hover:bg-purple]-500', 'hover:bg-red-700');

  } catch (error) {
    console.log(error);
    alert('Unable to connect to livestream');
  }
}

const leaveStream = () => {
  player.disconnect();
  watchingStream = false;
  startEndButton.innerHTML = 'watch stream';
  startEndButton.classList.replace('bg-red-500', 'bg-purple-500');
  startEndButton.classList.replace('hover:bg-red-500', 'hover:bg-purple-700');
}

const watchOrLeaveStream = async (event) => {
  event.preventDefault();
  if (!watchingStream) {
    await watchStream();
  }
  else {
    leaveStream();
  }
};

startEndButton.addEventListener('click', watchOrLeaveStream);

const classifyNewChat = async (event) => {
  event.preventDefault();

  const response = await fetch('/classify', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ 'text': `${newChat.value}` })
  });

  const data = await response.json();
  //console.log(data)

  var certainty = Math.trunc(data['classification'][0]['confidences'][data['classification'][0]['prediction'] == 'TOXIC' ? 1 : 0]['confidence'] * 100, 2) + '%'

  var flag = `
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="grey" class="w-6 h-6">
    <path stroke-linecap="round" stroke-linejoin="round" d="M3 3v1.5M3 21v-6m0 0l2.77-.693a9 9 0 016.208.682l.108.054a9 9 0 006.086.71l3.114-.732a48.524 48.524 0 01-.005-10.499l-3.11.732a9 9 0 01-6.085-.711l-.108-.054a9 9 0 00-6.208-.682L3 4.5M3 15V4.5" />
  </svg>`

  var chat1 = `<a title='certainty: ${certainty}'>${newChat.value} ${data['classification'][0]['prediction'] == 'TOXIC' ? ' [toxic]' : ''}</a><a style='float: right' title='flag as incorrectly labeled'>${flag}</a>`
  var chat2 = '<br>'

  var message = chat1 + chat2
  var positive = data['classification'][0]['prediction'] != 'TOXIC'
  var obj = { 'positive': positive, 'message': message }
  updateChat()

  //console.log("sent to socket")
  socket.emit('new_chat', { 'messageObj': obj, 'streamId': streamId });

}

newChatButton.addEventListener('click', classifyNewChat);


const toggleChatPositivity = async () => {
  positiveOnly = !positiveOnly;
  togglePositivity.innerHTML = positiveOnly ? 'all chat' : 'positive only'
  updateChat()
}

const updateChat = () => {
  chat.innerHTML = ''
  for (var i = 0; i < chatMessages.length; i++) {
    if(chatMessages[i]['positive'] || !positiveOnly) {
        chat.innerHTML += chatMessages[i]['message'];
    }
  }
}

togglePositivity.addEventListener('click', toggleChatPositivity);

// socket connection
socket.on('connect', () => {
  //console.log("connected to server socket"); 
  socket.on('update_all_chats', (data) => {
    //console.log('received new chat')
    if(data['streamId'] == streamId) {
        chatMessages.push(data['messageObj'])
        updateChat()
    }
  });
});