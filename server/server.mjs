import { createServer } from 'node:http';
import { existsSync, readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { networkInterfaces, tmpdir } from 'node:os';
import { spawn, spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const currentDir = dirname(fileURLToPath(import.meta.url));
loadEnv(join(currentDir, '.env'));

const PORT = Number(process.env.PORT || 8787);
const MAX_BODY_BYTES = 32 * 1024 * 1024;
const TCGDEX_BASE = (process.env.TCGDEX_BASE || 'https://api.tcgdex.net/v2/en').replace(/\/$/, '');
const GRADED_API_BASE = (process.env.GRADED_API_BASE || 'https://pokemon-tcg-api.p.rapidapi.com').replace(/\/$/, '');
const RAPIDAPI_KEY = String(process.env.RAPIDAPI_KEY || '').trim();
const gradedPricingCache = new Map();
const GRADED_CACHE_MS = 12 * 60 * 60 * 1000;
const OCR_SOURCE_PATH = join(currentDir, 'vision-ocr.swift');
const OCR_BINARY_PATH = join(currentDir, '.tcgbinder-vision-ocr');
const ocrCompileStatus = compileVisionOcrHelper();

const server = createServer(async (request, response) => {
  setCorsHeaders(response);
  const startedAt = Date.now();
  const requestPath = request.url || '/';
  console.log(`[${new Date().toISOString()}] ${request.method} ${requestPath}`);
  if (request.method === 'OPTIONS') {
    response.writeHead(204).end();
    return;
  }

  const url = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);
  try {
    if (request.method === 'GET' && url.pathname === '/api/health') {
      const ready = ocrCompileStatus.ready;
      const message = ready
        ? 'Card recognition is ready.'
        : `Card recognition could not start on this Mac: ${ocrCompileStatus.message}`;
      console.log(`[health] ready=${ready} message=${message}`);
      json(response, 200, {
        ready,
        provider: 'TCG Binder Companion',
        ocrReady: ready,
        message,
      });
      return;
    }

    if (request.method === 'GET' && url.pathname === '/api/cards/graded-pricing') {
      const cardName = String(url.searchParams.get('name') || '').trim();
      const cardNumber = String(url.searchParams.get('number') || '').trim();
      const setName = String(url.searchParams.get('set') || '').trim();
      if (!cardName) {
        json(response, 400, { error: 'A card name is required for graded pricing.' });
        return;
      }
      if (!RAPIDAPI_KEY) {
        json(response, 200, {
          success: true, configured: false, dataAvailable: false, provider: 'Pokémon TCG API', unit: 'USD', rows: [],
          notice: 'Add a free RapidAPI key to server/.env as RAPIDAPI_KEY to load PSA, BGS and CGC sold-price data.',
        });
        return;
      }
      const cacheKey = [normalizeText(cardName), normalizeNumber(cardNumber), normalizeText(setName)].join('|');
      const cached = gradedPricingCache.get(cacheKey);
      if (cached && Date.now() - cached.savedAt < GRADED_CACHE_MS) {
        console.log(`[graded] cache hit for ${cardName} ${cardNumber}`);
        json(response, 200, cached.value);
        return;
      }
      const graded = await fetchGradedPricing(cardName, cardNumber, setName);
      gradedPricingCache.set(cacheKey, { savedAt: Date.now(), value: graded });
      json(response, 200, graded);
      return;
    }

    if (request.method === 'GET' && url.pathname === '/api/cards/pricing') {
      const cardId = String(url.searchParams.get('cardId') || '').trim();
      if (!/^[a-zA-Z0-9-]+$/.test(cardId)) {
        json(response, 400, { error: 'A valid TCGdex card ID is required for pricing.' });
        return;
      }
      const fullCard = await fetchTcgdexJson(`${TCGDEX_BASE}/cards/${encodeURIComponent(cardId)}`, `pricing card details ${cardId}`);
      const pricing = buildUngradedPricingResponse(fullCard);
      console.log(`[pricing] ${cardId}: ${pricing.variants.length} TCGplayer variant price row(s) returned.`);
      json(response, 200, pricing);
      return;
    }

    if (request.method === 'POST' && url.pathname === '/api/cards/ocr-identify') {
      if (!ocrCompileStatus.ready) {
        json(response, 503, { code: 'ocr-unavailable', error: `Apple Vision OCR is not available: ${ocrCompileStatus.message}` });
        return;
      }
      const body = await readJsonBody(request);
      validateImagePayload(body);
      const ocrStartedAt = Date.now();
      console.log(`[ocr] Received card photo (${Math.round(body.imageBase64.length / 1024)} KB base64). Running Apple Vision OCR...`);
      const ocr = await runVisionOcr(body.imageBase64);
      console.log(`[ocr] Apple Vision extracted ${ocr.lines.length} line(s) in ${Date.now() - ocrStartedAt} ms.`);
      console.log(`[ocr] Visible text: ${ocr.lines.map((line) => line.text).join(' | ')}`);
      const extraction = await extractionFromOcr(ocr);
      console.log('[ocr] Parsed extraction:', JSON.stringify(extraction));
      if (!extraction.cardName) {
        json(response, 422, { code: 'ocr-name-unreadable', error: 'TCG Binder could not read the card name. Try another clear photo or search for the card manually.', extraction });
        return;
      }
      const lookupStartedAt = Date.now();
      const match = await findPokemonMatch(extraction);
      console.log(`[ocr] TCGdex lookup finished in ${Date.now() - lookupStartedAt} ms.`);
      console.log(`[ocr] TCGdex lookup for name="${extraction.cardName}" number="${extraction.cardNumber}": ${match ? match.candidate.name + ' ' + match.candidate.cardNumber : 'no match'}`);
      if (!match) {
        json(response, 404, { code: 'no-match', error: `No exact match was found for “${extraction.cardName}”. Try searching for the card manually.`, extraction });
        return;
      }
      json(response, 200, { success: true, candidate: match.candidate, extraction, matchQuality: match.matchQuality, matchSource: 'apple-vision-ocr', elapsedMs: Date.now() - startedAt });
      console.log(`[ocr] Completed successfully in ${Date.now() - startedAt} ms.`);
      return;
    }

    if (request.method === 'POST' && url.pathname === '/api/cards/search') {
      const body = await readJsonBody(request);
      const cardName = typeof body?.cardName === 'string' ? body.cardName.trim() : '';
      const cardNumber = typeof body?.cardNumber === 'string' ? body.cardNumber.trim() : '';
      if (!cardName) {
        json(response, 400, { error: 'Enter a Pokémon card name before searching.' });
        return;
      }
      const extraction = {
        isTradingCard: true,
        game: 'pokemon',
        cardName,
        cardNumber,
        setHint: '',
        confidence: 1,
        visibleNotes: 'Manual fallback search used. AI did not analyze this photo.',
      };
      const match = await findPokemonMatch(extraction);
      if (!match) {
        json(response, 404, { error: `No English Pokémon card match was found for “${cardName}”. Check the spelling or include the printed card number.`, extraction });
        return;
      }
      json(response, 200, { success: true, candidate: match.candidate, extraction, matchQuality: match.matchQuality, matchSource: 'manual-search' });
      return;
    }

    json(response, 404, { error: 'Route not found.' });
  } catch (error) {
    const apiError = normalizeError(error);
    console.error('[TCG Binder server]', apiError.error);
    json(response, apiError.status, { code: apiError.code, error: apiError.error });
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('\nTCG Binder Companion is running.');
  console.log(`Card recognition: ${ocrCompileStatus.ready ? 'ready' : 'NOT READY - ' + ocrCompileStatus.message}`);
  console.log('\nEnter one of these URLs in the TCG Binder app:');
  console.log(`  Simulator only: http://localhost:${PORT}`);
  for (const address of localIPv4Addresses()) console.log(`  iPhone Wi-Fi:   http://${address}:${PORT}`);
  console.log('');
});

function compileVisionOcrHelper() {
  if (process.platform !== 'darwin') {
    return { ready: false, message: 'Apple Vision OCR requires macOS.' };
  }
  if (!existsSync(OCR_SOURCE_PATH)) {
    return { ready: false, message: `Missing Swift helper at ${OCR_SOURCE_PATH}.` };
  }
  console.log('[ocr] Compiling Apple Vision helper...');
  const result = spawnSync('/usr/bin/xcrun', [
    'swiftc', '-O', '-framework', 'Vision', '-framework', 'ImageIO', '-framework', 'CoreGraphics',
    '-o', OCR_BINARY_PATH, OCR_SOURCE_PATH,
  ], { encoding: 'utf8' });
  if (result.status !== 0 || !existsSync(OCR_BINARY_PATH)) {
    const message = (result.stderr || result.stdout || 'Unknown Swift compilation error.').trim();
    console.error('[ocr] Compilation failed:', message);
    return { ready: false, message };
  }
  console.log('[ocr] Apple Vision helper compiled successfully.');
  return { ready: true, message: 'Apple Vision OCR helper is ready.' };
}

async function runVisionOcr(imageBase64) {
  const folder = mkdtempSync(join(tmpdir(), 'tcgbinder-ocr-'));
  const imagePath = join(folder, 'capture.jpg');
  writeFileSync(imagePath, Buffer.from(imageBase64, 'base64'));
  try {
    const output = await runProcess(OCR_BINARY_PATH, [imagePath], 30000);
    return JSON.parse(output);
  } catch (error) {
    const err = new Error(`Apple Vision OCR failed: ${error.message || error}`);
    err.code = 'ocr-failed'; err.status = 500; throw err;
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
}

function runProcess(command, args, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`Process timed out after ${timeoutMs} ms.`));
    }, timeoutMs);
    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('error', (error) => { clearTimeout(timer); reject(error); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(stdout);
      else reject(new Error(stderr.trim() || `Process exited with code ${code}.`));
    });
  });
}

