// Constanten
const NATIVE_APP_URL = 'http://localhost:35729';

// Status variabelen
let isConnected = false;
let isRecording = false;
let socket = null;
let activeTabs = new Set();
let toolbarState = {
  collapsed: false,
  position: null
};

// TabID registratie voor communicatie met content scripts
function registerTab(tabId) {
  activeTabs.add(tabId);
}

function unregisterTab(tabId) {
  activeTabs.delete(tabId);
}

// Socket.IO verbinding met native app opzetten
function connectToNativeApp() {
  try {
    console.log('Proberen verbinding te maken met:', NATIVE_APP_URL);
    
    // Check if Socket.IO is available
    if (typeof io !== 'function') {
      console.error('Socket.IO is niet geladen! Type van io is:', typeof io);
      showDebugAlert('Socket.IO is niet geladen. Controleer de console voor meer informatie.');
      return;
    }
    
    // Show connection options we're using
    console.log('Socket.IO verbindingsopties:', { 
      'withCredentials': true,
      'forceNew': true,
      'reconnectionAttempts': 5,
      'timeout': 10000
    });
    
    socket = io(NATIVE_APP_URL, { 
      'withCredentials': true,
      'forceNew': true,
      'reconnectionAttempts': 5,
      'timeout': 10000
    });
    
    socket.on('connect', () => {
      console.log('✅ Verbonden met native app');
      isConnected = true;
      notifyConnectionStateChange(true);
      showDebugAlert('✅ Verbonden met native app!');
    });
    
    socket.on('connect_error', (err) => {
      console.error('⚠️ Verbindingsfout met native app:', err.message);
      isConnected = false;
      notifyConnectionStateChange(false);
      showDebugAlert('⚠️ Verbindingsfout: ' + err.message);
    });
    
    socket.on('disconnect', (reason) => {
      console.log('❌ Verbinding met native app verbroken:', reason);
      isConnected = false;
      notifyConnectionStateChange(false);
      showDebugAlert('❌ Verbinding verbroken: ' + reason);
    });
    
    socket.on('recording-status-changed', (data) => {
      console.log('📱 Opnamestatus ontvangen:', data);
      isRecording = data.isRecording;
      notifyRecordingStateChange(isRecording);
    });
    
    socket.on('recording-complete', (data) => {
      console.log('🎬 Opname voltooid:', data.filePath);
      showDebugAlert('🎬 Opname opgeslagen: ' + data.filePath);
    });
    
    socket.on('screenshot-complete', (data) => {
      console.log('📷 Screenshot voltooid:', data.filePath);
      showDebugAlert('📷 Screenshot opgeslagen: ' + data.filePath);
    });
    
    socket.io.on('error', (error) => {
      console.error('🔥 Socket.IO error:', error);
      showDebugAlert('🔥 Socket.IO fout: ' + error);
    });
    
    // Start met automatisch verbinden
    attemptReconnect();
    
  } catch (error) {
    console.error('🚨 Kritieke fout bij verbinden met native app:', error);
    isConnected = false;
    notifyConnectionStateChange(false);
    showDebugAlert('🚨 Kritieke fout: ' + error.message);
  }
}

// Helper function to show debug alerts
function showDebugAlert(message) {
  // Send message to popup for debugging
  browser.runtime.sendMessage({
    action: "debug", 
    message: message
  }).catch(() => {}); // Ignore errors if no popup is open
}

// Automatisch opnieuw verbinden
function attemptReconnect() {
  if (!isConnected && socket) {
    socket.connect();
  }
}

// Probeer elke 5 seconden opnieuw te verbinden
setInterval(attemptReconnect, 5000);

// Stuur statusupdate naar alle actieve tabs
async function notifyConnectionStateChange(state) {
  for (const tabId of activeTabs) {
    try {
      await browser.tabs.sendMessage(tabId, {
        action: "connectionStateChanged",
        isConnected: state
      }).catch(() => {
        // Tab bestaat waarschijnlijk niet meer
        activeTabs.delete(tabId);
      });
    } catch (error) {
      // Tab bestaat waarschijnlijk niet meer
      activeTabs.delete(tabId);
    }
  }
}

// Stuur opnamestatus naar alle actieve tabs
async function notifyRecordingStateChange(state) {
  for (const tabId of activeTabs) {
    try {
      await browser.tabs.sendMessage(tabId, {
        action: "recordingStateChanged",
        isRecording: state
      }).catch(() => {
        // Tab bestaat waarschijnlijk niet meer
        activeTabs.delete(tabId);
      });
    } catch (error) {
      // Tab bestaat waarschijnlijk niet meer
      activeTabs.delete(tabId);
    }
  }
}

