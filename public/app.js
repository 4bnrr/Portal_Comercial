import { selectPaymentRule, calculatePaymentPlan } from './payment-plan-core.js?v=20.0';
const app = document.querySelector('#app');
const toastEl = document.querySelector('#toast');
let catalog = { enterprises: [], units: [], status: 'not_configured', stats: {} };
let materials = [];
let history = [];
let enterpriseLinks = {};
let paymentPlanRules = { version: 1, defaultRule: {}, rules: [] };
let lastSimulation = null;
let selectedSimulationUnit = null;
let lastSimulationResults = [];
let integrity = {};
let enterpriseMediaConfig = {};
let priceHistory = { rows: [], summary: [] };
let adminEnterpriseData = { entries: [], pending: [] };
let backups = [];
let readOnlyPortal = false;
let staticPortal = false;


const fmtBRL = value => value == null || Number.isNaN(Number(value)) ? '—' : Number(value).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const fmtDate = value => value ? new Date(value).toLocaleString('pt-BR') : '—';
const escapeHtml = s => String(s ?? '').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const toast = (msg,error=false) => { toastEl.textContent=msg;toastEl.className='toast show'+(error?' error':'');setTimeout(()=>toastEl.className='toast',3500); };
async function api(url, options={}) { const r=await fetch(url,options); const j=await r.json().catch(()=>({})); if(!r.ok) throw new Error(j.error||j.message||`Erro ${r.status}`); return j; }
async function loadAll(){
  if(location.hostname.endsWith('.vercel.app')){
    const bootstrap=await api('/data/bootstrap.json',{cache:'no-store'});
    catalog=bootstrap.catalog||catalog;
    enterpriseLinks=bootstrap.enterpriseLinks||{};
    paymentPlanRules=bootstrap.paymentPlanRules||paymentPlanRules;
    enterpriseMediaConfig=bootstrap.enterpriseMedia||{};
    priceHistory=bootstrap.priceHistory||priceHistory;
    readOnlyPortal=true;
    staticPortal=true;
    document.querySelector('nav a[data-route="administracao"]')?.remove();
    updateHeader();
    return;
  }
  [catalog,enterpriseLinks,paymentPlanRules,enterpriseMediaConfig,priceHistory]=await Promise.all([
    api('/api/catalog'),
    api('/api/enterprise-links'),
    api('/api/payment-plan-rules'),
    api('/api/enterprise-media'),
    api('/api/price-history')
  ]);
  try{catalog={...catalog,...await api('/api/status')}}catch{}
  readOnlyPortal=Boolean(catalog.readOnly);
  if(readOnlyPortal)document.querySelector('nav a[data-route="administracao"]')?.remove();
  if(!readOnlyPortal){try{[adminEnterpriseData,backups]=await Promise.all([api('/api/admin/enterprises'),api('/api/backups')])}catch{}}
  updateHeader();
}
function updateHeader(){
  const el=document.querySelector('#headerStatus');if(!el)return;
  const ok=catalog.status==='ok'||catalog.status==='warning';
  const sync=catalog.syncing;
  const age=catalog.lastSuccess?timeAgo(catalog.lastSuccess):'sem sincronização';
  el.className='sync-pill '+(ok?'ok':catalog.status==='error'?'error':'');
  el.title=`Última atualização: ${fmtDate(catalog.lastSuccess)}`;
  el.innerHTML=`<span></span>${sync?'Sincronizando':ok?`CVCRM • ${age}`:catalog.status==='error'?'Falha CVCRM':'CVCRM pendente'}`;
}
function timeAgo(value){
  if(!value)return '—';
  const diff=Math.max(0,Date.now()-new Date(value).getTime()),m=Math.floor(diff/60000);
  if(m<1)return 'agora';
  if(m<60)return `há ${m} min`;
  const h=Math.floor(m/60);if(h<24)return `há ${h}h`;
  return `há ${Math.floor(h/24)}d`;
}
function statusBadge(status){return `<span class="badge ${escapeHtml(status)}">${escapeHtml(status||'indisponível')}</span>`}
function pageHead(eyebrow,title,description){return `<section class="page-head"><div class="container"><div class="eyebrow">${eyebrow}</div><h1>${title}</h1><p>${description}</p></div></section>`}
// A disponibilidade vem do catálogo; apenas cadastros que não pertencem à
// vitrine residencial ficam protegidos também na interface.
function isHiddenEnterprise(name){const n=String(name||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]/g,'');return ['aracastreetmall','testepagadoria','atlantaresidencepark','allegroresidence','acquaventureamerica'].includes(n)}
function availableUnits(){return catalog.units.filter(u=>u.status==='disponivel'&&!isHiddenEnterprise(u.enterpriseName)&&enterpriseMedia(u.enterpriseName).visible)}
function simulatorUnits(){return availableUnits().filter(u=>Number(u.price)>0)}
function enterpriseDetailUrl(e){return enterpriseLinks[String(e.id)]||enterpriseLinks[e.name]||''}
function home(){
  const available=availableUnits(),visible=visibleEnterprises();
  const priced=available.filter(u=>Number(u.price)>0);
  const lowUnit=priced.slice().sort((a,b)=>Number(a.price)-Number(b.price))[0];
  const low=lowUnit?.price;
  const syncOk=catalog.status==='ok'||catalog.status==='warning';
  return `
<section class="hero hero-refined"><div class="container hero-grid hero-grid-refined"><div><div class="eyebrow">inteligência para a jornada comercial</div><h1>O ponto de partida para decisões imobiliárias mais claras.</h1><p>Consulte empreendimentos, unidades disponíveis, valores e condições em uma interface comercial simples e padronizada. Os dados são atualizados automaticamente pelo CVCRM.</p><div class="buttons"><a class="btn primary" href="#empreendimentos">Explorar empreendimentos →</a><a class="btn secondary" href="#simulador">▦ Simular entrada</a></div></div><aside class="hero-card hero-card-refined"><div class="eyebrow">painel comercial</div><h2>Informação comercial clara e centralizada.</h2><div class="hero-list"><div><b>Tabelas e unidades</b><small>Somente disponibilidade comercial atual.</small></div><div><b>Simulação comercial</b><small>Entrada estimada por unidade disponível.</small></div><div><b>Atualização automática</b><small>Dados sincronizados periodicamente com o CVCRM.</small></div></div></aside></div></section>
<section class="section home-dashboard"><div class="container">
  <div class="metrics metrics-refined metrics-dashboard">
    <div class="metric"><label>Empreendimentos</label><strong>${visible.length}</strong><p>Com unidades disponíveis agora.</p></div>
    <div class="metric"><label>Unidades disponíveis</label><strong>${available.length}</strong><p>Situação atual = Disponível.</p></div>
    <div class="metric"><label>Menor valor</label><strong>${fmtBRL(low)}</strong><p>${lowUnit?escapeHtml(enterpriseDisplayName(lowUnit.enterpriseName)):'Sem preço disponível'}</p></div>
  </div>
</div></section>`}

function visibleEnterprises(){
  return catalog.enterprises
    .filter(e=>Number(e.unidades_disponiveis??e.availableUnits)>0)
    .filter(e=>!isHiddenEnterprise(e.name))
    .filter(e=>enterpriseMedia(e.name).visible)
    .sort((a,b)=>String(a.name||'').localeCompare(String(b.name||''),'pt-BR'));
}


function normalizeEnterpriseName(name){
  return String(name||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]/g,'');
}
function enterpriseMedia(name){
  const n=normalizeEnterpriseName(name);
  const cfg=enterpriseMediaConfig[n]||{};
  return {
    image:cfg.image||'/assets/empreendimentos/placeholder.svg',
    imageFit:cfg.imageFit==='contain'?'contain':'cover',
    url:cfg.url||'',
    displayName:cfg.displayName||name,
    visible:cfg.visible!==false,
    highlights:Array.isArray(cfg.highlights)?cfg.highlights:[]
  };
}
function enterpriseImageUrl(name){return enterpriseMedia(name).image}
function enterpriseDisplayName(name){return enterpriseMedia(name).displayName||name}
function enterpriseOfficialUrl(name){
  const media=enterpriseMedia(name);
  if(media.url)return media.url;
  const e=catalog.enterprises.find(x=>normalizeEnterpriseName(x.name)===normalizeEnterpriseName(name));
  return e?enterpriseDetailUrl(e):'';
}

