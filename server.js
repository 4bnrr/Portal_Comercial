import 'dotenv/config';
import express from 'express';
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const IS_VERCEL = Boolean(process.env.VERCEL);
const SYNC_ONCE_MODE = process.argv.includes('--sync-once');
const BUNDLED_DATA_DIR = path.join(__dirname, 'data');
const VERCEL_RUNTIME_DATA_DIR = path.join(os.tmpdir(), 'estacao1-portal-data');

const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const adminSessions = new Map();

function parseCookies(req){
  const raw=req.headers.cookie||'';
  return Object.fromEntries(raw.split(';').map(v=>v.trim()).filter(Boolean).map(v=>{
    const i=v.indexOf('=');
    return i>=0?[decodeURIComponent(v.slice(0,i)),decodeURIComponent(v.slice(i+1))]:[v,''];
  }));
}
function getAdminSession(req){
  const sid=parseCookies(req).estacao_admin;
  if(!sid)return null;
  const session=adminSessions.get(sid);
  if(!session)return null;
  if(session.expires<Date.now()){adminSessions.delete(sid);return null;}
  session.expires=Date.now()+8*60*60*1000;
  return session;
}
function requireAdmin(req,res,next){
  if(getAdminSession(req))return next();
  res.status(401).json({error:'Não autorizado'});
}
const PORT = Number(process.env.PORT || 3000);
const DATA_DIR = IS_VERCEL ? VERCEL_RUNTIME_DATA_DIR : BUNDLED_DATA_DIR;
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const CACHE_FILE = path.join(DATA_DIR, IS_VERCEL ? 'vercel-cache.json' : 'cache.json');
const MATERIALS_FILE = path.join(DATA_DIR, 'materials.json');
const HISTORY_FILE = path.join(DATA_DIR, 'history.json');
const RAW_FILE = path.join(DATA_DIR, 'raw-cvcrm-last.json');
const INTEGRITY_FILE = path.join(DATA_DIR, 'cvcrm-integrity.json');
const ENTERPRISE_LINKS_FILE = path.join(DATA_DIR, 'enterprise-links.json');
const PAYMENT_PLAN_RULES_FILE = path.join(DATA_DIR, 'payment-plan-rules.json');
const RATE_LIMIT_FILE = path.join(DATA_DIR, 'cvcrm-rate-limit.json');
const DETAILED_TABLE_RAW_FILE = path.join(DATA_DIR, 'raw-tabelas-detalhadas-last.json');
const ENTERPRISE_MEDIA_FILE = path.join(DATA_DIR, 'enterprise-media.json');
const PRICE_HISTORY_FILE = path.join(DATA_DIR, 'price-history.json');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
const ENTERPRISE_IMAGE_DIR = path.join(__dirname, 'public', 'assets', 'empreendimentos');
const MAX_HISTORY = 150;
const VERCEL_CATALOG_BLOB_PATH = process.env.VERCEL_CATALOG_BLOB_PATH || 'estacao1/catalog.json';

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
fs.mkdirSync(BACKUP_DIR, { recursive: true });
if (!IS_VERCEL) fs.mkdirSync(ENTERPRISE_IMAGE_DIR, { recursive: true });

if (IS_VERCEL) {
  const seedFiles = [
    'vercel-cache.json', 'materials.json', 'history.json', 'enterprise-links.json',
    'payment-plan-rules.json', 'cvcrm-rate-limit.json', 'price-history.json',
    'enterprise-media.json',
  ];
  for (const name of seedFiles) {
    const source = path.join(BUNDLED_DATA_DIR, name);
    const target = path.join(DATA_DIR, name);
    if (!fs.existsSync(target) && fs.existsSync(source)) fs.copyFileSync(source, target);
  }
}

const emptyCache = { lastSync: null, lastSuccess: null, status: 'not_configured', error: null, enterprises: [], units: [], stats: {} };
const jsonCache = new Map();
function readJson(file, fallback) {
  try {
    const stat = fs.statSync(file);
    const cached = jsonCache.get(file);
    if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) return cached.value;
    const value = JSON.parse(fs.readFileSync(file, 'utf8'));
    jsonCache.set(file, { mtimeMs: stat.mtimeMs, size: stat.size, value });
    return value;
  } catch {
    jsonCache.delete(file);
    return fallback;
  }
}
function writeJson(file, value) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8');
  fs.renameSync(tmp, file);
  const stat = fs.statSync(file);
  jsonCache.set(file, { mtimeMs: stat.mtimeMs, size: stat.size, value });
}

let persistedCatalog = null;
let persistedCatalogLoadedAt = 0;
const PERSISTED_CATALOG_TTL_MS = 30000;

function blobStorageConfigured() {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB_STORE_ID);
}

async function readPersistedCatalog({ fresh = false } = {}) {
  const localFallback = readJson(CACHE_FILE, emptyCache);
  if (!IS_VERCEL || !blobStorageConfigured()) return localFallback;
  if (!fresh && persistedCatalog && Date.now() - persistedCatalogLoadedAt < PERSISTED_CATALOG_TTL_MS) {
    return persistedCatalog;
  }
  try {
    const { get: getBlob } = await import('@vercel/blob');
    const stored = await getBlob(VERCEL_CATALOG_BLOB_PATH, { access: 'private', useCache: false });
    if (!stored?.stream) return localFallback;
    const value = JSON.parse(await new Response(stored.stream).text());
    persistedCatalog = value;
    persistedCatalogLoadedAt = Date.now();
    writeJson(CACHE_FILE, value);
    return value;
  } catch (error) {
    console.error('[VERCEL BLOB] Falha ao ler catálogo persistente:', error.message);
    return localFallback;
  }
}

async function persistCatalog(cache) {
  if (!IS_VERCEL) return;
  if (!blobStorageConfigured()) throw new Error('Vercel Blob não configurado. Conecte um armazenamento privado ao projeto.');
  const { put: putBlob } = await import('@vercel/blob');
  await putBlob(VERCEL_CATALOG_BLOB_PATH, JSON.stringify(cache), {
    access: 'private',
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: 'application/json',
    cacheControlMaxAge: 60,
  });
  persistedCatalog = cache;
  persistedCatalogLoadedAt = Date.now();
}
if (!IS_VERCEL) {
  if (!fs.existsSync(CACHE_FILE)) {
    const bundledVercelCache = path.join(BUNDLED_DATA_DIR, 'vercel-cache.json');
    const initialCache = SYNC_ONCE_MODE ? readJson(bundledVercelCache, emptyCache) : emptyCache;
    writeJson(CACHE_FILE, initialCache);
  }
  if (!fs.existsSync(MATERIALS_FILE)) writeJson(MATERIALS_FILE, []);
  if (!fs.existsSync(HISTORY_FILE)) writeJson(HISTORY_FILE, []);
  if (!fs.existsSync(ENTERPRISE_LINKS_FILE)) writeJson(ENTERPRISE_LINKS_FILE, {});
  if (!fs.existsSync(PAYMENT_PLAN_RULES_FILE)) writeJson(PAYMENT_PLAN_RULES_FILE, { version: 1, defaultRule: {}, rules: [] });
  if (!fs.existsSync(RATE_LIMIT_FILE)) writeJson(RATE_LIMIT_FILE, { blockedUntil: null, last429At: null, count429: 0 });
  if (!fs.existsSync(PRICE_HISTORY_FILE)) writeJson(PRICE_HISTORY_FILE, []);
  if (!fs.existsSync(ENTERPRISE_MEDIA_FILE)) writeJson(ENTERPRISE_MEDIA_FILE, {});
}


function safeSlug(value) {
  return normKey(value || 'empreendimento').replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'empreendimento';
}

function backupFiles(label = 'manual') {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const folder = path.join(BACKUP_DIR, `${stamp}-${safeSlug(label)}`);
  fs.mkdirSync(folder, { recursive: true });
  const files = [
    CACHE_FILE, ENTERPRISE_LINKS_FILE, ENTERPRISE_MEDIA_FILE,
    PAYMENT_PLAN_RULES_FILE, PRICE_HISTORY_FILE
  ];
  for (const file of files) {
    if (fs.existsSync(file)) {
      try { fs.copyFileSync(file, path.join(folder, path.basename(file))); } catch {}
    }
  }
  const folders = fs.readdirSync(BACKUP_DIR, { withFileTypes: true })
    .filter(x => x.isDirectory())
    .map(x => ({ name: x.name, path: path.join(BACKUP_DIR, x.name), time: fs.statSync(path.join(BACKUP_DIR, x.name)).mtimeMs }))
    .sort((a,b) => b.time - a.time);
  for (const old of folders.slice(40)) {
    try { fs.rmSync(old.path, { recursive: true, force: true }); } catch {}
  }
  return folder;
}

