const { ipcRenderer, desktopCapturer } = require('electron');
const { writeFile } = require('fs');
const path = require('path');
const { app } = require('@electron/remote');

// HTML Elements
const videoElement = document.getElementById('preview');
const startBtn = document.getElementById('start-btn');
const stopBtn = document.getElementById('stop-btn');
const screenshotBtn = document.getElementById('screenshot-btn');
const sourcesList = document.getElementById('sources-list');
const recordingsList = document.getElementById('recordings-list');
const statusIndicator = document.getElementById('status-indicator');
const statusText = document.getElementById('status-text');

// Globals
let mediaRecorder;
let recordedChunks = [];
let selectedSourceId = null;
let stream = null;

// Downloads map instellen
const downloadsPath = path.join(app.getPath('downloads'), 'screen-recordings');

// Laad de beschikbare schermopnamebronnen
async function getVideoSources() {
  try {
    const sources = await desktopCapturer.getSources({
      types: ['window', 'screen'],
      thumbnailSize: { width: 200, height: 200 }
    });
    
    // Clear list
    sourcesList.innerHTML = '';
    
    sources.forEach(source => {
      const sourceItem = document.createElement('div');
      sourceItem.classList.add('source-item');
      sourceItem.dataset.id = source.id;
      
      if (source.id === selectedSourceId) {
        sourceItem.classList.add('selected');
      }
      
      const img = document.createElement('img');
      img.classList.add('source-thumbnail');
      img.src = source.thumbnail.toDataURL();
      
      const name = document.createElement('div');
      name.classList.add('source-name');
      name.textContent = source.name;
      
      sourceItem.appendChild(img);
      sourceItem.appendChild(name);
      
      sourceItem.onclick = () => selectSource(source.id);
      
      sourcesList.appendChild(sourceItem);
    });
  } catch (e) {
    console.error('Error loading video sources', e);
  }
}

// Selecteer opnamebron
function selectSource(sourceId) {
  selectedSourceId = sourceId;
  
  // Update UI
  document.querySelectorAll('.source-item').forEach(item => {
    item.classList.toggle('selected', item.dataset.id === sourceId);
  });
}

// Start opname
async function startRecording(sourceId) {
  try {
    if (sourceId) {
      selectedSourceId = sourceId;
    }
    
    if (!selectedSourceId) {
      const sources = await desktopCapturer.getSources({
        types: ['window', 'screen'],
        thumbnailSize: { width: 100, height: 100 }
      });
      
      if (sources.length > 0) {
        // Default naar het hoofdscherm
        selectedSourceId = sources.find(source => source.name === 'Entire Screen')?.id || sources[0].id;
      } else {
        throw new Error('Geen opnamebronnen gevonden');
      }
    }
    
    // Creëer stream
    const constraints = {
      audio: {
        mandatory: {
          chromeMediaSource: 'desktop'
        }
      },
      video: {
        mandatory: {
          chromeMediaSource: 'desktop',
          chromeMediaSourceId: selectedSourceId,
          minWidth: 1280,
          maxWidth: 1920,
          minHeight: 720,
          maxHeight: 1080
        }
      }
    };
    
    stream = await navigator.mediaDevices.getUserMedia(constraints);
    
    // Preview weergeven
    videoElement.srcObject = stream;
    videoElement.play();
    
    // MediaRecorder instellen
    const options = { mimeType: 'video/webm; codecs=vp9' };
    mediaRecorder = new MediaRecorder(stream, options);
    
    mediaRecorder.ondataavailable = handleDataAvailable;
    mediaRecorder.onstop = handleStop;
    
    mediaRecorder.start();
    
    // UI updaten
    startBtn.disabled = true;
    stopBtn.disabled = false;
    statusIndicator.classList.add('recording');
    statusText.textContent = 'Opname bezig...';
    
    updateRecentRecordings();
  } catch (e) {
    console.error('Error starting recording', e);
    alert(`Kon opname niet starten: ${e.message}`);
  }
}

// Stop opname
function stopRecording() {
  if (!mediaRecorder || mediaRecorder.state === 'inactive') return;
  
  mediaRecorder.stop();
  
  // Stop alle tracks in de stream
  if (stream) {
    stream.getTracks().forEach(track => track.stop());
  }
  
  // UI updaten
  startBtn.disabled = false;
  stopBtn.disabled = true;
  statusIndicator.classList.remove('recording');
  statusText.textContent = 'Gereed';
  
  // Preview verbergen
  videoElement.srcObject = null;
}

// Screenshot nemen
async function takeScreenshot(videoOnly = false) {
  try {
    // Gebruik desktopCapturer om een screenshot te maken
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: 1920, height: 1080 }
    });
    
    if (sources.length === 0) {
      throw new Error('Geen schermen gevonden');
    }
    
    // Gebruik het eerste scherm
    const source = sources[0];
    const timestamp = new Date().toISOString().replace(/:/g, '-').replace(/\..+/, '');
    const fileName = `screenshot_${timestamp}.jpg`;
    const filePath = path.join(downloadsPath, fileName);
    
    // Sla het screenshot op
    writeFile(filePath, source.thumbnail.toJPEG(100), (err) => {
      if (err) {
        console.error('Failed to save screenshot', err);
      } else {
        console.log('Screenshot saved to:', filePath);
        updateRecentRecordings();
        ipcRenderer.send('screenshot-complete', filePath);
      }
    });
  } catch (e) {
    console.error('Error taking screenshot', e);
    alert(`Kon screenshot niet maken: ${e.message}`);
  }
}

// Chunk data verwerken
function handleDataAvailable(e) {
  if (e.data.size > 0) {
    recordedChunks.push(e.data);
  }
}

// Opname opslaan wanneer gestopt
async function handleStop() {
  // Maak een Blob van de opgenomen chunks
  const blob = new Blob(recordedChunks, {
    type: 'video/webm'
  });
  
  // Maak een unieke bestandsnaam met timestamp
  const timestamp = new Date().toISOString().replace(/:/g, '-').replace(/\..+/, '');
  const fileName = `recording_${timestamp}.webm`;
  const filePath = path.join(downloadsPath, fileName);
  
  // Sla de opname op als bestand
  const buffer = Buffer.from(await blob.arrayBuffer());
  
  writeFile(filePath, buffer, (err) => {
    if (err) {
      console.error('Failed to save recording', err);
    } else {
      console.log('Video saved to:', filePath);
      updateRecentRecordings();
      ipcRenderer.send('recording-complete', filePath);
    }
  });
  
  // Reset voor volgende opname
  recordedChunks = [];
}

// Update lijst met recente opnames
function updateRecentRecordings() {
  // Deze functie zou de lijst met opnames moeten updaten door de downloads folder te checken
  // Voor nu implementeren we een placeholder
  recordingsList.innerHTML = '<li class="recording-item">Recente opnames komen hier</li>';
}

// Event listeners
startBtn.onclick = () => startRecording();
stopBtn.onclick = stopRecording;
screenshotBtn.onclick = () => takeScreenshot();

// Luister naar berichten van het main process
ipcRenderer.on('start-recording', (event, sourceId) => {
  startRecording(sourceId);
});

ipcRenderer.on('stop-recording', () => {
  stopRecording();
});

ipcRenderer.on('take-screenshot', (event, videoOnly) => {
  takeScreenshot(videoOnly);
});

// Laad bronnen bij opstart
getVideoSources();
updateRecentRecordings();
