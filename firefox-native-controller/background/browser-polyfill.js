// Browser API compatibility layer
(function() {
  if (typeof window.browser === 'undefined') {
    window.browser = {};
  }

  // Define storage API if it doesn't exist
  if (typeof window.browser.storage === 'undefined') {
    window.browser.storage = {
      local: {
        get: function(key) {
          return new Promise((resolve) => {
            if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
              chrome.storage.local.get(key, resolve);
            } else {
              // Use localStorage as fallback
              try {
                const result = {};
                if (Array.isArray(key)) {
                  key.forEach(k => {
                    const value = localStorage.getItem('extension_' + k);
                    if (value !== null) {
                      result[k] = JSON.parse(value);
                    }
                  });
                } else if (typeof key === 'string') {
                  const value = localStorage.getItem('extension_' + key);
                  if (value !== null) {
                    result[key] = JSON.parse(value);
                  }
                } else if (key === null) {
                  // Get all items with extension_ prefix
                  for (let i = 0; i < localStorage.length; i++) {
                    const k = localStorage.key(i);
                    if (k.startsWith('extension_')) {
                      const actualKey = k.substring(10);
                      result[actualKey] = JSON.parse(localStorage.getItem(k));
                    }
                  }
                }
                resolve(result);
              } catch (e) {
                console.error('Error accessing localStorage:', e);
                resolve({});
              }
            }
          });
        },
        set: function(items) {
          return new Promise((resolve) => {
            if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
              chrome.storage.local.set(items, resolve);
            } else {
              // Use localStorage as fallback
              try {
                Object.keys(items).forEach(key => {
                  localStorage.setItem('extension_' + key, JSON.stringify(items[key]));
                });
                resolve();
              } catch (e) {
                console.error('Error accessing localStorage:', e);
                resolve();
              }
            }
          });
        },
        remove: function(keys) {
          return new Promise((resolve) => {
            if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
              chrome.storage.local.remove(keys, resolve);
            } else {
              // Use localStorage as fallback
              try {
                if (Array.isArray(keys)) {
                  keys.forEach(key => {
                    localStorage.removeItem('extension_' + key);
                  });
                } else {
                  localStorage.removeItem('extension_' + keys);
                }
                resolve();
              } catch (e) {
                console.error('Error accessing localStorage:', e);
                resolve();
              }
            }
          });
        },
        clear: function() {
          return new Promise((resolve) => {
            if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
              chrome.storage.local.clear(resolve);
            } else {
              // Use localStorage as fallback - only clear extension_ prefixed items
              try {
                const keysToRemove = [];
                for (let i = 0; i < localStorage.length; i++) {
                  const key = localStorage.key(i);
                  if (key.startsWith('extension_')) {
                    keysToRemove.push(key);
                  }
                }
                keysToRemove.forEach(key => localStorage.removeItem(key));
                resolve();
              } catch (e) {
                console.error('Error accessing localStorage:', e);
                resolve();
              }
            }
          });
        }
      }
    };
  }

  // Define runtime API if it doesn't exist
  if (typeof window.browser.runtime === 'undefined') {
    window.browser.runtime = {
      sendMessage: function(message) {
        return new Promise((resolve, reject) => {
          if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
            chrome.runtime.sendMessage(message, (response) => {
              if (chrome.runtime.lastError) {
                reject(chrome.runtime.lastError);
              } else {
                resolve(response);
              }
            });
          } else {
            reject(new Error("Runtime API not available"));
          }
        });
      },
      onMessage: {
        addListener: function(callback) {
          if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
            chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
              const result = callback(message, sender);
              if (result && result.then) {
                result.then(sendResponse);
                return true; // Keep channel open for async response
              }
              return false;
            });
          }
        }
      }
    };
  }

  console.log("Browser API polyfill loaded");
})();