function recordPriceHistory(cache) {
  const history = readJson(PRICE_HISTORY_FILE, []);
  const at = cache.lastSuccess || new Date().toISOString();
  for (const e of cache.enterprises || []) {
    if (!(Number(e.availableUnits) > 0) || !(Number(e.lowestPrice) > 0)) continue;
    history.push({
      at,
      enterpriseId: String(e.id ?? ''),
      enterpriseName: textValue(e.name),
      lowestPrice: Number(e.lowestPrice),
      availableUnits: Number(e.availableUnits || 0),
    });
  }
  const cutoff = Date.now() - 400 * 24 * 60 * 60 * 1000;
  const filtered = history.filter(x => {
    const t = Date.parse(x.at || '');
    return !Number.isFinite(t) || t >= cutoff;
  }).slice(-12000);
  writeJson(PRICE_HISTORY_FILE, filtered);
}

function enterpriseMediaSummary() {
  const cache = readJson(CACHE_FILE, emptyCache);
  const config = readJson(ENTERPRISE_MEDIA_FILE, {});
  const entries = (cache.enterprises || []).map(e => {
    const key = normKey(e.name);
    const media = config[key] || {};
    return {
      id: String(e.id ?? ''),
      sourceName: e.name,
      displayName: textValue(media.displayName, e.name),
      image: textValue(media.image),
      url: textValue(media.url),
      visible: media.visible !== false,
      highlights: Array.isArray(media.highlights) ? media.highlights : [],
      configured: Boolean(media.image || media.url || media.displayName || (Array.isArray(media.highlights) && media.highlights.length)),
      availableUnits: Number(e.availableUnits || 0),
      lowestPrice: e.lowestPrice,
    };
  });
  return {
    entries,
    pending: entries.filter(x => x.visible && !x.configured),
    configuredCount: entries.filter(x => x.configured).length,
  };
}

function addHistory(action, detail, meta = {}) {
  const history = readJson(HISTORY_FILE, []);
  history.unshift({ id: crypto.randomUUID(), at: new Date().toISOString(), action, detail, ...meta });
  writeJson(HISTORY_FILE, history.slice(0, MAX_HISTORY));
}

function configured() {
  return Boolean(process.env.CVCRM_DOMAIN && process.env.CVCRM_EMAIL && process.env.CVCRM_TOKEN);
}
function cronAuthorized(req) {
  const secret = String(process.env.CRON_SECRET || '');
  const received = String(req.headers.authorization || '');
  if (!secret) return false;
  const expected = `Bearer ${secret}`;
  const left = Buffer.from(received);
  const right = Buffer.from(expected);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}
function baseUrl() { return `https://${process.env.CVCRM_DOMAIN}.cvcrm.com.br`; }
function normKey(s) { return String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, ''); }
function indexObject(obj) {
  const idx = new Map();
  if (!obj || typeof obj !== 'object') return idx;
  for (const [k, v] of Object.entries(obj)) idx.set(normKey(k), v);
  return idx;
}
function pick(obj, keys, fallback = null) {
  const idx = indexObject(obj);
  for (const key of keys) {
    const v = idx.get(normKey(key));
    if (v !== undefined && v !== null && String(v).trim() !== '') return v;
  }
  return fallback;
}
function numberValue(v) {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (v === null || v === undefined || v === '') return null;
  let s = String(v).trim().replace(/R\$|\s/g, '');
  if (/^-?\d{1,3}(\.\d{3})+,\d+$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
  else if (/^-?\d+,\d+$/.test(s)) s = s.replace(',', '.');
  else s = s.replace(/[^0-9.-]/g, '');
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}
function intValue(v) { const n = numberValue(v); return n === null ? null : Math.round(n); }
function textValue(v, fallback = '') { return v === null || v === undefined ? fallback : String(v).trim(); }
function recordArray(payload) {
  // Estrutura confirmada no CVCRM da Estação 1:
  // { pagina, registros, total_de_registros, total_de_paginas, dados: [...] }
  return Array.isArray(payload?.dados) ? payload.dados : [];
}
function paginationInfo(payload, fallbackPage = 1) {
  return {
    page: intValue(payload?.pagina) || fallbackPage,
    pageSize: intValue(payload?.registros) || 0,
    totalRecords: intValue(payload?.total_de_registros) || 0,
    totalPages: intValue(payload?.total_de_paginas) || 1,
  };
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

let lastCvRequestAt = 0;
const CVCRM_MIN_GAP_MS = Math.max(3200, Number(process.env.CVCRM_REQUEST_GAP_MS || 3200));
const CVCRM_PHASE_GAP_MS = Math.max(0, Number(process.env.CVCRM_PHASE_GAP_MS || 0));
const CVCRM_429_MIN_COOLDOWN_MS = Math.max(60000, Number(process.env.CVCRM_429_COOLDOWN_MS || 60000));

let syncProgress = {
  phase: 'idle',
  label: '',
  currentPage: 0,
  totalPages: 0,
  loaded: 0,
  totalRecords: 0,
  retryWaitSeconds: null,
  warning: null,
  endpoint: null,
};

function setProgress(patch) {
  syncProgress = { ...syncProgress, ...patch };
}

function readRateLimitState() {
  return readJson(RATE_LIMIT_FILE, { blockedUntil: null, last429At: null, count429: 0 });
}

function setRateLimitCooldown(ms, response = null) {
  const now = Date.now();
  const prev = readRateLimitState();
  const prevUntil = prev.blockedUntil ? Date.parse(prev.blockedUntil) || 0 : 0;
  const blockedUntilMs = Math.max(prevUntil, now + ms);
  const next = {
    blockedUntil: new Date(blockedUntilMs).toISOString(),
    last429At: new Date(now).toISOString(),
    count429: Number(prev.count429 || 0) + 1,
    retryAfter: response?.headers?.get?.('retry-after') || null,
  };
  writeJson(RATE_LIMIT_FILE, next);
  return blockedUntilMs;
}

function clearExpiredRateLimit() {
  const state = readRateLimitState();
  const until = state.blockedUntil ? Date.parse(state.blockedUntil) : 0;
  if (until && until <= Date.now()) {
    writeJson(RATE_LIMIT_FILE, { ...state, blockedUntil: null });
  }
}

async function waitCountdown(ms, label) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const remaining = Math.max(0, end - Date.now());
    setProgress({
      phase: 'waiting',
      label,
      retryWaitSeconds: Math.ceil(remaining / 1000),
    });
    await sleep(Math.min(1000, remaining));
  }
  setProgress({ retryWaitSeconds: null });
}

async function respectPersistentCooldown() {
  const state = readRateLimitState();
  const until = state.blockedUntil ? Date.parse(state.blockedUntil) : 0;
  if (until > Date.now()) {
    await waitCountdown(until - Date.now(), 'Proteção contra limite do CVCRM');
  } else {
    clearExpiredRateLimit();
  }
}

async function waitCvcrmSlot() {
  await respectPersistentCooldown();
  const elapsed = Date.now() - lastCvRequestAt;
  const wait = Math.max(0, CVCRM_MIN_GAP_MS - elapsed);
  if (wait) await sleep(wait);
  lastCvRequestAt = Date.now();
}

function retryAfterMs(response, attempt) {
  const raw = response.headers.get('retry-after');
  let serverWait = 0;

  if (raw) {
    const seconds = Number(raw);
    if (Number.isFinite(seconds) && seconds >= 0) {
      serverWait = seconds * 1000;
    } else {
      const when = Date.parse(raw);
      if (Number.isFinite(when)) serverWait = Math.max(0, when - Date.now());
    }
  }

  const escalating = [60000, 90000, 120000, 180000][Math.min(attempt, 3)];
  return Math.max(CVCRM_429_MIN_COOLDOWN_MS, serverWait + 10000, escalating);
}

async function cvGet(endpoint, page, pageSize = 500) {
  const url = new URL(endpoint, baseUrl());
  url.searchParams.set('pagina', String(page));
  url.searchParams.set('registros_por_pagina', String(pageSize));

  for (let attempt = 0; attempt < 4; attempt++) {
    await waitCvcrmSlot();
    setProgress({ endpoint, phase: 'requesting' });

    const started = Date.now();
    let response;
    try {
      response = await fetch(url, {
        method: 'GET',
        headers: {
          email: process.env.CVCRM_EMAIL,
          token: process.env.CVCRM_TOKEN,
          Accept: 'application/json',
        },
        signal: AbortSignal.timeout(60000),
      });
    } catch (error) {
      const err = new Error(`Falha de rede ao consultar CVCRM: ${error instanceof Error ? error.message : String(error)}`);
      err.cause = error;
      throw err;
    }

    const bodyText = await response.text();
    let body;
    try { body = JSON.parse(bodyText); }
    catch { body = { mensagem: bodyText.slice(0, 3000) }; }

    console.log(`[CVCRM] GET ${endpoint} página ${page} -> HTTP ${response.status} (${Date.now() - started} ms)`);

    if (response.ok) return body;

    if (response.status === 429) {
      const waitMs = retryAfterMs(response, attempt);
      const blockedUntil = setRateLimitCooldown(waitMs, response);
      console.warn(`[CVCRM] HTTP 429 em ${endpoint}. Bloqueio de proteção até ${new Date(blockedUntil).toLocaleTimeString('pt-BR')}.`);

      if (attempt < 3) {
        await respectPersistentCooldown();
        continue;
      }

      const err = new Error('CVCRM 429: limite de requisições persistiu após as tentativas de proteção.');
      err.status = 429;
      throw err;
    }

    const msg = textValue(body?.message || body?.mensagem || body?.Response || response.statusText, `HTTP ${response.status}`);
    const err = new Error(`CVCRM ${response.status}: ${msg}`);
    err.status = response.status;
    throw err;
  }

  throw new Error('CVCRM: número máximo de tentativas excedido.');
}

