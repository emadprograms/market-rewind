const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();

  page.on('console', msg => console.log('BROWSER_LOG:', msg.text()));
  page.on('pageerror', error => console.log('BROWSER_ERROR:', error.message));

  await page.goto('http://localhost:3000');

  // Wait for the button
  await page.waitForSelector('button');
  
  // Click the 'Initialize Market Simulator' button
  const buttons = await page.$$('button');
  for (const btn of buttons) {
    const text = await page.evaluate(el => el.textContent, btn);
    if (text.includes('Initialize Market Simulator')) {
      await btn.click();
      console.log('Clicked initialize');
      break;
    }
  }

  await new Promise(r => setTimeout(r, 2000));
  await browser.close();
})();