function enterprises(){
  const ents=visibleEnterprises();
  return pageHead(
    'Portfólio comercial',
    'Empreendimentos',
    'Conheça os empreendimentos disponíveis e acesse os detalhes de cada projeto.'
  )+`<section class="section enterprises-section enterprise-gallery-section"><div class="container">
    ${ents.length?`<div class="cards enterprise-cards enterprise-gallery">
      ${ents.map((e,i)=>{
        const media=enterpriseMedia(e.name);
        const link=enterpriseDetailUrl(e)||media.url;
        const image=media.image;
        return `<article class="card enterprise-card enterprise-photo-card">
          <div class="enterprise-photo-wrap">
            ${image
              ? `<img class="enterprise-photo${media.imageFit==='contain'?' enterprise-photo--contain':''}" src="${escapeHtml(image)}" alt="${escapeHtml(e.name)}" loading="lazy" referrerpolicy="no-referrer" onerror="this.onerror=null;this.src='/assets/empreendimentos/placeholder.svg'">`
              : ''}
            <div class="enterprise-photo-overlay"></div>
            <div class="enterprise-photo-badges">
              <span class="enterprise-index">Empreendimento ${String(i+1).padStart(2,'0')}</span>
              <span class="enterprise-status-dot">Disponível</span>
            </div>
          </div>
          <div class="enterprise-card-body">
            <h3>${escapeHtml(media.displayName||e.name)}</h3>${media.highlights.length?`<div class="enterprise-highlights">${media.highlights.map(h=>`<span>${escapeHtml(h)}</span>`).join('')}</div>`:''}${(!media.image||media.image.includes('placeholder'))?`<div class="enterprise-auto-note">Cadastro visual pendente</div>`:''}
            <div class="enterprise-price">
              <small>A partir de</small>
              <strong>${fmtBRL(e.lowestPrice)}</strong>
            </div>
            ${link
              ? `<a href="${escapeHtml(link)}" target="_blank" rel="noopener" class="btn secondary enterprise-detail-btn">Ver detalhes <span>→</span></a>`
              : `<button class="btn secondary enterprise-detail-btn" disabled>Ver detalhes <span>→</span></button>`}
          </div>
        </article>`;
      }).join('')}
    </div>`:'<div class="empty">Nenhum empreendimento comercial encontrado na última sincronização.</div>'}
  </div></section>`;
}
function varandaCategory(u){
  const enterprise=String(u.enterpriseName||'')
    .normalize('NFD').replace(/[\u0300-\u036f]/g,'')
    .toUpperCase();

  // VERTEX: cada pavimento é uma tipologia comercial independente.
  if(enterprise.includes('VERTEX GETULIO')||enterprise.includes('RESIDENCIAL VERTEX FRAGA MAIA')){
    const configured=String(u.typology||'').trim();
    if(configured.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase()==='terreo') return 'Térreo';
    const configuredFloor=configured.match(/^(\d+)º andar$/i);
    if(configuredFloor){
      const floor=Number(configuredFloor[1]);
      return floor>=1?`${floor}º andar`:'';
    }
    const floor=Number(u.floor);
    if(Number.isFinite(floor)&&floor===0) return 'Térreo';
    if(Number.isFinite(floor)&&floor>=1) return `${floor}º andar`;
    return '';
  }

  // ASTER: a tipologia comercial vem da coluna ETAPA.
  // "COM QUINTAL" => Com quintal.
  // "SEM QUINTAL" => Com varanda, conforme regra comercial definida.
  if(enterprise.includes('ASTER RESIDENCE')){
    const stage=String(u.stage||'')
      .normalize('NFD').replace(/[\u0300-\u036f]/g,'')
      .toUpperCase();

    if(stage.includes('COM QUINTAL') || (stage.includes('QUINTAL') && !stage.includes('SEM QUINTAL'))){
      return 'Com quintal';
    }
    if(stage.includes('SEM QUINTAL') || stage.includes('VARANDA')){
      return 'Com varanda';
    }
  }

  // Demais empreendimentos: classificação comercial pela descrição do BLOCO/TIPOLOGIA.
  const raw=String(u.typology||u.tower||'')
    .normalize('NFD').replace(/[\u0300-\u036f]/g,'')
    .toUpperCase();

  if(raw.includes('SEM VARANDA')) return 'Sem varanda';
  if(raw.includes('COM VARANDA')) return 'Com varanda';
  return '';
}
function commercialCategoryOrder(category){
  const fixed={'Sem varanda':0,'Com varanda':1,'Com quintal':2,'Térreo':10};
  if(Object.prototype.hasOwnProperty.call(fixed,category)) return fixed[category];
  const floor=String(category||'').match(/^(\d+)º andar$/i);
  return floor?10+Number(floor[1]):99;
}
function enterpriseVarandaMinimumRows(){
  // Uma linha por categoria comercial e sempre com o menor preço disponível.
  // A numeração de bloco é ignorada.
  // Sândalo/Jasmim/Acqua: Com varanda / Sem varanda.
  // Aster: Com quintal / Com varanda, usando a coluna ETAPA.
  const byEnterprise=new Map();

  for(const u of availableUnits().filter(u=>Number(u.price)>0)){
    const enterprise=String(u.enterpriseName||'').trim();
    if(!enterprise) continue;

    const vertexType=isVertexCommercialRow(u)?String(u.commercialType||'Padrão').trim():'';
    const key=`${enterprise.toLocaleLowerCase('pt-BR')}|${vertexType.toLocaleLowerCase('pt-BR')}`;
    let g=byEnterprise.get(key);
    if(!g){
      g={enterpriseName:enterprise,commercialType:vertexType,overall:null,categories:new Map()};
      byEnterprise.set(key,g);
    }

    if(!g.overall || Number(u.price)<Number(g.overall.price)) g.overall=u;

    const cat=varandaCategory(u);
    if(cat){
      const current=g.categories.get(cat);
      if(!current || Number(u.price)<Number(current.price)){
        g.categories.set(cat,u);
      }
    }
  }

  const rows=[];
  for(const g of byEnterprise.values()){
    if(g.categories.size){
      const cats=[...g.categories.keys()].sort((a,b)=>{
        return commercialCategoryOrder(a)-commercialCategoryOrder(b) || a.localeCompare(b,'pt-BR');
      });

      for(const cat of cats){
        const u=g.categories.get(cat);
        rows.push({
          ...u,
          _displayLabel:`${g.enterpriseName} • ${cat}`,
          _kind:cat.toLowerCase().replace(/\s+/g,'-'),
          _categoryOrder:commercialCategoryOrder(cat),
          commercialType:g.commercialType||u.commercialType||''
        });
      }
    }else if(g.overall){
      rows.push({...g.overall,_displayLabel:g.enterpriseName,_kind:'overall'});
    }
  }

  return rows.sort((a,b)=>{
    const cmp=String(a.enterpriseName||'').localeCompare(String(b.enterpriseName||''),'pt-BR');
    if(cmp) return cmp;
    const order={'sem-varanda':0,'com-varanda':1,'com-quintal':2,overall:3};
    return (a._categoryOrder??order[a._kind]??99)-(b._categoryOrder??order[b._kind]??99) || Number(a.price)-Number(b.price);
  });
}
function commercialRowLabel(r){return String(r._displayLabel||r.enterpriseName||'')}
function isVertexCommercialRow(r){
  const enterprise=normalizeEnterpriseName(r?.enterpriseName);
  return enterprise.includes('vertexgetulio')||enterprise.includes('residencialvertexfragamaia');
}
function vertexCommercialGroupKey(r){
  const type=String(r?.commercialType||'Padrão').trim()||'Padrão';
  return `${normalizeEnterpriseName(r?.enterpriseName)}|${normalizeEnterpriseName(type)}`;
}
function tables(){return pageHead('Consulta comercial','Tabelas de preços','Menor valor disponível por empreendimento e tipologia comercial, com o respectivo valor de avaliação da unidade utilizada como referência.')+`<section class="section prices-section"><div class="container"><div class="price-search-panel"><div class="price-search-copy"><div class="eyebrow">Consulta rápida</div><strong>Encontre um empreendimento</strong><small>Pesquise pelo nome do empreendimento ou pela tipologia exibida.</small></div><div class="filters price-filters"><input id="q" class="input price-search-input" placeholder="Buscar empreendimento"></div></div><div id="tableArea"></div></div></section>`}
function renderTable(){
  const q=(document.querySelector('#q')?.value||'').toLowerCase();
  const allRows=enterpriseVarandaMinimumRows();
  const vertexRows=allRows.filter(isVertexCommercialRow);
  const entries=allRows.filter(r=>!isVertexCommercialRow(r)).map(row=>({kind:'row',row,enterpriseName:row.enterpriseName}));
  if(vertexRows.length){
    const vertexGroups=new Map();
    for(const row of vertexRows){
      const type=String(row.commercialType||'Padrão').trim();
      const key=vertexCommercialGroupKey(row);
      if(!vertexGroups.has(key)) vertexGroups.set(key,{type,enterpriseName:row.enterpriseName,rows:[]});
      vertexGroups.get(key).rows.push(row);
    }
    for(const {type,enterpriseName,rows} of vertexGroups.values()){
      const reference=rows.slice().sort((a,b)=>Number(a.price)-Number(b.price))[0];
      entries.push({kind:'vertex',row:reference,rows,commercialType:type,enterpriseName:`${enterpriseDisplayName(enterpriseName)} • ${type}`});
    }
  }
  const visibleEntries=entries
    .filter(entry=>!q||entry.enterpriseName.toLowerCase().includes(q)||(entry.rows||[entry.row]).some(r=>commercialRowLabel(r).toLowerCase().includes(q)))
    .sort((a,b)=>String(a.enterpriseName).localeCompare(String(b.enterpriseName),'pt-BR'));
  const area=document.querySelector('#tableArea');if(!area)return;
  const body=visibleEntries.map((entry,entryIndex)=>{
    if(entry.kind==='row'){
      const r=entry.row;
      return `<tr><td><b>${escapeHtml(commercialRowLabel(r))}</b></td><td><b>${fmtBRL(r.price)}</b></td><td><b>${Number(r.appraisal)>0?fmtBRL(r.appraisal):'—'}</b></td><td><a class="btn secondary btn-small" href="#simulador">Simular →</a></td></tr>`;
    }
    const r=entry.row;
    const detailId=`vertexTypologyDetails-${entryIndex}`;
    return `<tr class="vertex-summary-row"><td><b>${escapeHtml(entry.enterpriseName)}</b></td><td><b>${fmtBRL(r.price)}</b></td><td><b>${Number(r.appraisal)>0?fmtBRL(r.appraisal):'—'}</b></td><td><button class="btn secondary btn-small vertex-typology-toggle" type="button" data-target="${detailId}" aria-expanded="false">Simular ↓</button></td></tr>
      <tr id="${detailId}" class="vertex-detail-row" hidden><td colspan="4"><div class="vertex-detail-panel"><div class="vertex-detail-heading"><b>${escapeHtml(entry.enterpriseName)}</b><small>Escolha um andar para simular</small></div><div class="vertex-detail-table-wrap"><table class="vertex-detail-table"><thead><tr><th>Tipologia</th><th>Valor de venda</th><th>Valor da avaliação</th><th>Simular</th></tr></thead><tbody>${entry.rows.map(item=>`<tr><td><b>${escapeHtml(varandaCategory(item))}</b></td><td><b>${fmtBRL(item.price)}</b></td><td><b>${Number(item.appraisal)>0?fmtBRL(item.appraisal):'—'}</b></td><td><a class="btn secondary btn-small" href="#simulador">Simular →</a></td></tr>`).join('')}</tbody></table></div></div></td></tr>`;
  }).join('');
  area.innerHTML=`<div class="price-table-head"><p class="meta"><b>${visibleEntries.length.toLocaleString('pt-BR')}</b> opções comerciais resumidas</p><span class="price-table-caption">Menores valores disponíveis</span></div>${visibleEntries.length?`<div class="table-wrap table-wrap-refined"><table class="data-table price-table"><thead><tr><th>Empreendimento</th><th>Valor de venda</th><th>Valor da avaliação</th><th>Simular</th></tr></thead><tbody>${body}</tbody></table></div>`:'<div class="empty">Nenhuma opção disponível encontrada.</div>'}`;
  document.querySelectorAll('.vertex-typology-toggle').forEach(button=>button.addEventListener('click',e=>{
    const details=document.querySelector(`#${e.currentTarget.dataset.target}`);
    if(!details)return;
    const opening=details.hidden;
    details.hidden=!opening;
    e.currentTarget.setAttribute('aria-expanded',String(opening));
    e.currentTarget.textContent=opening?'Ocultar tipologias ↑':'Simular ↓';
    if(opening) setTimeout(()=>details.scrollIntoView({behavior:'smooth',block:'nearest'}),0);
  }));
}
function simulatorChoices(){return enterpriseVarandaMinimumRows()}
function parseMoney(v){
  if(typeof v==='number') return Number.isFinite(v)?v:0;
  let s=String(v||'').replace(/R\$|\s/g,'');
  if(s.includes(',')&&s.includes('.')) s=s.replace(/\./g,'').replace(',','.');
  else s=s.replace(',','.');
  const n=Number(s.replace(/[^0-9.-]/g,''));
  return Number.isFinite(n)?n:0;
}
function formatMoneyField(el){
  if(!el)return;
  const value=Math.max(0,parseMoney(el.value));
  el.value=fmtBRL(value);
}
function formatMoneyWhileTyping(el){
  if(!el)return;
  const digits=String(el.value||'').replace(/\D/g,'');
  const value=Number(digits||'0')/100;
  el.value=fmtBRL(value);
  try{el.setSelectionRange(el.value.length,el.value.length)}catch{}
}
function wireMoneyField(el){
  if(!el)return;
  const initial=Math.max(0,parseMoney(el.value));
  el.value=fmtBRL(initial);
  el.addEventListener('focus',()=>{try{el.setSelectionRange(el.value.length,el.value.length)}catch{}});
  el.addEventListener('input',()=>formatMoneyWhileTyping(el));
  el.addEventListener('paste',()=>setTimeout(()=>formatMoneyWhileTyping(el),0));
  el.addEventListener('blur',()=>formatMoneyField(el));
  el.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();document.querySelector('#calcBtn')?.click()}});
}
function simulator(){
  const enterpriseOptions=[...new Set(simulatorChoices().map(x=>x.enterpriseName))]
    .sort((a,b)=>a.localeCompare(b,'pt-BR'));
  return pageHead(
    'Simulação comercial',
    'Simulador de entrada',
    'Informe os dados do cliente, o financiamento aprovado e o subsídio. O sistema compara automaticamente todos os empreendimentos e tipologias disponíveis.'
  )+`<section class="section"><div class="container">
    <div class="sim-tabs">
      <button id="tabSimulator" class="sim-tab active" type="button">Simulador</button>
      <button id="tabPaymentPlan" class="sim-tab" type="button">Plano de Pagamento</button>
      <button id="tabCompare" class="sim-tab" type="button">Comparar <span id="compareCount" class="compare-count" hidden>0</span></button>
    </div>

    <div id="simulatorTab">
      <div class="sim-horizontal-panel">
        <div class="sim-horizontal-fields">
          <div class="field">
            <label>ID do cliente</label>
            <input id="clientId" class="input" placeholder="Ex.: 12345" autocomplete="off">
          </div>
          <div class="field">
            <label>Nome do cliente</label>
            <input id="clientName" class="input" placeholder="Nome completo" autocomplete="off">
          </div>
          <div class="field">
            <label>Financiamento aprovado</label>
            <input id="financing" class="input" inputmode="decimal" placeholder="R$ 0,00">
          </div>
          <div class="field">
            <label>Subsídio</label>
            <input id="subsidy" class="input" inputmode="decimal" value="0">
          </div>
        </div>
        <div class="sim-advanced-filters">
          <div class="field"><label>Empreendimentos</label><details id="filterEnterprise" class="multi-select"><summary><span id="filterEnterpriseLabel">Todos os empreendimentos</span></summary><div class="multi-select-menu"><button id="clearEnterpriseFilter" class="multi-select-all" type="button">Todos os empreendimentos</button>${enterpriseOptions.map(x=>`<label class="multi-select-option"><input type="checkbox" value="${escapeHtml(x)}" data-enterprise-filter><span>${escapeHtml(enterpriseDisplayName(x))}</span></label>`).join('')}</div></details></div>
          <div class="field"><label>Tipologia</label><select id="filterTypology" class="select"><option value="">Todas</option>${[...new Set(simulatorChoices().map(x=>varandaCategory(x)||'Geral'))].sort((a,b)=>a.localeCompare(b,'pt-BR')).map(x=>`<option>${escapeHtml(x)}</option>`).join('')}</select></div>
          <div class="field"><label>Entrada máxima</label><input id="maxEntry" class="input" inputmode="decimal" placeholder="Sem limite"></div>
        </div>
        <div class="sim-horizontal-actions">
          <button id="calcBtn" class="btn primary" type="button">Gerar possibilidades</button>
        </div>
      </div>

      <div id="simResult" class="sim-results sim-results-below">
        <div class="empty">
          <b>Informe o financiamento aprovado e o subsídio.</b>
          <p>Os empreendimentos e tipologias disponíveis serão apresentados abaixo.</p>
        </div>
      </div>
    </div>

    <div id="paymentPlanTab" hidden></div>
    <div id="compareTab" hidden>
      <div class="compare-panel">
        <div class="compare-panel-head">
          <div>
            <div class="eyebrow">comparação comercial</div>
            <h2>Comparar opções</h2>
            <p>Selecione de 2 a 3 opções nos cards da simulação.</p>
          </div>
          <button id="clearCompareBtn" class="btn secondary btn-small" type="button">Limpar seleção</button>
        </div>
        <div id="compareSelection"></div>
        <div id="compareResult"></div>
      </div>
    </div>
  </div></section>`;
}
function selectedEnterpriseFilters(){
  return new Set([...document.querySelectorAll('[data-enterprise-filter]:checked')].map(input=>input.value));
}
function updateEnterpriseFilterLabel(){
  const selected=[...document.querySelectorAll('[data-enterprise-filter]:checked')];
  const label=document.querySelector('#filterEnterpriseLabel');
  if(!label)return;
  if(!selected.length){label.textContent='Todos os empreendimentos';return}
  if(selected.length===1){label.textContent=enterpriseDisplayName(selected[0].value);return}
  label.textContent=`${selected.length} empreendimentos selecionados`;
}
function buildSimulationResults(){
  const financing=Math.max(0,parseMoney(document.querySelector('#financing')?.value));
  const subsidy=Math.max(0,parseMoney(document.querySelector('#subsidy')?.value));
  const clientId=String(document.querySelector('#clientId')?.value||'').trim();
  const clientName=String(document.querySelector('#clientName')?.value||'').trim();
  const pct=80;
  if(!financing){toast('Informe o financiamento aprovado.',true);return []}
  const filterEnterprises=selectedEnterpriseFilters();
  const filterTypology=String(document.querySelector('#filterTypology')?.value||'');
  const maxEntry=Math.max(0,parseMoney(document.querySelector('#maxEntry')?.value));
  return simulatorChoices().map((u,index)=>{
    const sale=Math.max(0,Number(u.price||0));
    const appraisal=Math.max(0,Number(u.appraisal||0));
    const appraisalLimit=appraisal>0?appraisal*(pct/100):0;
    const financingEffective=appraisal>0?Math.min(financing,appraisalLimit):financing;
    const entry=Math.max(0,sale-financingEffective-subsidy);
    const capped=appraisal>0&&financing>appraisalLimit;
    return {index,unit:u,clientId,clientName,sale,appraisal,financingApproved:financing,financingEffective,subsidy,appraisalLimit,maxFinancingPercent:pct,entry,capped};
  }).filter(r=>{
    if(filterEnterprises.size && !filterEnterprises.has(r.unit.enterpriseName))return false;
    if(filterTypology && (varandaCategory(r.unit)||'Geral')!==filterTypology)return false;
    if(maxEntry>0 && r.entry>maxEntry)return false;
    return true;
  });
}
function simulationResultCard(r,i){
  return `<article class="sim-result-card">
    <div class="sim-result-top">
      <div><span class="sim-result-index">${String(i+1).padStart(2,'0')}</span><h3>${escapeHtml(commercialRowLabel(r.unit))}</h3></div>
      <div class="sim-result-entry sim-result-entry-highlight"><small>Entrada</small><strong>${fmtBRL(r.entry)}</strong></div>
    </div>
    <div class="sim-result-grid">
      <div><small>Valor de venda</small><b>${fmtBRL(r.sale)}</b></div>
      <div><small>Valor da avaliação</small><b>${r.appraisal?fmtBRL(r.appraisal):'Não informado'}</b></div>
      <div><small>Financiamento efetivo</small><b>${fmtBRL(r.financingEffective)}</b></div>
      <div><small>Subsídio</small><b>${fmtBRL(r.subsidy)}</b></div>
    </div>
    ${r.capped
      ? `<div class="sim-warning">O financiamento efetivo foi limitado a 80% do valor de avaliação.</div>`
      : r.appraisal
        ? `<div class="sim-ok">Financiamento dentro do limite de 80% da avaliação.</div>`
        : `<div class="sim-warning">Valor de avaliação não identificado; não foi possível validar o limite de 80%.</div>`}
    <div class="sim-card-actions">
      <button class="btn primary btn-small" type="button" data-plan-sim="${i}">Plano de Pagamento</button>
      <label class="sim-compare-option">
        <input type="checkbox" data-compare-sim="${i}">
        <span>Comparar</span>
      </label>
    </div>
  </article>`;
}
function renderSimulationResults(results){
  const area=document.querySelector('#simResult');if(!area)return;
  if(!results.length){
    area.innerHTML='<div class="empty"><b>Nenhuma opção comercial disponível para simulação.</b><p>Verifique se o catálogo foi sincronizado e se existem unidades com status Disponível e preço válido.</p></div>';
    return;
  }
  const indexedResults=results.map((result,index)=>({result,index}));
  const vertexGroups=new Map();
  for(const item of indexedResults.filter(({result})=>isVertexCommercialRow(result.unit))){
    const key=vertexCommercialGroupKey(item.result.unit);
    if(!vertexGroups.has(key))vertexGroups.set(key,[]);
    vertexGroups.get(key).push(item);
  }
  const renderedVertexGroups=new Set();
  const cards=indexedResults.map(({result,index})=>{
    if(!isVertexCommercialRow(result.unit))return simulationResultCard(result,index);
    const type=String(result.unit.commercialType||'Padrão').trim()||'Padrão';
    const groupKey=vertexCommercialGroupKey(result.unit);
    if(renderedVertexGroups.has(groupKey))return '';
    renderedVertexGroups.add(groupKey);
    const vertexResults=vertexGroups.get(groupKey)||[];
    const reference=vertexResults[0];
    const detailId=`simVertexModal-${normalizeEnterpriseName(result.unit.enterpriseName)}-${normalizeEnterpriseName(type)}`;
    return `<article class="sim-result-card sim-vertex-summary-card">
      <div class="sim-result-top">
        <div><span class="sim-result-index">VERTEX</span><h3>${escapeHtml(enterpriseDisplayName(reference.result.unit.enterpriseName))} • ${escapeHtml(type)}</h3></div>
        <div class="sim-result-entry sim-result-entry-highlight"><small>Menor entrada</small><strong>${fmtBRL(reference.result.entry)}</strong></div>
      </div>
      <div class="sim-result-grid">
        <div><small>Menor valor de venda</small><b>${fmtBRL(reference.result.sale)}</b></div>
        <div><small>Valor da avaliação</small><b>${reference.result.appraisal?fmtBRL(reference.result.appraisal):'Não informado'}</b></div>
        <div><small>Financiamento efetivo</small><b>${fmtBRL(reference.result.financingEffective)}</b></div>
        <div><small>Andares disponíveis</small><b>${vertexResults.length.toLocaleString('pt-BR')}</b></div>
      </div>
      <div class="sim-ok sim-vertex-summary-note">Clique abaixo para consultar somente os andares disponíveis e seus respectivos valores.</div>
      <div class="sim-card-actions"><button class="btn primary btn-small" type="button" data-vertex-sim-toggle data-target="${detailId}" aria-expanded="false">Ver tipologias</button></div>
    </article>`;
  }).join('');
  const vertexModals=[...vertexGroups.values()].map(vertexResults=>{
    const reference=vertexResults[0];
    const type=String(reference.result.unit.commercialType||'Padrão').trim()||'Padrão';
    const enterpriseName=enterpriseDisplayName(reference.result.unit.enterpriseName);
    const detailId=`simVertexModal-${normalizeEnterpriseName(reference.result.unit.enterpriseName)}-${normalizeEnterpriseName(type)}`;
    return `<div id="${detailId}" class="sim-vertex-modal" hidden>
      <button class="sim-vertex-modal-backdrop" type="button" data-vertex-modal-close aria-label="Fechar tipologias"></button>
      <section class="sim-vertex-modal-dialog" role="dialog" aria-modal="true" aria-labelledby="${detailId}-title">
        <div class="sim-vertex-modal-head"><div><span class="eyebrow">tipologias disponíveis</span><h3 id="${detailId}-title">${escapeHtml(enterpriseName)} • ${escapeHtml(type)}</h3><small>Somente andares com unidades disponíveis para venda.</small></div><button class="sim-vertex-modal-close" type="button" data-vertex-modal-close aria-label="Fechar">×</button></div>
        <div class="sim-vertex-table-wrap"><table class="sim-vertex-table"><thead><tr><th>Tipologia</th><th>Venda</th><th>Avaliação</th><th>Entrada</th><th>Ações</th></tr></thead><tbody>${vertexResults.map(item=>`<tr><td><b>${escapeHtml(varandaCategory(item.result.unit)||commercialRowLabel(item.result.unit))}</b></td><td>${fmtBRL(item.result.sale)}</td><td>${item.result.appraisal?fmtBRL(item.result.appraisal):'—'}</td><td><b class="sim-vertex-entry-value">${fmtBRL(item.result.entry)}</b></td><td><div class="sim-vertex-row-actions"><button class="btn primary btn-small" type="button" data-plan-sim="${item.index}">Simular</button><label class="sim-compare-option"><input type="checkbox" data-compare-sim="${item.index}"><span>Comparar</span></label></div></td></tr>`).join('')}</tbody></table></div>
      </section>
    </div>`;
  }).join('');
  area.innerHTML=`
    <div class="sim-results-head">
      <div>
        <div class="eyebrow">possibilidades encontradas</div>
        <h2>${results.length.toLocaleString('pt-BR')} opções comerciais</h2>
      </div>
      <div class="sim-results-actions">
        <p>Financiamento aprovado: <b>${fmtBRL(results[0].financingApproved)}</b> • Subsídio: <b>${fmtBRL(results[0].subsidy)}</b></p>
        <button id="printAllSimulation" class="btn primary btn-small sim-print-main-btn" type="button">Gerar PDF / Imprimir</button>
      </div>
    </div>
    <div id="simComparison"></div><div class="sim-result-list">
      ${cards}
    </div>${vertexModals}`;
  area.querySelectorAll('[data-vertex-sim-toggle]').forEach(button=>button.addEventListener('click',e=>{
    const modal=area.querySelector(`#${e.currentTarget.dataset.target}`);
    if(!modal)return;
    modal.hidden=false;
    e.currentTarget.setAttribute('aria-expanded','true');
    document.body.classList.add('sim-modal-open');
    modal.querySelector('.sim-vertex-modal-close')?.focus();
  }));
  area.querySelectorAll('[data-vertex-modal-close]').forEach(button=>button.addEventListener('click',e=>{
    const modal=e.currentTarget.closest('.sim-vertex-modal');
    if(!modal)return;
    modal.hidden=true;
    document.body.classList.remove('sim-modal-open');
    area.querySelector(`[data-vertex-sim-toggle][data-target="${modal.id}"]`)?.setAttribute('aria-expanded','false');
  }));
  area.querySelectorAll('[data-compare-sim]').forEach(cb=>{
    cb.addEventListener('change',()=>{
      const selected=[...area.querySelectorAll('[data-compare-sim]:checked')];
      if(selected.length>3){
        cb.checked=false;
        toast('Você pode comparar no máximo 3 opções.',true);
      }
      updateCompareCount();
    });
  });
  updateCompareCount();
  area.querySelector('#printAllSimulation')?.addEventListener('click',printSimulation);
  area.querySelectorAll('[data-plan-sim]').forEach(btn=>btn.addEventListener('click',()=>{
    const r=lastSimulationResults[Number(btn.dataset.planSim)];
    if(r){document.body.classList.remove('sim-modal-open');area.querySelectorAll('.sim-vertex-modal').forEach(modal=>modal.hidden=true);selectedSimulationUnit=r.unit;lastSimulation=r;showSimulatorTab('plan')}
  }));
}
function selectedCompareIndices(){
  return [...document.querySelectorAll('[data-compare-sim]:checked')]
    .map(x=>Number(x.dataset.compareSim))
    .filter(Number.isFinite);
}