async function extractionFromOcr(ocr) {
  const lines = Array.isArray(ocr?.lines) ? ocr.lines : [];
  const texts = lines.map((line) => String(line.text || '').trim()).filter(Boolean);
  const combinedText = texts.join('\n');
  const numberCandidates = extractCollectorNumberCandidates(lines);
  const number = numberCandidates[0] || '';
  if (numberCandidates.length > 0) {
    console.log(`[ocr] Collector number candidate(s): ${numberCandidates.join(', ')}.`);
  }
  const allCards = await getTcgdexCardIndex();
  const uniqueNames = [...new Set(allCards.map((card) => String(card.name || '')).filter(Boolean))];
  const normalizedCombined = normalizeText(combinedText);
  const exactNames = uniqueNames
    .filter((name) => normalizeText(name).length >= 3 && normalizedCombined.includes(normalizeText(name)))
    .sort((left, right) => normalizeText(right).length - normalizeText(left).length);
  let cardName = exactNames[0] || '';
  if (!cardName) {
    const possibleLines = texts.filter((text) => {
      const compact = text.replace(/\s+/g, ' ').trim();
      return compact.length >= 3 && compact.length <= 28 && !/\b(?:hp|damage|weakness|resistance|retreat|basic|stage|trainer|energy)\b/i.test(compact) && !/\d{2,}/.test(compact);
    });
    let best = null;
    for (const line of possibleLines.slice(0, 8)) {
      for (const name of uniqueNames) {
        const distance = editDistance(line, name);
        const maximumDistance = Math.max(1, Math.min(3, Math.floor(normalizeText(name).length / 4)));
        if (distance <= maximumDistance && (!best || distance < best.distance || (distance === best.distance && name.length > best.name.length))) {
          best = { name, distance };
        }
      }
    }
    cardName = best?.name || possibleLines[0] || '';
  }
  const averageConfidence = lines.length
    ? lines.reduce((total, line) => total + Number(line.confidence || 0), 0) / lines.length
    : 0;
  return {
    isTradingCard: Boolean(cardName),
    game: 'pokemon',
    cardName,
    cardNumber: number,
    cardNumberCandidates: numberCandidates,
    setHint: '',
    confidence: Math.max(0, Math.min(1, averageConfidence)),
    visibleNotes: texts.slice(0, 12).join(' | '),
  };
}