// Tab events
browser.tabs.onRemoved.addListener((tabId) => {
  unregisterTab(tabId);
});

browser.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.url) {
    unregisterTab(tabId);
  }
});

// Ontvang berichten van content scripts
browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Tab registreren als afkomstig van content script
  if (sender.tab && sender.tab.id) {
    registerTab(sender.tab.id);
  }
  
  switch (message.action) {
    case "contentScriptLoaded":
      sendResponse({ success: true });
      break;
      
    case "getStatus":
      sendResponse({
        isConnected,
        isRecording
      });
      break;
      
    case "startRecording":
      if (isConnected && socket) {
        socket.emit('start-recording');
        sendResponse({ success: true });
      } else {
        sendResponse({ success: false, error: "Niet verbonden met native app" });
      }
      break;
      
    case "stopRecording":
      if (isConnected && socket) {
        socket.emit('stop-recording');
        sendResponse({ success: true });
      } else {
        sendResponse({ success: false, error: "Niet verbonden met native app" });
      }
      break;
      
    case "takeScreenshot":
      if (isConnected && socket) {
        socket.emit('take-screenshot', { videoOnly: message.videoOnly });
        sendResponse({ success: true });
      } else {
        sendResponse({ success: false, error: "Niet verbonden met native app" });
      }
      break;
      
    case "saveToolbarState":
      if (message.state.collapsed !== undefined) {
        toolbarState.collapsed = message.state.collapsed;
      }
      if (message.state.position) {
        toolbarState.position = message.state.position;
      }
      safeStorageSet('toolbarState', toolbarState);
      sendResponse({ success: true });
      break;
      
    case "getToolbarState":
      sendResponse(toolbarState);
      break;
      
    case "checkConnection":
      // Perform various connection checks
      checkSocketConnection()
        .then(result => {
          sendResponse({ success: true, result });
        })
        .catch(error => {
          sendResponse({ success: false, error: error.message });
        });
      return true; // Keep message channel open
  }
  
  return true;
});

// Hulpfunctie om storage veilig te gebruiken met fallback
function safeStorageGet(key, defaultValue = null) {
  if (typeof browser !== 'undefined' && browser.storage && browser.storage.local) {
    return browser.storage.local.get(key).then(data => {
      return data[key] || defaultValue;
    }).catch(error => {
      console.error('Storage error:', error);
      return defaultValue;
    });
  } else {
    console.warn('Browser storage not available, using memory storage');
    return Promise.resolve(defaultValue);
  }
}

function safeStorageSet(key, value) {
  if (typeof browser !== 'undefined' && browser.storage && browser.storage.local) {
    let data = {};
    data[key] = value;
    return browser.storage.local.set(data).catch(error => {
      console.error('Storage error:', error);
    });
  } else {
    console.warn('Browser storage not available, data will not persist');
    return Promise.resolve();
  }
}

// Laad toolbar state uit opslag bij opstarten
safeStorageGet('toolbarState', {}).then(state => {
  if (state) {
    toolbarState = state;
  }
});

// Function to check socket connection status
async function checkSocketConnection() {
  const results = {
    socketAvailable: typeof io === 'function',
    socketState: socket ? socket.connected : null,
    connectionStatus: isConnected,
    nativeAppUrl: NATIVE_APP_URL,
    networkCheck: null
  };
  
  // Try a simple fetch to check if the server is actually running
  try {
    const response = await fetch(NATIVE_APP_URL, { 
      method: 'GET',
      mode: 'no-cors' // This is needed to avoid CORS errors on the fetch itself
    });
    results.networkCheck = 'Server responded';
  } catch (error) {
    results.networkCheck = `Fetch error: ${error.message}`;
  }
  
  // Force a reconnect attempt
  if (socket && !socket.connected) {
    try {
      socket.connect();
      // Wait a moment to see if it connects
      await new Promise(resolve => setTimeout(resolve, 1000));
      results.reconnectAttempt = socket.connected ? 'Success' : 'Failed';
    } catch (error) {
      results.reconnectAttempt = `Error: ${error.message}`;
    }
  }
  
  return results;
}

// Verbind met native app bij opstarten
connectToNativeApp();
