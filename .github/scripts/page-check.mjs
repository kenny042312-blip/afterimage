import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium, request as playwrightRequest } from 'playwright';

const root = path.resolve(process.argv[2] ?? process.cwd());
const output = path.resolve(process.env.PAGE_CHECK_OUTPUT ?? path.join(root, 'page-check-results'));
const includeFile = process.env.CHECK_FILE_URL === 'true';
const skipDirs = new Set(['.git', 'node_modules', 'page-check-results']);
const contentTypes = {
  '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.webp': 'image/webp', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8', '.woff': 'font/woff', '.woff2': 'font/woff2',
};

async function walk(dir) {
  const found = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    if (entry.isDirectory() && skipDirs.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...await walk(full));
    else if (entry.isFile() && /\.html?$/i.test(entry.name)) found.push(full);
  }
  return found;
}

function attrs(tag) {
  const result = {};
  for (const match of tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)) {
    result[match[1].toLowerCase()] = match[2] ?? match[3] ?? match[4] ?? '';
  }
  return result;
}

async function internalHosts(htmlFiles) {
  const hosts = new Map();
  for (const file of htmlFiles) {
    const html = await fs.readFile(file, 'utf8');
    for (const match of html.matchAll(/<(?:link|meta)\b[^>]*>/gi)) {
      const tag = match[0];
      const a = attrs(tag);
      const canonical = tag.toLowerCase().startsWith('<link') && a.rel?.toLowerCase() === 'canonical';
      const social = tag.toLowerCase().startsWith('<meta') && ['og:url', 'twitter:url'].includes((a.property ?? a.name ?? '').toLowerCase());
      if (!canonical && !social) continue;
      try {
        const u = new URL(a.href ?? a.content);
        if (!/^https?:$/.test(u.protocol)) continue;
        let prefix = '/';
        if (u.hostname.endsWith('.github.io') && u.pathname !== '/') {
          const first = u.pathname.split('/').filter(Boolean)[0];
          if (first) prefix = `/${first}/`;
        }
        hosts.set(u.hostname.toLowerCase(), prefix);
      } catch {}
    }
  }
  return hosts;
}

function decodePath(urlPath) {
  try { return decodeURIComponent(urlPath); } catch { return urlPath; }
}

function toLocalPath(raw, base, origin, ownHosts) {
  let target;
  try { target = new URL(raw, base); } catch { return null; }
  if (target.origin === origin) return `${target.pathname}${target.search}`;
  const prefix = ownHosts.get(target.hostname.toLowerCase());
  if (!prefix) return null;
  let pathname = target.pathname;
  if (prefix !== '/' && pathname.startsWith(prefix)) pathname = `/${pathname.slice(prefix.length)}`;
  if (!pathname.startsWith('/')) pathname = `/${pathname}`;
  return `${pathname}${target.search}`;
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    const pathname = decodePath(url.pathname);
    let target = path.resolve(root, `.${pathname}`);
    if (target !== root && !target.startsWith(`${root}${path.sep}`)) {
      res.writeHead(403).end('Forbidden');
      return;
    }
    let stat;
    try { stat = await fs.stat(target); } catch {}
    if (stat?.isDirectory()) target = path.join(target, 'index.html');
    try { stat = await fs.stat(target); } catch { stat = null; }
    if (!stat?.isFile()) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('Not Found');
      return;
    }
    res.writeHead(200, {
      'content-type': contentTypes[path.extname(target).toLowerCase()] ?? 'application/octet-stream',
      'cache-control': 'no-store',
    });
    if (req.method === 'HEAD') res.end();
    else res.end(await fs.readFile(target));
  } catch (error) {
    res.writeHead(500).end(String(error));
  }
});

const htmlFiles = (await walk(root)).sort();
if (!htmlFiles.length) {
  console.error(`No HTML pages found under ${root}`);
  process.exit(1);
}
await fs.mkdir(output, { recursive: true });
await new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', resolve);
});
const address = server.address();
const origin = `http://127.0.0.1:${address.port}`;
const ownHosts = await internalHosts(htmlFiles);
const browser = await chromium.launch({ headless: true });
const api = await playwrightRequest.newContext({ timeout: 5000 });
const failures = [];
const warnings = [];
const checkedLinks = new Set();
const checkedAssets = new Set();
const assetTypes = new Set(['script', 'stylesheet', 'image', 'font', 'media']);

