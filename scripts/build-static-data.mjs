import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const dataDir = path.join(root, 'data');
const outputDir = path.join(root, 'public', 'data');

function readJson(name, fallback) {
  try {
    return JSON.parse(fs.readFileSync(path.join(dataDir, name), 'utf8'));
  } catch {
    return fallback;
  }
}

function normKey(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function buildPriceHistory(rows) {
  const groups = new Map();
  for (const row of rows) {
    const key = normKey(row.enterpriseName);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  const summary = [...groups.values()].map(list => {
    list.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
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
  }).sort((a, b) => a.enterpriseName.localeCompare(b.enterpriseName, 'pt-BR'));
  return { rows, summary };
}

const emptyCatalog = {
  lastSync: null, lastSuccess: null, status: 'not_configured', enterprises: [], units: [], stats: {},
};
const outputFile = path.join(outputDir, 'bootstrap.json');
let existing = null;
try { existing = JSON.parse(fs.readFileSync(outputFile, 'utf8')); } catch {}

function catalogFreshness(catalog) {
  const value = Date.parse(catalog?.lastSuccess || catalog?.lastSync || 0);
  return Number.isFinite(value) ? value : 0;
}

// Em estações locais, data/cache.json pode ficar mais antigo que o catálogo
// estático já publicado. Nunca permita que uma alteração visual faça o portal
// regredir para essa cópia antiga. No GitHub Actions, a consulta recém-concluída
// continua vencendo por possuir o lastSuccess mais recente.
const sourceCatalog = [
  readJson('cache.json', null),
  readJson('vercel-cache.json', null),
  existing?.catalog || null,
].filter(Boolean).sort((a, b) => catalogFreshness(b) - catalogFreshness(a))[0] || emptyCatalog;
const catalogCandidates = [
  sourceCatalog,
  readJson('cache.json', null),
  readJson('vercel-cache.json', null),
  existing?.catalog || null,
].filter(Boolean);

function appraisalFallbacks(catalogs) {
  const byUnit = new Map();
  const byVertexFloor = new Map();
  for (const catalog of catalogs) {
    for (const unit of catalog.units || []) {
      const appraisal = Number(unit.appraisal);
      if (!(appraisal > 0)) continue;
      const exactKey = `${unit.enterpriseId}:${unit.id}`;
      if (!byUnit.has(exactKey)) byUnit.set(exactKey, appraisal);
      if (normKey(unit.enterpriseName).includes('vertexgetulio')) {
        const floorKey = `${unit.enterpriseId}:${unit.commercialType || 'Padrão'}:${unit.floor}`;
        if (!byVertexFloor.has(floorKey)) byVertexFloor.set(floorKey, new Set());
        byVertexFloor.get(floorKey).add(appraisal);
      }
    }
  }
  return { byUnit, byVertexFloor };
}

function withPreservedAppraisal(unit, fallbacks) {
  if (Number(unit.appraisal) > 0) return unit;
  const exact = fallbacks.byUnit.get(`${unit.enterpriseId}:${unit.id}`);
  if (exact > 0) return { ...unit, appraisal: exact };
  if (!normKey(unit.enterpriseName).includes('vertexgetulio')) return unit;
  const values = [...(fallbacks.byVertexFloor.get(`${unit.enterpriseId}:${unit.commercialType || 'Padrão'}:${unit.floor}`) || [])];
  return values.length === 1 ? { ...unit, appraisal: values[0] } : unit;
}

const appraisalFallbackIndex = appraisalFallbacks(catalogCandidates);
const enterpriseMedia = readJson('enterprise-media.json', {});
const hiddenNames = new Set(['aracastreetmall', 'testepagadoria', 'atlantaresidencepark', 'allegroresidence', 'acquaventureamerica']);
const enterprises = (sourceCatalog.enterprises || []).filter(enterprise => {
  const key = normKey(enterprise.name);
  return Number(enterprise.unidades_disponiveis ?? enterprise.availableUnits) > 0
    && !hiddenNames.has(key)
    && enterpriseMedia[key]?.visible !== false;
});
const visibleEnterpriseIds = new Set(enterprises.map(enterprise => String(enterprise.id)));
const units = (sourceCatalog.units || [])
  .filter(unit => unit.status === 'disponivel' && visibleEnterpriseIds.has(String(unit.enterpriseId)))
  .map(unit => withPreservedAppraisal(unit, appraisalFallbackIndex));
const catalog = { ...sourceCatalog, enterprises, units };
const priceRows = readJson('price-history.json', []);
const bootstrap = {
  generatedAt: new Date().toISOString(),
  catalog: { ...catalog, readOnly: true, syncing: false },
  enterpriseLinks: readJson('enterprise-links.json', {}),
  paymentPlanRules: readJson('payment-plan-rules.json', { version: 1, defaultRule: {}, rules: [] }),
  enterpriseMedia,
  priceHistory: buildPriceHistory(priceRows),
};

function deploymentSignature(value) {
  const historySummary = (value?.priceHistory?.summary || []).map(row => ({
    enterpriseName: row.enterpriseName,
    latestPrice: row.latestPrice,
    previousPrice: row.previousPrice,
    change: row.change,
  }));
  return JSON.stringify({
    enterprises: value?.catalog?.enterprises || [],
    units: value?.catalog?.units || [],
    enterpriseLinks: value?.enterpriseLinks || {},
    paymentPlanRules: value?.paymentPlanRules || {},
    enterpriseMedia: value?.enterpriseMedia || {},
    historySummary,
  });
}

fs.mkdirSync(outputDir, { recursive: true });

if (existing && deploymentSignature(existing) === deploymentSignature(bootstrap)) {
  console.log(`Catálogo sem alterações públicas: ${bootstrap.catalog.enterprises.length} empreendimentos, ${bootstrap.catalog.units.length} unidades.`);
} else {
  fs.writeFileSync(outputFile, JSON.stringify(bootstrap));
  console.log(`Catálogo estático atualizado: ${bootstrap.catalog.enterprises.length} empreendimentos, ${bootstrap.catalog.units.length} unidades.`);
}
