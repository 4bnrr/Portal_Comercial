import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { calculatePaymentPlan, selectPaymentRule } from './public/payment-plan-core.js';

const baseInput={sale:200000,appraisal:210000,financingApproved:168000,subsidy:0,maxFinancingPercent:80};
const standard={id:'padrao',name:'Regra padrão',remunerationType:'percentual',realEstatePercent:3.5,fixedCommission:0,coordinationPercent:0,totalRiskLimitPercent:13.5,maxBuilderPercent:10};
const atlanta={id:'atlanta',name:'Atlanta 2 — casas',remunerationType:'fixed',realEstatePercent:0,fixedCommission:12000,coordinationPercent:0.585,totalRiskLimitPercent:13.5,maxBuilderPercent:10};
const acqua={id:'acqua',name:'Acqua América — sem varanda',remunerationType:'fixed',realEstatePercent:0,fixedCommission:10000,coordinationPercent:0.585,totalRiskLimitPercent:13.5,maxBuilderPercent:10};
const configuredRules=JSON.parse(await readFile(new URL('./data/payment-plan-rules.json',import.meta.url),'utf8'));
const publishedCatalog=JSON.parse(await readFile(new URL('./public/data/bootstrap.json',import.meta.url),'utf8'));
const portalApp=await readFile(new URL('./public/app.js',import.meta.url),'utf8');

const s=calculatePaymentPlan(baseInput,standard);
assert.equal(s.maxPlanCapacity,27000);
assert.equal(s.entryRequired,32000);
assert.equal(s.ownResourcesMinimum,5000);
assert.equal(s.realEstateCommission,7000);
assert.equal(s.builderRisk,20000);

const a=calculatePaymentPlan(baseInput,atlanta);
assert.equal(a.maxPlanCapacity,27000);
assert.equal(a.realEstateCommission,12000);
assert.equal(a.coordination,1170);
assert.equal(a.builderRisk,13830);

const q=calculatePaymentPlan(baseInput,acqua);
assert.equal(q.maxPlanCapacity,27000);
assert.equal(q.realEstateCommission,10000);
assert.equal(q.coordination,1170);
assert.equal(q.builderRisk,15830);

const vertexRule=selectPaymentRule(configuredRules,{enterpriseName:'Vertex Getulio',typology:'Sem varanda',developmentType:'Vertical - Apartamento'});
assert.equal(vertexRule.id,'vertex-getulio');
assert.equal(vertexRule.totalRiskLimitPercent,7);
const vertex=calculatePaymentPlan(baseInput,vertexRule);
assert.equal(vertex.maxPlanCapacity,14000);
assert.equal(vertex.realEstateCommission,7000);
assert.equal(vertex.builderRisk,7000);
assert.equal(vertex.ownResourcesMinimum,18000);
const fragaRule=selectPaymentRule(configuredRules,{enterpriseName:'Residencial Vertex Fraga Maia',typology:'Com varanda 1º andar',developmentType:'Vertical - Apartamento'});
assert.equal(fragaRule.id,'padrao','O Vertex Fraga Maia mantém a regra financeira padrão.');
const availableVertexUnits=publishedCatalog.catalog.units.filter(unit=>String(unit.enterpriseId)==='121'&&unit.status==='disponivel');
assert.ok(availableVertexUnits.length>0,'O catálogo deve publicar unidades disponíveis do Vertex Getúlio.');
assert.equal(
  availableVertexUnits.filter(unit=>Number(unit.appraisal)>0).length,
  availableVertexUnits.length,
  'Todas as unidades publicadas do Vertex Getúlio devem possuir valor de avaliação.'
);
const availableFragaUnits=publishedCatalog.catalog.units.filter(unit=>String(unit.enterpriseId)==='123'&&unit.status==='disponivel');
assert.ok(availableFragaUnits.length>0,'O catálogo deve preservar as unidades do Vertex Fraga Maia para a flag da Vercel.');
const availableAzureUnits=publishedCatalog.catalog.units.filter(unit=>String(unit.enterpriseId)==='124'&&unit.status==='disponivel');
assert.equal(
  Math.min(...availableAzureUnits.filter(unit=>Number(unit.price)>0).map(unit=>Number(unit.price))),
  159990,
  'O Azure Fraga Maia deve ser publicado a partir de R$ 159.990,00.'
);
assert.equal(
  publishedCatalog.catalog.enterprises.find(enterprise=>String(enterprise.id)==='124')?.lowestPrice,
  159990,
  'O cartão do Azure Fraga Maia deve exibir o menor preço publicado.'
);
const azureReference=availableAzureUnits.find(unit=>unit.code==='AFM.01.1.1');
assert.equal(azureReference?.price,159990,'A unidade de referência do Azure deve usar o valor de venda da tabela completa.');
assert.equal(azureReference?.appraisal,222000,'A unidade de referência do Azure deve usar a avaliação da tabela completa.');
const azureCorrectedUnit=availableAzureUnits.find(unit=>unit.code==='AFM.01.1.416');
assert.equal(azureCorrectedUnit?.price,215990,'O ajuste provisório não deve permanecer associado à unidade 416.');
assert.equal(azureCorrectedUnit?.appraisal,245000,'A unidade 416 deve manter a avaliação correspondente da tabela completa.');
assert.equal(
  publishedCatalog.catalog.enterprises.some(enterprise=>String(enterprise.id)==='123'),
  true,
  'O catálogo deve preservar o Vertex Fraga Maia para ativação em tempo de execução.'
);
assert.equal(
  publishedCatalog.enterpriseMedia.residencialvertexfragamaia?.visible,
  false,
  'A configuração temporária de visibilidade do Vertex Fraga Maia deve permanecer desativada.'
);
assert.match(portalApp,/vertexFragaMaiaVisible:\s*false/,'A flag deve iniciar desligada quando a Vercel estiver indisponível.');
assert.match(portalApp,/api\/public-config/,'O portal deve consultar a configuração pública da Vercel.');

console.log('OK — Regra padrão:', {limite:s.maxPlanCapacity, entrada:s.entryRequired, recursoProprio:s.ownResourcesMinimum, imobiliaria:s.realEstateCommission, construtora:s.builderRisk});
console.log('OK — Atlanta:', {comissao:a.realEstateCommission, coordenacao:a.coordination, construtora:a.builderRisk, total:a.realEstateCommission+a.coordination+a.builderRisk});
console.log('OK — Acqua América:', {comissao:q.realEstateCommission, coordenacao:q.coordination, construtora:q.builderRisk, total:q.realEstateCommission+q.coordination+q.builderRisk});
console.log('OK — Vertex Getúlio:', {limite:vertex.maxPlanCapacity, imobiliaria:vertex.realEstateCommission, construtora:vertex.builderRisk, recursoProprio:vertex.ownResourcesMinimum});
console.log('OK — Avaliações do Vertex:', {unidades:availableVertexUnits.length, comAvaliacao:availableVertexUnits.filter(unit=>Number(unit.appraisal)>0).length});
console.log('OK — Vertex Fraga Maia preservado e controlado pela flag da Vercel.');
console.log('OK — Azure Fraga Maia a partir de R$ 159.990,00.');
