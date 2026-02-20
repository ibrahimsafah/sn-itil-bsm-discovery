#!/usr/bin/env node

/**
 * Build script for BSM Hypergraph Discovery
 *
 * Compiles all source files (HTML, CSS, JS) into a single self-contained HTML file.
 * Produces two variants:
 *   - dist/bsm-discovery.html              (no images)
 *   - dist/bsm-discovery-with-images.html   (screenshots base64-embedded)
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

const SRC = path.join(__dirname, 'src');
const DIST = path.join(__dirname, 'dist');
const ROOT = __dirname;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readSrc(filename) {
  return fs.readFileSync(path.join(SRC, filename), 'utf-8');
}

function fetchURL(url) {
  return new Promise((resolve, reject) => {
    const get = (u) => {
      https.get(u, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          get(res.headers.location);
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode} fetching ${u}`));
          return;
        }
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
        res.on('error', reject);
      }).on('error', reject);
    };
    get(url);
  });
}

function imageToBase64(filePath) {
  const buf = fs.readFileSync(filePath);
  const ext = path.extname(filePath).slice(1).toLowerCase();
  const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : `image/${ext}`;
  return `data:${mime};base64,${buf.toString('base64')}`;
}

function humanSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

// ---------------------------------------------------------------------------
// Image gallery builder
// ---------------------------------------------------------------------------

function buildImageGallery() {
  const pngs = fs.readdirSync(ROOT)
    .filter((f) => f.endsWith('.png'))
    .sort();

  if (pngs.length === 0) return '';

  const imgs = pngs.map((f) => {
    const dataUri = imageToBase64(path.join(ROOT, f));
    const label = f.replace('.png', '').replace(/-/g, ' ');
    return `        <figure class="gallery-fig">
          <img src="${dataUri}" alt="${label}" loading="lazy">
          <figcaption>${label}</figcaption>
        </figure>`;
  });

  return `
  <!-- Embedded Screenshot Gallery -->
  <div id="screenshot-gallery" class="screenshot-gallery collapsed">
    <button class="gallery-toggle" id="gallery-toggle" title="Screenshots">
      <span class="gallery-icon">&#x1F4F7;</span> Screenshots
    </button>
    <div class="gallery-grid" id="gallery-grid">
      <div class="gallery-header">
        <h3>Application Screenshots</h3>
        <button class="gallery-close" id="gallery-close">&#x2715;</button>
      </div>
      <div class="gallery-items">
${imgs.join('\n')}
      </div>
    </div>
  </div>
  <style>
    .screenshot-gallery { position: fixed; z-index: 10000; }
    .screenshot-gallery .gallery-toggle {
      position: fixed; bottom: 16px; right: 16px; z-index: 10001;
      background: var(--bg-tertiary, #21262d); color: var(--text-primary, #e6edf3);
      border: 1px solid var(--border, #30363d); border-radius: 8px;
      padding: 8px 14px; font-size: 13px; cursor: pointer;
      box-shadow: 0 4px 12px rgba(0,0,0,0.4); transition: background 0.2s;
    }
    .screenshot-gallery .gallery-toggle:hover { background: var(--bg-hover, #30363d); }
    .screenshot-gallery .gallery-grid {
      display: none; position: fixed; inset: 24px; z-index: 10002;
      background: var(--bg-secondary, #161b22); border: 1px solid var(--border, #30363d);
      border-radius: 12px; padding: 20px; overflow-y: auto;
      box-shadow: 0 12px 40px rgba(0,0,0,0.6);
    }
    .screenshot-gallery:not(.collapsed) .gallery-grid { display: block; }
    .screenshot-gallery:not(.collapsed) .gallery-toggle { display: none; }
    .screenshot-gallery .gallery-header {
      display: flex; justify-content: space-between; align-items: center;
      margin-bottom: 16px; padding-bottom: 12px; border-bottom: 1px solid var(--border, #30363d);
    }
    .screenshot-gallery .gallery-header h3 {
      margin: 0; color: var(--text-primary, #e6edf3); font-size: 16px;
    }
    .screenshot-gallery .gallery-close {
      background: none; border: none; color: var(--text-muted, #8b949e);
      font-size: 20px; cursor: pointer; padding: 4px 8px;
    }
    .screenshot-gallery .gallery-close:hover { color: var(--text-primary, #e6edf3); }
    .screenshot-gallery .gallery-items {
      display: grid; grid-template-columns: repeat(auto-fill, minmax(340px, 1fr));
      gap: 16px;
    }
    .screenshot-gallery .gallery-fig {
      margin: 0; background: var(--bg-tertiary, #21262d);
      border: 1px solid var(--border, #30363d); border-radius: 8px;
      overflow: hidden; transition: transform 0.2s;
    }
    .screenshot-gallery .gallery-fig:hover { transform: scale(1.02); }
    .screenshot-gallery .gallery-fig img {
      width: 100%; height: auto; display: block;
    }
    .screenshot-gallery .gallery-fig figcaption {
      padding: 8px 12px; font-size: 12px; color: var(--text-muted, #8b949e);
      text-transform: capitalize;
    }
  </style>
  <script>
    (function() {
      var gallery = document.getElementById('screenshot-gallery');
      document.getElementById('gallery-toggle').addEventListener('click', function() {
        gallery.classList.remove('collapsed');
      });
      document.getElementById('gallery-close').addEventListener('click', function() {
        gallery.classList.add('collapsed');
      });
    })();
  </script>`;
}

// ---------------------------------------------------------------------------
// Main build
// ---------------------------------------------------------------------------

async function build() {
  console.log('BSM Hypergraph Discovery — Build\n');

  // Ensure dist/
  if (!fs.existsSync(DIST)) fs.mkdirSync(DIST);

  // 1. Fetch D3.js from CDN
  console.log('  Fetching D3.js v7 from CDN...');
  let d3Source;
  try {
    d3Source = await fetchURL('https://d3js.org/d3.v7.min.js');
    console.log(`  ✓ D3.js fetched (${humanSize(Buffer.byteLength(d3Source))})`);
  } catch (err) {
    console.error('  ✗ Failed to fetch D3.js:', err.message);
    console.log('  Trying local fallback...');
    const localD3 = path.join(ROOT, 'node_modules', 'd3', 'dist', 'd3.min.js');
    if (fs.existsSync(localD3)) {
      d3Source = fs.readFileSync(localD3, 'utf-8');
      console.log(`  ✓ D3.js loaded from local (${humanSize(Buffer.byteLength(d3Source))})`);
    } else {
      console.error('  ✗ No local D3.js fallback. Aborting.');
      process.exit(1);
    }
  }

  // 2. Read source files
  console.log('  Reading source files...');
  const css = readSrc('bsm-discovery.css');
  const jsFiles = [
    // Core
    'ITILDataSimulator.js',
    'HypergraphCore.js',
    'BSMHypergraphRenderer.js',
    // Analytics engine (base + extensions)
    'analytics/AnalyticsEngine.js',
    'analytics/CentralityAnalysis.js',
    'analytics/TemporalAnalysis.js',
    'analytics/CooccurrenceAnalysis.js',
    'analytics/AnomalyDetection.js',
    'analytics/RiskAnalysis.js',
    'analytics/CommunityDetection.js',
    'analytics/ImpactPrediction.js',
    'analytics/IncidentCorrelation.js',
    // UpSet chart
    'UpSetRenderer.js',
    // App (base + extensions)
    'app/BSMDiscovery.js',
    'app/BSMDiscoveryControls.js',
    'app/BSMDiscoveryAnalytics.js',
    'app/BSMDiscoveryUpSet.js',
  ];
  const jsModules = jsFiles.map((f) => ({
    name: f,
    source: readSrc(f),
  }));
  console.log(`  ✓ ${jsFiles.length} JS modules + CSS loaded`);

  // 3. Read HTML and extract the body content (between <body> and </body>)
  const html = readSrc('bsm-discovery.html');

  // Extract the inline init script from the HTML
  const initScriptMatch = html.match(/<script>\s*(var app[\s\S]*?)<\/script>\s*<\/body>/);
  const initScript = initScriptMatch ? initScriptMatch[1].trim() : '';

  // Extract body content (everything between <body> and the scripts section)
  const bodyStart = html.indexOf('<body>') + '<body>'.length;
  const scriptsStart = html.indexOf('<!-- Application Scripts -->');
  const bodyContent = html.substring(bodyStart, scriptsStart).trim();

  // 4. App script block (shared by all variants)
  const appScript = jsModules.map((mod) =>
    `/* ── ${mod.name} ── */\n${mod.source}`
  ).join('\n') + `\n/* ── Init ── */\n${initScript}`;

  // 5. Assemble the self-contained HTML (D3 inlined)
  const assembledHtml = (imageGallery) => `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>BSM Hypergraph Discovery</title>
  <style>
