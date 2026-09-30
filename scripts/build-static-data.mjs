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

const sourceCatalog = readJson('cache.json', readJson('vercel-cache.json', {
  lastSync: null, lastSuccess: null, status: 'not_configured', enterprises: [], units: [], stats: {},
}));
const enterpriseMedia = readJson('enterprise-media.json', {});
const hiddenNames = new Set(['aracastreetmall', 'testepagadoria', 'atlantaresidencepark', 'allegroresidence', 'acquaventureamerica']);
const enterprises = (sourceCatalog.enterprises || []).filter(enterprise => {
  const key = normKey(enterprise.name);
  return Number(enterprise.unidades_disponiveis ?? enterprise.availableUnits) > 0
    && !hiddenNames.has(key)
    && enterpriseMedia[key]?.visible !== false;
});
const visibleEnterpriseIds = new Set(enterprises.map(enterprise => String(enterprise.id)));
const units = (sourceCatalog.units || []).filter(unit =>
  unit.status === 'disponivel' && visibleEnterpriseIds.has(String(unit.enterpriseId))
);
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

fs.mkdirSync(outputDir, { recursive: true });
fs.writeFileSync(path.join(outputDir, 'bootstrap.json'), JSON.stringify(bootstrap));
console.log(`Catálogo estático gerado: ${bootstrap.catalog.enterprises.length} empreendimentos, ${bootstrap.catalog.units.length} unidades.`);
