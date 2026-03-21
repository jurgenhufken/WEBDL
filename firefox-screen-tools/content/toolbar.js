// Create and initialize the toolbar
(function() {
  try {
    const host = String((window && window.location && window.location.hostname) || '').toLowerCase();
    if (host === 'localhost' || host === '127.0.0.1') return;
  } catch (e) {}

  // Register this tab with the background script
  browser.runtime.sendMessage({ action: "contentScriptLoaded" }).catch(error => {
    console.log("Error registering content script: ", error);
  });

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
  toolbar.appendChild(toggleButton);
  
  // Add the toolbar to the body
  document.body.appendChild(toolbar);
  
  // Initialize recording state
  let isRecording = false;
  
  // Check if we're currently recording
  browser.runtime.sendMessage({ action: "getRecordingStatus" })
    .then(response => {
      if (response && response.isRecording) {
        setRecordingState(true);
      }
    })
    .catch(error => console.error("Error checking recording status:", error));
  
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
  function setRecordingState(recording) {
    isRecording = recording;
    recordButton.style.display = recording ? 'none' : '';
    stopButton.style.display = recording ? '' : 'none';
    recordingIndicator.classList.toggle('active', recording);
  }
  
  // Make toolbar draggable
  makeDraggable(toolbar, handle);
  
  // Toggle toolbar collapse/expand
  toggleButton.addEventListener('click', () => {
    toolbar.classList.toggle('collapsed');
    // Store state in storage
    browser.storage.local.set({ toolbarCollapsed: toolbar.classList.contains('collapsed') });
  });
  
  // Check if toolbar was previously collapsed
  browser.storage.local.get('toolbarCollapsed').then(data => {
    if (data.toolbarCollapsed) {
      toolbar.classList.add('collapsed');
    }
  });
  
  // Check if toolbar position was saved
  browser.storage.local.get(['toolbarPositionX', 'toolbarPositionY']).then(data => {
    if (data.toolbarPositionX && data.toolbarPositionY) {
      toolbar.style.right = 'auto';
      toolbar.style.bottom = 'auto';
      toolbar.style.left = `${data.toolbarPositionX}px`;
      toolbar.style.top = `${data.toolbarPositionY}px`;
    }
  });
  
  // Add event listeners for toolbar actions
  screenshotButton.addEventListener('click', () => {
    browser.runtime.sendMessage({ action: "takeScreenshot" })
      .catch(error => console.error("Error taking screenshot:", error));
  });
  
  recordButton.addEventListener('click', () => {
    browser.runtime.sendMessage({ action: "startRecording" })
      .then(response => {
        if (response && response.success) {
          setRecordingState(true);
        } else if (response && response.error) {
          console.error("Failed to start recording:", response.error);
        }
      })
      .catch(error => console.error("Error starting recording:", error));
  });
  
  stopButton.addEventListener('click', () => {
    browser.runtime.sendMessage({ action: "stopRecording" })
      .then(() => {
        setRecordingState(false);
      })
      .catch(error => console.error("Error stopping recording:", error));
  });
  
  // Listen for recording state changes from background
  browser.runtime.onMessage.addListener((message) => {
    if (message.action === "recordingStateChanged") {
      setRecordingState(message.isRecording);
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
      browser.storage.local.set({
        toolbarPositionX: parseInt(element.style.left),
        toolbarPositionY: parseInt(element.style.top)
      });
    }
  }
})();
