// Create and initialize the toolbar
(function() {
  // Check if the toolbar already exists (avoid duplicates)
  if (document.querySelector('.screen-tools-toolbar')) {
    return;
  }

  // Create toolbar elements
  const toolbar = document.createElement('div');
  toolbar.className = 'screen-tools-toolbar';
  
  // Toolbar handle for dragging
  const handle = document.createElement('div');
  handle.className = 'toolbar-handle';
  
  // Container for buttons
  const buttonsContainer = document.createElement('div');
  buttonsContainer.className = 'toolbar-buttons';
  
  // Screenshot button
  const screenshotButton = createToolbarButton('Screenshot', 'screenshot');
  
  // Record button
  const recordButton = createToolbarButton('Opnemen', 'record');
  
  // Stop recording button (initially hidden)
  const stopButton = createToolbarButton('Stoppen', 'stop');
  stopButton.style.display = 'none';
  
  // Recording indicator
  const recordingIndicator = document.createElement('div');
  recordingIndicator.className = 'recording-indicator';
  
  // Connection indicator
  const connectionIndicator = document.createElement('div');
  connectionIndicator.className = 'connection-indicator disconnected';
  connectionIndicator.title = 'Niet verbonden met native app';
  
  // Collapse/expand toggle
  const toggleButton = document.createElement('button');
  toggleButton.className = 'toolbar-toggle';
  toggleButton.title = 'Inklappen/Uitklappen';
  
  // Add buttons to container
  buttonsContainer.appendChild(screenshotButton);
  buttonsContainer.appendChild(recordButton);
  buttonsContainer.appendChild(stopButton);
  
  // Add everything to the toolbar
  toolbar.appendChild(handle);
  toolbar.appendChild(buttonsContainer);
  toolbar.appendChild(recordingIndicator);
  toolbar.appendChild(connectionIndicator);
  toolbar.appendChild(toggleButton);
  
  // Add the toolbar to the body
  document.body.appendChild(toolbar);
  
  // Initialize recording state
  let isRecording = false;
  let isConnected = false;
  
  // Check if we're currently connected and recording
  browser.runtime.sendMessage({ action: "getStatus" })
    .then(response => {
      if (response) {
        updateConnectionStatus(response.isConnected);
        if (response.isConnected) {
          updateRecordingState(response.isRecording);
        }
      }
    })
    .catch(error => console.error("Error checking status:", error));
  
  // Function to create toolbar buttons
  function createToolbarButton(text, iconName) {
    const button = document.createElement('button');
    button.className = 'toolbar-button';
    button.title = text;
    
    const img = document.createElement('img');
    img.src = browser.runtime.getURL(`icons/${iconName}.svg`);
    img.alt = text;
    
    const span = document.createElement('span');
    span.textContent = text;
    
    button.appendChild(img);
    button.appendChild(span);
    return button;
  }
  
  // Function to update UI based on recording state
  function updateRecordingState(recording) {
    isRecording = recording;
    recordButton.style.display = recording ? 'none' : '';
    stopButton.style.display = recording ? '' : 'none';
    recordingIndicator.classList.toggle('active', recording);
  }
  
  // Function to update UI based on connection state
  function updateConnectionStatus(connected) {
    isConnected = connected;
    connectionIndicator.classList.toggle('connected', connected);
    connectionIndicator.classList.toggle('disconnected', !connected);
    connectionIndicator.title = connected ? 'Verbonden met native app' : 'Niet verbonden met native app';
    
    // Disable controls if not connected
    recordButton.disabled = !connected;
    stopButton.disabled = !connected;
    screenshotButton.disabled = !connected;
    
    // Add visual feedback for disabled state
    [recordButton, stopButton, screenshotButton].forEach(btn => {
      btn.style.opacity = connected ? '1' : '0.5';
      btn.style.cursor = connected ? 'pointer' : 'not-allowed';
    });
  }
  
  // Make toolbar draggable
  makeDraggable(toolbar, handle);
  
  // Toggle toolbar collapse/expand
  toggleButton.addEventListener('click', () => {
    toolbar.classList.toggle('collapsed');
    // Store state in storage
    try {
      browser.runtime.sendMessage({ 
        action: "saveToolbarState", 
        state: { collapsed: toolbar.classList.contains('collapsed') }
      }).catch(error => {
        console.error("Error saving toolbar state:", error);
      });
    } catch(e) {
      console.error("Error sending message to background script:", e);
    }
  });
  
  // Check if toolbar was previously collapsed
  try {
    browser.runtime.sendMessage({ action: "getToolbarState" })
      .then(state => {
        if (state && state.collapsed) {
          toolbar.classList.add('collapsed');
        }
        if (state && state.position) {
          toolbar.style.right = 'auto';
          toolbar.style.bottom = 'auto';
          toolbar.style.left = `${state.position.left}px`;
          toolbar.style.top = `${state.position.top}px`;
        }
      })
      .catch(error => {
        console.error("Error getting toolbar state:", error);
      });
  } catch(e) {
    console.error("Error sending message to background script:", e);
  }
  
  // Add event listeners for toolbar actions
  screenshotButton.addEventListener('click', () => {
    if (!isConnected) return;
    
    browser.runtime.sendMessage({ action: "takeScreenshot" })
      .catch(error => console.error("Error taking screenshot:", error));
  });
  
  recordButton.addEventListener('click', () => {
    if (!isConnected) return;
    
    browser.runtime.sendMessage({ action: "startRecording" })
      .catch(error => console.error("Error starting recording:", error));
  });
  
  stopButton.addEventListener('click', () => {
    if (!isConnected) return;
    
    browser.runtime.sendMessage({ action: "stopRecording" })
      .catch(error => console.error("Error stopping recording:", error));
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
  
  // Function to make an element draggable
  function makeDraggable(element, dragHandle) {
    let pos1 = 0, pos2 = 0, pos3 = 0, pos4 = 0;
    
    dragHandle.addEventListener('mousedown', dragMouseDown);
    
    function dragMouseDown(e) {
      e.preventDefault();
      // Get the mouse cursor position at startup
      pos3 = e.clientX;
      pos4 = e.clientY;
      document.addEventListener('mouseup', closeDragElement);
      document.addEventListener('mousemove', elementDrag);
    }
    
    function elementDrag(e) {
      e.preventDefault();
      // Calculate the new cursor position
      pos1 = pos3 - e.clientX;
      pos2 = pos4 - e.clientY;
      pos3 = e.clientX;
      pos4 = e.clientY;
      
      // Set the element's new position
      const newTop = (element.offsetTop - pos2);
      const newLeft = (element.offsetLeft - pos1);
      
      // Constrain to viewport
      const maxX = window.innerWidth - element.offsetWidth;
      const maxY = window.innerHeight - element.offsetHeight;
      
      element.style.top = `${Math.min(Math.max(0, newTop), maxY)}px`;
      element.style.left = `${Math.min(Math.max(0, newLeft), maxX)}px`;
      element.style.right = 'auto';
      element.style.bottom = 'auto';
    }
    
    function closeDragElement() {
      // Stop moving when mouse button is released
      document.removeEventListener('mouseup', closeDragElement);
      document.removeEventListener('mousemove', elementDrag);
      
      // Save position to storage
      try {
        browser.runtime.sendMessage({ 
          action: "saveToolbarState", 
          state: { 
            position: {
              top: parseInt(element.style.top),
              left: parseInt(element.style.left)
            }
          }
        }).catch(error => {
          console.error("Error saving toolbar position:", error);
        });
      } catch(e) {
        console.error("Error sending message to background script:", e);
      }
    }
  }
  
  // Debug panel functionality
  let debugPanel = null;
  let debugLog = [];
  
  function createDebugPanel() {
    // Create debug panel if it doesn't exist
    if (document.querySelector('.debug-panel')) {
      return;
    }
    
    // Create debug panel
    debugPanel = document.createElement('div');
    debugPanel.className = 'debug-panel';
    debugPanel.innerHTML = `
      <button class="close-btn">&times;</button>
      <h3>Screen Tools Debug</h3>
      <div class="status">
        <div class="status-item">
          <span class="status-label">Verbinding:</span>
          <span class="status-value ${isConnected ? 'connected' : 'disconnected'}">${isConnected ? 'Verbonden' : 'Niet verbonden'}</span>
        </div>
        <div class="status-item">
          <span class="status-label">Opname:</span>
          <span class="status-value ${isRecording ? 'recording' : ''}">${isRecording ? 'Bezig' : 'Inactief'}</span>
        </div>
      </div>
      <div class="debug-log"></div>
      <div class="debug-buttons">
        <button class="check-connection-btn">Check Verbinding</button>
        <button class="clear-log-btn">Log Wissen</button>
      </div>
    `;
    
    // Add to body
    document.body.appendChild(debugPanel);
    
    // Add event listeners
    debugPanel.querySelector('.close-btn').addEventListener('click', () => {
      debugPanel.remove();
      debugPanel = null;
    });
    
    debugPanel.querySelector('.check-connection-btn').addEventListener('click', () => {
      addLogEntry('Verbinding controleren...');
      browser.runtime.sendMessage({ action: "checkConnection" })
        .catch(error => {
          addLogEntry(`Fout bij verbinding checken: ${error.message}`, 'error');
        });
    });
    
    debugPanel.querySelector('.clear-log-btn').addEventListener('click', () => {
      debugLog = [];
      updateLogDisplay();
    });
    
    // Add CSS link for debug panel
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = browser.runtime.getURL('content/debug-panel.css');
    document.head.appendChild(link);
    
    // Load initial log entries
    updateLogDisplay();
    
    return debugPanel;
  }
  
  function addLogEntry(message, type = 'info') {
    const timestamp = new Date().toLocaleTimeString();
    debugLog.push({ timestamp, message, type });
    
    // Keep log at a reasonable size
    if (debugLog.length > 50) {
      debugLog.shift();
    }
    
    // Update display if panel exists
    updateLogDisplay();
  }
  
  function updateLogDisplay() {
    if (!debugPanel) return;
    
    const logContainer = debugPanel.querySelector('.debug-log');
    if (!logContainer) return;
    
    // Update status indicators
    const connectionStatus = debugPanel.querySelector('.status-value');
    if (connectionStatus) {
      connectionStatus.textContent = isConnected ? 'Verbonden' : 'Niet verbonden';
      connectionStatus.className = `status-value ${isConnected ? 'connected' : 'disconnected'}`;
    }
    
    const recordingStatus = debugPanel.querySelectorAll('.status-value')[1];
    if (recordingStatus) {
      recordingStatus.textContent = isRecording ? 'Bezig' : 'Inactief';
      recordingStatus.className = `status-value ${isRecording ? 'recording' : ''}`;
    }
    
    // Update log entries
    logContainer.innerHTML = '';
    debugLog.forEach(entry => {
      const logEntry = document.createElement('div');
      logEntry.className = `log-entry ${entry.type}`;
      
      const timestamp = document.createElement('span');
      timestamp.className = 'timestamp';
      timestamp.textContent = entry.timestamp;
      
      const message = document.createElement('span');
      message.className = 'message';
      message.textContent = entry.message;
      
      logEntry.appendChild(timestamp);
      logEntry.appendChild(message);
      logContainer.appendChild(logEntry);
    });
    
    // Scroll to bottom
    logContainer.scrollTop = logContainer.scrollHeight;
  }
  
  // Add double-click handler to the toolbar to show debug panel
  handle.addEventListener('dblclick', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!debugPanel) {
      createDebugPanel();
    }
  });
  
  // Listen for debug messages from background script
  browser.runtime.onMessage.addListener((message) => {
    if (message.action === "debug") {
      addLogEntry(message.message, message.type || 'info');
    }
    return true;
  });

  // Notify background script that content script is loaded
  browser.runtime.sendMessage({ action: "contentScriptLoaded" })
    .then(() => {
      addLogEntry('Content script geladen');
    })
    .catch(error => {
      console.error("Error notifying background script:", error);
      addLogEntry(`Fout bij melden aan background script: ${error.message}`, 'error');
    });
    
  // Add initial log entry
  addLogEntry('Toolbar geïnitialiseerd');
})();