function updateCompareCount(){
  const count=selectedCompareIndices().length;
  const badge=document.querySelector('#compareCount');
  if(!badge)return;
  badge.textContent=String(count);
  badge.hidden=count===0;
}

function renderCompareTab(){
  const selection=document.querySelector('#compareSelection');
  const result=document.querySelector('#compareResult');
  if(!selection||!result)return;

  const indices=selectedCompareIndices();
  const rows=indices.map(i=>lastSimulationResults[i]).filter(Boolean);
  updateCompareCount();

  if(!rows.length){
    selection.innerHTML='<div class="compare-empty"><b>Nenhuma opção selecionada.</b><p>Volte para a aba Simulador e marque “Comparar” nos cards desejados.</p></div>';
    result.innerHTML='';
    return;
  }

  selection.innerHTML=`<div class="compare-picked-grid">${rows.map((r,pos)=>`
    <article class="compare-picked-card">
      <span class="sim-result-index">${String(indices[pos]+1).padStart(2,'0')}</span>
      <div><b>${escapeHtml(commercialRowLabel(r.unit))}</b><small>Entrada ${fmtBRL(r.entry)}</small></div>
    </article>`).join('')}</div>
    <div class="compare-picked-info">${rows.length} de 3 opções selecionadas</div>`;

  if(rows.length<2){
    result.innerHTML='<div class="compare-empty compact"><b>Selecione mais uma opção para comparar.</b></div>';
    return;
  }

  renderSimulationComparison(indices);
}