${css}
  </style>
  <script>
/* D3.js v7 — https://d3js.org — BSD 3-Clause License */
${d3Source}
  </script>
</head>
<body>
  ${bodyContent}
${imageGallery}
  <script>${appScript}
  </script>
</body>
</html>`;

  // 6. Assemble the CDN variant (D3 + d3-force-webgpu loaded from CDN)
  const cdnHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>BSM Hypergraph Discovery</title>
  <style>
${css}
  </style>
  <script src="https://d3js.org/d3.v7.min.js"></script>
</head>
<body>
  ${bodyContent}
  <script>${appScript}
  </script>
</body>
</html>`;

  // 7. Write output — self-contained (no images)
  const outNoImages = path.join(DIST, 'bsm-discovery.html');
  const contentNoImages = assembledHtml('');
  fs.writeFileSync(outNoImages, contentNoImages);
  console.log(`\n  ✓ ${outNoImages}`);
  console.log(`    Size: ${humanSize(Buffer.byteLength(contentNoImages))}`);

  // 8. Write output — self-contained (with images)
  console.log('\n  Embedding screenshots...');
  const gallery = buildImageGallery();
  const contentWithImages = assembledHtml(gallery);
  const outWithImages = path.join(DIST, 'bsm-discovery-with-images.html');
  fs.writeFileSync(outWithImages, contentWithImages);
  console.log(`  ✓ ${outWithImages}`);
  console.log(`    Size: ${humanSize(Buffer.byteLength(contentWithImages))}`);

  // 9. Write output — CDN variant
  const outCdn = path.join(DIST, 'bsm-discovery-cdn.html');
  fs.writeFileSync(outCdn, cdnHtml);
  console.log(`\n  ✓ ${outCdn}`);
  console.log(`    Size: ${humanSize(Buffer.byteLength(cdnHtml))}`);

  console.log('\n  Build complete.\n');
}

build().catch((err) => {
  console.error('Build failed:', err);
  process.exit(1);
});
