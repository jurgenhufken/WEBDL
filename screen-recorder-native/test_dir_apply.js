const { JSDOM } = require('jsdom');
JSDOM.fromURL('http://localhost:35729/gallery', {runScripts: 'dangerously', resources: 'usable'}).then(dom => {
  setTimeout(() => {
    try {
      const list = dom.window.getSelectedDirsFromModal();
      console.log("getSelectedDirsFromModal:", list);
      process.exit(0);
    } catch(e) {
      console.error(e);
      process.exit(1);
    }
  }, 2000);
});