function renderSimulationComparison(indices){
  const target=document.querySelector('#compareResult');if(!target)return;
  const list=indices.map(i=>lastSimulationResults[i]).filter(Boolean);
  target.innerHTML=`<section class="sim-comparison"><div class="section-title"><div><div class="eyebrow">comparativo</div><h2>${list.length} opções lado a lado</h2></div></div><div class="comparison-grid">${list.map(r=>{
    const url=enterpriseOfficialUrl(r.unit.enterpriseName);
    return `<article>
      <h3>${escapeHtml(commercialRowLabel(r.unit))}</h3>
      <div class="comparison-entry"><small>Entrada</small><b>${fmtBRL(r.entry)}</b></div>
      <dl>
        <div><dt>Venda</dt><dd>${fmtBRL(r.sale)}</dd></div>
        <div><dt>Avaliação</dt><dd>${fmtBRL(r.appraisal)}</dd></div>
        <div><dt>Financiamento</dt><dd>${fmtBRL(r.financingEffective)}</dd></div>
        <div><dt>Subsídio</dt><dd>${fmtBRL(r.subsidy)}</dd></div>
      </dl>
      ${url?`<div class="comparison-qr"><img src="/api/qr?text=${encodeURIComponent(url)}" alt="QR Code"><a href="${escapeHtml(url)}" target="_blank" rel="noopener">Abrir empreendimento</a></div>`:''}
    </article>`;
  }).join('')}</div></section>`;
}

