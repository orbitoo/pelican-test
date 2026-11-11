// tools/cdp.mjs
// Safe wrapper around `puppeteer-core` connecting exclusively to the persistent
// host Chrome CDP bridge at `http://127.0.0.1:19222`.
// NEVER spawns a headless browser and NEVER calls `browser.close()`.

import puppeteer from 'puppeteer-core';

export const CDP_HTTP_URL = process.env.CDP_URL || 'http://127.0.0.1:19222';

export async function withCDPBrowser(fn) {
  const browser = await puppeteer.connect({
    browserURL: CDP_HTTP_URL,
    defaultViewport: null,
    protocolTimeout: 180000,
  });
  const openedPages = [];

  async function openRenderPage(url, width = 1920, height = 1080) {
    const page = await browser.newPage();
    openedPages.push(page);
    await page.setViewport({ width, height, deviceScaleFactor: 1 });
    const errors = [];
    const loggedOnce = new Set();
    page.on('pageerror', (err) => {
      const msg = err.stack || err.message || String(err);
      errors.push(msg);
      if (!loggedOnce.has(msg)) {
        loggedOnce.add(msg);
        console.error('[cdp pageerror]:', msg);
      }
    });
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        const txt = msg.text();
        errors.push(txt);
        if (!loggedOnce.has(txt)) {
          loggedOnce.add(txt);
          console.error('[cdp console.error]:', txt);
        }
      }
    });
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForFunction('window.__PELICAN_READY__ === true', { timeout: 30000 });
    page.__pelicanErrors = errors;
    return page;
  }

  try {
    return await fn({ browser, openRenderPage });
  } finally {
    for (const p of openedPages) {
      try {
        if (!p.isClosed()) await p.close();
      } catch (_e) {
        // ignore cleanup error
      }
    }
    try {
      await browser.disconnect();
    } catch (_e) {
      // ignore disconnect error
    }
  }
}