function extractCollectorNumberCandidates(lines) {
  const normalizedLines = Array.isArray(lines)
    ? lines.map((line) => ({ text: String(line.text || '').trim(), y: Number(line.y ?? 1) })).filter((line) => line.text)
    : [];
  const bottomLines = normalizedLines.filter((line) => line.y <= 0.34);
  const orderedLines = [...bottomLines, ...normalizedLines.filter((line) => line.y > 0.34)];
  const candidates = [];
  const addCandidate = (value) => {
    const canonical = canonicalizeCollectorNumber(value);
    if (canonical && !candidates.includes(canonical)) candidates.push(canonical);
  };

  for (const line of orderedLines) {
    const text = line.text.toUpperCase().replace(/／/g, '/');
    for (const match of text.matchAll(/\b((?:TG|GG)\s*\d{1,3}[A-Z]?\s*\/\s*(?:TG|GG)\s*\d{1,3}[A-Z]?)\b/g)) addCandidate(match[1]);
    for (const match of text.matchAll(/(?:^|[^A-Z0-9])(?:[A-Z]{2,5}\s*)?(?:EN\s*)?(\d{1,3}[A-Z]?\s*\/\s*\d{1,3})(?:$|[^A-Z0-9])/g)) addCandidate(match[1]);
    for (const match of text.matchAll(/\b((?:DP|SVP|SWSH|SM|XY|BW|HGSS)\s*[- ]?\s*\d{1,3}[A-Z]?)\b/g)) addCandidate(match[1]);
  }
  for (const line of bottomLines) {
    const text = line.text.toUpperCase();
    if (/\b(?:HP|DAMAGE|WEAKNESS|RESISTANCE)\b/.test(text)) continue;
    for (const match of text.matchAll(/(?:^|[^A-Z0-9\/])(\d{1,3}[A-Z]?)(?:$|[^A-Z0-9\/])/g)) {
      const token = match[1];
      if (!/^20\d{2}$/.test(token)) addCandidate(token);
    }
  }
  return candidates;
}