function calcSimulation(){
  try{
    lastSimulationResults=buildSimulationResults()
      .sort((a,b)=>a.entry-b.entry || a.sale-b.sale || commercialRowLabel(a.unit).localeCompare(commercialRowLabel(b.unit),'pt-BR'));
    lastSimulation=lastSimulationResults[0]||null;
    selectedSimulationUnit=lastSimulation?.unit||null;
    renderSimulationResults(lastSimulationResults);
    if(lastSimulationResults.length){
      setTimeout(()=>document.querySelector('#simResult')?.scrollIntoView({behavior:'smooth',block:'start'}),50);
    }
  }catch(err){
    console.error('[SIMULADOR]',err);
    const area=document.querySelector('#simResult');
    if(area)area.innerHTML=`<div class="empty"><b>Não foi possível gerar as possibilidades.</b><p>${escapeHtml(err?.message||'Erro inesperado no simulador.')}</p></div>`;
    toast('Falha ao gerar as possibilidades.',true);
  }
}
function printSimulation(){
  document.body.classList.remove('print-plan');
  const results=Array.isArray(lastSimulationResults)?lastSimulationResults:[];
  if(!results.length){
    alert('Gere as possibilidades antes de imprimir a simulação.');
    return;
  }

  const first=results[0]||{};
  const clientId=String(first.clientId||document.querySelector('#clientId')?.value||'').trim();
  const clientName=String(first.clientName||document.querySelector('#clientName')?.value||'').trim();
  const financingApproved=Math.max(0,Number(first.financingApproved||0));
  const subsidy=Math.max(0,Number(first.subsidy||0));

  let sheet=document.querySelector('#simPrintSheet');
  if(!sheet){
    sheet=document.createElement('section');
    sheet.id='simPrintSheet';
    document.body.appendChild(sheet);
  }

  const rows=results.map((r,i)=>{
    const category=varandaCategory(r.unit);
    const typology=category
      ? category.charAt(0).toUpperCase()+category.slice(1).replace('-', ' ')
      : (r.unit?.developmentType?.toLowerCase().includes('casa')?'Casa':'—');
    return `<tr>
      <td>${String(i+1).padStart(2,'0')}</td>
      <td><b>${escapeHtml(r.unit?.enterpriseName||'—')}</b></td>
      <td>${escapeHtml(typology)}</td>
      <td>${fmtBRL(r.sale)}</td>
      <td>${r.appraisal?fmtBRL(r.appraisal):'—'}</td>
      <td>${fmtBRL(r.financingEffective)}</td>
      <td>${fmtBRL(r.subsidy)}</td>
      <td><b>${fmtBRL(r.entry)}</b></td>
    </tr>`;
  }).join('');

  sheet.innerHTML=`
    <div class="sim-print-header">
      <div class="sim-print-brand">
        <img class="print-logo" src="/assets/logo-estacao1.png?v=7.0" alt="Estação 1">
        <div>
          <strong>ESTAÇÃO 1 | SIMULAÇÃO COMERCIAL</strong>
          <span>Opções comerciais em ordem de menor entrada</span>
        </div>
      </div>
    </div>

    <div class="sim-print-client-grid">
      <div><span>Cliente</span><b>${escapeHtml(clientName||'Não informado')}</b></div>
      <div><span>ID</span><b>${escapeHtml(clientId||'Não informado')}</b></div>
      <div><span>Crédito aprovado</span><b>${fmtBRL(financingApproved)}</b></div>
      <div><span>Subsídio</span><b>${fmtBRL(subsidy)}</b></div>
    </div>

    ${enterpriseOfficialUrl(first.unit?.enterpriseName)?`<div class="sim-print-best"><div><span>Melhor entrada encontrada</span><b>${escapeHtml(commercialRowLabel(first.unit))} • ${fmtBRL(first.entry)}</b></div><div><img src="/api/qr?text=${encodeURIComponent(enterpriseOfficialUrl(first.unit.enterpriseName))}" alt="QR Code"><small>Detalhes do empreendimento</small></div></div>`:''}
    <div class="sim-print-section-title">
      <span>Todas as opções calculadas</span>
      <b>${results.length.toLocaleString('pt-BR')} possibilidades</b>
    </div>

    <table class="sim-print-table">
      <thead>
        <tr>
          <th>#</th>
          <th>Empreendimento</th>
          <th>Tipologia</th>
          <th>Valor</th>
          <th>Avaliação</th>
          <th>Financ. efetivo</th>
          <th>Subsídio</th>
          <th>Entrada</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>

    <div class="sim-print-note">
      Simulação comercial informativa. Valores sujeitos à análise de crédito, avaliação do imóvel, regras do agente financeiro e condições vigentes.
    </div>`;

  const logo=sheet.querySelector('.print-logo');
  const doPrint=()=>setTimeout(()=>window.print(),150);
  if(logo && !logo.complete){
    logo.addEventListener('load',doPrint,{once:true});
    logo.addEventListener('error',doPrint,{once:true});
  }else{
    doPrint();
  }
}
window.printSimulation=printSimulation;

