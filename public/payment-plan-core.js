export function normalizeText(value='') {
  return String(value ?? '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g,'')
    .toLowerCase().replace(/\s+/g,' ').trim();
}

function activeOnDate(rule, now = new Date()) {
  if (rule?.enabled === false) return false;
  const today = now.toISOString().slice(0,10);
  if (rule?.validFrom && today < String(rule.validFrom).slice(0,10)) return false;
  if (rule?.validUntil && today > String(rule.validUntil).slice(0,10)) return false;
  return true;
}

function matchesAny(text, patterns = []) {
  if (!Array.isArray(patterns) || patterns.length === 0) return true;
  const t = normalizeText(text);
  return patterns.some(p => t.includes(normalizeText(p)));
}

export function selectPaymentRule(config, context, now = new Date()) {
  const rules = Array.isArray(config?.rules) ? config.rules : [];
  for (const rule of rules) {
    if (!activeOnDate(rule, now)) continue;
    if (!matchesAny(context?.enterpriseName, rule.enterprisePatterns)) continue;
    const typologyMatch = matchesAny(context?.typology, rule.typologyPatterns);
    const developmentMatch = matchesAny(context?.developmentType, rule.developmentTypePatterns);
    const needsTypology = Array.isArray(rule.typologyPatterns) && rule.typologyPatterns.length > 0;
    const needsDevelopment = Array.isArray(rule.developmentTypePatterns) && rule.developmentTypePatterns.length > 0;
    // If both selectors exist, either one may qualify the unit. This allows horizontal/casas
    // to be recognized even when the commercial label is a QUADRA.
    if (needsTypology || needsDevelopment) {
      if (!((needsTypology && typologyMatch) || (needsDevelopment && developmentMatch))) continue;
    }
    return rule;
  }
  return config?.defaultRule || {
    id:'padrao', name:'Regra padrão', remunerationType:'percentual', realEstatePercent:3.5,
    fixedCommission:0, coordinationPercent:0, totalRiskLimitPercent:13.5,
    maxBuilderPercent:10, enabled:true
  };
}

export function calculatePaymentPlan(input, rule) {
  const sale = Math.max(0, Number(input?.sale) || 0);
  const appraisal = Math.max(0, Number(input?.appraisal) || 0);
  const financingApproved = Math.max(0, Number(input?.financingApproved) || 0);
  const subsidy = Math.max(0, Number(input?.subsidy) || 0);
  const maxFinancingPercent = Math.max(0, Number(input?.maxFinancingPercent) || 80);

  const appraisalFinancingLimit = appraisal > 0 ? appraisal * (maxFinancingPercent / 100) : 0;
  const financingEffective = appraisal > 0
    ? Math.min(financingApproved, appraisalFinancingLimit)
    : 0;

  const entryRequired = Math.max(0, sale - financingEffective - subsidy);
  const totalRiskPercent = Math.max(0, Number(rule?.totalRiskLimitPercent) || 13.5);
  const maxPlanCapacity = Math.max(0, sale * totalRiskPercent / 100);

  const remunerationType = rule?.remunerationType === 'fixed' ? 'fixed' : 'percentual';
  const realEstateCommission = remunerationType === 'fixed'
    ? Math.max(0, Number(rule?.fixedCommission) || 0)
    : Math.max(0, sale * (Number(rule?.realEstatePercent) || 0) / 100);
  const coordination = Math.max(0, sale * (Number(rule?.coordinationPercent) || 0) / 100);

  let builderRisk;
  if (remunerationType === 'fixed') {
    builderRisk = maxPlanCapacity - realEstateCommission - coordination;
  } else {
    const configuredMax = Math.max(0, sale * (Number(rule?.maxBuilderPercent) || 0) / 100);
    builderRisk = Math.min(configuredMax, maxPlanCapacity - realEstateCommission - coordination);
  }

  const remunerationExceedsLimit = builderRisk < -0.005;
  builderRisk = Math.max(0, builderRisk);
  const ownResourcesMinimum = Math.max(0, entryRequired - maxPlanCapacity);
  const status = entryRequired <= maxPlanCapacity + 0.005
    ? 'ENTRADA DENTRO DO PLANO'
    : 'RECURSO PRÓPRIO NECESSÁRIO';

  return {
    sale, appraisal, financingApproved, financingEffective, subsidy,
    maxFinancingPercent, appraisalFinancingLimit, entryRequired,
    totalRiskPercent, maxPlanCapacity, remunerationType,
    realEstateCommission, coordination, builderRisk,
    ownResourcesMinimum, status, remunerationExceedsLimit,
    ruleId: rule?.id || 'padrao', ruleName: rule?.name || 'Regra padrão'
  };
}
