// Variables to store recording state
let mediaRecorder = null;
let recordedChunks = [];
let stream = null;
let bgPort = null;

// DOM elements
let startButton, stopButton, startContainer, recordingContainer;

// Initialize when the DOM is loaded
document.addEventListener('DOMContentLoaded', function() {
  // Get UI elements
  startButton = document.getElementById('start-recording-button');
  stopButton = document.getElementById('stop-recording-button');
  startContainer = document.getElementById('start-container');
  recordingContainer = document.getElementById('recording-container');
  
  // Add event listeners
  startButton.addEventListener('click', handleStartRecording);
  stopButton.addEventListener('click', handleStopRecording);
  
  // Connect to background script
  bgPort = browser.runtime.connect({ name: 'recorder' });
  
  // Listen for messages from background script
  bgPort.onMessage.addListener((message) => {
    if (message.action === "stopRecording") {
      handleStopRecording();
    }
  });
  
  // Notify background script that recorder is ready
  bgPort.postMessage({ action: "recorderReady" });
});

// Handle start recording button click
async function handleStartRecording() {
  try {
    // Hide start container, show recording container
    startContainer.classList.add('hidden');
    recordingContainer.classList.remove('hidden');
    
    // Request access to screen capture with audio
    const constraints = {
      video: {
        mediaSource: "screen",
        width: { ideal: 1920 },
        height: { ideal: 1080 },
        frameRate: { ideal: 30 }
      },
      audio: true
    };
    
    // This will work because it's triggered by user interaction
    stream = await navigator.mediaDevices.getDisplayMedia(constraints);
    
    // Check if stream was obtained (user might cancel the dialog)
    if (!stream) {
      showStartView();
      return;
    }
    
    // Create a media recorder instance
    const options = { mimeType: 'video/webm;codecs=vp9,opus' };
    mediaRecorder = new MediaRecorder(stream, options);
    
    recordedChunks = [];
    
    // Handle data available event
    mediaRecorder.ondataavailable = function(event) {
      if (event.data.size > 0) {
        recordedChunks.push(event.data);
      }
    };
    
    // Handle recording stop event
    mediaRecorder.onstop = async function() {
      // Create a blob from the recorded chunks
      const blob = new Blob(recordedChunks, {
        type: 'video/webm'
      });
      
      if (blob.size > 0) {
        // Create a file name with date and time
        const timestamp = new Date().toISOString().replace(/:/g, '-').replace(/\..+/, '');
        const filename = `screen_recording_${timestamp}.webm`;
        
        // Save to downloads
        await browser.downloads.download({
          url: URL.createObjectURL(blob),
          filename: filename,
          saveAs: false
        });
      } else {
        console.error("No data recorded");
      }
      
      cleanup();
      
      // Notify background script recording stopped
      bgPort.postMessage({ action: "recordingStopped" });
      
      // Close this tab after short delay
      setTimeout(() => {
        window.close();
      }, 1000);
    };
    
    // Detect when user cancels sharing
    stream.getVideoTracks()[0].onended = function() {
      handleStopRecording();
    };
    
    // Start recording
    mediaRecorder.start(1000); // Collect data in 1-second chunks
    
    // Notify background script recording started
    bgPort.postMessage({ action: "recordingStarted" });
    
  } catch (error) {
    console.error("Recording error:", error);
    showStartView();
    alert(`Error starting recording: ${error.message}`);
  }
}

// Handle stop recording button click
function handleStopRecording() {
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.stop();
  } else {
    cleanup();
    showStartView();
  }
}

// Cleanup resources
function cleanup() {
  if (stream) {
    stream.getTracks().forEach(track => track.stop());
    stream = null;
  }
  
  mediaRecorder = null;
  recordedChunks = [];
}

// Show the start view
function showStartView() {
  startContainer.classList.remove('hidden');
  recordingContainer.classList.add('hidden');
}

// Handle messages from the background script
browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.action) {
    case "stopRecording":
      handleStopRecording();
      sendResponse({ success: true });
      return true;
  }
});