function pctBR(value){return `${Number(value||0).toLocaleString('pt-BR',{minimumFractionDigits:3,maximumFractionDigits:3})}%`}
function paymentPlanContext(){
  const base=lastSimulation||{};
  const unit=selectedSimulationUnit||base.unit||null;
  const clientId=String(base.clientId||document.querySelector('#clientId')?.value||'').trim();
  const clientName=String(base.clientName||document.querySelector('#clientName')?.value||'').trim();
  const financingApproved=Math.max(0,parseMoney(document.querySelector('#financing')?.value)||Number(base.financingApproved||0));
  const subsidy=Math.max(0,parseMoney(document.querySelector('#subsidy')?.value)||Number(base.subsidy||0));
  const sale=Math.max(0,Number(unit?.price??base.sale??0));
  const appraisal=Math.max(0,Number(unit?.appraisal??base.appraisal??0));
  return {unit,clientId,clientName,sale,appraisal,financingApproved,subsidy,maxFinancingPercent:80};
}
function renderPaymentPlan(){
  const area=document.querySelector('#paymentPlanTab'); if(!area)return;
  const ctx=paymentPlanContext(); const u=ctx.unit;
  if(!u){area.innerHTML='<div class="empty"><b>Selecione um empreendimento no Simulador.</b><p>Os dados do Plano de Pagamento serão carregados automaticamente.</p></div>';return}
  if(!ctx.sale){area.innerHTML='<div class="empty"><b>Valor do imóvel indisponível.</b><p>Não é possível montar o Plano de Pagamento sem o valor de venda da opção selecionada.</p></div>';return}
  if(!ctx.appraisal){area.innerHTML='<div class="plan-alert error"><b>Valor de avaliação não identificado.</b><p>O Plano de Pagamento exige o VALOR DO IMÓVEL (1x) da tabela detalhada para validar o limite de financiamento de 80%.</p></div>';return}
  const category=varandaCategory(u);
  const typology=category || (u.developmentType?.toLowerCase().includes('casa')?'Casa':'Não especificada');
  const rule=selectPaymentRule(paymentPlanRules,{enterpriseName:u.enterpriseName,typology:`${category} ${u.typology||''}`,developmentType:u.developmentType||''});
  const r=calculatePaymentPlan(ctx,rule);
  const blocked=r.remunerationExceedsLimit;
  const status=blocked?'OPERAÇÃO BLOQUEADA':r.status;
  const ownMsg=r.ownResourcesMinimum>0?`O cliente deverá pagar no mínimo ${fmtBRL(r.ownResourcesMinimum)} com recursos próprios. O saldo poderá ser estruturado dentro da capacidade do Plano de Pagamento.`:'A entrada gerada está integralmente dentro da capacidade do Plano de Pagamento.';
  const fixed=rule.remunerationType==='fixed';
  area.innerHTML=`<div class="plan-shell plan-shell-refined"><div class="plan-head plan-head-refined"><div><div class="eyebrow">plano de pagamento</div><h2>${escapeHtml(u.enterpriseName)}</h2><p>${typology==='Não especificada'?'':escapeHtml(typology)}</p></div><span class="plan-status ${blocked?'blocked':r.ownResourcesMinimum>0?'warning':'ok'}">${escapeHtml(status)}</span></div>${blocked?'<div class="plan-alert error"><b>A remuneração cadastrada ultrapassa o limite máximo de risco da operação.</b><p>A conclusão do Plano de Pagamento foi bloqueada.</p></div>':''}<div class="plan-grid plan-grid-refined"><div><small>Empreendimento</small><b>${escapeHtml(u.enterpriseName)}</b></div><div><small>Tipologia</small><b>${escapeHtml(typology)}</b></div><div><small>Valor do imóvel</small><b>${fmtBRL(r.sale)}</b></div><div><small>Valor da avaliação</small><b>${fmtBRL(r.appraisal)}</b></div><div><small>Financiamento + Subsídio</small><b>${fmtBRL(Math.max(0,r.financingEffective+r.subsidy))}</b></div><div><small>Financiamento efetivo</small><b>${fmtBRL(r.financingEffective)}</b></div><div><small>Subsídio</small><b>${fmtBRL(r.subsidy)}</b></div><div class="plan-kpi plan-kpi-entry"><small>Entrada gerada</small><b>${fmtBRL(r.entryRequired)}</b></div><div class="plan-kpi"><small>Limite total de risco</small><b>${fmtBRL(r.maxPlanCapacity)}</b></div><div><small>Comissão da imobiliária</small><b>${fixed?'Fixa • ':''}${fmtBRL(r.realEstateCommission)}</b></div><div><small>Remuneração da coordenação</small><b>${pctBR(rule.coordinationPercent||0)} • ${fmtBRL(r.coordination)}</b></div><div><small>Risco disponível para a construtora</small><b>${fmtBRL(r.builderRisk)}</b></div><div class="plan-kpi plan-kpi-own"><small>Recurso próprio mínimo</small><b>${fmtBRL(r.ownResourcesMinimum)}</b></div><div><small>Regra aplicada</small><b>${escapeHtml(r.ruleName)}</b></div></div><div class="plan-summary ${blocked?'blocked':r.ownResourcesMinimum>0?'warning':'ok'}"><div><small>Status final da operação</small><strong>${escapeHtml(status)}</strong></div><p>${blocked?`A operação não pode ser concluída enquanto a parametrização de remuneração ultrapassar o teto global de ${Number(r.totalRiskPercent).toLocaleString('pt-BR',{maximumFractionDigits:3})}%.`:escapeHtml(ownMsg)}</p></div><div class="plan-note"><b>Validação do financiamento:</b> limite de 80% da avaliação = ${fmtBRL(r.appraisalFinancingLimit)}. O Plano de Pagamento utiliza ${fmtBRL(r.financingEffective)} como financiamento efetivo e nunca ultrapassa esse teto.</div><div class="buttons plan-print-actions"><button class="btn secondary" type="button" onclick="printPaymentPlan()">Imprimir / Salvar PDF</button></div></div>`;
}

function printPaymentPlan(){
  const ctx=paymentPlanContext();
  const u=ctx.unit;
  if(!u || !ctx.sale || !ctx.appraisal){
    alert('Selecione um empreendimento e gere um Plano de Pagamento válido antes de imprimir.');
    return;
  }

  const category=varandaCategory(u);
  const typology=category || (u.developmentType?.toLowerCase().includes('casa')?'Casa':'Não especificada');
  const rule=selectPaymentRule(paymentPlanRules,{
    enterpriseName:u.enterpriseName,
    typology:`${category} ${u.typology||''}`,
    developmentType:u.developmentType||''
  });
  const r=calculatePaymentPlan(ctx,rule);
  const blocked=r.remunerationExceedsLimit;
  const status=blocked?'OPERAÇÃO BLOQUEADA':r.status;
  const ownMsg=r.ownResourcesMinimum>0
    ? `O cliente deverá pagar no mínimo ${fmtBRL(r.ownResourcesMinimum)} com recursos próprios. O saldo poderá ser estruturado dentro da capacidade do Plano de Pagamento.`
    : 'A entrada gerada está integralmente dentro da capacidade do Plano de Pagamento.';
  const fixed=rule.remunerationType==='fixed';

  let sheet=document.querySelector('#planPrintSheet');
  if(!sheet){
    sheet=document.createElement('section');
    sheet.id='planPrintSheet';
    document.body.appendChild(sheet);
  }

  sheet.innerHTML=`
    <div class="print-head">
      <div class="print-brand">
        <img class="print-logo" src="/assets/logo-estacao1.png?v=7.0" alt="Estação 1">
        <div><strong>Estação 1</strong><span>Portal Comercial</span></div>
      </div>
      <div class="print-doc"><b>PLANO DE PAGAMENTO</b></div>
    </div>

    <div class="print-title">
      <span>Plano de Pagamento</span>
      <h1>${escapeHtml(u.enterpriseName)}</h1>
      ${typology==='Não especificada'?'':`<p>${escapeHtml(typology)}</p>`}
    </div>

    <div class="plan-print-status ${blocked?'blocked':r.ownResourcesMinimum>0?'warning':'ok'}">
      <span>STATUS FINAL DA OPERAÇÃO</span>
      <strong>${escapeHtml(status)}</strong>
      <p>${escapeHtml(blocked?'A remuneração cadastrada ultrapassa o limite máximo de risco da operação.':ownMsg)}</p>
    </div>

    <div class="print-grid plan-print-grid">
      <div><span>Cliente</span><b>${escapeHtml(ctx.clientName||'Não informado')}</b></div>
      <div><span>ID do cliente</span><b>${escapeHtml(ctx.clientId||'Não informado')}</b></div>
      <div><span>Valor do imóvel</span><b>${fmtBRL(r.sale)}</b></div>
      <div><span>Valor da avaliação</span><b>${fmtBRL(r.appraisal)}</b></div>
      <div><span>Financiamento + Subsídio</span><b>${fmtBRL(Math.max(0,r.financingEffective+r.subsidy))}</b></div>
      <div><span>Financiamento efetivo</span><b>${fmtBRL(r.financingEffective)}</b></div>
      <div><span>Subsídio</span><b>${fmtBRL(r.subsidy)}</b></div>
      <div><span>Entrada gerada</span><b>${fmtBRL(r.entryRequired)}</b></div>
      <div><span>Limite total de risco</span><b>${fmtBRL(r.maxPlanCapacity)}</b></div>
      <div><span>Recurso próprio mínimo</span><b>${fmtBRL(r.ownResourcesMinimum)}</b></div>
    </div>

    <div class="plan-print-breakdown">
      <div><span>Comissão da imobiliária</span><b>${fixed?'Fixa • ':''}${fmtBRL(r.realEstateCommission)}</b></div>
      <div><span>Remuneração da coordenação</span><b>${pctBR(rule.coordinationPercent||0)} • ${fmtBRL(r.coordination)}</b></div>
      <div><span>Risco disponível para a construtora</span><b>${fmtBRL(r.builderRisk)}</b></div>
      <div><span>Regra aplicada</span><b>${escapeHtml(r.ruleName)}</b></div>
    </div>

    <div class="print-validation">
      <b>Validação do financiamento</b>
      <p>Limite de 80% da avaliação: ${fmtBRL(r.appraisalFinancingLimit)}. Financiamento efetivo utilizado: ${fmtBRL(r.financingEffective)}.</p>
    </div>

    <div class="print-formula">
      <span>Cálculo da entrada gerada</span>
      <b>${fmtBRL(r.sale)} − ${fmtBRL(r.financingEffective)} − ${fmtBRL(r.subsidy)} = ${fmtBRL(r.entryRequired)}</b>
    </div>`;

  document.body.classList.add('print-plan');

  const cleanup=()=>document.body.classList.remove('print-plan');
  window.addEventListener('afterprint',cleanup,{once:true});

  const logo=sheet.querySelector('.print-logo');
  const doPrint=()=>setTimeout(()=>window.print(),150);
  if(logo && !logo.complete){
    logo.addEventListener('load',doPrint,{once:true});
    logo.addEventListener('error',doPrint,{once:true});
  }else{
    doPrint();
  }
}
window.printPaymentPlan=printPaymentPlan;