try {
  console.log(`Checking ${htmlFiles.length} HTML page(s) under ${root}`);
  for (const file of htmlFiles) {
    const relative = path.relative(root, file).split(path.sep).join('/');
    const routePath = `/${relative.split('/').map(encodeURIComponent).join('/')}`;
    const pageUrl = `${origin}${routePath}`;
    const name = relative.replace(/[^a-zA-Z0-9._-]+/g, '_');
    const screenshot = path.join(output, `${name}.png`);
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
    const localErrors = [];
    const localWarnings = [];

    page.on('console', msg => {
      if (msg.type() !== 'error') return;
      if (msg.text().startsWith('Failed to load resource:') || msg.text().includes("The Content Security Policy directive 'frame-ancestors' is ignored when delivered via a <meta> element")) {
        localWarnings.push(`browser warning: ${msg.text()}`);
      } else {
        localErrors.push(`console error: ${msg.text()}`);
      }
    });
    page.on('pageerror', error => localErrors.push(`uncaught JavaScript error: ${error.message}`));
    page.on('requestfailed', req => {
      const reason = req.failure()?.errorText ?? 'request failed';
      if (req.url().startsWith(`${origin}/`)) localErrors.push(`request failed: ${req.url()} (${reason})`);
      else localWarnings.push(`external request warning: ${req.url()} (${reason})`);
    });
    page.on('response', response => {
      const req = response.request();
      if (response.status() < 400) return;
      const detail = `HTTP ${response.status()}: ${response.url()}`;
      if (response.url().startsWith(`${origin}/`)) localErrors.push(detail);
      else if (assetTypes.has(req.resourceType())) localWarnings.push(`external asset warning: ${detail}`);
    });
    await page.route('**/*', async route => {
      const req = route.request();
      if (!req.url().startsWith(`${origin}/`) && ['font', 'stylesheet'].includes(req.resourceType())) {
        localWarnings.push(`external style/font skipped: ${req.url()}`);
        await route.abort('blockedbyclient');
      } else {
        await route.continue();
      }
    });

    try {
      const response = await page.goto(pageUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
      if (!response || response.status() >= 400) localErrors.push(`page navigation failed: HTTP ${response?.status() ?? 'no response'} ${pageUrl}`);
      await page.waitForTimeout(350);
      const rendered = await page.evaluate(() => {
        const body = document.body;
        if (!body) return { blank: true, textLength: 0, visibleMedia: 0 };
        const textLength = (body.innerText ?? '').trim().length;
        const visibleMedia = [...body.querySelectorAll('canvas,svg,img,video,iframe,object,[role="main"]')]
          .filter(el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; }).length;
        return { blank: textLength === 0 && visibleMedia === 0, textLength, visibleMedia };
      });
      if (rendered.blank) localErrors.push('page rendered blank (no visible text or media)');

      const hrefs = await page.locator('a[href]').evaluateAll(nodes => nodes.map(a => a.getAttribute('href')).filter(Boolean));
      for (const href of hrefs) {
        if (/^(?:#|mailto:|tel:|javascript:|data:)/i.test(href)) continue;
        const key = toLocalPath(href, pageUrl, origin, ownHosts);
        if (!key || checkedLinks.has(key)) continue;
        checkedLinks.add(key);
        const linkResponse = await api.get(`${origin}${key}`);
        if (linkResponse.status() >= 400) localErrors.push(`internal link HTTP ${linkResponse.status()}: ${href} (from ${relative})`);
      }

      const assets = await page.evaluate(() => {
        const refs = [];
        const assetRels = new Set(['stylesheet', 'icon', 'manifest', 'preload', 'modulepreload', 'apple-touch-icon', 'mask-icon']);
        for (const el of document.querySelectorAll('script[src],img[src],source[src],source[srcset],video[poster],audio[src],object[data],iframe[src],link[href],meta[property="og:image"],meta[name="twitter:image"]')) {
          if (el.tagName === 'LINK' && !el.rel.split(/\s+/).some(rel => assetRels.has(rel.toLowerCase()))) continue;
          if (el.tagName === 'META') refs.push(el.content);
          else if (el.tagName === 'VIDEO') refs.push(el.getAttribute('poster'));
          else if (el.hasAttribute('srcset')) refs.push(...el.getAttribute('srcset').split(',').map(part => part.trim().split(/\s+/)[0]));
          else refs.push(el.getAttribute('src') || el.getAttribute('href') || el.getAttribute('data'));
        }
        const readRules = (rules, stylesheetUrl) => {
          for (const rule of rules) {
            for (const match of rule.cssText.matchAll(/url\(\s*(['"]?)(.*?)\1\s*\)/gi)) refs.push(new URL(match[2], stylesheetUrl).href);
            if (rule.cssRules) readRules(rule.cssRules, stylesheetUrl);
          }
        };
        for (const sheet of document.styleSheets) { try { readRules(sheet.cssRules, sheet.href || document.baseURI); } catch {} }
        return refs.filter(Boolean);
      });
      for (const asset of assets) {
        if (/^(?:data:|blob:|javascript:)/i.test(asset)) continue;
        const key = toLocalPath(asset, pageUrl, origin, ownHosts);
        if (!key || checkedAssets.has(key)) continue;
        checkedAssets.add(key);
        const assetResponse = await api.get(`${origin}${key}`);
        if (assetResponse.status() >= 400) localErrors.push(`asset HTTP ${assetResponse.status()}: ${asset} (from ${relative})`);
      }
    } catch (error) {
      localErrors.push(`page check error: ${error.message}`);
    }

    try { await page.screenshot({ path: screenshot, fullPage: false, animations: 'disabled', timeout: 10000 }); }
    catch (error) { localErrors.push(`screenshot failed: ${error.message}`); }
    if (localErrors.length) failures.push({ page: relative, errors: [...new Set(localErrors)] });
    if (localWarnings.length) warnings.push({ page: relative, warnings: [...new Set(localWarnings)] });
    console.log(`${localErrors.length ? 'FAIL' : 'PASS'} ${relative}`);
    for (const error of new Set(localErrors)) console.log(`  - ${error}`);
    for (const warning of new Set(localWarnings)) console.log(`  - WARN ${warning}`);

    if (includeFile) {
      const filePage = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
      const fileIssues = [];
      filePage.on('console', msg => { if (msg.type() === 'error') fileIssues.push(`console error: ${msg.text()}`); });
      filePage.on('pageerror', error => fileIssues.push(`JavaScript error: ${error.message}`));
      filePage.on('requestfailed', req => fileIssues.push(`request failed: ${req.url()} (${req.failure()?.errorText ?? 'request failed'})`));
      try {
        await filePage.goto(pathToFileURL(file).href, { waitUntil: 'domcontentloaded', timeout: 15000 });
        await filePage.waitForTimeout(350);
        const blank = await filePage.evaluate(() => !(document.body?.innerText ?? '').trim() && !document.querySelector('canvas,svg,img,video,iframe,object'));
        if (blank) fileIssues.push('page rendered blank');
        await filePage.screenshot({ path: path.join(output, `${name}-file.png`), fullPage: false, animations: 'disabled', timeout: 10000 });
      } catch (error) { fileIssues.push(`file:// open failed: ${error.message}`); }
      if (fileIssues.length) warnings.push({ page: `${relative} (file://)`, warnings: [...new Set(fileIssues)] });
      console.log(`${fileIssues.length ? 'WARN' : 'PASS'} file://${relative}`);
      for (const warning of new Set(fileIssues)) console.log(`  - ${warning}`);
      await filePage.close();
    }
    await page.close();
  }
} finally {
  await api.dispose();
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}

const summary = { checkedPages: htmlFiles.length, failures, warnings, screenshots: output };
await fs.writeFile(path.join(output, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
console.log(`\nChecked ${summary.checkedPages} page(s); ${failures.length} page(s) failed; ${warnings.length} warning group(s).`);
if (failures.length) process.exitCode = 1;
