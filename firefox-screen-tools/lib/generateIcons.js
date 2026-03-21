const fs = require('fs');
const { createCanvas } = require('canvas');

// Function to create a basic icon
function createIcon(size, color, filename) {
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext('2d');
  
  // Background
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, size, size);
  
  // Icon shape
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(size/2, size/2, size/2 - 4, 0, Math.PI * 2);
  ctx.fill();
  
  // Save to file
  const buffer = canvas.toBuffer('image/png');
  fs.writeFileSync(filename, buffer);
  
  console.log(`Created icon: ${filename}`);
}

// Function to create screenshot icon
function createScreenshotIcon(size, filename) {
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext('2d');
  
  // Background
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, size, size);
  
  // Camera shape
  ctx.fillStyle = '#0060df';
  const padding = size * 0.15;
  ctx.fillRect(padding, padding, size - padding * 2, size - padding * 2);
  
  // Flash
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(size * 0.3, size * 0.3, size * 0.1, 0, Math.PI * 2);
  ctx.fill();
  
  // Save to file
  const buffer = canvas.toBuffer('image/png');
  fs.writeFileSync(filename, buffer);
  
  console.log(`Created screenshot icon: ${filename}`);
}

// Function to create record icon
function createRecordIcon(size, filename) {
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext('2d');
  
  // Background
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, size, size);
  
  // Record circle
  ctx.fillStyle = '#f44336';
  ctx.beginPath();
  ctx.arc(size/2, size/2, size/3, 0, Math.PI * 2);
  ctx.fill();
  
  // Save to file
  const buffer = canvas.toBuffer('image/png');
  fs.writeFileSync(filename, buffer);
  
  console.log(`Created record icon: ${filename}`);
}

// Create directories if they don't exist
if (!fs.existsSync('icons')) {
  fs.mkdirSync('icons');
}

// Create extension icons
createIcon(48, '#0060df', 'icons/icon-48.png');
createIcon(96, '#0060df', 'icons/icon-96.png');

// Create button icons
createScreenshotIcon(48, 'icons/screenshot.png');
createRecordIcon(48, 'icons/record.png');

console.log('Icon generation complete!');