function showSimulatorTab(tab){
  const panels={
    sim:document.querySelector('#simulatorTab'),
    plan:document.querySelector('#paymentPlanTab'),
    compare:document.querySelector('#compareTab')
  };
  const buttons={
    sim:document.querySelector('#tabSimulator'),
    plan:document.querySelector('#tabPaymentPlan'),
    compare:document.querySelector('#tabCompare')
  };

  if(!panels.sim||!panels.plan||!panels.compare)return;

  if(tab==='plan')renderPaymentPlan();
  if(tab==='compare')renderCompareTab();

  Object.entries(panels).forEach(([key,panel])=>{
    panel.hidden=key!==tab;
  });
  Object.entries(buttons).forEach(([key,button])=>{
    button?.classList.toggle('active',key===tab);
  });
}



let adminAuthenticated=false;

async function checkAdminAuth(){
  try{
    const r=await api('/api/admin/auth');
    adminAuthenticated=Boolean(r?.authenticated);
  }catch{
    adminAuthenticated=false;
  }
  return adminAuthenticated;
}

function adminLogin(){
  return pageHead('Área restrita','Administração','Acesso exclusivo para usuários autorizados.')+
  `<section class="section"><div class="container admin-login-wrap">
    <form id="adminLoginForm" class="admin-login-card">
      <div class="eyebrow">área protegida</div>
      <h2>Entrar na Administração</h2>
      <p>Informe o usuário e a senha administrativos.</p>
      <div class="field"><label>Usuário</label><input id="adminUser" class="input" autocomplete="username" required></div>
      <div class="field"><label>Senha</label><input id="adminPass" class="input" type="password" autocomplete="current-password" required></div>
      <button class="btn primary" type="submit">Entrar</button>
      <div id="adminLoginError" class="admin-login-error" hidden>Usuário ou senha inválidos.</div>
    </form>
  </div></section>`;
}

