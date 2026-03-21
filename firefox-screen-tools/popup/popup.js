document.addEventListener('DOMContentLoaded', function() {
  const screenshotBtn = document.getElementById('screenshot-btn');
  const recordBtn = document.getElementById('record-btn');
  const stopRecordingBtn = document.getElementById('stop-recording-btn');
  const recordingStatus = document.getElementById('recording-status');
  
  // Check if we're currently recording
  browser.runtime.sendMessage({ action: "getRecordingStatus" })
    .then(response => {
      if (response.isRecording) {
        recordingStatus.classList.remove('hidden');
      }
    });
  
  // Take screenshot
  screenshotBtn.addEventListener('click', function() {
    browser.runtime.sendMessage({ action: "takeScreenshot" })
      .then(() => {
        // Close popup after taking screenshot
        window.close();
      })
      .catch(error => {
        console.error("Error taking screenshot:", error);
      });
  });
  
  // Start recording
  recordBtn.addEventListener('click', function() {
    browser.runtime.sendMessage({ action: "startRecording" })
      .then(response => {
        if (response.success) {
          recordingStatus.classList.remove('hidden');
        } else {
          console.error("Failed to start recording:", response.error);
        }
      })
      .catch(error => {
        console.error("Error starting recording:", error);
      });
  });
  
  // Stop recording
  stopRecordingBtn.addEventListener('click', function() {
    browser.runtime.sendMessage({ action: "stopRecording" })
      .then(() => {
        recordingStatus.classList.add('hidden');
        window.close();
      })
      .catch(error => {
        console.error("Error stopping recording:", error);
      });
  });
});
