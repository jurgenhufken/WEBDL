let isRecording = false;

// Keep track of which tabs have our content script running
let activeTabs = new Set();

// Function to register a tab as having our content script
function registerTab(tabId) {
  activeTabs.add(tabId);
}

// Function to unregister a tab when it's closed or navigated away
function unregisterTab(tabId) {
  activeTabs.delete(tabId);
}

// Function to notify all tabs about recording state changes
async function notifyRecordingStateChange(state) {
  isRecording = state;
  
  // Only send messages to tabs we know have our content script
  for (const tabId of activeTabs) {
    try {
      // Check if the tab still exists
      const tab = await browser.tabs.get(tabId).catch(() => null);
      if (!tab) {
        activeTabs.delete(tabId);
        continue;
      }
      
      // Send message to the tab
      await browser.tabs.sendMessage(tabId, {
        action: "recordingStateChanged",
        isRecording: state
      }).catch(() => {
        // If sending fails, tab probably navigated away or closed
        activeTabs.delete(tabId);
      });
    } catch (error) {
      // If there's an error, remove the tab from active tabs
      activeTabs.delete(tabId);
    }
  }
}

// Listen for tab events to manage our active tabs list
browser.tabs.onRemoved.addListener((tabId) => {
  unregisterTab(tabId);
});

browser.tabs.onUpdated.addListener((tabId, changeInfo) => {
  // If the URL changes, unregister the tab as our content script will be reloaded
  if (changeInfo.url) {
    unregisterTab(tabId);
  }
});

// Listen for messages from the popup and content scripts
browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // If the message comes from a content script, register the tab
  if (sender.tab && sender.tab.id) {
    registerTab(sender.tab.id);
  }
  
  switch (message.action) {
    case "takeScreenshot":
      return takeScreenshot().then(() => ({ success: true }));
    
    case "startRecording":
      return startRecording().then(
        () => ({ success: true }),
        error => ({ success: false, error: error.message })
      );
    
    case "stopRecording":
      return stopRecording().then(() => ({ success: true }));
    
    case "getRecordingStatus":
      return Promise.resolve({ isRecording });
      
    case "contentScriptLoaded":
      // Tab registration is already handled when receiving any message
      return Promise.resolve({ success: true });
  }
});

// Take screenshot function
async function takeScreenshot() {
  try {
    // Get the active tab
    const tabs = await browser.tabs.query({ active: true, currentWindow: true });
    const tab = tabs[0];
    
    // First try to detect a video on the page
    let videoInfo = null;
    try {
      videoInfo = await browser.tabs.sendMessage(tab.id, { action: "detectVideo" });
    } catch (error) {
      console.log("Error detecting video, will capture full tab", error);
    }
    
    // Capture the visible tab
    const screenshotData = await browser.tabs.captureVisibleTab(null, { format: "jpeg", quality: 100 });
    
    // If we found a video, crop the screenshot to just the video area
    let finalScreenshotData = screenshotData;
    
    if (videoInfo && videoInfo.found) {
      try {
        // Create an image from the screenshot
        const img = new Image();
        await new Promise((resolve, reject) => {
          img.onload = resolve;
          img.onerror = reject;
          img.src = screenshotData;
        });
        
        // Create a canvas to draw the cropped image
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        
        // Account for device pixel ratio
        const dpr = videoInfo.devicePixelRatio || 1;
        
        // Set canvas dimensions to the video dimensions
        canvas.width = videoInfo.width * dpr;
        canvas.height = videoInfo.height * dpr;
        
        // Calculate the source coordinates considering scroll position and DPR
        const sourceX = videoInfo.x * dpr;
        const sourceY = videoInfo.y * dpr;
        const sourceWidth = videoInfo.width * dpr;
        const sourceHeight = videoInfo.height * dpr;
        
        // Draw only the video portion onto the canvas
        ctx.drawImage(img, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, canvas.width, canvas.height);
        
        // Convert canvas to JPEG (high quality)
        finalScreenshotData = canvas.toDataURL('image/jpeg', 1.0);
      } catch (cropError) {
        console.error("Error cropping video screenshot:", cropError);
        // Fall back to full screenshot
        finalScreenshotData = screenshotData;
      }
    }
    
    // Convert the data URL to a blob
    const response = await fetch(finalScreenshotData);
    const blob = await response.blob();
    
    // Create a file name with date and time
    const timestamp = new Date().toISOString().replace(/:/g, '-').replace(/\..+/, '');
    const prefix = videoInfo && videoInfo.found ? 'video' : 'screenshot';
    const filename = `${prefix}_${timestamp}.jpg`;
    
    // Save to downloads
    await browser.downloads.download({
      url: URL.createObjectURL(blob),
      filename: filename,
      saveAs: false
    });
    
    return true;
  } catch (error) {
    console.error("Screenshot error:", error);
    throw error;
  }
}

// Variable to store recorder connection port
let recorderPort = null;

// Listen for connections from the recorder
browser.runtime.onConnect.addListener(function(port) {
  if (port.name === "recorder") {
    recorderPort = port;
    
    // Listen for messages from recorder
    port.onMessage.addListener(function(message) {
      switch(message.action) {
        case "recorderReady":
          // The recorder tab is ready to accept commands
          console.log("Recorder tab is ready");
          break;
          
        case "recordingStarted":
          isRecording = true;
          notifyRecordingStateChange(true);
          break;
          
        case "recordingStopped":
          isRecording = false;
          notifyRecordingStateChange(false);
          recorderPort = null;
          break;
      }
    });
    
    // Handle disconnection
    port.onDisconnect.addListener(function() {
      isRecording = false;
      notifyRecordingStateChange(false);
      recorderPort = null;
    });
  }
});

// Start recording function
async function startRecording() {
  if (isRecording) {
    return Promise.resolve(); // Already recording
  }
  
  try {
    // Create a new tab that will handle the screen recording
    const recorderTab = await browser.tabs.create({
      url: browser.runtime.getURL("recorder/recorder.html"),
      active: true // Make the tab active so user sees it
    });
    
    // Store the recorder tab ID for later use
    browser.storage.local.set({ recorderTabId: recorderTab.id });
    
    // No need to send a start message - the recorder UI handles starting
    return Promise.resolve();
  } catch (error) {
    console.error("Recording error:", error);
    isRecording = false;
    throw error;
  }
}

// Stop recording function
async function stopRecording() {
  try {
    if (recorderPort) {
      // Send stop message through the port
      recorderPort.postMessage({ action: "stopRecording" });
      // We don't wait for a response, as the recorder will notify us when it's done
      return Promise.resolve();
    } else {
      // Get the recorder tab id as a fallback
      const data = await browser.storage.local.get("recorderTabId");
      if (data.recorderTabId) {
        try {
          // Try to send a message to the tab directly
          await browser.tabs.sendMessage(data.recorderTabId, { action: "stopRecording" });
          
          // Clean up
          await browser.storage.local.remove("recorderTabId");
        } catch (err) {
          // Tab might be closed already, just clean up
          await browser.storage.local.remove("recorderTabId");
        }
      }
      
      isRecording = false;
      await notifyRecordingStateChange(false);
      return Promise.resolve();
    }
  } catch (error) {
    console.error("Error stopping recording:", error);
    isRecording = false;
    throw error;
  }
}
