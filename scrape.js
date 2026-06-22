/**
 * Scrapes the live CBUAE EUR -> AED rate using a stealth headless browser
 * (to clear Cloudflare) and writes public/rate.json.
 *
 * Run locally:  npm install && npx playwright install chromium && npm run scrape
 * In CI:        handled by .github/workflows/fetch-rate.yml
 */
import { chromium } from 'playwright-extra';
import stealth from 'puppeteer-extra-plugin-stealth';
import fs from 'fs';

chromium.use(stealth());

const SOURCE_URL = 'https://www.centralbank.ae/en/forex-eibor/exchange-rates/';
const LABEL = 'Euro';

function round4(n) { return Math.round(n * 10000) / 10000; }

async function run() {
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-blink-features=AutomationControlled']
  });
  const page = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
               '(KHTML, like Gecko) Chrome/124.0 Safari/537.36',
    locale: 'en-US'
  }).then(c => c.newPage());

  await page.goto(SOURCE_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });

  // Wait for Cloudflare's "Just a moment..." challenge to resolve, then for
  // the rate table to render. Poll the page text for the Euro row.
  let rate = null;
  for (let i = 0; i < 24; i++) {            // up to ~2 minutes
    await page.waitForTimeout(5000);
    const text = await page.evaluate(() => document.body ? document.body.innerText : '');
    const m = text.match(new RegExp(LABEL + '\\s+(\\d+\\.\\d{3,6})'));
    if (m) { rate = parseFloat(m[1]); break; }
    if (/just a moment/i.test(text)) continue;   // still on the challenge
  }

  await browser.close();

  const out = rate === null
    ? { ok: false, error: 'eur_rate_not_found', source: SOURCE_URL, fetchedAt: new Date().toISOString() }
    : {
        ok: true,
        base: 'AED',
        currency: 'EUR',
        quote: 'AED per 1 EUR',
        rate: round4(rate),
        rateRaw: rate,
        source: SOURCE_URL,
        fetchedAt: new Date().toISOString()
      };

  fs.mkdirSync('public', { recursive: true });
  fs.writeFileSync('public/rate.json', JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out));
  if (!out.ok) process.exit(1);
}

run().catch(err => { console.error(err); process.exit(1); });
