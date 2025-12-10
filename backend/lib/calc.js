'use strict';

const { computeFeederVDPercent } = require('./vd');

/* ===================== CONFIG / CONSTANTES ===================== */
const VOLTAJE_CALC = 120; // usado solo en algunos textos; las fórmulas nuevas usan bases fijas abajo
const MONO_LIM_kW  = 5;
const BIFA_LIM_kW  = 10;

const AMPACIDAD = { '14AWG':15,'12AWG':20,'10AWG':30,'8AWG':40,'6AWG':55,'4AWG':70,'2AWG':95 };
const ZEFF_OHMKM = { '14AWG':8.90,'12AWG':5.60,'10AWG':3.60,'8AWG':2.26,'6AWG':1.51,'4AWG':1.21,'2AWG':0.98 };
const AREA_CONDUCTOR = { '14AWG':2.08,'12AWG':3.31,'10AWG':15.68,'8AWG':8.37,'6AWG':13.3,'4AWG':21.1,'2AWG':33.6 };
const AREA_TUBERIA   = { '1/2"':176,'3/4"':304,'1"':520,'1-1/4"':884,'1-1/2"':1272,'2"':2108,'2-1/2"':3783,'3"':5701 };

const TARGET_VA_x_CIRCUITO_GENERAL = 1500;
const LONG_ALIMENTADOR_m_DEF = 15;
const LONG_DERIVADOS_m_DEF   = 10;
const MAX_FOCOS_POR_CIRCUITO = 12;
const MAX_CONTACTOS_POR_CIRCUITO = 10;
const POT_CONTACTO_VA = 180;
const POT_CONTACTO_ESPECIAL_VA = 2400;

const VD_FEEDER_MAX_PCT = 2.0;
const VD_BRANCH_MAX_PCT = 3.0;
const VD_TOTAL_MAX_PCT  = 5.0;

const STANDARD_BREAKERS = [15,20,25,30,35,40,45,50,60,70,80,90,100,110,125,150,175,200];
const MIN_BREAKER_A = 15;

const CRITERIA_URL = 'http://bit.ly/4o4q4Zf';

/* Bases fijas solicitadas */
const V_MONO_EN = 120;      // En: línea-neutro
const V_BIFA_EN = 120;      // En para fórmula 2f-3h (DERIVADOS: En=120 V)
const V_TRIFA_EF = 220;     // Ef: línea-línea
const FP_TRIFA   = 0.86;

/* ===================== UTILIDADES ===================== */
const num  = x => Number.isFinite(Number(x)) ? Number(x) : 0;
const sum  = arr => Array.isArray(arr)? arr.reduce((a,b)=>a+num(b),0):0;
const avg  = arr => arr && arr.length? sum(arr)/arr.length : 0;

