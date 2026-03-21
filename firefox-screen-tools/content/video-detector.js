// This script detects video elements on the page and sends their positions to the background script

let __webdlSkip = false;
try {
  const host = String((window && window.location && window.location.hostname) || '').toLowerCase();
  __webdlSkip = (host === 'localhost' || host === '127.0.0.1');
} catch (e) { __webdlSkip = false; }

// Function to find the main visible video element on the page
function findMainVideoElement() {
  // Get all video elements on the page
  const videos = document.querySelectorAll('video');
  
  // If no videos, return null
  if (videos.length === 0) {
    return null;
  }
  
  // Filter for visible videos
  const visibleVideos = Array.from(videos).filter(video => {
    const rect = video.getBoundingClientRect();
    const isVisible = (
      rect.width > 100 && rect.height > 100 && // Must be reasonably sized
      rect.top >= 0 && 
      rect.left >= 0 && 
      rect.bottom <= (window.innerHeight || document.documentElement.clientHeight) &&
      rect.right <= (window.innerWidth || document.documentElement.clientWidth)
    );
    
    // Check if it's playing or has controls
    const isPlayable = !video.paused || video.controls;
    
    return isVisible && isPlayable;
  });
  
  // If no visible videos, try to find the largest video
  if (visibleVideos.length === 0) {
    // Sort by area (width * height) in descending order
    const sortedBySize = Array.from(videos).sort((a, b) => {
      const areaA = a.offsetWidth * a.offsetHeight;
      const areaB = b.offsetWidth * b.offsetHeight;
      return areaB - areaA;
    });
    
    // Return the largest video if it's at least 100x100 pixels
    if (sortedBySize.length > 0 && sortedBySize[0].offsetWidth > 100 && sortedBySize[0].offsetHeight > 100) {
      return sortedBySize[0];
    }
    
    return null;
  }
  
  // If multiple visible videos, get the one that's playing or the largest
  const playingVideos = visibleVideos.filter(v => !v.paused);
  if (playingVideos.length > 0) {
    // Sort playing videos by size
    return playingVideos.sort((a, b) => {
      const areaA = a.offsetWidth * a.offsetHeight;
      const areaB = b.offsetWidth * b.offsetHeight;
      return areaB - areaA;
    })[0];
  }
  
  // If no playing videos, return the largest visible one
  return visibleVideos.sort((a, b) => {
    const areaA = a.offsetWidth * a.offsetHeight;
    const areaB = b.offsetWidth * b.offsetHeight;
    return areaB - areaA;
  })[0];
}

// Function to find a video container that might be larger than the video element itself
function findVideoContainer(videoElement) {
  if (!videoElement) return null;
  
  // Try to find container by looking for parents with position relative/absolute
  // and similar dimensions to the video or larger
  let container = videoElement;
  let currentElement = videoElement;
  let maxIterations = 5; // Don't go too far up the DOM tree
  
  while (maxIterations > 0 && currentElement.parentElement) {
    const parent = currentElement.parentElement;
    const videoRect = videoElement.getBoundingClientRect();
    const parentRect = parent.getBoundingClientRect();
    
    // Check if the parent is significantly larger than the video
    const isContainer = (
      parentRect.width >= videoRect.width &&
      parentRect.height >= videoRect.height &&
      // Avoid going too far up (body, html, etc)
      parent.tagName !== 'BODY' && 
      parent.tagName !== 'HTML' &&
      // Look for common video container classes/IDs
      (parent.className.toLowerCase().includes('player') ||
       parent.className.toLowerCase().includes('video') ||
       parent.id.toLowerCase().includes('player') ||
       parent.id.toLowerCase().includes('video') ||
       // Or check position styles that might indicate a video container
       getComputedStyle(parent).position === 'relative' ||
       getComputedStyle(parent).position === 'absolute')
    );
    
    if (isContainer) {
      container = parent;
      // Check if we've found a good container (like YouTube's player)
      if (
        parent.className.toLowerCase().includes('player') ||
        parent.id.toLowerCase().includes('player')
      ) {
        break;
      }
    }
    
    currentElement = parent;
    maxIterations--;
  }
  
  return container;
}

// Listener for screenshot request
if (!__webdlSkip) browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "detectVideo") {
    // Find the video element
    const videoElement = findMainVideoElement();
    
    // If no video was found
    if (!videoElement) {
      sendResponse({ found: false });
      return true;
    }
    
    // Find the best container for the video
    const container = findVideoContainer(videoElement);
    const rect = container.getBoundingClientRect();
    
    // Get scroll position
    const scrollX = window.pageXOffset || document.documentElement.scrollLeft;
    const scrollY = window.pageYOffset || document.documentElement.scrollTop;
    
    // Return the position and dimensions
    sendResponse({
      found: true,
      x: Math.round(rect.left + scrollX),
      y: Math.round(rect.top + scrollY),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
      devicePixelRatio: window.devicePixelRatio || 1
    });
    
    return true;
  }
});

// Notify that video detector is loaded
if (!__webdlSkip) browser.runtime.sendMessage({ action: "videoDetectorLoaded" }).catch(error => {
  console.log("Error registering video detector: ", error);
});