function canonicalizeCollectorNumber(value) {
  const compact = String(value || '').toUpperCase().replace(/\s+/g, '').replace(/-/g, '').replace('／', '/');
  if (!compact) return '';

  const subset = compact.match(/^(TG\d{1,3}[A-Z]?\/TG\d{1,3}[A-Z]?|GG\d{1,3}[A-Z]?\/GG\d{1,3}[A-Z]?)$/i);
  if (subset) return subset[1].toUpperCase();
  const fractional = compact.match(/(\d{1,3}[A-Z]?)\/(\d{1,3})$/i);
  if (fractional) {
    const numerator = fractional[1].replace(/^(\d+)([A-Z]?)$/i, (_, digits, suffix) => `${digits.padStart(3, '0')}${suffix.toLowerCase()}`);
    return `${numerator}/${fractional[2]}`;
  }
  const prefixedPromo = compact.match(/^((?:DP|SVP|SWSH|SM|XY|BW|HGSS)\d{1,3}[A-Z]?)$/i);
  if (prefixedPromo) return prefixedPromo[1].toUpperCase();
  const standalone = compact.match(/^(\d{1,3}[A-Z]?)$/i);
  return standalone ? standalone[1].toLowerCase() : '';
}

let tcgdexCardIndexCache = null;

async function fetchTcgdexJson(url, label) {
  let response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(20000) });
  } catch (error) {
    console.error(`[tcgdex] ${label} network failure for ${url}: ${error.message || error}`);
    const err = new Error('TCGdex could not be reached from your Mac. Check your internet connection and try again.');
    err.code = 'tcgdex-network-error'; err.status = 503; throw err;
  }
  const text = await response.text();
  if (!response.ok) {
    console.error(`[tcgdex] ${label} failed: HTTP ${response.status} ${text.slice(0, 180)}`);
    const err = new Error(`TCGdex request failed with HTTP ${response.status}. Try again or check the backend terminal.`);
    err.code = 'tcgdex-http-error'; err.status = 502; throw err;
  }
  try {
    return JSON.parse(text);
  } catch {
    console.error(`[tcgdex] ${label} returned invalid JSON: ${text.slice(0, 180)}`);
    const err = new Error('TCGdex returned unreadable data.');
    err.code = 'tcgdex-invalid-json'; err.status = 502; throw err;
  }
}