function administration(){
  if(!adminAuthenticated)return adminLogin();
  return pageHead('Gestão local','Administração','Gerencie imagens, links, nomes comerciais, destaques e visibilidade sem editar código.')+
  `<section class="section admin-page"><div class="container">
    <div class="admin-toolbar">
      <div class="status-box compact"><span class="status-dot ${(catalog.status==='ok'||catalog.status==='warning')?'ok':'error'}"></span><div><div class="eyebrow">CVCRM</div><b>${catalog.syncing?'Sincronizando':catalog.status==='ok'?'Conectado':'Atenção'}</b><small>Último sucesso: ${fmtDate(catalog.lastSuccess)}</small></div></div>
      <div class="admin-toolbar-actions"><button id="adminSyncBtn" class="btn secondary">Sincronizar agora</button><button id="backupBtn" class="btn primary">Criar backup</button><button id="adminLogoutBtn" class="btn secondary">Sair</button></div>
    </div>
    <div class="metrics admin-metrics">
      <div class="metric"><label>Pendências de cadastro</label><strong>${adminEnterpriseData.pending?.length||0}</strong><p>Empreendimentos sem imagem/link/configuração.</p></div>
      <div class="metric"><label>Backups</label><strong>${backups.length}</strong><p>Cópias automáticas e manuais preservadas.</p></div>
      <div class="metric"><label>Histórico de preços</label><strong>${priceHistory.rows?.length||0}</strong><p>Pontos registrados nas sincronizações.</p></div>
    </div>
    <div class="section-title admin-title"><div><div class="eyebrow">empreendimentos</div><h2>Cadastro visual e comercial</h2></div></div>
    <div class="admin-enterprise-list">${(adminEnterpriseData.entries||[]).map((e,i)=>`<form class="admin-enterprise-card" data-admin-index="${i}">
      <div class="admin-thumb"><img src="${escapeHtml(e.image||'/assets/empreendimentos/placeholder.svg')}" onerror="this.src='/assets/empreendimentos/placeholder.svg'"></div>
      <div class="admin-fields">
        <div class="admin-card-head"><div><small>Origem CVCRM</small><b>${escapeHtml(e.sourceName)}</b></div>${e.configured?'':'<span class="admin-pending">Pendente</span>'}</div>
        <input type="hidden" name="sourceName" value="${escapeHtml(e.sourceName)}">
        <div class="admin-grid">
          <div class="field"><label>Nome comercial</label><input class="input" name="displayName" value="${escapeHtml(e.displayName||e.sourceName)}"></div>
          <div class="field"><label>Link de detalhes</label><input class="input" name="url" value="${escapeHtml(e.url||'')}" placeholder="https://..."></div>
          <div class="field"><label>Destaques</label><input class="input" name="highlights" value="${escapeHtml((e.highlights||[]).join(', '))}" placeholder="Lançamento, Últimas unidades"></div>
          <div class="field admin-visible-field"><label>Visibilidade</label><label class="toggle"><input type="checkbox" name="visible" ${e.visible!==false?'checked':''}><span>Exibir no portal</span></label></div>
        </div>
        <div class="admin-card-actions"><label class="btn secondary btn-small upload-image-btn">Trocar imagem<input type="file" name="image" accept="image/jpeg,image/png,image/webp" hidden></label><button class="btn primary btn-small" type="submit">Salvar alterações</button></div>
      </div>
    </form>`).join('')||'<div class="empty">Nenhum empreendimento disponível.</div>'}</div>
  </div></section>`;
}
function materialsPage(){return pageHead('Central de arquivos','Materiais','Publique e consulte books, plantas, memoriais, apresentações e outros arquivos comerciais. Sem login.')+`<section class="section"><div class="container"><form id="uploadForm" class="upload"><div class="upload-grid"><div class="field"><label>Arquivo</label><input name="file" type="file" class="input" required></div><div class="field"><label>Título</label><input name="title" class="input" placeholder="Título do material"></div><div class="field"><label>Empreendimento</label><select name="enterpriseName" class="select"><option value="">Geral</option>${catalog.enterprises.map(e=>`<option>${escapeHtml(e.name)}</option>`).join('')}</select></div><button class="btn primary" type="submit">Publicar</button></div></form><div class="material-list">${materials.map(m=>`<article class="material"><div class="eyebrow">${escapeHtml(m.enterpriseName||'GERAL')}</div><h3>${escapeHtml(m.title)}</h3><p class="meta">${escapeHtml(m.fileName)} • ${(m.size/1024/1024).toFixed(1)} MB</p><div class="buttons"><a class="btn secondary" target="_blank" href="${m.url}">Abrir arquivo</a><button class="btn danger" data-delete-material="${m.id}">Remover</button></div></article>`).join('')||'<div class="empty">Nenhum material publicado.</div>'}</div></div></section>`}
function updates(){
  const p=catalog.syncProgress||{};
  const prog=(p.totalPages&&p.currentPage)?Math.min(100,Math.round((p.currentPage/p.totalPages)*100)):0;
  const warnings=integrity.warnings||[];
  const ep=integrity.endpoints||{};
  return pageHead('Integração','Atualizações','Sincronização protegida das fontes CVCRM. O catálogo anterior só é substituído quando unidades, situações e preços terminam corretamente.')+
  `<section class="section"><div class="container">
    <div class="status-box">
      <span class="status-dot ${catalog.status==='ok'?'ok':catalog.status==='error'?'error':''}"></span>
      <div style="flex:1"><div class="eyebrow">Integração CVCRM</div>
      <h2>${catalog.syncing?'Sincronizando':catalog.status==='ok'?'Sincronizado':catalog.status==='warning'?'Sincronizado com aviso':catalog.status==='error'?'Falha na sincronização':'Aguardando sincronização'}</h2>
      <p>Último sucesso: <b>${fmtDate(catalog.lastSuccess)}</b></p>
      ${catalog.syncing?`<div style="margin-top:12px"><div style="height:8px;background:#e4e4e4;border-radius:10px;overflow:hidden"><div style="height:100%;width:${prog}%;background:currentColor"></div></div><p>${escapeHtml(p.label||'Sincronizando')}${p.currentPage&&p.totalPages?` • página ${p.currentPage} de ${p.totalPages}`:''}</p></div>`:''}
      ${catalog.rateLimit?.active?`<div class="empty" style="margin-top:12px;text-align:left"><b>Proteção contra limite ativa</b><p>O CVCRM pediu redução de chamadas. Esta sincronização aguardará automaticamente cerca de ${catalog.rateLimit.remainingSeconds||0}s antes da próxima tentativa.</p></div>`:''}
      ${warnings.length?`<div class="empty" style="margin-top:12px;text-align:left"><b>Atenção na API</b>${warnings.map(w=>`<p>${escapeHtml(w)}</p>`).join('')}</div>`:''}
      </div>
      <button id="syncBtn" class="btn primary" ${catalog.syncing?'disabled':''}>${catalog.syncing?'Sincronizando...':'Sincronizar agora'}</button>
    </div>
    <div class="metrics" style="margin-top:20px">
      <div class="metric"><label>Empreendimentos atuais</label><strong>${catalog.enterprises.length.toLocaleString('pt-BR')}</strong><p>Com situação comercial atual.</p></div>
      <div class="metric"><label>Unidades disponíveis</label><strong>${(catalog.stats?.availableUnits??availableUnits().length).toLocaleString('pt-BR')}</strong><p>Situação atual = disponível.</p></div>
      <div class="metric"><label>Disponíveis com preço</label><strong>${(catalog.stats?.availableWithPrice??simulatorUnits().length).toLocaleString('pt-BR')}</strong><p>Podem ser usadas no simulador.</p></div>
    </div>
    <div class="metrics" style="margin-top:20px">
      <div class="metric"><label>/unidades</label><strong>${ep.unidades?.records??'—'}</strong><p>${ep.unidades?.ok===false?'Falhou':'Registros lidos'}</p></div>
      <div class="metric"><label>/unidades/situacao</label><strong>${ep.situacao?.records??'—'}</strong><p>${ep.situacao?.ok===false?'Falhou':'Situações lidas'}</p></div>
      <div class="metric"><label>/unidades/precos</label><strong>${ep.precos?.records??'—'}</strong><p>${ep.precos?.ok===false?'Falhou':'Preços lidos'}</p></div>
    </div>
    <div class="section-title" style="margin-top:38px"><div><div class="eyebrow">rastreabilidade</div><h2>Histórico</h2></div><a class="btn secondary" href="/api/export/catalog.json">Exportar catálogo JSON</a></div>
    <div class="history">${history.slice(0,30).map(h=>`<div class="history-item"><b>${escapeHtml(h.action)}</b><span>${escapeHtml(h.detail)} • ${fmtDate(h.at)}</span></div>`).join('')||'<div class="empty">Ainda não há eventos registrados.</div>'}</div>
  </div></section>`
}
const pages={inicio:home,empreendimentos:enterprises,tabelas:tables,simulador:simulator,administracao:administration};
async function route(){
  let name=(location.hash||'#inicio').slice(1).split('?')[0];
  if(readOnlyPortal&&name==='administracao'){
    name='inicio';
    window.history.replaceState(null,'','#inicio');
  }
  document.querySelectorAll('nav a').forEach(a=>a.classList.toggle('active',a.dataset.route===name));
  if(name==='administracao')await checkAdminAuth();
  app.innerHTML=(pages[name]||home)();
  wire(name);
  window.scrollTo({top:0,behavior:'instant'});
}
function wire(name){if(name==='tabelas'){document.querySelector('#q')?.addEventListener('input',renderTable);renderTable()}
if(name==='simulador'){const financingField=document.querySelector('#financing');const subsidyField=document.querySelector('#subsidy');const maxEntryField=document.querySelector('#maxEntry');wireMoneyField(financingField);wireMoneyField(subsidyField);wireMoneyField(maxEntryField);document.querySelectorAll('[data-enterprise-filter]').forEach(input=>input.addEventListener('change',updateEnterpriseFilterLabel));document.querySelector('#clearEnterpriseFilter')?.addEventListener('click',()=>{document.querySelectorAll('[data-enterprise-filter]').forEach(input=>input.checked=false);updateEnterpriseFilterLabel()});document.querySelector('#calcBtn')?.addEventListener('click',()=>{document.querySelector('#filterEnterprise')?.removeAttribute('open');formatMoneyField(financingField);formatMoneyField(subsidyField);calcSimulation()});document.querySelector('#tabSimulator')?.addEventListener('click',()=>showSimulatorTab('sim'));document.querySelector('#tabPaymentPlan')?.addEventListener('click',()=>showSimulatorTab('plan'));document.querySelector('#tabCompare')?.addEventListener('click',()=>showSimulatorTab('compare'));document.querySelector('#clearCompareBtn')?.addEventListener('click',()=>{document.querySelectorAll('[data-compare-sim]').forEach(x=>x.checked=false);updateCompareCount();renderCompareTab()})}
if(name==='administracao'&&!adminAuthenticated){
  document.querySelector('#adminLoginForm')?.addEventListener('submit',async e=>{
    e.preventDefault();
    const username=document.querySelector('#adminUser')?.value||'';
    const password=document.querySelector('#adminPass')?.value||'';
    try{
      await api('/api/admin/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username,password})});
      adminAuthenticated=true;
      adminEnterpriseData=await api('/api/admin/enterprises');
      backups=await api('/api/backups');
      route();
    }catch{
      const err=document.querySelector('#adminLoginError');if(err)err.hidden=false;
    }
  });
}
if(name==='administracao'&&adminAuthenticated){
  document.querySelector('#backupBtn')?.addEventListener('click',async()=>{try{await api('/api/admin/backup',{method:'POST'});toast('Backup criado.');backups=await api('/api/backups');route()}catch(err){toast(err.message,true)}});
  document.querySelector('#adminSyncBtn')?.addEventListener('click',async()=>{try{await api('/api/sync',{method:'POST'});toast('Sincronização iniciada.')}catch(err){toast(err.message,true)}});
  document.querySelector('#adminLogoutBtn')?.addEventListener('click',async()=>{try{await api('/api/admin/logout',{method:'POST'});}catch{}adminAuthenticated=false;route();});
  document.querySelectorAll('.admin-enterprise-card').forEach(form=>{
    form.addEventListener('submit',async e=>{
      e.preventDefault();
      const fd=new FormData(form);
      const payload={
        sourceName:fd.get('sourceName'),
        displayName:fd.get('displayName'),
        url:fd.get('url'),
        highlights:String(fd.get('highlights')||'').split(',').map(x=>x.trim()).filter(Boolean),
        visible:form.querySelector('[name="visible"]')?.checked!==false
      };
      try{
        await api('/api/admin/enterprise',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
        enterpriseMediaConfig=await api('/api/enterprise-media');
        adminEnterpriseData=await api('/api/admin/enterprises');
        toast('Empreendimento atualizado.');
        route();
      }catch(err){toast(err.message,true)}
    });
    form.querySelector('[name="image"]')?.addEventListener('change',async e=>{
      const file=e.target.files?.[0];if(!file)return;
      const fd=new FormData();fd.append('sourceName',form.querySelector('[name="sourceName"]').value);fd.append('image',file);
      try{
        await api('/api/admin/enterprise-image',{method:'POST',body:fd});
        enterpriseMediaConfig=await api('/api/enterprise-media');
        adminEnterpriseData=await api('/api/admin/enterprises');
        toast('Imagem atualizada.');
        route();
      }catch(err){toast(err.message,true)}
    });
  });
}
if(name==='materiais'){document.querySelector('#uploadForm')?.addEventListener('submit',async e=>{e.preventDefault();const btn=e.submitter;btn.disabled=true;try{await api('/api/materials',{method:'POST',body:new FormData(e.currentTarget)});materials=await api('/api/materials');toast('Material publicado.');route()}catch(err){toast(err.message,true)}finally{btn.disabled=false}});document.querySelectorAll('[data-delete-material]').forEach(btn=>btn.addEventListener('click',async()=>{if(!confirm('Remover este material?'))return;try{await api('/api/materials/'+btn.dataset.deleteMaterial,{method:'DELETE'});materials=await api('/api/materials');route()}catch(err){toast(err.message,true)}}))}
if(name==='atualizacoes'){document.querySelector('#syncBtn')?.addEventListener('click',async e=>{e.currentTarget.disabled=true;e.currentTarget.textContent='Iniciando...';try{await api('/api/sync',{method:'POST'});toast('Sincronização iniciada. Você pode acompanhar o progresso nesta tela.');await loadAll();route()}catch(err){toast(err.message,true);await loadAll();route()}})}}
setInterval(async()=>{if(staticPortal)return;try{catalog=await api('/api/status');updateHeader()}catch{}},300000);
window.addEventListener('hashchange',route);document.querySelector('#menuBtn').addEventListener('click',()=>document.querySelector('#nav').classList.toggle('open'));document.querySelector('#nav').addEventListener('click',()=>document.querySelector('#nav').classList.remove('open'));
loadAll().then(route).catch(err=>{app.innerHTML=`<div class="container section"><div class="empty"><h2>Não foi possível carregar o portal.</h2><p>${escapeHtml(err.message)}</p></div></div>`});
