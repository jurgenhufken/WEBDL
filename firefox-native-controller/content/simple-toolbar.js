// Eenvoudige toolbar met basis functionaliteit
(function() {
  // Maak een eenvoudige toolbar
  const toolbar = document.createElement('div');
  toolbar.style.position = 'fixed';
  toolbar.style.bottom = '20px';
  toolbar.style.right = '20px';
  toolbar.style.zIndex = '2147483647';
  toolbar.style.backgroundColor = 'white';
  toolbar.style.padding = '10px';
  toolbar.style.borderRadius = '5px';
  toolbar.style.boxShadow = '0 0 10px rgba(0,0,0,0.2)';
  toolbar.style.display = 'flex';
  toolbar.style.gap = '10px';

  // Screenshot knop
  const screenshotBtn = document.createElement('button');
  screenshotBtn.textContent = "Screenshot";
  screenshotBtn.style.padding = '5px 10px';
  screenshotBtn.style.cursor = 'pointer';

  // Record knop
  const recordBtn = document.createElement('button');
  recordBtn.textContent = "Opnemen";
  recordBtn.style.padding = '5px 10px';
  recordBtn.style.cursor = 'pointer';

  // Stop knop
  const stopBtn = document.createElement('button');
  stopBtn.textContent = "Stoppen";
  stopBtn.style.padding = '5px 10px';
  stopBtn.style.cursor = 'pointer';
  stopBtn.style.display = 'none';

  // Status indicator
  const statusIndicator = document.createElement('div');
  statusIndicator.style.width = '10px';
  statusIndicator.style.height = '10px';
  statusIndicator.style.borderRadius = '50%';
  statusIndicator.style.backgroundColor = 'red';
  statusIndicator.style.alignSelf = 'center';

  // Voeg alles toe aan de toolbar
  toolbar.appendChild(screenshotBtn);
  toolbar.appendChild(recordBtn);
  toolbar.appendChild(stopBtn);
  toolbar.appendChild(statusIndicator);

  // Voeg de toolbar toe aan de pagina
  document.body.appendChild(toolbar);

  // Status bijhouden
  let isRecording = false;
  let isConnected = false;

  // Connect met background script
  browser.runtime.sendMessage({ action: "getStatus" })
    .then(response => {
      if (response) {
        updateConnectionStatus(response.isConnected);
        if (response.isConnected) {
          updateRecordingState(response.isRecording);
        }
      }
    })
    .catch(error => {
      console.error('Error getting status:', error);
    });

  // Update connection status
  function updateConnectionStatus(connected) {
    isConnected = connected;
    statusIndicator.style.backgroundColor = connected ? 'green' : 'red';
    screenshotBtn.disabled = !connected;
    recordBtn.disabled = !connected;
    stopBtn.disabled = !connected;
  }

  // Update recording state
  function updateRecordingState(recording) {
    isRecording = recording;
    recordBtn.style.display = recording ? 'none' : '';
    stopBtn.style.display = recording ? '' : 'none';
  }

  // Screenshot button click
  screenshotBtn.addEventListener('click', function() {
    if (!isConnected) return;
    console.log("Screenshot button clicked");
    browser.runtime.sendMessage({ action: "takeScreenshot" })
      .catch(error => console.error('Error taking screenshot:', error));
  });

  // Record button click
  recordBtn.addEventListener('click', function() {
    if (!isConnected) return;
    console.log("Record button clicked");
    browser.runtime.sendMessage({ action: "startRecording" })
      .catch(error => console.error('Error starting recording:', error));
  });

  // Stop button click
  stopBtn.addEventListener('click', function() {
    if (!isConnected) return;
    console.log("Stop button clicked");
    browser.runtime.sendMessage({ action: "stopRecording" })
      .catch(error => console.error('Error stopping recording:', error));
  });

  // Listen for status updates from background
  browser.runtime.onMessage.addListener((message) => {
    if (message.action === "recordingStateChanged") {
      updateRecordingState(message.isRecording);
    } else if (message.action === "connectionStateChanged") {
      updateConnectionStatus(message.isConnected);
    }
    return true;
  });

  // Tell the background script we're ready
  browser.runtime.sendMessage({ action: "contentScriptLoaded" })
    .catch(error => {
      console.error('Error notifying background script:', error);
    });
})();
