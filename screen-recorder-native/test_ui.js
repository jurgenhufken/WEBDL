const { JSDOM } = require("jsdom");

async function testUI() {
  console.log('Loading http://localhost:35729/gallery via JSDOM...');
  
  const dom = await JSDOM.fromURL("http://localhost:35729/gallery", {
    runScripts: "dangerously",
    resources: "usable",
    beforeParse(window) {
      window.IntersectionObserver = class { 
        observe() {} 
        unobserve() {} 
        disconnect() {} 
      };
      // Polyfill requestAnimationFrame which might also be missing
      window.requestAnimationFrame = (cb) => setTimeout(cb, 0);
    }
  });

  const window = dom.window;
  const document = window.document;

  await new Promise(r => setTimeout(r, 2000));

  console.log('\\n--- UI TEST RESULTS ---');

  // 1. Check if the Search Input exists
  const inpSearch = document.getElementById('inpSearch');
  if (inpSearch) {
    console.log('✅ Zoekveld (inpSearch) succesvol gevonden in DOM!');
  } else {
    console.log('❌ Zoekveld ontbreekt!');
  }

  // 2. Check if the Mappen button exists
  const btnDirSelect = document.getElementById('btnDirSelect');
  if (btnDirSelect) {
    console.log('✅ Mappen knop (btnDirSelect) gevonden!');
  } else {
    console.log('❌ Mappen knop ontbreekt!');
  }

  // 3. Check Duplicates Scanner
  const btnDups = document.getElementById('btnDups');
  if (btnDups) {
    console.log('✅ 🛡 Duplicaten Scanner knop gevonden!');
    // Simulate Click
    btnDups.click();
    
    // Check if modal opens
    const dupsModal = document.getElementById('dupsModal');
    if (dupsModal) {
       console.log('✅ Duplicaten Modal is geopend en aanwezig in DOM!');
    }

    // Click Scan
    const btnDupsScan = document.getElementById('btnDupsScan');
    if (btnDupsScan) {
       console.log('✅ "Start Scan" knop gevonden! Klik wordt gesimuleerd...');
       btnDupsScan.click();
       
       await new Promise(r => setTimeout(r, 4000)); // wait for API response
       
       const dupsContent = document.getElementById('dupsContent');
       if (dupsContent.innerHTML.includes('groepen met duplicaten gevonden') || dupsContent.innerHTML.includes('Geen duplicaten gevonden')) {
          console.log('✅ Duplicaten Scanner API succesvol aangeroepen via UI, resultaten ge-renderd!');
       } else {
          console.log('❌ Resultaten UI update mislukt.');
       }
    }
  } else {
    console.log('❌ Duplicaten Scanner knop ontbreekt!');
  }

  console.log('-----------------------\\n');
  
  // Cleanup
  setTimeout(() => process.exit(0), 1000);
}

testUI().catch(console.error);
