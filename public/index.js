const dom = document.getElementById('dom-content');

const loadStreams = async () => {
  const response = await fetch('/currentlive', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    }
  });

  const data = await response.json();

  if (!data.message) {
    for (var i = 0; i < data.liveSIDs.length; i++) {
        dom.innerHTML += `
        <!-- Livestream Card -->
        <a href=/watch?id=${data.liveSIDs[i]}>
        <div class="max-w-sm rounded overflow-hidden shadow-lg m-5">
        
        <!-- Sentiment Progress Bar -->
        <div class="w-full bg-gray-200 m-0 h-2.5 dark:bg-gray-700">
            <div class="bg-red-600 m-0 h-2.5 dark:bg-red-500" style="width: 45%"></div>
        </div>
        
        <!-- Card Picture and Info -->
        <img class="w-full" src="/img/sample.png" alt="Sunset in the mountains">
        <div class="px-6 py-4">
            <div class="font-bold text-xl mb-2">TODO: Title</div>
            <p class="text-gray-700 text-base">TODO: Name</p>
            </div>
        </div>
        </a>
        `
    }
  } else {
    dom.innerHTML += 'No one is streaming at the moment'
  }

}
loadStreams()