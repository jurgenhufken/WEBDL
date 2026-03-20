const { app, BrowserWindow, ipcMain, Menu, Tray, desktopCapturer } = require('electron');
const path = require('path');
const fs = require('fs');
const express = require('express');
const http = require('http');
const socketIO = require('socket.io');

// Server voor communicatie met browser extensie
const expressApp = express();

// OPTIONS preflight request handler
expressApp.options('*', (req, res) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  res.header('Access-Control-Max-Age', '3600'); // Cache preflight voor een uur
  res.sendStatus(200);
});

// CORS headers toevoegen voor alle routes
expressApp.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  next();
});

// Voeg een endpoint toe om CORS te testen
expressApp.get('/cors-test', (req, res) => {
  res.json({ status: 'success', message: 'CORS is enabled!' });
});

const server = http.createServer(expressApp);
const io = socketIO(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST', 'OPTIONS'],
    credentials: true,
    allowedHeaders: ['Origin', 'X-Requested-With', 'Content-Type', 'Accept']
  },
  allowEIO3: true, // Compatibiliteit met oudere clients
  transports: ['websocket', 'polling']
});
const PORT = 35729;

// Bewaar referenties naar window en tray
let mainWindow;
let tray;
let isRecording = false;
let mediaRecorder = null;
let recordedChunks = [];

// Map voor opgeslagen opnames
const downloadsPath = path.join(app.getPath('downloads'), 'screen-recordings');
if (!fs.existsSync(downloadsPath)) {
  fs.mkdirSync(downloadsPath, { recursive: true });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      enableRemoteModule: true
    },
    icon: path.join(__dirname, 'assets/icon.png')
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));
  
  // Minimaliseer naar tray bij sluiten
  mainWindow.on('close', (event) => {
    if (!app.isQuitting) {
      event.preventDefault();
      mainWindow.hide();
      return false;
    }
    return true;
  });
}

function createTray() {
  tray = new Tray(path.join(__dirname, 'assets/icon-small.png'));
  const contextMenu = Menu.buildFromTemplate([
    { 
      label: 'Open Screen Recorder', 
      click: () => { mainWindow.show(); } 
    },
    { 
      label: 'Quit', 
      click: () => { 
        app.isQuitting = true;
        app.quit(); 
      } 
    }
  ]);
  
  tray.setToolTip('Screen Recorder');
  tray.setContextMenu(contextMenu);
  
  tray.on('click', () => {
    mainWindow.isVisible() ? mainWindow.hide() : mainWindow.show();
  });
}

async function startRecording(sourceId = null) {
  if (isRecording) return;
  
  try {
    // Als geen specifieke bron is opgegeven, laat gebruiker kiezen
    const sources = await desktopCapturer.getSources({ 
      types: ['window', 'screen'],
      thumbnailSize: { width: 250, height: 250 }
    });
    
    if (!sourceId && sources.length > 0) {
      // Default naar het hoofdscherm
      sourceId = sources.find(source => source.name === 'Entire Screen')?.id || sources[0].id;
    }
    
    if (mainWindow) {
      try {
        mainWindow.webContents.send('start-recording', sourceId);
      } catch (err) {
        console.log('Kon start-recording bericht niet sturen:', err.message);
      }
    }
    isRecording = true;
    
    // Update tray icon en menu als die bestaat
    if (tray) {
      try {
        tray.setImage(path.join(__dirname, 'assets/icon-recording.png'));
      } catch (err) {
        console.log('Kon tray icon niet updaten:', err.message);
        // Niet kritisch, negeren en doorgaan
      }
    }
    
    // Status update sturen naar alle clients
    io.emit('recording-status-changed', { isRecording: true });
    
  } catch (error) {
    console.error('Error starting recording:', error);
  }
}

function stopRecording() {
  if (!isRecording) return;
  
  if (mainWindow) {
    try {
      mainWindow.webContents.send('stop-recording');
    } catch (err) {
      console.log('Kon stop-recording bericht niet sturen:', err.message);
    }
  }
  isRecording = false;
  
  // Update tray icon en menu als die bestaat
  if (tray) {
    try {
      tray.setImage(path.join(__dirname, 'assets/icon-small.png'));
    } catch (err) {
      console.log('Kon tray icon niet updaten:', err.message);
      // Niet kritisch, negeren en doorgaan
    }
  }
  
  // Status update sturen naar alle clients
  io.emit('recording-status-changed', { isRecording: false });
}

function takeScreenshot(videoOnly = false) {
  if (mainWindow) {
    try {
      mainWindow.webContents.send('take-screenshot', videoOnly);
    } catch (err) {
      console.log('Kon take-screenshot bericht niet sturen:', err.message);
    }
  }
}

// Zorg ervoor dat recording status is gereset bij opstart
isRecording = false;

// Set up communication server
io.on('connection', (socket) => {
  console.log('Browser extension connected');
  
  // Stuur huidige status bij nieuwe verbinding
  socket.emit('recording-status-changed', { isRecording: false });
  
  // Send server info to help with debugging
  socket.emit('server-info', { 
    version: '1.0.0',
    serverTime: new Date().toISOString(),
    corsEnabled: true
  });
  
  socket.on('start-recording', () => {
    startRecording();
  });
  
  socket.on('stop-recording', () => {
    stopRecording();
  });
  
  socket.on('take-screenshot', (data) => {
    takeScreenshot(data?.videoOnly);
  });
  
  socket.on('disconnect', () => {
    console.log('Browser extension disconnected');
  });
});

// Start de server
server.listen(PORT, () => {
  console.log(`Communication server running at http://localhost:${PORT}`);
});

// IPC handlers voor communicatie met renderer proces
ipcMain.on('recording-complete', (event, filePath) => {
  io.emit('recording-complete', { filePath });
});

ipcMain.on('screenshot-complete', (event, filePath) => {
  io.emit('screenshot-complete', { filePath });
});

// App lifecycle events
app.on('ready', () => {
  createWindow();
  createTray();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

app.on('before-quit', () => {
  app.isQuitting = true;
});