async function fetchAll(endpoint, label) {
  const rows = [];
  let page = 1;
  let totalPages = 1;

  do {
    setProgress({
      phase: 'fetching',
      endpoint,
      label,
      currentPage: page,
      totalPages,
      loaded: rows.length,
      retryWaitSeconds: null,
    });

    const payload = await cvGet(endpoint, page, 500);
    const chunk = recordArray(payload);
    const info = paginationInfo(payload, page);

    if (page === 1) {
      totalPages = Math.max(1, info.totalPages);
      setProgress({ totalPages, totalRecords: info.totalRecords });
    }

    rows.push(...chunk);

    setProgress({
      phase: 'fetching',
      endpoint,
      label,
      currentPage: page,
      totalPages,
      loaded: rows.length,
      totalRecords: info.totalRecords || rows.length,
    });

    if (chunk.length === 0 || page >= totalPages) break;
    page++;
  } while (page <= 1000);

  return rows;
}

async function waitBetweenPhases(nextLabel) {
  if (CVCRM_PHASE_GAP_MS <= 0) return;
  await waitCountdown(CVCRM_PHASE_GAP_MS, `Aguardando antes de ${nextLabel}`);
}


async function cvGetConventional(endpoint, params = {}) {
  const url = new URL(endpoint, baseUrl());
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
  }

  for (let attempt = 0; attempt < 3; attempt++) {
    // Mantemos o mesmo espaçamento conservador entre chamadas para não disputar
    // requisições com o CVDW, mesmo a API convencional possuindo limite próprio.
    await waitCvcrmSlot();
    setProgress({ endpoint, phase: 'requesting' });
    const started = Date.now();
    let response;
    try {
      response = await fetch(url, {
        method: 'GET',
        headers: {
          email: process.env.CVCRM_EMAIL,
          token: process.env.CVCRM_TOKEN,
          Accept: 'application/json',
        },
        signal: AbortSignal.timeout(90000),
      });
    } catch (error) {
      throw new Error(`Falha de rede ao consultar tabela detalhada do CVCRM: ${error instanceof Error ? error.message : String(error)}`);
    }

    const bodyText = await response.text();
    let body;
    try { body = JSON.parse(bodyText); }
    catch { body = { mensagem: bodyText.slice(0, 5000) }; }

    console.log(`[CVCRM] GET ${endpoint} -> HTTP ${response.status} (${Date.now() - started} ms)`);
    if (response.ok) return body;

    if (response.status === 429) {
      const waitMs = retryAfterMs(response, attempt);
      setRateLimitCooldown(waitMs, response);
      if (attempt < 2) {
        await respectPersistentCooldown();
        continue;
      }
    }

    const msg = textValue(body?.message || body?.mensagem || body?.Response || response.statusText, `HTTP ${response.status}`);
    const err = new Error(`CVCRM ${response.status}: ${msg}`);
    err.status = response.status;
    throw err;
  }
  throw new Error('CVCRM: número máximo de tentativas excedido na tabela detalhada.');
}

function directAppraisalValue(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
  // A coluna usada no CVCRM da Estação 1 é "VALOR DO IMÓVEL (1x)".
  for (const [key, value] of Object.entries(obj)) {
    const nk = normKey(key);
    if (nk === 'valordoimovel1x' || nk === 'valordoimovel' ||
        (nk.startsWith('valordoimovel') && nk.includes('1x'))) {
      const n = numberValue(value);
      if (n !== null && n > 0) return n;
    }
  }
  return null;
}

function appraisalFromConditionObject(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
  const label = textValue(pick(obj, [
    'descricao','descrição','nome','titulo','título','rotulo','rótulo','coluna','campo','parcela','condicao','condição'
  ]));
  const nl = normKey(label);
  if (!nl.includes('valordoimovel')) return null;
  const value = numberValue(pick(obj, ['valor','value','valor_parcela','valorparcela','montante','total']));
  return value !== null && value > 0 ? value : null;
}

function findAppraisalDeep(node, depth = 0) {
  if (node === null || node === undefined || depth > 6) return null;
  if (typeof node !== 'object') return null;
  if (!Array.isArray(node)) {
    const direct = directAppraisalValue(node);
    if (direct !== null) return direct;
    const condition = appraisalFromConditionObject(node);
    if (condition !== null) return condition;
  }
  const values = Array.isArray(node) ? node : Object.values(node);
  for (const child of values) {
    if (child && typeof child === 'object') {
      const found = findAppraisalDeep(child, depth + 1);
      if (found !== null) return found;
    }
  }
  return null;
}

function detailedUnitKeys(row) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return [];
  const out = [];
  const add = (prefix, value) => {
    const t = textValue(value);
    if (t) out.push(`${prefix}:${normKey(t)}`);
  };
  add('id', pick(row, ['idunidade','id_unidade','unidade_id']));
  add('int', pick(row, ['idunidade_int','id_unidade_int']));
  add('ref', pick(row, ['referencia','codigo','codigo_unidade','codigounidade']));
  const unit = pick(row, ['unidade','nome_unidade','nomeunidade','nome','numero_unidade','numerounidade']);
  add('unit', unit);
  const block = pick(row, ['bloco','nome_bloco','nomebloco','bloco_nome','torre']);
  if (unit && block) add('blockunit', `${block}|${unit}`);
  return [...new Set(out)];
}

function collectDetailedUnitAppraisals(payload) {
  const index = new Map();
  let objectsVisited = 0;
  let matchedObjects = 0;

  const walk = (node, depth = 0) => {
    if (node === null || node === undefined || depth > 12) return;
    if (Array.isArray(node)) {
      for (const child of node) walk(child, depth + 1);
      return;
    }
    if (typeof node !== 'object') return;
    objectsVisited++;

    const keys = detailedUnitKeys(node);
    if (keys.length) {
      const appraisal = findAppraisalDeep(node);
      if (appraisal !== null && appraisal > 0) {
        matchedObjects++;
        for (const key of keys) if (!index.has(key)) index.set(key, appraisal);
      }
    }
    for (const child of Object.values(node)) if (child && typeof child === 'object') walk(child, depth + 1);
  };
  walk(payload);
  return { index, objectsVisited, matchedObjects };
}

function lookupDetailedAppraisal(index, row) {
  if (!index) return null;
  for (const key of detailedUnitKeys(row)) {
    if (index.has(key)) return index.get(key);
  }
  return null;
}

function tableSeriesValue(row, pattern) {
  const series = Array.isArray(row?.series) ? row.series : [];
  const item = series.find(entry => pattern.test(normKey(entry?.nome)));
  return item ? numberValue(item.valor) : null;
}

function collectCommercialDashboardRows(payload, allowAnyTable = false) {
  const index = new Map();
  const walk = (node, depth = 0) => {
    if (!node || typeof node !== 'object' || depth > 12) return;
    if (Array.isArray(node)) {
      for (const child of node) walk(child, depth + 1);
      return;
    }

    const tableName = textValue(pick(node, ['tabela','nome_tabela','nometabela','nome']));
    const rows = Array.isArray(node.dados) ? node.dados : null;
    if (rows && (allowAnyTable || normKey(tableName).includes('dashboard'))) {
      for (const row of rows) {
        const detail = {
          price: tableSeriesValue(row, /valordevenda/) ?? extractPrice(row),
          // Tabelas antigas são usadas apenas como fonte de preço. A situação
          // atual continua vindo de /unidades/situacao para não reabrir vendas.
          status: allowAnyTable ? null : deriveStatus(row),
          tableName,
        };
        for (const key of detailedUnitKeys(row)) index.set(key, detail);
      }
    }

    for (const child of Object.values(node)) if (child && typeof child === 'object') walk(child, depth + 1);
  };
  walk(payload);
  return index;
}

function lookupCommercialDashboard(index, row) {
  if (!index) return null;
  for (const key of detailedUnitKeys(row)) {
    if (index.has(key)) return index.get(key);
  }
  return null;
}

