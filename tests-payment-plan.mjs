import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { calculatePaymentPlan, selectPaymentRule } from './public/payment-plan-core.js';

const baseInput={sale:200000,appraisal:210000,financingApproved:168000,subsidy:0,maxFinancingPercent:80};
const standard={id:'padrao',name:'Regra padrão',remunerationType:'percentual',realEstatePercent:3.5,fixedCommission:0,coordinationPercent:0,totalRiskLimitPercent:13.5,maxBuilderPercent:10};
const atlanta={id:'atlanta',name:'Atlanta 2 — casas',remunerationType:'fixed',realEstatePercent:0,fixedCommission:12000,coordinationPercent:0.585,totalRiskLimitPercent:13.5,maxBuilderPercent:10};
const acqua={id:'acqua',name:'Acqua América — sem varanda',remunerationType:'fixed',realEstatePercent:0,fixedCommission:10000,coordinationPercent:0.585,totalRiskLimitPercent:13.5,maxBuilderPercent:10};
const configuredRules=JSON.parse(await readFile(new URL('./data/payment-plan-rules.json',import.meta.url),'utf8'));

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

console.log('OK — Regra padrão:', {limite:s.maxPlanCapacity, entrada:s.entryRequired, recursoProprio:s.ownResourcesMinimum, imobiliaria:s.realEstateCommission, construtora:s.builderRisk});
console.log('OK — Atlanta:', {comissao:a.realEstateCommission, coordenacao:a.coordination, construtora:a.builderRisk, total:a.realEstateCommission+a.coordination+a.builderRisk});
console.log('OK — Acqua América:', {comissao:q.realEstateCommission, coordenacao:q.coordination, construtora:q.builderRisk, total:q.realEstateCommission+q.coordination+q.builderRisk});
console.log('OK — Vertex Getúlio:', {limite:vertex.maxPlanCapacity, imobiliaria:vertex.realEstateCommission, construtora:vertex.builderRisk, recursoProprio:vertex.ownResourcesMinimum});
