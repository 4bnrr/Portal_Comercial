import assert from 'node:assert/strict';
import { calculatePaymentPlan } from './public/payment-plan-core.js';

const baseInput={sale:200000,appraisal:210000,financingApproved:168000,subsidy:0,maxFinancingPercent:80};
const standard={id:'padrao',name:'Regra padrão',remunerationType:'percentual',realEstatePercent:3.5,fixedCommission:0,coordinationPercent:0,totalRiskLimitPercent:13.5,maxBuilderPercent:10};
const atlanta={id:'atlanta',name:'Atlanta 2 — casas',remunerationType:'fixed',realEstatePercent:0,fixedCommission:12000,coordinationPercent:0.585,totalRiskLimitPercent:13.5,maxBuilderPercent:10};
const acqua={id:'acqua',name:'Acqua América — sem varanda',remunerationType:'fixed',realEstatePercent:0,fixedCommission:10000,coordinationPercent:0.585,totalRiskLimitPercent:13.5,maxBuilderPercent:10};

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

console.log('OK — Regra padrão:', {limite:s.maxPlanCapacity, entrada:s.entryRequired, recursoProprio:s.ownResourcesMinimum, imobiliaria:s.realEstateCommission, construtora:s.builderRisk});
console.log('OK — Atlanta:', {comissao:a.realEstateCommission, coordenacao:a.coordination, construtora:a.builderRisk, total:a.realEstateCommission+a.coordination+a.builderRisk});
console.log('OK — Acqua América:', {comissao:q.realEstateCommission, coordenacao:q.coordination, construtora:q.builderRisk, total:q.realEstateCommission+q.coordination+q.builderRisk});