async function getTcgdexCardIndex() {
  if (tcgdexCardIndexCache) return tcgdexCardIndexCache;
  console.log('[tcgdex] Loading complete English card index for fallback matching...');
  const cards = await fetchTcgdexJson(`${TCGDEX_BASE}/cards`, 'full card index');
  if (!Array.isArray(cards)) throw new Error('TCGdex card index did not return a list.');
  tcgdexCardIndexCache = cards;
  console.log(`[tcgdex] Cached ${cards.length} English card briefs for fuzzy/manual fallback.`);
  return tcgdexCardIndexCache;
}

function editDistance(left, right) {
  const a = normalizeText(left);
  const b = normalizeText(right);
  const rows = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j += 1) rows[0][j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      rows[i][j] = Math.min(
        rows[i - 1][j] + 1,
        rows[i][j - 1] + 1,
        rows[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
  }
  return rows[a.length][b.length];
}

async function searchTcgdexCardsByName(inputName) {
  const requestedName = inputName.trim();
  const filterUrl = `${TCGDEX_BASE}/cards?name=${encodeURIComponent(requestedName)}`;
  const filtered = await fetchTcgdexJson(filterUrl, 'name filter');
  if (!Array.isArray(filtered)) throw new Error('TCGdex name search did not return a list.');
  console.log(`[tcgdex] GET ${filterUrl} -> ${filtered.length} result(s).`);
  if (filtered.length > 0) {
    console.log(`[tcgdex] First matches: ${filtered.slice(0, 5).map((card) => `${card.name} (${card.id})`).join(', ')}`);
    return { cards: filtered, searchMode: 'api-name-filter', correctedName: '' };
  }
  const allCards = await getTcgdexCardIndex();
  const needle = normalizeText(requestedName);
  let localMatches = allCards.filter((card) => normalizeText(card.name).includes(needle) || needle.includes(normalizeText(card.name)));
  if (localMatches.length > 0) {
    console.log(`[tcgdex] Filter endpoint returned zero, but local index found ${localMatches.length} contains-match result(s).`);
    return { cards: localMatches, searchMode: 'local-index', correctedName: '' };
  }

  const uniqueNames = [...new Set(allCards.map((card) => String(card.name || '')).filter(Boolean))];
  const rankedNames = uniqueNames
    .map((name) => ({ name, distance: editDistance(requestedName, name) }))
    .sort((left, right) => left.distance - right.distance);
  const closest = rankedNames[0];
  const maximumDistance = Math.max(1, Math.min(3, Math.floor(needle.length / 4)));
  if (closest && closest.distance <= maximumDistance) {
    localMatches = allCards.filter((card) => normalizeText(card.name) === normalizeText(closest.name));
    console.log(`[tcgdex] No exact name matches for "${requestedName}". Fuzzy-corrected to "${closest.name}" (${localMatches.length} printing(s)).`);
    return { cards: localMatches, searchMode: 'fuzzy-name', correctedName: closest.name };
  }

  console.log(`[tcgdex] No cards found for "${requestedName}". Closest indexed names: ${rankedNames.slice(0, 3).map((item) => `${item.name} [distance ${item.distance}]`).join(', ')}`);
  return { cards: [], searchMode: 'none', correctedName: '' };
}

async function hydrateTcgdexCandidate(brief, extraction) {
  const detailUrl = `${TCGDEX_BASE}/cards/${encodeURIComponent(brief.id)}`;
  let full = null;
  try {
    full = await fetchTcgdexJson(detailUrl, `card details ${brief.id}`);
  } catch (error) {
    console.warn(`[tcgdex] Falling back to card brief for ${brief.id}: ${error.message}`);
  }
  const imageBase = full?.image || brief.image;
  if (!imageBase) {
    console.warn(`[tcgdex] Discarding ${brief.id}: no official image URL was returned.`);
    return null;
  }
  const officialTotal = full?.set?.cardCount?.official;
  return {
    id: full?.id || brief.id,
    game: 'pokemon',
    name: full?.name || brief.name || extraction.cardName,
    setName: full?.set?.name || extraction.setHint || 'Set unavailable',
    cardNumber: officialTotal ? `${full.localId}/${officialTotal}` : String(full?.localId || brief.localId || extraction.cardNumber || ''),
    rarity: full?.rarity || 'Rarity unavailable',
    imageUrl: `${imageBase}/high.webp`,
  };
}

async function findPokemonMatch(extraction) {
  const search = await searchTcgdexCardsByName(extraction.cardName);
  const cards = search.cards;
  if (!Array.isArray(cards) || cards.length === 0) return null;

  const requestedNumbers = [...new Set([extraction.cardNumber, ...(Array.isArray(extraction.cardNumberCandidates) ? extraction.cardNumberCandidates : [])]
    .flatMap((value) => collectorNumberAliases(value))
    .filter(Boolean))];
  const requestedName = search.correctedName || extraction.cardName;
  if (requestedNumbers.length > 0) console.log(`[tcgdex] Matching normalized collector alias(es): ${requestedNumbers.join(', ')}.`);
  const ranked = cards.map((card) => {
    const nameExact = normalizeText(card.name) === normalizeText(requestedName);
    const cardAliases = collectorNumberAliases(card.localId);
    const numberExact = requestedNumbers.length > 0 && cardAliases.some((alias) => requestedNumbers.includes(alias));
    return { card, score: (numberExact ? 1000 : 0) + (nameExact ? 100 : 0), numberExact };
  }).sort((left, right) => right.score - left.score);
  for (const rankedCard of ranked.slice(0, 8)) {
    const candidate = await hydrateTcgdexCandidate(rankedCard.card, extraction);
    if (candidate) {
      console.log(`[tcgdex] Selected ${candidate.name} ${candidate.cardNumber} (${candidate.id}) via ${search.searchMode}.`);
      return {
        candidate,
        matchQuality: rankedCard.numberExact ? 'exact-number' : 'name-only',
      };
    }
  }
  console.log(`[tcgdex] ${cards.length} card brief result(s) were found, but none produced a usable image candidate.`);
  return null;
}


async function fetchGradedPricing(cardName, cardNumber, setName) {
  const localNumber = String(cardNumber || '').split('/')[0].trim();
  const query = [cardName, localNumber].filter(Boolean).join(' ');
  const endpoint = new URL(`${GRADED_API_BASE}/cards`);
  endpoint.searchParams.set('search', query);
  endpoint.searchParams.set('sort', 'price_highest');
  endpoint.searchParams.set('rapidapi-key', RAPIDAPI_KEY);
  const started = Date.now();
  const response = await fetch(endpoint, {
    headers: {
      'x-rapidapi-key': RAPIDAPI_KEY,
      'x-rapidapi-host': 'pokemon-tcg-api.p.rapidapi.com',
    },
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`Graded pricing provider returned HTTP ${response.status}${detail ? `: ${detail.slice(0, 120)}` : ''}`);
  }
  const payload = await response.json();
  const results = Array.isArray(payload) ? payload : (payload.data || payload.cards || payload.results || []);
  const cards = Array.isArray(results) ? results : [results].filter(Boolean);
  const requestedAliases = collectorNumberAliases(cardNumber);
  const ranked = cards.map((card) => {
    const providerName = card.name || card.card_name || '';
    const providerNumber = card.card_number || card.number || '';
    const aliases = collectorNumberAliases(providerNumber);
    const numberExact = requestedAliases.length > 0 && aliases.some((alias) => requestedAliases.includes(alias));
    const nameExact = normalizeText(providerName).includes(normalizeText(cardName)) || normalizeText(cardName).includes(normalizeText(providerName));
    return { card, score: (numberExact ? 1000 : 0) + (nameExact ? 100 : 0), numberExact, nameExact };
  }).sort((a, b) => b.score - a.score);
  const selected = ranked[0]?.card || null;
  const rows = extractGradedRows(selected);
  console.log(`[graded] ${cardName} ${cardNumber}: provider returned ${cards.length} card(s), ${rows.length} graded price row(s) in ${Date.now() - started} ms.`);
  return {
    success: true,
    configured: true,
    dataAvailable: rows.length > 0,
    provider: 'Pokémon TCG API / eBay sold data',
    unit: 'USD',
    rows,
    matchedName: selected?.name || selected?.card_name || null,
    matchedNumber: selected?.card_number || selected?.number || null,
    notice: 'Graded values are median prices from completed eBay graded sales, not the cheapest live listing. Sample size is shown when provided.',
  };
}

function extractGradedRows(card) {
  const graded = card?.prices?.ebay?.graded || card?.pricing?.ebay?.graded || null;
  if (!graded || typeof graded !== 'object') return [];
  const rows = [];
  for (const [companyRaw, grades] of Object.entries(graded)) {
    if (!grades || typeof grades !== 'object') continue;
    const company = String(companyRaw).toUpperCase();
    for (const [grade, value] of Object.entries(grades)) {
      const record = typeof value === 'number' ? { median_price: value } : value;
      const medianPrice = finitePrice(record?.median_price ?? record?.medianPrice ?? record?.price);
      if (medianPrice === null) continue;
      rows.push({
        key: `${company.toLowerCase()}-${grade}`,
        label: `${company} ${grade}`,
        company,
        grade: String(grade),
        medianPrice,
        sampleSize: Number.isFinite(Number(record?.sample_size ?? record?.sampleSize)) ? Number(record?.sample_size ?? record?.sampleSize) : null,
      });
    }
  }
  return rows.sort((a, b) => a.company.localeCompare(b.company) || Number(b.grade) - Number(a.grade));
}

function buildUngradedPricingResponse(card) {
  const tcgplayer = card?.pricing?.tcgplayer || null;
  const unit = String(tcgplayer?.unit || 'USD');
  const labels = [
    ['normal', 'Normal'],
    ['holo', 'Holofoil'],
    ['holofoil', 'Holofoil'],
    ['reverse', 'Reverse Holofoil'],
    ['reverse-holofoil', 'Reverse Holofoil'],
    ['1st-edition', 'First Edition'],
    ['1st-edition-holofoil', 'First Edition Holofoil'],
    ['unlimited', 'Unlimited'],
    ['unlimited-holofoil', 'Unlimited Holofoil'],
  ];
  const seenLabels = new Set();
  const variants = [];
  for (const [key, label] of labels) {
    const value = tcgplayer?.[key];
    if (!value || seenLabels.has(label)) continue;
    seenLabels.add(label);
    variants.push({
      key,
      label,
      lowPrice: finitePrice(value.lowPrice),
      marketPrice: finitePrice(value.marketPrice),
      midPrice: finitePrice(value.midPrice),
      directLowPrice: finitePrice(value.directLowPrice),
    });
  }
  return {
    success: true,
    dataAvailable: variants.length > 0,
    source: 'TCGdex',
    provider: 'TCGplayer',
    unit,
    updated: normalizePricingDate(tcgplayer?.updated),
    variants,
    notice: 'Prices are ungraded TCGplayer market data supplied through TCGdex. TCGdex notes that some printing-to-marketplace mappings are still being improved, so confirm unusually high-value results before relying on them.',
  };
}

function finitePrice(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function normalizePricingDate(value) {
  if (!value) return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'number') {
    const millis = value < 1000000000000 ? value * 1000 : value;
    const date = new Date(millis);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  return null;
}

function normalizeError(error) {
  if (error && typeof error === 'object' && typeof error.message === 'string') {
    return { status: Number(error.status || (error.message.startsWith('Photo upload') ? 400 : 500)), code: error.code || 'server-error', error: error.message };
  }
  return { status: 500, code: 'server-error', error: 'Unexpected server error.' };
}
function normalizeText(value) { return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]/g, ''); }
function collectorNumberAliases(value) {
  const compact = String(value || '').toUpperCase().replace(/\s+/g, '').replace(/-/g, '').replace(/／/g, '/');
  if (!compact) return [];
  const aliases = new Set();
  const add = (item) => { if (item) aliases.add(item.toLowerCase()); };

  const gallery = compact.match(/^((?:TG|GG)\d{1,3}[A-Z]?)\/((?:TG|GG)\d{1,3}[A-Z]?)$/i);
  if (gallery) {
    add(gallery[1]);
    add(`${gallery[1]}/${gallery[2]}`);
    return [...aliases];
  }

  const fractional = compact.match(/(?:[A-Z]{0,8})?(\d{1,3})([A-Z]?)\/(?:[A-Z]{0,4})?(\d{1,3})$/i);
  if (fractional) {
    const numerator = `${Number(fractional[1])}${String(fractional[2] || '').toLowerCase()}`;
    add(numerator);
    add(`${numerator}/${Number(fractional[3])}`);
    return [...aliases];
  }

  const promo = compact.match(/^((?:DP|SVP|SWSH|SM|XY|BW|HGSS))(\d{1,3})([A-Z]?)$/i);
  if (promo) {
    const numeric = `${Number(promo[2])}${String(promo[3] || '').toLowerCase()}`;
    add(`${promo[1]}${numeric}`);
    if (promo[1].toUpperCase() === 'SVP') add(numeric);
    return [...aliases];
  }

  const standalone = compact.match(/^(\d{1,3})([A-Z]?)$/i);
  if (standalone) {
    add(`${Number(standalone[1])}${String(standalone[2] || '').toLowerCase()}`);
    return [...aliases];
  }

  add(normalizeText(compact));
  return [...aliases];
}
function normalizeNumber(value) { return collectorNumberAliases(value)[0] || ''; }
function validateImagePayload(body) {
  if (!body || typeof body.imageBase64 !== 'string' || body.imageBase64.length < 100) throw new Error('Photo upload was empty. Retake your card photo.');
  if (body.imageBase64.length > MAX_BODY_BYTES) throw new Error('Photo upload is too large. Retake the photo and try again.');
  if (!['image/jpeg', 'image/png'].includes(body.mimeType)) throw new Error('Photo upload must be JPEG or PNG.');
}
function setCorsHeaders(response) {
  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  response.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
}
function json(response, status, payload) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(payload));
}
async function readJsonBody(request) {
  const chunks = []; let total = 0;
  for await (const chunk of request) {
    total += chunk.length;
    if (total > MAX_BODY_BYTES) throw new Error('Photo upload is too large. Retake the photo and try again.');
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new Error('Photo upload could not be read.'); }
}
function localIPv4Addresses() {
  const addresses = [];
  for (const items of Object.values(networkInterfaces())) {
    for (const item of items || []) if (item.family === 'IPv4' && !item.internal) addresses.push(item.address);
  }
  return addresses;
}
function loadEnv(path) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const index = trimmed.indexOf('=');
    if (index < 1) continue;
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim().replace(/^[\'\"]|[\'\"]$/g, '');
    if (!process.env[key]) process.env[key] = value;
  }
}