async function fetchDetailedAppraisals(unitsRows, situationRows = []) {
  const situationIndex = latestByUnit(situationRows);
  const enterprises = new Map();
  for (const row of unitsRows) {
    const id = enterpriseKey(row);
    const name = enterpriseName(row);
    if (!id) continue;
    if (!enterprises.has(String(id))) enterprises.set(String(id), { id: String(id), name, hasAvailable: false });
    const situation = lookupUnit(situationIndex, row);
    const situationStatus = Object.keys(situation).length ? deriveStatus(situation) : null;
    const status = situationStatus && situationStatus !== 'indisponivel'
      ? situationStatus
      : deriveStatus(row);
    if (status === 'disponivel') enterprises.get(String(id)).hasAvailable = true;
  }

  const perEnterprise = new Map();
  const commercialDashboards = new Map();
  const diagnostics = [];
  let position = 0;
  for (const enterprise of [...enterprises.values()].sort((a,b)=>a.name.localeCompare(b.name,'pt-BR'))) {
    position++;
    const endpoint = `/api/v1/cadastros/empreendimentos/${encodeURIComponent(enterprise.id)}/tabelasdepreco/detalhada`;
    setProgress({
      phase: 'fetching-appraisals',
      endpoint,
      label: `4/4 • Valor do imóvel • ${enterprise.name}`,
      currentPage: position,
      totalPages: enterprises.size,
      loaded: position - 1,
      totalRecords: enterprises.size,
    });
    try {
      let payload = await cvGetConventional(endpoint, { tabelasemjson: 'true' });
      let allowAnyTable = false;
      let dashboard = collectCommercialDashboardRows(payload);

      // Algumas tabelas disponíveis (como a do Allegro) não aparecem na rota
      // genérica nem no CVDW. Nesse caso, listamos as tabelas do empreendimento,
      // escolhemos a vigência mais recente sem exigir aprovação e consultamos seu ID.
      if (!dashboard.size && enterprise.hasAvailable) {
        const tableList = await cvGetConventional(
          `/api/v1/cadastros/empreendimentos/${encodeURIComponent(enterprise.id)}/tabelasdepreco`
        );
        const tables = (Array.isArray(tableList) ? tableList : recordArray(tableList))
          .filter(table => table && pick(table, ['idtabela','id_tabela']))
          .sort((a, b) => {
            const dateDifference = priceTableTimestamp(b) - priceTableTimestamp(a);
            if (dateDifference) return dateDifference;
            return priceTableId(b) - priceTableId(a);
          });
        const latestTable = tables[0];
        if (latestTable) {
          const tableId = pick(latestTable, ['idtabela','id_tabela']);
          payload = await cvGetConventional(
            `/api/v1/cadastros/empreendimentos/${encodeURIComponent(enterprise.id)}/tabelasdepreco/${encodeURIComponent(tableId)}/detalhada`,
            { tabelasemjson: 'true' }
          );
          allowAnyTable = true;
          dashboard = collectCommercialDashboardRows(payload, true);
        }
      }
      const parsed = collectDetailedUnitAppraisals(payload);
      perEnterprise.set(String(enterprise.id), parsed.index);
      const dashboardEligible = [...dashboard.values()].some(row =>
        Number(row.price) > 0 && (allowAnyTable || row.status === 'disponivel')
      );
      if (dashboardEligible) commercialDashboards.set(String(enterprise.id), dashboard);
      diagnostics.push({
        enterpriseId: enterprise.id,
        enterpriseName: enterprise.name,
        ok: true,
        appraisalMatches: parsed.index.size,
        matchedObjects: parsed.matchedObjects,
        objectsVisited: parsed.objectsVisited,
        dashboardMatches: dashboard.size,
        dashboardEligible,
        fallbackTable: allowAnyTable,
        sample: payload,
      });
    } catch (error) {
      diagnostics.push({
        enterpriseId: enterprise.id,
        enterpriseName: enterprise.name,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
      console.warn(`[CVCRM] Não foi possível obter VALOR DO IMÓVEL de ${enterprise.name}: ${error.message}`);
    }
  }

  // Guardamos a resposta detalhada para diagnóstico, mas limitamos cada payload a
  // uma serialização completa apenas nesta fonte auxiliar; o arquivo não é servido publicamente.
  try { writeJson(DETAILED_TABLE_RAW_FILE, { at: new Date().toISOString(), enterprises: diagnostics }); } catch {}
  return { perEnterprise, commercialDashboards, diagnostics };
}

function unitKey(row) {
  return textValue(pick(row, ['idunidade','id_unidade','idunidade_int','referencia','id','codigo','codigo_unidade','unidade']));
}
function unitKeys(row) {
  const rawKeys = [
    pick(row, ['idunidade']),
    pick(row, ['idunidade_int']),
    pick(row, ['referencia']),
    pick(row, ['codigo','codigo_unidade']),
  ].map(textValue).filter(Boolean);
  const enterprise = enterpriseKey(row);
  // O mesmo número/código de unidade pode existir em empreendimentos distintos.
  // O prefixo impede que situação ou preço de um projeto seja aplicado em outro.
  const keys = enterprise ? rawKeys.map(key => `${enterprise}:${key}`) : rawKeys;
  return [...new Set(keys)];
}
function enterpriseKey(row) {
  return textValue(pick(row, [
    'idempreendimento','id_empreendimento','idempreendimento_int',
    'empreendimento_id','codigoempreendimento','idempreendimento_cv'
  ]));
}
function enterpriseName(row) {
  return textValue(
    pick(row, ['nome_empreendimento','empreendimento','nomeempreendimento','empreendimento_nome','nomeempreendimento_cv','nome_projeto']),
    'Empreendimento não informado'
  );
}
function yesValue(v) {
  const x = normKey(v);
  return ['s','sim','1','true','yes','ativo','aprovado'].includes(x);
}
function rowTimestamp(row) {
  const raw = pick(row, ['referencia_data','data_referencia','datareferencia','updated_at','atualizado_em','data_atualizacao']);
  if (!raw) return 0;
  const t = Date.parse(String(raw).replace(' ', 'T'));
  return Number.isFinite(t) ? t : 0;
}
function rowReference(row) {
  return intValue(pick(row, ['referencia','idreferencia','id_referencia'])) || 0;
}
function latestByUnit(rows) {
  const canonical = new Map();
  for (const row of rows) {
    const keys = unitKeys(row);
    if (!keys.length) continue;
    const canonicalKey = keys[0];
    const prev = canonical.get(canonicalKey);
    if (!prev ||
        rowTimestamp(row) > rowTimestamp(prev) ||
        (rowTimestamp(row) === rowTimestamp(prev) && rowReference(row) >= rowReference(prev))) {
      canonical.set(canonicalKey, row);
    }
  }
  const alias = new Map();
  for (const row of canonical.values()) for (const key of unitKeys(row)) alias.set(key, row);
  return alias;
}
function lookupUnit(index, row) {
  for (const key of unitKeys(row)) if (index.has(key)) return index.get(key);
  return {};
}
function normalizeStatus(v) {
  const x = normKey(v);
  if (!x) return null;
  if (x.includes('dispon')) return 'disponivel';
  if (x.includes('reserv')) return 'reservada';
  if (x.includes('vend')) return 'vendida';
  if (x.includes('permuta')) return 'permuta';
  if (x.includes('bloq')) return 'bloqueada';
  if (x.includes('distrat')) return 'disponivel';
  return textValue(v).toLowerCase();
}
function deriveStatus(source) {
  // /unidades/situacao é um histórico de mudanças. O estado NOVO está em
  // para_situacao; de_situacao é o estado anterior e não deve ser exibido.
  const explicit = normalizeStatus(pick(source, [
    'para_situacao',
    'situacao_nome','nome_situacao','situacao','status','situacao_unidade',
    'situacao_reservada_nomesituacao','descricao_situacao'
  ]));
  if (explicit) return explicit;

  const reason = normalizeStatus(pick(source, [
    'situacao_bloqueada_motivo','situacao_motivo','motivo'
  ]));
  if (reason) return reason;

  if (yesValue(pick(source, ['situacao_vendida']))) return 'vendida';
  if (yesValue(pick(source, ['situacao_reservada']))) return 'reservada';
  if (yesValue(pick(source, ['situacao_bloqueada']))) return 'bloqueada';
  return 'indisponivel';
}
function extractPrice(row) {
  return numberValue(pick(row, [
    'valor','valor_unidade','valorunidade','preco','preco_unidade',
    'valor_tabela','valortabela','valor_venda','valorvenda',
    'valor_total','valortotal','valor_total_unidade','valorfinal'
  ]));
}
function isActivePanelRow(row) {
  const panel = normKey(pick(row, ['ativo_painel','ativopainel']));
  if (panel) return panel === 'a' || panel === 'ativo' || panel === 's' || panel === 'sim';
  const active = normKey(pick(row, ['ativo','ativa','tabela_ativa','vigente']));
  return !active || ['a','ativo','s','sim','1','true'].includes(active);
}
function priceTableTimestamp(row) {
  const raw = pick(row, [
    'data_vigencia_de','datavigenciade','vigencia_de','inicio_vigencia',
    'data_vigencia_ate','datavigenciaate','vigencia_ate','fim_vigencia'
  ]);
  const parsed = raw ? Date.parse(String(raw).replace(' ', 'T')) : NaN;
  return Number.isFinite(parsed) ? parsed : rowTimestamp(row);
}
function priceTableId(row) {
  return intValue(pick(row, ['idtabela','id_tabela','idtabela_int'])) || 0;
}
function isEnterprisePanelActive(row) {
  const panel = normKey(pick(row, ['ativo_painel','ativopainel']));
  // O CVDW atual não expõe esse campo em todas as contas. Quando vier informado,
  // publicamos somente o estado A; quando vier ausente, a disponibilidade decide.
  return !panel || panel === 'a' || panel === 'ativo';
}
function bestPriceByUnit(rows) {
  const groups = new Map();
  for (const row of rows) {
    const keys = unitKeys(row);
    if (!keys.length) continue;
    const k = keys[0];
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(row);
  }
  const alias = new Map();
  for (const list of groups.values()) {
    const positives = list.filter(r => {
      const p = extractPrice(r);
      return p !== null && p > 0;
    });
    const active = positives.filter(isActivePanelRow);
    const pool = active.length ? active : (positives.length ? positives : list);
    pool.sort((a,b) => {
      const vd = priceTableTimestamp(b) - priceTableTimestamp(a);
      if (vd) return vd;
      const tableIdDifference = priceTableId(b) - priceTableId(a);
      if (tableIdDifference) return tableIdDifference;
      const td = rowTimestamp(b) - rowTimestamp(a);
      if (td) return td;
      return rowReference(b) - rowReference(a);
    });
    // A publicação considera a tabela ativa mais recente, mesmo ainda não aprovada.
    // Não escolhemos o menor valor entre tabelas diferentes, pois isso poderia
    // manter no portal uma tabela antiga depois da entrada de uma nova vigência.
    const chosen = pool[0] || {};
    for (const row of list) for (const key of unitKeys(row)) alias.set(key, chosen);
  }
  return alias;
}
function isVertexUnit(row) {
  return enterpriseKey(row) === '121' || normKey(enterpriseName(row)).includes('vertexgetulio');
}
function vertexFloorLabel(row) {
  let floor = intValue(pick(row, ['andar','pavimento']));
  if (floor === null) {
    const unitNumber = intValue(pick(row, ['nome','unidade','numero_unidade','numerounidade']));
    if (unitNumber !== null && unitNumber >= 1) floor = unitNumber <= 99 ? 0 : Math.floor(unitNumber / 100);
  }
  if (floor === null) return textValue(pick(row, ['tipologia']), 'Andar não informado');
  return floor === 0 ? 'Térreo' : `${floor}º andar`;
}
function vertexCommercialType(row) {
  const raw = normKey(pick(row, [
    'tipologia','nome_tipologia','tipologia_nome','tipo_unidade','tipo_unidade_nome','tipounidade'
  ]));
  return raw.includes('varanda') ? 'Com varanda' : 'Padrão';
}
function normalizeUnit(baseRow, situationRow = {}, priceRow = {}, detailedAppraisal = null, dashboardRow = null, preserveBaseIdentity = false) {
  const combined = { ...baseRow, ...situationRow, ...priceRow };
  // Quando o CVCRM publica uma Dashboard comercial para o empreendimento,
  // situação e preço apenas complementam a identidade estrutural de /unidades.
  // Isso permite descobrir novos empreendimentos sem cadastrar IDs no código.
  const identitySource = preserveBaseIdentity ? baseRow : combined;
  // A API /unidades/situacao é histórica. Para empreendimentos/unidades recém-criados,
  // pode existir uma linha de situação sem um estado atual reconhecível. Nesse caso,
  // não devemos transformar a unidade em "indisponivel" e descartá-la do catálogo:
  // usamos a situação atual informada pela própria linha de /unidades como fallback.
  const hasSituationRow = Object.keys(situationRow).length > 0;
  const situationStatus = hasSituationRow ? deriveStatus(situationRow) : null;
  const baseStatus = deriveStatus(baseRow);
  const resolvedStatus = hasSituationRow && situationStatus !== 'indisponivel'
    ? situationStatus
    : baseStatus;
  const statusSource = hasSituationRow && situationStatus !== 'indisponivel' ? situationRow : baseRow;
  const eId = enterpriseKey(identitySource) || enterpriseName(identitySource);
  const id = unitKey(identitySource) || crypto.createHash('sha1').update(JSON.stringify(baseRow)).digest('hex').slice(0,14);
  const price = dashboardRow?.price ?? extractPrice(priceRow) ?? extractPrice(baseRow);

  return {
    id,
    internalId: textValue(pick(identitySource, ['idunidade_int'])),
    enterpriseId: eId,
    enterpriseInternalId: textValue(pick(identitySource, ['idempreendimento_int'])),
    enterpriseName: enterpriseName(identitySource),
    code: textValue(pick(identitySource, ['idunidade_int','codigo','codigo_unidade','unidade','nome']), id),
    developmentType: textValue(pick(identitySource, ['tipo_empreendimento'])),
    typology: isVertexUnit(baseRow) ? vertexFloorLabel(baseRow) : textValue(pick(identitySource, ['bloco','nome_bloco','nomebloco','bloco_nome','torre','tipologia','nome_tipologia','tipologia_nome','tipo_unidade','tipo_unidade_nome','tipounidade','produto','planta','modelo','descricao_tipologia'])),
    commercialType: isVertexUnit(baseRow) ? vertexCommercialType(baseRow) : '',
    stage: textValue(pick(identitySource, ['etapa'])),
    bedrooms: intValue(pick(identitySource, ['qtde_quartos','quartos','dormitorios','dormitórios','quantidade_quartos','qtdequartos'])),
    suites: intValue(pick(identitySource, ['qtde_suites','suites','suítes','quantidade_suites'])),
    tower: textValue(pick(identitySource, ['bloco','torre','nome_bloco','nomebloco','bloco_nome'])),
    floor: intValue(pick(identitySource, ['andar','pavimento'])),
    area: numberValue(pick(identitySource, ['area_privativa','areaprivativa','area_privativa_total','area_total','areatotal','area'])),
    parkingSpaces: intValue(pick(identitySource, ['vagas_garagem','qtde_vagas_garagem','vagas','vagasgaragem','quantidade_vagas'])),
    price,
    appraisal: detailedAppraisal ?? numberValue(pick(combined, ['VALOR DO IMÓVEL (1x)','VALOR DO IMOVEL (1x)','valor_do_imovel_1x','valor_imovel_1x','valordoimovel1x','valor_imovel','valor do imovel','valor do imóvel','valor_avaliacao','valoravaliacao','avaliacao','valor_de_avaliacao'])),
    status: dashboardRow?.status || resolvedStatus,
    statusReason: textValue(pick(statusSource, ['situacao_bloqueada_motivo','situacao_reservada_nomesituacao','motivo'])),
    tableName: textValue(dashboardRow?.tableName || pick(priceRow, ['tabela','tabela_preco','tabelapreco','nome_tabela','nometabela','tabela_preco_nome'])),
    hasSituation: hasSituationRow,
    hasPrice: price !== null && price > 0,
    updatedAt: textValue(pick(statusSource, ['referencia_data','data_referencia','datareferencia','updated_at','atualizado_em']), new Date().toISOString()),
  };
}
function mergeData(unitsRows, situationRows = [], priceRows = [], appraisalByEnterprise = new Map(), commercialDashboards = new Map()) {
  const situationIndex = latestByUnit(situationRows);
  const priceIndex = bestPriceByUnit(priceRows);
  const allUnits = unitsRows.filter(isEnterprisePanelActive).map(row => {
    const enterpriseId = String(enterpriseKey(row));
    const enterpriseAppraisals = appraisalByEnterprise.get(enterpriseId) || null;
    const enterpriseDashboard = commercialDashboards.get(enterpriseId) || null;
    return normalizeUnit(
      row,
      lookupUnit(situationIndex, row),
      lookupUnit(priceIndex, row),
      lookupDetailedAppraisal(enterpriseAppraisals, row),
      lookupCommercialDashboard(enterpriseDashboard, row),
      Boolean(enterpriseDashboard)
    );
  });

  const enterpriseMap = new Map();
  for (const u of allUnits) {
    const key = u.enterpriseId || u.enterpriseName;
    if (!enterpriseMap.has(key)) {
      enterpriseMap.set(key, {
        id: key,
        internalId: u.enterpriseInternalId,
        name: u.enterpriseName,
        type: u.developmentType,
        totalUnits: 0,
        availableUnits: 0,
        unidades_disponiveis: 0,
        reservedUnits: 0,
        blockedUnits: 0,
        soldUnits: 0,
        permutaUnits: 0,
        pricedUnits: 0,
        lowestPrice: null,
      });
    }
    const e = enterpriseMap.get(key);
    e.totalUnits++;
    if (u.status === 'disponivel') {
      e.availableUnits++;
      e.unidades_disponiveis++;
    }
    if (u.status === 'reservada') e.reservedUnits++;
    if (u.status === 'bloqueada') e.blockedUnits++;
    if (u.status === 'vendida') e.soldUnits++;
    if (u.status === 'permuta') e.permutaUnits++;
    if (u.hasPrice) e.pricedUnits++;
    if (u.status === 'disponivel' && u.price !== null && u.price > 0) {
      e.lowestPrice = e.lowestPrice === null ? u.price : Math.min(e.lowestPrice, u.price);
    }
  }

  // Catálogo residencial: qualquer empreendimento atual ou novo entra
  // automaticamente assim que possuir ao menos uma unidade disponível.
  // Cadastros de teste e o produto exclusivamente comercial não compõem a vitrine.
  const nonResidentialEnterpriseNames = new Set(['aracastreetmall', 'testepagadoria']);
  const isResidentialEnterprise = name => !nonResidentialEnterpriseNames.has(normKey(name));
  const availableCommercialUnits = allUnits.filter(u =>
    u.status === 'disponivel' && isResidentialEnterprise(u.enterpriseName)
  );

  const allEnterprises = [...enterpriseMap.values()];
  const enterprises = allEnterprises.filter(e =>
    Number(e.unidades_disponiveis) > 0 && isResidentialEnterprise(e.name)
  );

  enterprises.sort((a,b) => a.name.localeCompare(b.name, 'pt-BR'));
  const visibleIds = new Set(enterprises.map(e => String(e.id)));
  const units = availableCommercialUnits.filter(u => visibleIds.has(String(u.enterpriseId)));

  return { units, enterprises, allUnits, allEnterprises };
}
function buildIntegrity(unitsRows, situationRows, priceRows, merged, errors = []) {
  const available = merged.units.filter(u => u.status === 'disponivel');
  const availableWithPrice = available.filter(u => u.price !== null && u.price > 0);
  const availableWithoutPrice = available.filter(u => !(u.price !== null && u.price > 0));
  const statusCounts = {};
  for (const u of merged.units) statusCounts[u.status] = (statusCounts[u.status] || 0) + 1;

  return {
    at: new Date().toISOString(),
    endpoints: {
      unidades: { records: unitsRows.length, ok: !errors.some(e => e.endpoint === 'unidades') },
      situacao: { records: situationRows.length, ok: !errors.some(e => e.endpoint === 'situacao') },
      precos: { records: priceRows.length, ok: !errors.some(e => e.endpoint === 'precos') },
    },
    allEnterpriseCount: merged.allEnterprises.length,
    commercialEnterpriseCount: merged.enterprises.length,
    commercialUnitCount: merged.units.length,
    availableCount: available.length,
    availableWithPriceCount: availableWithPrice.length,
    availableWithoutPriceCount: availableWithoutPrice.length,
    statusCounts,
    warnings: [
      ...(availableWithoutPrice.length ? [`${availableWithoutPrice.length} unidade(s) disponível(is) sem preço retornado pela API de preços.`] : []),
      ...errors.map(e => `${e.endpoint}: ${e.message}`),
    ],
  };
}

let syncing = false;

async function syncCvcrm(trigger = 'manual') {
  if (syncing) return { ok: false, message: 'Sincronização já está em andamento.' };
  if (!configured()) throw new Error('CVCRM ainda não configurado. Execute CONFIGURAR_CVCRM.bat.');

  syncing = true;
  syncProgress = {
    phase: 'starting',
    label: 'Preparando sincronização segura',
    currentPage: 0,
    totalPages: 0,
    loaded: 0,
    totalRecords: 0,
    retryWaitSeconds: null,
    warning: null,
    endpoint: null,
  };

  const startedAt = new Date().toISOString();
  if (IS_VERCEL) {
    const storedCatalog = await readPersistedCatalog({ fresh: true });
    writeJson(CACHE_FILE, storedCatalog);
  }
  const previousCache = readJson(CACHE_FILE, emptyCache);

  let unitsRows = [];
  let situationRows = [];
  let priceRows = [];
  let appraisalData = { perEnterprise: new Map(), commercialDashboards: new Map(), diagnostics: [] };
  let merged = { units: [], allUnits: [], enterprises: [], allEnterprises: [] };

  try {
    await respectPersistentCooldown();

    unitsRows = await fetchAll('/api/v1/cvdw/unidades', '1/3 • Baixando unidades');
    if (!unitsRows.length) {
      throw new Error('A API /unidades respondeu sem registros. O catálogo anterior foi preservado.');
    }

    await waitBetweenPhases('situações');

    situationRows = await fetchAll('/api/v1/cvdw/unidades/situacao', '2/3 • Baixando situações');
    if (!situationRows.length) {
      throw new Error('A API /unidades/situacao respondeu sem registros. O catálogo anterior foi preservado.');
    }

    await waitBetweenPhases('preços');

    priceRows = await fetchAll('/api/v1/cvdw/unidades/precos', '3/3 • Baixando preços');
    if (!priceRows.length) {
      throw new Error('A API /unidades/precos respondeu sem registros. O catálogo anterior foi preservado.');
    }

    // O CVDW de preços não contém a coluna comercial "VALOR DO IMÓVEL (1x)".
    // Essa coluna é obtida na tabela de preço detalhada da API convencional.
    appraisalData = await fetchDetailedAppraisals(unitsRows, situationRows);

    setProgress({
      phase: 'processing',
      label: 'Cruzando unidades, situações e preços',
      endpoint: null,
      currentPage: 0,
      totalPages: 0,
      loaded: 0,
      totalRecords: 0,
      retryWaitSeconds: null,
    });

    merged = mergeData(unitsRows, situationRows, priceRows, appraisalData.perEnterprise, appraisalData.commercialDashboards);
    // Empreendimentos liberados recentemente não devem sumir da vitrine por uma
    // inconsistência temporária entre unidades, situações e tabelas de preço.
    const requiredEnterpriseIds = new Set(['121', '122']);
    for (const enterpriseId of requiredEnterpriseIds) {
      const staged = merged.enterprises.some(e => String(e.id) === enterpriseId);
      if (staged) continue;
      const previousEnterprise = (previousCache.enterprises || []).find(e => String(e.id) === enterpriseId);
      const previousUnits = (previousCache.units || []).filter(u => String(u.enterpriseId) === enterpriseId);
      if (!previousEnterprise || !previousUnits.length) continue;
      merged.enterprises.push(previousEnterprise);
      merged.units.push(...previousUnits);
      console.warn(`[CVCRM] ${previousEnterprise.name} não foi reconstruído; última versão válida preservada.`);
    }
    merged.enterprises.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
    const appraisalErrors = appraisalData.diagnostics.filter(d => !d.ok).map(d => ({ endpoint: `tabela detalhada ${d.enterpriseName}`, message: d.error }));
    const integrity = buildIntegrity(unitsRows, situationRows, priceRows, merged, appraisalErrors);
    integrity.appraisals = {
      enterprisesRequested: appraisalData.diagnostics.length,
      enterprisesOk: appraisalData.diagnostics.filter(d => d.ok).length,
      unitsWithAppraisal: merged.units.filter(u => Number(u.appraisal) > 0).length,
    };

    if (!merged.allUnits.length) {
      throw new Error('O cruzamento final resultou em 0 unidades. O catálogo anterior foi preservado.');
    }
    if (!merged.enterprises.length) {
      throw new Error('O cruzamento final resultou em 0 empreendimentos comerciais. O catálogo anterior foi preservado.');
    }

    const finished = new Date().toISOString();
    const nextCache = {
      lastSync: startedAt,
      lastSuccess: finished,
      status: integrity.warnings.length ? 'warning' : 'ok',
      error: integrity.warnings.join(' | ') || null,
      enterprises: merged.enterprises,
      units: merged.units,
      stats: {
        unitsSource: unitsRows.length,
        situationsSource: situationRows.length,
        pricesSource: priceRows.length,
        allEnterprises: merged.allEnterprises.length,
        commercialEnterprises: merged.enterprises.length,
        unitsNormalized: merged.units.length,
        availableUnits: integrity.availableCount,
        availableWithPrice: integrity.availableWithPriceCount,
        availableWithoutPrice: integrity.availableWithoutPriceCount,
        trigger,
        partial: false,
      },
    };

    writeJson(INTEGRITY_FILE, integrity);
    writeJson(RAW_FILE, {
      at: finished,
      envelope: 'pagina/registros/total_de_registros/total_de_paginas/dados',
      counts: {
        unidades: unitsRows.length,
        situacoes: situationRows.length,
        precos: priceRows.length,
        tabelasDetalhadas: appraisalData.diagnostics.filter(d => d.ok).length,
        unidadesComValorImovel: merged.units.filter(u => Number(u.appraisal) > 0).length,
      },
      samples: {
        unidades: unitsRows.slice(0, 20),
        situacoes: situationRows.slice(0, 20),
        precos: priceRows.slice(0, 20),
      },
      errors: [],
    });

    // Preserva uma cópia antes de publicar o novo catálogo e registra a evolução de preços.
    try { backupFiles('antes-sync'); } catch {}
    // ÚNICO momento em que o catálogo publicado é substituído.
    writeJson(CACHE_FILE, nextCache);
    await persistCatalog(nextCache);
    try { recordPriceHistory(nextCache); } catch (error) { console.warn('[HISTORICO PRECO]', error.message); }

    addHistory(
      'Sincronização CVCRM concluída',
      `${merged.enterprises.length} empreendimentos • ${integrity.availableCount} disponíveis • ${integrity.availableWithPriceCount} com preço`,
      { trigger }
    );

    setProgress({
      phase: 'done',
      label: 'Sincronização concluída',
      endpoint: null,
      currentPage: 0,
      totalPages: 0,
      loaded: merged.units.length,
      totalRecords: merged.units.length,
      retryWaitSeconds: null,
      warning: nextCache.error,
    });

    return { ok: true, ...nextCache.stats, lastSuccess: finished, warning: nextCache.error };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    // Não altera cache.json em caso de erro.
    writeJson(INTEGRITY_FILE, {
      at: new Date().toISOString(),
      published: false,
      preservedPreviousCatalog: true,
      previousLastSuccess: previousCache.lastSuccess || null,
      stagedCounts: {
        unidades: unitsRows.length,
        situacoes: situationRows.length,
        precos: priceRows.length,
        tabelasDetalhadas: appraisalData.diagnostics.filter(d => d.ok).length,
        unidadesComValorImovel: merged.units.filter(u => Number(u.appraisal) > 0).length,
      },
      warnings: [message],
      rateLimit: readRateLimitState(),
    });

    addHistory(
      'Sincronização CVCRM não publicada',
      `${message} • catálogo anterior preservado`,
      { trigger }
    );

    setProgress({
      phase: 'error',
      label: 'Sincronização não publicada',
      warning: `${message} Catálogo anterior preservado.`,
      retryWaitSeconds: null,
    });

    throw error;
  } finally {
    syncing = false;
  }
}

function startSync(trigger = 'manual') {
  if (syncing) {
    return {
      ok: true,
      started: false,
      syncing: true,
      message: 'Já existe uma sincronização em andamento. Nenhuma nova chamada foi criada.',
    };
  }

  syncCvcrm(trigger).catch(error => console.error('[CVCRM]', error.message));
  return {
    ok: true,
    started: true,
    syncing: true,
    message: 'Sincronização segura iniciada em segundo plano.',
  };
}

const storage = multer.diskStorage({
  destination: (_, __, cb) => cb(null, UPLOAD_DIR),
  filename: (_, file, cb) => {
    const ext = path.extname(file.originalname).slice(0, 12);
    cb(null, `${Date.now()}-${crypto.randomBytes(5).toString('hex')}${ext}`);
  },
});
const upload = multer({ storage, limits: { fileSize: 25 * 1024 * 1024 } });

const enterpriseImageStorage = multer.diskStorage({
  destination: (_, __, cb) => cb(null, ENTERPRISE_IMAGE_DIR),
  filename: (req, file, cb) => {
    const sourceName = textValue(req.body?.sourceName, 'empreendimento');
    const extRaw = path.extname(file.originalname || '').toLowerCase();
    const ext = ['.jpg','.jpeg','.png','.webp'].includes(extRaw) ? extRaw : '.jpg';
    cb(null, `${safeSlug(sourceName)}-${Date.now()}${ext}`);
  },
});
const uploadEnterpriseImage = multer({
  storage: enterpriseImageStorage,
  limits: { fileSize: 12 * 1024 * 1024 },
  fileFilter: (_, file, cb) => {
    if (!/^image\/(jpeg|png|webp)$/.test(file.mimetype || '')) return cb(new Error('Envie uma imagem JPG, PNG ou WEBP.'));
    cb(null, true);
  },
});

app.use(express.json({ limit: '2mb' }));
app.use('/api', (req, res, next) => {
  const isAuthorizedCatalogPublish = req.method === 'POST' && req.path === '/cron/publish';
  if (IS_VERCEL && !isAuthorizedCatalogPublish && !['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    return res.status(503).json({
      error: 'A versão publicada na Vercel é somente para consulta. Use a VM para sincronização e administração.',
    });
  }
  next();
});
app.use('/uploads', express.static(UPLOAD_DIR, {
  etag: true,
  lastModified: true,
  maxAge: '1d',
}));
app.use(express.static(path.join(__dirname, 'public'), {
  etag: true,
  lastModified: true,
  setHeaders(res, filePath) {
    if (path.basename(filePath) === 'index.html') {
      res.setHeader('Cache-Control', 'no-cache');
      return;
    }
    res.setHeader('Cache-Control', 'public, max-age=3600, must-revalidate');
  }
}));

app.get('/api/status', async (_, res) => {
  const cache = await readPersistedCatalog();
  const rateLimit = readRateLimitState();
  const blockedUntilMs = rateLimit.blockedUntil ? Date.parse(rateLimit.blockedUntil) : 0;
  const vercelAutoSync = IS_VERCEL && configured() && blobStorageConfigured() && Boolean(process.env.CRON_SECRET);
  res.json({
    readOnly: IS_VERCEL,
    configured: configured(),
    syncing,
    syncProgress,
    rateLimit: {
      ...rateLimit,
      active: Boolean(blockedUntilMs && blockedUntilMs > Date.now()),
      remainingSeconds: blockedUntilMs > Date.now() ? Math.ceil((blockedUntilMs - Date.now()) / 1000) : 0,
    },
    domain: process.env.CVCRM_DOMAIN || null,
    autoSync: {
      enabled: IS_VERCEL
        ? vercelAutoSync
        : String(process.env.CVCRM_AUTO_SYNC || 'true').toLowerCase() === 'true',
      minutes: Math.max(30, Number(process.env.CVCRM_SYNC_MINUTES || 60)),
      scheduler: IS_VERCEL ? 'github-actions' : 'node-interval',
      persistentStorage: IS_VERCEL ? blobStorageConfigured() : true,
    },
    email: process.env.CVCRM_EMAIL || null,
    ...cache,
  });
});
app.get('/api/catalog', async (_, res) => res.json(await readPersistedCatalog()));

app.get('/api/cron/sync', async (req, res) => {
  if (!IS_VERCEL) return res.status(404).json({ error: 'Agendamento disponível somente na Vercel.' });
  if (!cronAuthorized(req)) return res.status(401).json({ error: 'Agendamento não autorizado.' });
  if (!configured()) return res.status(503).json({ error: 'Credenciais do CVCRM não configuradas na Vercel.' });
  if (!blobStorageConfigured()) return res.status(503).json({ error: 'Vercel Blob não configurado.' });
  if (syncing) return res.status(409).json({ error: 'Já existe uma sincronização em andamento.' });
  try {
    const result = await syncCvcrm('github-actions');
    res.json({ ok: true, result });
  } catch (error) {
    console.error('[VERCEL CRON]', error);
    res.status(500).json({ ok: false, error: error instanceof Error ? error.message : String(error) });
  }
});

app.post('/api/cron/publish', async (req, res) => {
  if (!IS_VERCEL) return res.status(404).json({ error: 'Rota disponível apenas na Vercel.' });
  if (!cronAuthorized(req)) return res.status(401).json({ error: 'Não autorizado.' });
  if (!blobStorageConfigured()) return res.status(503).json({ error: 'Vercel Blob não configurado.' });
  const catalog = req.body;
  if (!catalog || typeof catalog !== 'object' || !Array.isArray(catalog.enterprises) || !Array.isArray(catalog.units)) {
    return res.status(400).json({ error: 'Catálogo inválido.' });
  }
  try {
    await persistCatalog(catalog);
    writeJson(CACHE_FILE, catalog);
    res.json({
      ok: true,
      lastSuccess: catalog.lastSuccess || null,
      enterprises: catalog.enterprises.length,
      units: catalog.units.length,
    });
  } catch (error) {
    console.error('[VERCEL PUBLISH]', error);
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});
app.get('/api/integrity', (_, res) => res.json(readJson(INTEGRITY_FILE, { at: null, warnings: ['Ainda não houve sincronização V3.'] })));
app.get('/api/enterprise-links', (_, res) => res.json(readJson(ENTERPRISE_LINKS_FILE, {})));
app.get('/api/payment-plan-rules', (_, res) => res.json(readJson(PAYMENT_PLAN_RULES_FILE, { version: 1, defaultRule: {}, rules: [] })));

app.get('/api/enterprise-media', (_, res) => res.json(readJson(ENTERPRISE_MEDIA_FILE, {})));

app.get('/api/admin/auth', (req,res)=>{
  res.json({authenticated:Boolean(getAdminSession(req))});
});

app.post('/api/admin/login', (req,res)=>{
  const username=textValue(req.body?.username);
  const password=textValue(req.body?.password);
  if(!ADMIN_PASSWORD){
    return res.status(503).json({error:'Defina ADMIN_PASSWORD no arquivo .env antes de usar a Administração.'});
  }
  const uOk=username===ADMIN_USER;
  const pA=Buffer.from(password);
  const pB=Buffer.from(ADMIN_PASSWORD);
  const pOk=pA.length===pB.length && crypto.timingSafeEqual(pA,pB);
  if(!uOk||!pOk)return res.status(401).json({error:'Usuário ou senha inválidos'});
  const sid=crypto.randomBytes(32).toString('hex');
  adminSessions.set(sid,{username,expires:Date.now()+8*60*60*1000});
  res.setHeader('Set-Cookie',`estacao_admin=${sid}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${8*60*60}`);
  res.json({ok:true});
});

app.post('/api/admin/logout', (req,res)=>{
  const sid=parseCookies(req).estacao_admin;
  if(sid)adminSessions.delete(sid);
  res.setHeader('Set-Cookie','estacao_admin=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
  res.json({ok:true});
});

app.get('/api/admin/enterprises', requireAdmin, (_, res) => {
  res.json(enterpriseMediaSummary());
});

app.post('/api/admin/enterprise', requireAdmin, (req, res) => {
  const sourceName = textValue(req.body?.sourceName);
  if (!sourceName) return res.status(400).json({ error: 'Informe o nome de origem do empreendimento.' });
  try { backupFiles('admin-empreendimento'); } catch {}
  const config = readJson(ENTERPRISE_MEDIA_FILE, {});
  const key = normKey(sourceName);
  const prev = config[key] || {};
  config[key] = {
    ...prev,
    sourceName,
    displayName: textValue(req.body?.displayName, sourceName),
    url: textValue(req.body?.url),
    image: textValue(req.body?.image, prev.image || ''),
    visible: req.body?.visible !== false,
    highlights: Array.isArray(req.body?.highlights)
      ? req.body.highlights.map(x => textValue(x)).filter(Boolean).slice(0, 5)
      : prev.highlights || [],
    updatedAt: new Date().toISOString(),
  };
  writeJson(ENTERPRISE_MEDIA_FILE, config);
  addHistory('Empreendimento atualizado', sourceName, { area: 'administracao' });
  res.json(config[key]);
});

app.post('/api/admin/enterprise-image', requireAdmin, uploadEnterpriseImage.single('image'), (req, res) => {
  const sourceName = textValue(req.body?.sourceName);
  if (!sourceName) return res.status(400).json({ error: 'Informe o empreendimento.' });
  if (!req.file) return res.status(400).json({ error: 'Selecione uma imagem.' });
  try { backupFiles('admin-imagem'); } catch {}
  const config = readJson(ENTERPRISE_MEDIA_FILE, {});
  const key = normKey(sourceName);
  const prev = config[key] || {};
  const image = `/assets/empreendimentos/${req.file.filename}`;
  config[key] = {
    ...prev,
    sourceName,
    displayName: textValue(prev.displayName, sourceName),
    image,
    visible: prev.visible !== false,
    highlights: Array.isArray(prev.highlights) ? prev.highlights : [],
    updatedAt: new Date().toISOString(),
  };
  writeJson(ENTERPRISE_MEDIA_FILE, config);
  addHistory('Imagem do empreendimento atualizada', sourceName, { area: 'administracao' });
  res.json({ ok: true, image, config: config[key] });
});

app.get('/api/price-history', (_, res) => {
  const rows = readJson(PRICE_HISTORY_FILE, []);
  const byEnterprise = new Map();
  for (const row of rows) {
    const key = normKey(row.enterpriseName);
    if (!byEnterprise.has(key)) byEnterprise.set(key, []);
    byEnterprise.get(key).push(row);
  }
  const summary = [...byEnterprise.values()].map(list => {
    list.sort((a,b) => Date.parse(a.at) - Date.parse(b.at));
    const latest = list.at(-1);
    const previous = list.length > 1 ? list.at(-2) : null;
    return {
      enterpriseName: latest.enterpriseName,
      latestPrice: latest.lowestPrice,
      previousPrice: previous?.lowestPrice ?? null,
      change: previous ? Number(latest.lowestPrice) - Number(previous.lowestPrice) : 0,
      at: latest.at,
      points: list.slice(-60),
    };
  }).sort((a,b) => a.enterpriseName.localeCompare(b.enterpriseName, 'pt-BR'));
  res.json({ rows, summary });
});

app.get('/api/backups', requireAdmin, (_, res) => {
  const items = fs.readdirSync(BACKUP_DIR, { withFileTypes: true })
    .filter(x => x.isDirectory())
    .map(x => {
      const p = path.join(BACKUP_DIR, x.name);
      return { name: x.name, at: fs.statSync(p).mtime.toISOString() };
    })
    .sort((a,b) => Date.parse(b.at) - Date.parse(a.at));
  res.json(items);
});

app.post('/api/admin/backup', requireAdmin, (_, res) => {
  const folder = backupFiles('manual');
  addHistory('Backup manual criado', path.basename(folder), { area: 'administracao' });
  res.json({ ok: true, name: path.basename(folder) });
});

app.get('/api/qr', async (req, res) => {
  const text = textValue(req.query.text);
  if (!text) return res.status(400).send('Texto não informado');
  try {
    const { default: QRCode } = await import('qrcode');
    const png = await QRCode.toBuffer(text, { type: 'png', width: 220, margin: 1, errorCorrectionLevel: 'M' });
    res.type('png').set('Cache-Control', 'public, max-age=86400').send(png);
  } catch (error) {
    res.status(500).json({ error: 'Componente de QR Code não instalado. Execute ATUALIZAR_DEPENDENCIAS.bat.', detail: error.message });
  }
});
app.get('/api/history', (_, res) => res.json(readJson(HISTORY_FILE, [])));
app.post('/api/sync', requireAdmin, (_, res) => {
  try { res.status(202).json(startSync('manual')); }
  catch (e) { res.status(500).json({ ok: false, error: e instanceof Error ? e.message : String(e) }); }
});
app.get('/api/materials', (_, res) => res.json(readJson(MATERIALS_FILE, [])));
app.post('/api/materials', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Selecione um arquivo.' });
  const materials = readJson(MATERIALS_FILE, []);
  const item = {
    id: crypto.randomUUID(), title: textValue(req.body.title, req.file.originalname),
    category: textValue(req.body.category, 'outro'), enterpriseId: textValue(req.body.enterpriseId), enterpriseName: textValue(req.body.enterpriseName),
    fileName: req.file.originalname, url: `/uploads/${req.file.filename}`, size: req.file.size, mimeType: req.file.mimetype, createdAt: new Date().toISOString(),
  };
  materials.unshift(item); writeJson(MATERIALS_FILE, materials); addHistory('Material publicado', item.title); res.json(item);
});
app.delete('/api/materials/:id', (req, res) => {
  const materials = readJson(MATERIALS_FILE, []); const item = materials.find(m => m.id === req.params.id);
  if (!item) return res.status(404).json({ error: 'Material não encontrado.' });
  const filename = path.basename(item.url || '');
  try { if (filename) fs.unlinkSync(path.join(UPLOAD_DIR, filename)); } catch {}
  writeJson(MATERIALS_FILE, materials.filter(m => m.id !== req.params.id)); addHistory('Material removido', item.title); res.json({ ok: true });
});
app.get('/api/export/catalog.json', (_, res) => res.download(CACHE_FILE, 'catalogo-estacao1.json'));

app.get('*', (_, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

if (!IS_VERCEL && !SYNC_ONCE_MODE) {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[ESTACAO 1] Portal iniciado em http://localhost:${PORT}`);
    console.log(`[ESTACAO 1] Login do portal: desativado`);
    console.log(`[CVCRM] ${configured() ? 'Configurado' : 'Pendente de configuração'}`);
    if (configured()) console.log('[CVCRM] Sincronizacao automatica configurada pelo servidor.');
  });
}

const autoSyncEnabled = !IS_VERCEL && !SYNC_ONCE_MODE && String(process.env.CVCRM_AUTO_SYNC || 'true').toLowerCase() === 'true';
const minutes = Math.max(30, Number(process.env.CVCRM_SYNC_MINUTES || 60));
const startupDelayMs = Math.max(15000, Number(process.env.CVCRM_STARTUP_SYNC_DELAY_MS || 30000));

if (autoSyncEnabled) {
  console.log(`[CVCRM] Sincronização automática habilitada a cada ${minutes} minutos.`);
  console.log(`[CVCRM] Primeira sincronização automática em ${Math.round(startupDelayMs / 1000)} segundos.`);
  setTimeout(() => { if (configured()) startSync('automatic-startup'); }, startupDelayMs);
  setInterval(() => { if (configured()) startSync('automatic'); }, minutes * 60 * 1000);
} else {
  console.log('[CVCRM] Sincronização automática desativada.');
}

if (SYNC_ONCE_MODE) {
  const publishUrl = String(process.env.VERCEL_PUBLISH_URL || '').trim();
  const publishSecret = String(process.env.CRON_SECRET || '');
  if (!publishUrl || !publishSecret) {
    throw new Error('VERCEL_PUBLISH_URL e CRON_SECRET são obrigatórios no modo --sync-once.');
  }

  const result = await syncCvcrm('github-actions');
  const catalog = readJson(CACHE_FILE, emptyCache);
  const response = await fetch(publishUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${publishSecret}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(catalog),
    signal: AbortSignal.timeout(120000),
  });
  const responseText = await response.text();
  if (!response.ok) {
    throw new Error(`Falha ao publicar catálogo na Vercel (HTTP ${response.status}): ${responseText.slice(0, 500)}`);
  }
  console.log(`[CVCRM] Sincronização e publicação concluídas: ${result.unitsNormalized} unidades.`);
}

export default app;