function generarFolio(){
  const letras = Array.from({length:4}, ()=> 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'[Math.floor(Math.random()*26)]).join('');
  const d=new Date(); const pad=(n,z=2)=>String(n).padStart(z,'0');
  return `LIM-${letras}-${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}-${pad(d.getMilliseconds(),3)}`;
}

/* Corriente por tipo de conexión (fijo) */
function corrientePorTipo(P_W, tipo){
  const P = Math.max(0, num(P_W));
  if(tipo==='bifa') return P / (Math.SQRT2 * 220);
  if(tipo==='trifa') return P / (Math.sqrt(3) * V_TRIFA_EF * FP_TRIFA);
  // mono
  return P / V_MONO_EN;
}

/* VD derivado por tipo de conexión (fijo) */
function vdBranchPorTipo(I, L_m, calibreAWG, tipo){
  const Z = ZEFF_OHMKM[calibreAWG]; if(!Z || !I || !L_m) return null;
  const L = Math.max(0, num(L_m));
  const Ieff = Math.max(0, num(I));
  if(tipo==='bifa'){
    // 2f-3h: %e = (I * L * Z) / (En * 10) con En=120 (DERIVADOS)
    return (Ieff * L * Z) / (V_BIFA_EN * 10);
  }
  if(tipo==='trifa'){
    // 3f-4h: %e = (√3 * I * L * Z) / (Ef * 10) con Ef=220
    return (Math.sqrt(3) * Ieff * L * Z) / (V_TRIFA_EF * 10);
  }
  // 1f-2h: %e = (2 * I * L * Z) / (En * 10) con En=120
  return (2 * Ieff * L * Z) / (V_MONO_EN * 10);
}

function seleccionarCalibre(I){
  for(const [awg,amp] of Object.entries(AMPACIDAD)) if(I<=amp) return awg;
  return '2AWG';
}
function nearestStandardBreaker(I){
  for(const b of STANDARD_BREAKERS) if(I<=b) return b;
  return STANDARD_BREAKERS[STANDARD_BREAKERS.length-1];
}
function circuitsFor(count,maxPer,totalVA){
  const byCount = num(count)>0 ? Math.ceil(num(count)/maxPer):0;
  const byVA    = num(totalVA)>0? Math.ceil(num(totalVA)/TARGET_VA_x_CIRCUITO_GENERAL):0;
  if(!byCount && !byVA) return 0;
  return Math.max(byCount,byVA,1);
}
function splitCount(count,n){
  count=Math.max(0,Math.floor(num(count)));
  n=Math.max(0,Math.floor(n));
  if(n<=0) return [];
  const base=Math.floor(count/n);
  let rem=count-base*n;
  const arr=Array.from({length:n},()=>base);
  let i=0; while(rem>0){ arr[i++%n]++; rem--; }
  return arr;
}
function toLengthsArray(v,len,fallback){
  const a = Array.isArray(v)? v.map(num) :
            (typeof v==='string' && v.trim()? v.split(',').map(s=>num(s.trim())):[]);
  const out=[];
  for(let i=0;i<len;i++){
    const val=num(a[i]);
    out.push(val>0?val:fallback);
  }
  return out;
}
function branchBreakerByCurrent(I){
  I = Math.max(0,num(I));
  if(I<=12) return 15;
  if(I<=16) return 20;
  if(I<=24) return 30;
  if(I<=32) return 40;
  if(I<=40) return 50;
  return 50;
}
function selectGroundCalibre(protA){
  const b=nearestStandardBreaker(protA||MIN_BREAKER_A);
  const map={
    15:{awg:'14AWG',mm2:2.08},20:{awg:'12AWG',mm2:3.31},25:{awg:'12AWG',mm2:3.31},
    30:{awg:'10AWG',mm2:15.68},35:{awg:'10AWG',mm2:15.68},40:{awg:'10AWG',mm2:15.68},
    50:{awg:'8AWG',mm2:8.37},60:{awg:'6AWG',mm2:13.3},80:{awg:'4AWG',mm2:21.1},
    100:{awg:'4AWG',mm2:21.1},125:{awg:'2AWG',mm2:33.6},150:{awg:'2AWG',mm2:33.6},
    175:{awg:'2AWG',mm2:33.6},200:{awg:'2AWG',mm2:33.6}
  };
  return map[b] || map[MIN_BREAKER_A];
}
function seleccionarMangueraConTierra(numPortadores,calibre,groundCalibre){
  const areaCon=AREA_CONDUCTOR[calibre]||0;
  const areaGnd=AREA_CONDUCTOR[groundCalibre]||0;
  const areaTotal=(numPortadores*areaCon)+areaGnd;
  for(const [tubo,areaInt] of Object.entries(AREA_TUBERIA)){
    const max40=areaInt*0.40;
    if(areaTotal<=max40){
      return { tubo, ocupacion_pct:(areaTotal/areaInt)*100, area_total_mm2:areaTotal, pct_sobre_40:(areaTotal/max40)*100 };
    }
  }
  const last=Object.keys(AREA_TUBERIA).slice(-1)[0];
  return { tubo:'≥'+last, ocupacion_pct:null, area_total_mm2:areaTotal, pct_sobre_40:null };
}

/* ===================== BALANCE ===================== */
const numSafe = v => Number.isFinite(Number(v)) ? Number(v) : 0;
function calcDesbalancePctRobusto(totals){
  const vals=(totals||[]).map(numSafe).filter(v=>Number.isFinite(v));
  if(!vals.length) return 0;
  const positives=vals.filter(v=>v>0);
  if(!positives.length) return 0;
  const maxVA=Math.max(...positives);
  const minVA=Math.min(...positives);
  return maxVA>0? ((maxVA-minVA)/maxVA)*100 : 0;
}
function buildBalanceItemsFromProposal(derived){
  return (derived||[]).map(ci=>({
    id: `${ci.key}_${ci.circuito_index}`,
    VA: numSafe(ci.VA),
    tipo: ci.tipo,
    key: ci.key,
    circuito_index: ci.circuito_index,
    idx: numSafe(ci.idx),
    tipo_conexion: ci.tipo_conexion || 'mono'
  }));
}
function balancearFases(phaseCount, items){
  const phases=Array.from({length:phaseCount},(_,i)=>({idx:i,totalVA:0,circuits:[]}));
  const sorted=[...items].sort((a,b)=> numSafe(b.VA)-numSafe(a.VA));
  for(const it of sorted){
    phases.sort((a,b)=> a.totalVA-b.totalVA);
    phases[0].circuits.push(it);
    phases[0].totalVA+=numSafe(it.VA);
  }
  const totals=phases.map(p=>p.totalVA);
  const desb=calcDesbalancePctRobusto(totals);
  const assignment=[];
  phases.forEach(p=>{
    p.circuits.forEach(ci=>{
      assignment.push({ id:ci.id,key:ci.key,circuito_index:ci.circuito_index,tipo:ci.tipo,VA:ci.VA,fase:p.idx+1,idx:ci.idx, tipo_conexion: ci.tipo_conexion });
    });
  });
  return { phases, totals, desbalance_pct: Number(desb.toFixed(2)), assignment };
}
function applyManualPhaseAssignments(phaseCount, items, manual){
  const map=new Map((manual||[]).map(m=> [m.id,numSafe(m.fase)]));
  const phases=Array.from({length:phaseCount},(_,i)=>({idx:i,totalVA:0,circuits:[]}));
  const pending=[];
  for(const ci of items){
    const f=map.get(ci.id);
    if(f && f>=1 && f<=phaseCount){
      phases[f-1].circuits.push(ci);
      phases[f-1].totalVA+=numSafe(ci.VA);
    }else pending.push(ci);
  }
  for(const ci of pending){
    phases.sort((a,b)=> a.totalVA-b.totalVA);
    phases[0].circuits.push(ci);
    phases[0].totalVA+=numSafe(ci.VA);
  }
  const totals=phases.map(p=>p.totalVA);
  const desb=calcDesbalancePctRobusto(totals);
  const assignment=[];
  phases.forEach(p=>{
    p.circuits.forEach(ci=>{
      assignment.push({ id:ci.id,key:ci.key,circuito_index:ci.circuito_index,tipo:ci.tipo,VA:ci.VA,fase:p.idx+1,idx:ci.idx, tipo_conexion: ci.tipo_conexion });
    });
  });
  return { phases, totals, desbalance_pct:Number(desb.toFixed(2)), assignment };
}

/* ===================== CÁLCULO ===================== */
function calcularSistema(p, forcedMode){
  const Focos=num(p.Focos);
  const PotFoco=num(p.PotFoco_W);
  const Contactos=num(p.Contactos);
  const Bombas=num(p.Bombas);
  let bombasHP=Array.isArray(p.Bombas_HP_List)? p.Bombas_HP_List.map(num):[];
  if(Bombas>0 && bombasHP.length===0) bombasHP=Array.from({length:Bombas},()=>1);
  if(bombasHP.length!==Bombas){ bombasHP=bombasHP.slice(0,Bombas); while(bombasHP.length<Bombas) bombasHP.push(1); }

  // Tipos conexión de bombas
  let bombasTipos = Array.isArray(p.Bombas_Tipos_List)? p.Bombas_Tipos_List.map(x=> String(x||'mono').toLowerCase()) : [];
  if(bombasTipos.length!==Bombas){ bombasTipos=bombasTipos.slice(0,Bombas); while(bombasTipos.length<Bombas) bombasTipos.push('mono'); }

  const ContactosEspeciales=num(p.ContactosEspeciales);
  const includeEspeciales=(forcedMode==='mono' || forcedMode==='auto');

  // Contactos específicos
  const ContactosEspecificos_Cant = num(p.ContactosEspecificos_Cant);
  let ContactosEspecificos_W_List = Array.isArray(p.ContactosEspecificos_W_List) ? p.ContactosEspecificos_W_List.map(num) : [];
  let ContactosEspecificos_Tipos_List = Array.isArray(p.ContactosEspecificos_Tipos_List) ? p.ContactosEspecificos_Tipos_List.map(x=> String(x||'mono').toLowerCase()) : [];
  if (ContactosEspecificos_Cant>0) {
    if (ContactosEspecificos_W_List.length > ContactosEspecificos_Cant) ContactosEspecificos_W_List = ContactosEspecificos_W_List.slice(0, ContactosEspecificos_Cant);
    if (ContactosEspecificos_W_List.length < ContactosEspecificos_Cant) ContactosEspecificos_W_List = [...ContactosEspecificos_W_List, ...Array(ContactosEspecificos_Cant - ContactosEspecificos_W_List.length).fill(0)];
    if (ContactosEspecificos_Tipos_List.length > ContactosEspecificos_Cant) ContactosEspecificos_Tipos_List = ContactosEspecificos_Tipos_List.slice(0, ContactosEspecificos_Cant);
    if (ContactosEspecificos_Tipos_List.length < ContactosEspecificos_Cant) ContactosEspecificos_Tipos_List = [...ContactosEspecificos_Tipos_List, ...Array(ContactosEspecificos_Cant - ContactosEspecificos_Tipos_List.length).fill('mono')];
  }

  const L_alim_m=num(p.largo_alim_m)||LONG_ALIMENTADOR_m_DEF;

  // Cálculo VA base y recomendación preliminar
  const VA_focos=Focos*PotFoco;
  const VA_contactos=Contactos*POT_CONTACTO_VA;
  const VA_bombas_total=sum(bombasHP)*746;
  const VA_especial= includeEspeciales? (ContactosEspeciales*POT_CONTACTO_ESPECIAL_VA):0;
  const VA_contactos_especificos_total = sum(ContactosEspecificos_W_List);

  const VA_instalada_total_pre = VA_focos + VA_contactos + VA_bombas_total + VA_especial + VA_contactos_especificos_total;
  const VA_demanda_total_pre = VA_instalada_total_pre <= 3000 ? VA_instalada_total_pre : 3000 + (VA_instalada_total_pre - 3000)*0.35;
  const kW_pre = VA_demanda_total_pre/1000;
  const recomendado = kW_pre<=MONO_LIM_kW ? 'Monofásico' : kW_pre<=BIFA_LIM_kW ? 'Bifásico' : 'Trifásico';

  let sistema;
  if(forcedMode==='mono') sistema='Monofásico';
  else if(forcedMode==='bifa') sistema='Bifásico';
  else if(forcedMode==='trifa') sistema='Trifásico';
  else sistema=recomendado;

  // Validación por sistema
  function isTipoValido(tipo, sistema){
    if(sistema==='Monofásico') return tipo==='mono';
    if(sistema==='Bifásico') return (tipo==='mono' || tipo==='bifa');
    if(sistema==='Trifásico') return (tipo==='mono' || tipo==='bifa' || tipo==='trifa');
    return true;
  }
  const bombasValidMask = bombasTipos.map(t=> isTipoValido(t, sistema));
  const cspValidMask = ContactosEspecificos_Tipos_List.map(t=> isTipoValido(t, sistema));

  // Demanda: excluir cargas inválidas
  const VA_bombas_valid = bombasHP.reduce((acc,hp,i)=> acc + (bombasValidMask[i]? hp*746 : 0), 0);
  const VA_csp_valid    = ContactosEspecificos_W_List.reduce((acc,W,i)=> acc + (cspValidMask[i]? W : 0), 0);

  const VA_instalada_total = VA_focos + VA_contactos + VA_especial + VA_bombas_valid + VA_csp_valid;
  const VA_demanda_total = VA_instalada_total <= 3000 ? VA_instalada_total : 3000 + (VA_instalada_total - 3000)*0.35;
  const kW = VA_demanda_total/1000;

  const I_alim=VA_demanda_total/V_MONO_EN; // alimentador usa 120 V base para texto; vdFeeder calcula según sistema
  const cal_alim=seleccionarCalibre(I_alim);

  // VD alimentador
  const vdFeeder = computeFeederVDPercent({ sistema, I: I_alim, L_m: L_alim_m, calibre: cal_alim });
  const vd_alim = vdFeeder.vd_pct;
  const vd_Vbase = vdFeeder.Vbase;
  const vd_formula = vdFeeder.formula;
  const Z_alim_ohm_km = vdFeeder.Z_ohm_km;

  const prot_candidato=nearestStandardBreaker(I_alim);
  const proteccion=Math.max(MIN_BREAKER_A, Math.min(prot_candidato, nearestStandardBreaker(AMPACIDAD[cal_alim]||prot_candidato)));

  /* Derivados estándar (mono por diseño) */
  const nFocos=circuitsFor(Focos,MAX_FOCOS_POR_CIRCUITO,VA_focos);
  const count_focos_list=splitCount(Focos,nFocos);
  const I_focos_list=count_focos_list.map(cnt=> corrientePorTipo(cnt*PotFoco, 'mono'));
  const I_circ_focos_worst=I_focos_list.length? Math.max(...I_focos_list):0;
  const cal_focos= I_circ_focos_worst>0 ? seleccionarCalibre(I_circ_focos_worst):null;
  const int_focos=nFocos>0? branchBreakerByCurrent(I_circ_focos_worst):0;

  const nContactos=circuitsFor(Contactos,MAX_CONTACTOS_POR_CIRCUITO,VA_contactos);
  const count_cont_list=splitCount(Contactos,nContactos);
  const I_cont_list=count_cont_list.map(cnt=> corrientePorTipo(cnt*POT_CONTACTO_VA, 'mono'));
  const I_circ_cont_worst=I_cont_list.length? Math.max(...I_cont_list):0;
  const cal_cont= I_circ_cont_worst>0? seleccionarCalibre(I_circ_cont_worst):null;
  const int_contactos=nContactos>0? branchBreakerByCurrent(I_circ_cont_worst):0;

  const nContactosEspeciales=includeEspeciales? ContactosEspeciales:0;
  const I_circ_especial=(includeEspeciales && nContactosEspeciales>0)? corrientePorTipo(POT_CONTACTO_ESPECIAL_VA, 'mono') :0;
  const cal_especial= I_circ_especial>0? seleccionarCalibre(I_circ_especial):null;
  const int_contactos_especiales= nContactosEspeciales>0? branchBreakerByCurrent(I_circ_especial):0;

  /* Bombas (I por tipo, VD por tipo) */
  const nBombas=bombasHP.length;
  const P_bombas_W = bombasHP.map(hp=> num(hp)*746);
  const I_bomba_list = P_bombas_W.map((P,i)=> corrientePorTipo(P, bombasTipos[i]||'mono'));
  const cal_bomba_list=I_bomba_list.map(I=> seleccionarCalibre(I||0.0001));
  const int_bomba_list=I_bomba_list.map(I=> branchBreakerByCurrent(I));
  const L_bombas=toLengthsArray(p.L_bombas,nBombas,LONG_DERIVADOS_m_DEF);
  const vd_bomba_list=I_bomba_list.map((I,i)=> vdBranchPorTipo(I, L_bombas[i], cal_bomba_list[i], bombasTipos[i]||'mono'));

  /* Longitudes y VD por grupos mono */
  const L_focos=toLengthsArray(p.L_focos,nFocos,LONG_DERIVADOS_m_DEF);
  const L_cont =toLengthsArray(p.L_contactos,nContactos,LONG_DERIVADOS_m_DEF);
  const L_esp  =toLengthsArray(p.L_especiales,nContactosEspeciales,LONG_DERIVADOS_m_DEF);

  const vd_focos_list=(cal_focos && nFocos>0)
    ? count_focos_list.map((cnt,i)=> vdBranchPorTipo(corrientePorTipo(cnt*PotFoco,'mono'), L_focos[i], cal_focos, 'mono'))
    : [];
  const vd_cont_list=(cal_cont && nContactos>0)
    ? count_cont_list.map((cnt,i)=> vdBranchPorTipo(corrientePorTipo(cnt*POT_CONTACTO_VA,'mono'), L_cont[i], cal_cont, 'mono'))
    : [];
  const vd_especial_list=(cal_especial && nContactosEspeciales>0)
    ? Array.from({length:nContactosEspeciales},(_,i)=> vdBranchPorTipo(I_circ_especial, L_esp[i], cal_especial, 'mono'))
    : [];

  /* Contactos específicos (I y VD por tipo) */
  const nContactosEspecificos = ContactosEspecificos_W_List.length;
  const I_csp_list = ContactosEspecificos_W_List.map((W,i)=> corrientePorTipo(W, ContactosEspecificos_Tipos_List[i]||'mono'));
  const cal_csp_list = I_csp_list.map(I => seleccionarCalibre(I||0.0001));
  const int_csp_list = I_csp_list.map(I => branchBreakerByCurrent(I));
  const L_csp = toLengthsArray(p.L_contactosEspecificos, nContactosEspecificos, LONG_DERIVADOS_m_DEF);
  const vd_csp_list = I_csp_list.map((I,i)=> vdBranchPorTipo(I, L_csp[i], cal_csp_list[i], ContactosEspecificos_Tipos_List[i]||'mono'));

  const vd_focos=vd_focos_list.length? avg(vd_focos_list):null;
  const vd_cont =vd_cont_list.length? avg(vd_cont_list):null;
  const vd_especial=vd_especial_list.length? avg(vd_especial_list):null;
  const vd_csp = vd_csp_list.length? avg(vd_csp_list):null;

  /* Propuesta derivada (incluye tipo_conexion y validez) */
  const derived_proposal=[];
  let idx=1;
  for(let i=0;i<nFocos;i++){
    const items=count_focos_list[i]||0;
    const VAci=items*PotFoco;
    derived_proposal.push({ idx:idx++, tipo:'Luminarias', key:'focos', circuito_index:i, items, VA:VAci, I:I_focos_list[i], cal:cal_focos||null, breaker:int_focos||0, L_m:L_focos[i]||LONG_DERIVADOS_m_DEF, vd_pct: vd_focos_list[i]??null, tipo_conexion:'mono', valido:true });
  }
  for(let i=0;i<nContactos;i++){
    const items=count_cont_list[i]||0;
    const VAci=items*POT_CONTACTO_VA;
    derived_proposal.push({ idx:idx++, tipo:'Contactos', key:'contactos', circuito_index:i, items, VA:VAci, I:I_cont_list[i], cal:cal_cont||null, breaker:int_contactos||0, L_m:L_cont[i]||LONG_DERIVADOS_m_DEF, vd_pct: vd_cont_list[i]??null, tipo_conexion:'mono', valido:true });
  }
  for(let i=0;i<nContactosEspeciales;i++){
    derived_proposal.push({ idx:idx++, tipo:'Contacto especial', key:'especiales', circuito_index:i, items:1, VA:POT_CONTACTO_ESPECIAL_VA, I:I_circ_especial, cal:cal_especial||null, breaker:int_contactos_especiales||0, L_m:L_esp[i]||LONG_DERIVADOS_m_DEF, vd_pct: vd_especial_list[i]??null, tipo_conexion:'mono', valido:true });
  }
  for(let i=0;i<nBombas;i++){
    const hp=bombasHP[i];
    const VAci=num(hp)*746;
    const tipo=bombasTipos[i]||'mono';
    const valido = isTipoValido(tipo, sistema);
    derived_proposal.push({ idx:idx++, tipo:'Bomba', key:'bombas', circuito_index:i, items:1, hp, VA:VAci, I:I_bomba_list[i], cal:cal_bomba_list[i]||null, breaker:int_bomba_list[i]||0, L_m:L_bombas[i]||LONG_DERIVADOS_m_DEF, vd_pct: vd_bomba_list[i]??null, tipo_conexion:tipo, valido });
  }
  for(let i=0;i<nContactosEspecificos;i++){
    const W = ContactosEspecificos_W_List[i]||0;
    const VAci = W;
    const tipo = ContactosEspecificos_Tipos_List[i]||'mono';
    const valido = isTipoValido(tipo, sistema);
    derived_proposal.push({ idx:idx++, tipo:'Contacto específico', key:'contactosEspecificos', circuito_index:i, items:1, VA:VAci, I:I_csp_list[i]||0, cal:cal_csp_list[i]||null, breaker:int_csp_list[i]||0, L_m:L_csp[i]||LONG_DERIVADOS_m_DEF, vd_pct: vd_csp_list[i]??null, tipo_conexion:tipo, valido });
  }

  /* Balance habilitado y reglas */
  const balanceEnabled =
    (forcedMode==='auto' && (recomendado==='Bifásico' || recomendado==='Trifásico')) ||
    forcedMode==='bifa' || forcedMode==='trifa';
  const phaseCount = balanceEnabled ? (sistema==='Trifásico'?3:(sistema==='Bifásico'?2:1)) : 1;

  function incluirEnBalance(ci){
    if(!ci.valido) return false;
    if(sistema==='Bifásico'){
      if((ci.tipo==='Bomba' || ci.tipo==='Contacto específico') && ci.tipo_conexion==='bifa') return false;
      return true;
    }
    if(sistema==='Trifásico'){
      if((ci.tipo==='Bomba' || ci.tipo==='Contacto específico') && ci.tipo_conexion==='trifa') return false;
      return true;
    }
    return ci.tipo_conexion==='mono';
  }

  let phase_balance=null;
  if(balanceEnabled && phaseCount>1){
    const items=buildBalanceItemsFromProposal(derived_proposal.filter(incluirEnBalance));
    if(Array.isArray(p.PhaseAssignments) && p.PhaseAssignments.length){
      phase_balance=applyManualPhaseAssignments(phaseCount,items,p.PhaseAssignments);
    } else {
      phase_balance=balancearFases(phaseCount,items);
    }
  }

  /* Ground y canalización */
  const groundSel=selectGroundCalibre(proteccion);
  const groundCalibre=groundSel.awg||'14AWG';
  const groundArea_mm2=groundSel.mm2||AREA_CONDUCTOR[groundCalibre]||null;

  let numCond=3;
  if(sistema==='Bifásico') numCond=4;
  if(sistema==='Trifásico') numCond=5;

  const conduit_per_module={
    alimentador: seleccionarMangueraConTierra(Math.max(1,numCond-1),cal_alim,groundCalibre),
    luminarias: seleccionarMangueraConTierra(2,cal_focos||cal_alim,groundCalibre),
    contactos: seleccionarMangueraConTierra(2,cal_cont||cal_alim,groundCalibre),
    contactos_especiales: seleccionarMangueraConTierra(2,cal_especial||cal_alim,groundCalibre),
    bombas: seleccionarMangueraConTierra(2,cal_bomba_list[0]||cal_alim,groundCalibre),
    contactos_especificos: seleccionarMangueraConTierra(2,cal_csp_list[0]||cal_alim,groundCalibre)
  };

  const contactosEspecificos_detalle = ContactosEspecificos_W_List.map((W,i)=>({
    VA: W, I: I_csp_list[i], breaker: int_csp_list[i], cal: cal_csp_list[i], tipo_conexion: ContactosEspecificos_Tipos_List[i]||'mono', valido: cspValidMask[i]
  }));

  /* Advertencias por cargas inválidas */
  const warnings=[];
  if(sistema==='Monofásico'){
    if(bombasValidMask.some(v=>!v)) warnings.push('No es posible conectar bombas bifásicas/trifásicas en sistema monofásico. Estas cargas fueron excluidas.');
    if(cspValidMask.some(v=>!v)) warnings.push('No es posible conectar contactos específicos bifásicos/trifásicos en sistema monofásico. Estas cargas fueron excluidas.');
  }
  if(sistema==='Bifásico'){
    if(bombasTipos.some(t=>t==='trifa')) warnings.push('No es posible conectar bombas trifásicas en sistema bifásico. Estas cargas fueron excluidas.');
    if(ContactosEspecificos_Tipos_List.some(t=>t==='trifa')) warnings.push('No es posible conectar contactos específicos trifásicos en sistema bifásico. Estas cargas fueron excluidas.');
  }

  return {
    ok:true,
    folio: generarFolio(),

    Focos, PotFoco_W:PotFoco, Contactos,
    Bombas:nBombas, Bombas_HP_List:bombasHP, bombas_tipos_list:bombasTipos,
    ContactosEspeciales,

    ContactosEspecificos_Cant: nContactosEspecificos,
    ContactosEspecificos_W_List,
    ContactosEspecificos_Tipos_List,

    largo_alim_m:L_alim_m, largo_der_m:LONG_DERIVADOS_m_DEF,

    VA_focos, VA_contactos, VA_bombas_total: VA_bombas_valid, VA_contactos_especiales:VA_especial,
    VA_contactos_especificos: VA_csp_valid,
    VA_instalada_total, VA_demanda_total, kW,

    I_alim, sistema, recomendado,
    cal_alim, proteccion, vd_alim,
    vd_Vbase, vd_formula, Z_alim_ohm_km,

    nFocos, count_focos_list, I_focos_list, I_circ_focos:I_circ_focos_worst, cal_focos, vd_focos, int_focos,
    nContactos, count_cont_list, I_cont_list, I_circ_cont:I_circ_cont_worst, cal_cont, vd_cont, int_contactos,

    nContactosEspeciales, I_circ_especial, cal_especial, vd_especial, int_contactos_especiales,

    nBombas, I_bomba_list, cal_bomba_list, int_bomba_list, vd_bomba_list, L_bombas,

    nContactosEspecificos, I_csp_list, cal_csp_list, int_csp_list, vd_csp_list, L_csp, vd_csp,

    vd_focos_list, vd_cont_list, vd_especial_list,

    derived_proposal,

    conduit_per_module,
    ground:{ calibre:groundCalibre, area_mm2:groundArea_mm2 },

    phaseCount, phase_balance, balanceEnabled,

    numCond,
    tubo: conduit_per_module.alimentador.tubo,
    ocupacion_pct: conduit_per_module.alimentador.ocupacion_pct,

    contactosEspecificos_detalle,
    warnings
  };
}

/* ===================== RESUMEN TEXTO (ORDEN NUEVO) ===================== */
function resumenLevantamiento(folio, entradas, c){
  const pct = (v,d=2)=> v==null?'—':`${Number(v).toFixed(d)}%`;
  const amp = v => `${Number(v||0).toFixed(2)} A`;
  const va  = v => `${Math.round(v||0)} VA`;

  const lines=[];

  // 1) Resumen de levantamiento
  lines.push('🧾 Resumen de levantamiento');
  lines.push(`Folio: ${folio}`);
  lines.push(`• Focos: ${entradas.Focos||0}  • Contactos: ${entradas.Contactos||0}  • Bombas: ${c.Bombas||0}  • Contactos especiales: ${entradas.ContactosEspeciales||0}`);
  if (c.nContactosEspecificos>0) {
    lines.push(`• Contactos específicos: ${c.nContactosEspecificos} (${(c.ContactosEspecificos_W_List||[]).join(', ')} W)`);
  }
  lines.push(`• Longitud alimentador: ${c.largo_alim_m} m  • Longitud derivado (default): ${c.largo_der_m} m`);
  lines.push('');

  // 2) Tipo de instalación
  lines.push('⚡ Tipo de instalación:');
  lines.push(`${c.sistema} (recomendado: ${c.recomendado})`);
  lines.push('');

  // 3) Demanda
  lines.push('📊 Demanda aproximada');
  lines.push(`• Carga instalada total (válida): ${va(c.VA_instalada_total)}`);
  lines.push(`• Demanda máxima: ${va(c.VA_demanda_total)} (${(c.kW||0).toFixed(3)} kW)`);
  lines.push('');

  // 4) Balance por fase
  if(c.balanceEnabled && c.phase_balance && c.phaseCount>1){
    const totals=c.phase_balance.totals||[];
    const fasesTxt=totals.map((v,i)=>`F${i+1}: ${va(v)}`).join(' • ');
    lines.push('⚖️ Balance de cargas por fase');
    lines.push(`• ${fasesTxt}`);
    lines.push(`• Desbalance: ${pct(c.phase_balance.desbalance_pct)} (lim ≤ 5.00%)`);
    lines.push('');
  }

  // 5) Propuesta de circuitos derivados
  lines.push('🧩 Propuesta de circuitos derivados');
  const showPhase = (c.phaseCount||1) > 1;
  const phaseMap = {};
  if(c.phase_balance?.assignment?.length){
    c.phase_balance.assignment.forEach(a=> { phaseMap[a.id] = a.fase; });
  }
  (c.derived_proposal||[]).forEach(ci=>{
    const itemsTxt=(ci.tipo==='Contacto especial'||ci.tipo==='Bomba'||ci.tipo==='Contacto específico')?'':` (${ci.items})`;
    const conn=ci.tipo_conexion? ` • ${ci.tipo_conexion.toUpperCase()}`:'';
    const id = `${ci.key}_${ci.circuito_index}`;
    const faseTxt = showPhase && phaseMap[id] ? ` (F${phaseMap[id]})` : '';
    lines.push(`• Circuito ${ci.idx}. ${ci.tipo}${itemsTxt}${conn}${faseTxt}${ci.valido?'':' • INVÁLIDO'}`);
  });
  lines.push('');

  // 6) Alimentador
  lines.push('⚡ Alimentador');
  lines.push(`• I_alimentador @120 V: ${amp(c.I_alim)}`);
  lines.push(`• Conductor: Cu THW 60°C ${c.cal_alim} | Interruptor: ${c.proteccion} A`);
  if(c.vd_alim!=null) lines.push(`• VD alimentador: ${pct(c.vd_alim)} (lim 2%)`);
  if(c.conduit_per_module && c.conduit_per_module.alimentador){
    const a=c.conduit_per_module.alimentador;
    lines.push(`• Canalización: ${a.tubo} | Ocupación: ${a.ocupacion_pct? a.ocupacion_pct.toFixed(1)+'%':'—'}`);
  }
  lines.push('');

  // 7) Canalizaciones de derivados
  if(c.conduit_per_module){
    lines.push('🧱 Canalizaciones de derivados');
    const mods = [
      { key:'luminarias', label:'Luminarias' },
      { key:'contactos', label:'Contactos' },
      { key:'contactos_especiales', label:'Contactos especiales' },
      { key:'bombas', label:'Bombas' },
      { key:'contactos_especificos', label:'Contactos específicos' }
    ];
    mods.forEach(m=>{
      const x=c.conduit_per_module[m.key];
      if(x && x.tubo){
        const oc = x.ocupacion_pct!=null ? `${x.ocupacion_pct.toFixed(1)}%` : '—';
        lines.push(`• ${m.label}: ${x.tubo} | Ocupación: ${oc}`);
      }
    });
    lines.push('');
  }

  // 8) Luminarias
  if(c.nFocos>0){
    const VA_circ=c.VA_focos/c.nFocos;
    lines.push('💡 Luminarias');
    lines.push(`• Nº circuitos: ${c.nFocos} | VA/circuito: ${va(VA_circ)}`);
    if(c.vd_focos_list.length){
      const worst=Math.max(...c.vd_focos_list.filter(x=>x!=null));
      lines.push(`• VD peor circuito: ${pct(worst)} (lim 3%)`);
    }
    lines.push(`• Breaker: ${c.int_focos} A | Conductor: ${c.cal_focos||'—'}`);
    lines.push('');
  }

  // 9) Contactos
  if(c.nContactos>0){
    const VA_circ=c.VA_contactos/c.nContactos;
    lines.push('🔌 Contactos');
    lines.push(`• Nº circuitos: ${c.nContactos} | VA/circuito: ${va(VA_circ)}`);
    if(c.vd_cont_list.length){
      const worst=Math.max(...c.vd_cont_list.filter(x=>x!=null));
      lines.push(`• VD peor circuito: ${pct(worst)} (lim 3%)`);
    }
    lines.push(`• Breaker: ${c.int_contactos} A | Conductor: ${c.cal_cont||'—'}`);
    lines.push('');
  }

  // 10) Contactos especiales
  if(c.nContactosEspeciales>0){
    lines.push('🔸 Contactos especiales (2400 VA dedicados)');
    lines.push(`• Cantidad: ${c.nContactosEspeciales} | I ≈ ${amp(c.I_circ_especial)}`);
    if(c.vd_especial_list.length){
      const worst=Math.max(...c.vd_especial_list.filter(x=>x!=null));
      lines.push(`• VD peor circuito: ${pct(worst)} (lim 3%)`);
    }
    lines.push(`• Breaker: ${c.int_contactos_especiales} A | Conductor: ${c.cal_especial||'—'}`);
    lines.push('');
  }

  // 11) Bombas
  if(c.Bombas>0){
    lines.push('🚰 Bombas (circuitos individuales)');
    for(let i=0;i<c.Bombas;i++){
      lines.push(`• Bomba ${i+1}: ${c.Bombas_HP_List[i]} HP • ${c.bombas_tipos_list?.[i]?.toUpperCase()||'MONO'} | I ≈ ${amp(c.I_bomba_list[i])} | Breaker: ${c.int_bomba_list[i]} A | Conductor: ${c.cal_bomba_list[i]} | VD: ${pct(c.vd_bomba_list[i])}`);
    }
    lines.push('');
  }

  // 12) Contactos específicos
  if(c.nContactosEspecificos>0){
    lines.push('🟧 Contactos específicos (circuitos dedicados)');
    for(let i=0;i<c.nContactosEspecificos;i++){
      const W = c.ContactosEspecificos_W_List[i]||0;
      const tipo = c.ContactosEspecificos_Tipos_List?.[i]?.toUpperCase()||'MONO';
      lines.push(`• CE ${i+1}: ${W} W • ${tipo} | I ≈ ${amp(c.I_csp_list[i])} | Breaker: ${c.int_csp_list[i]} A | Conductor: ${c.cal_csp_list[i]} | VD: ${pct(c.vd_csp_list[i])}`);
    }
    lines.push('');
  }

  // Advertencias
  if(Array.isArray(c.warnings) && c.warnings.length){
    lines.push('⚠️ Advertencias');
    c.warnings.forEach(w=> lines.push(`• ${w}`));
    lines.push('');
  }

  // VD total y referencias
  const worstVD=Math.max(
    ...(c.vd_focos_list||[]).filter(x=>x!=null),
    ...(c.vd_cont_list||[]).filter(x=>x!=null),
    ...(c.vd_especial_list||[]).filter(x=>x!=null),
    ...(c.vd_bomba_list||[]).filter(x=>x!=null),
    ...(c.vd_csp_list||[]).filter(x=>x!=null),
    0
  );
  const vdTotal=(c.vd_alim||0)+worstVD;
  lines.push(`📉 VD total estimada ≈ ${pct(vdTotal)} (lim NOM ≈ 5%)`);
  lines.push('');
  lines.push(`📖 Referencia: Tablas 310.15(B)(16), 9, 210-24, 250-122 – NOM‑001‑SEDE‑2012. ${CRITERIA_URL}`);

  return lines.join('\n');
}

module.exports = {
  generarFolio,
  calcularSistema,
  resumenLevantamiento,
  constants:{
    VOLTAJE_CALC,
    POT_CONTACTO_VA,
    POT_CONTACTO_ESPECIAL_VA,
    LONG_ALIMENTADOR_m_DEF,
    LONG_DERIVADOS_m_DEF,
    VD_FEEDER_MAX_PCT,
    VD_BRANCH_MAX_PCT,
    VD_TOTAL_MAX_PCT,
    CRITERIA_URL
  }
};