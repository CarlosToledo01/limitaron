(function(){
  const COLORS = {
    bgLight: '#ffffff',
    text: '#111827',
    breakerFeed: '#dc2626',
    breakerBranch: '#dc2626',
    ground: '#15803d',
    vdWarn: '#dc2626',
    phaseBar: {1:'#1d4ed8',2:'#059669',3:'#d97706'},
    phaseZone: {1:'#e0f2fe',2:'#dcfce7',3:'#fef3c7'}
  };
  const T = v => (v==null || Number.isNaN(v)) ? '—' : v;

  /* ===== Símbolos ===== */
  function symbolBreaker(x,y){
    const r=18;
    return `<path d="M${x} ${y-r} A ${r} ${r} 0 0 1 ${x} ${y+r}" stroke="#000" stroke-width="2" fill="none"/>`;
  }
  function symbolGround(x,y){
    return `<g stroke="${COLORS.ground}" stroke-width="2">
      <line x1="${x}" y1="${y}" x2="${x}" y2="${y+14}"/>
      <line x1="${x-10}" y1="${y+14}" x2="${x+10}" y2="${y+14}"/>
      <line x1="${x-6}" y1="${y+20}" x2="${x+6}" y2="${y+20}"/>
      <line x1="${x-3}" y1="${y+26}" x2="${x+3}" y2="${y+26}"/>
    </g>`;
  }
  function symbolLamp(x,y){
    return `<g stroke="#000" stroke-width="2" fill="none">
      <circle cx="${x}" cy="${y}" r="14"/>
      <line x1="${x-10}" y1="${y-10}" x2="${x+10}" y2="${y+10}"/>
      <line x1="${x+10}" y1="${y-10}" x2="${x-10}" y2="${y+10}"/>
    </g>`;
  }
  function symbolRecept(x,y){
    return `<g stroke="#000" stroke-width="2" fill="none">
      <rect x="${x-14}" y="${y-14}" width="28" height="28"/>
      <line x1="${x-14}" y1="${y-7}" x2="${x+14}" y2="${y-7}" stroke="#666" stroke-dasharray="3 3"/>
      <line x1="${x-14}" y1="${y+7}" x2="${x+14}" y2="${y+7}" stroke="#666" stroke-dasharray="3 3"/>
    </g>`;
  }
  function symbolSpecial(x,y){
    return `<g stroke="#000" stroke-width="2" fill="#fff">
      <polygon points="${x},${y-16} ${x+14},${y} ${x},${y+16} ${x-14},${y}"/>
      <line x1="${x-10}" y1="${y-6}" x2="${x+10}" y2="${y-6}" stroke="#666"/>
      <line x1="${x-10}" y1="${y+6}" x2="${x+10}" y2="${y+6}" stroke="#666"/>
    </g>`;
  }
  function symbolPump(x,y){
    return `<g stroke="#000" stroke-width="2" fill="none">
      <circle cx="${x}" cy="${y}" r="15"/>
      <path d="M${x-10} ${y+8} C ${x} ${y-14} ${x} ${y-14} ${x+10} ${y+8}" stroke="#000" fill="none"/>
    </g>`;
  }
  // NUEVO: símbolo para "Contacto específico" (usamos receptáculo, pero lo etiquetamos como dedicado)
  function symbolSpecific(x,y){
    return `<g stroke="#000" stroke-width="2" fill="none">
      <rect x="${x-15}" y="${y-15}" width="30" height="30" rx="4" ry="4"/>
      <circle cx="${x-6}" cy="${y}" r="3" fill="#000"/>
      <circle cx="${x+6}" cy="${y}" r="3" fill="#000"/>
    </g>`;
  }

  /* ===== Preparación de datos ===== */
  function buildCircuits(s){
    const byId = new Map();
    (s.derived_proposal||[]).forEach(ci=>{
      const id = `${ci.key}_${ci.circuito_index}`;
      byId.set(id,{
        id, idx:ci.idx, tipo:ci.tipo, items:ci.items, VA:ci.VA,
        breaker:ci.breaker, cal:ci.cal, L_m:ci.L_m, vd_pct:ci.vd_pct
      });
    });
    const circuits=[];
    if(s.balanceEnabled && s.phase_balance?.assignment?.length){
      s.phase_balance.assignment.forEach(a=>{
        const base=byId.get(a.id)||{};
        circuits.push({...base, fase:a.fase, id:a.id});
      });
    } else {
      const defF = (s.sistema==='Trifásico'?1:(s.sistema==='Bifásico'?1:1));
      byId.forEach(c=> circuits.push({...c,fase:defF}));
    }
    circuits.sort((a,b)=> (a.idx??0)-(b.idx??0));
    return circuits;
  }

  function computePhaseZones(circuits, marginLeft, stepX){
    const zones=[];
    let currentF=null, startIndex=0;
    circuits.forEach((c,i)=>{
      if(currentF==null){ currentF=c.fase; startIndex=i; }
      else if(c.fase!==currentF){
        zones.push({fase:currentF, x:marginLeft + startIndex*stepX, w:(i-startIndex)*stepX});
        currentF=c.fase; startIndex=i;
      }
    });
    if(currentF!=null){
      zones.push({fase:currentF, x:marginLeft + startIndex*stepX, w:(circuits.length-startIndex)*stepX});
    }
    return zones;
  }

  /* ===== Render principal ===== */
  function generateSLD(s, opts={}){
    const circuits = buildCircuits(s);
    const n = circuits.length;

    const marginLeft=100;
    const marginRight=100;
    const stepX=170;
    const lineGap=18;

    const width = marginLeft + marginRight + Math.max(n,1)*stepX;
    const centerX = width/2;

    const headerY=30;
    const busY = headerY + 170;
    const loadY = busY + 320;
    const groundYBase = loadY + 70;
    const height = groundYBase + 170;

    const vdAlimTxt = (s.vd_alim!=null)? `${s.vd_alim.toFixed(2)}%`:'—';

    const header=`
      <text x="${centerX}" y="${headerY}" font-size="22" text-anchor="middle" fill="${COLORS.text}" font-weight="700">
        ${s.sistema} • Alimentador: ${T(s.cal_alim)} • Int=<tspan fill="${COLORS.breakerFeed}">${T(s.proteccion)}A</tspan>
      </text>
      <text x="${centerX}" y="${headerY+26}" font-size="14" text-anchor="middle" fill="${COLORS.text}">
        Long=${T(s.largo_alim_m)}m • VD=${vdAlimTxt} • Tierra=${s.ground?.calibre||'—'} • Tubo=${T(s.tubo)}
      </text>
      ${s.balanceEnabled && s.phase_balance ? `
      <text x="${centerX}" y="${headerY+26+lineGap}" font-size="15" text-anchor="middle"
        fill="${s.phase_balance.desbalance_pct>5?COLORS.phaseBar[3]:COLORS.ground}" font-weight="700">
        Desbalance: ${s.phase_balance.desbalance_pct.toFixed(2)}% (≤5%)
      </text>`:''}
    `;

    const zones = computePhaseZones(circuits, marginLeft, stepX);

    const busStartX = marginLeft;
    const busEndX = marginLeft + Math.max(n-1,0)*stepX;
    const busBlack = `<line x1="${busStartX}" y1="${busY}" x2="${busEndX}" y2="${busY}" stroke="#000" stroke-width="8" stroke-linecap="round"/>`;

    const phaseBars = zones.map(z=>{
      const limitX1 = Math.max(z.x, busStartX);
      const limitX2 = Math.min(z.x+z.w, busEndX);
      const w = Math.max(0, limitX2 - limitX1);
      return `
        <g>
          <rect x="${limitX1}" y="${busY-60}" width="${w}" height="260" fill="${COLORS.phaseZone[z.fase]||'#f1f5f9'}" opacity="0.50"/>
          <text x="${limitX1+4}" y="${busY-66}" font-size="14" font-weight="700" fill="${COLORS.phaseBar[z.fase]||'#374151'}">F${z.fase}</text>
        </g>
      `;
    }).join('');

    // Helper: obtener "tubo" por tipo
    function tuboForType(tipo){
      const cpm = s.conduit_per_module || {};
      if(tipo==='Luminarias') return cpm.luminarias?.tubo;
      if(tipo==='Contactos') return cpm.contactos?.tubo;
      if(tipo==='Contacto especial') return cpm.contactos_especiales?.tubo;
      if(tipo==='Bomba') return cpm.bombas?.tubo;
      if(tipo==='Contacto específico') return cpm.contactos_especificos?.tubo; // NUEVO
      return undefined;
    }

    let body='';
    circuits.forEach((ci,i)=>{
      const x = marginLeft + i*stepX;
      const breakerY = busY + 95;
      const verticalEnd = busY + 280;
      const groundY = groundYBase;
      const conductorColor = COLORS.phaseBar[ci.fase] || '#000';

      let loadSymbol;
      if(ci.tipo==='Luminarias') loadSymbol = symbolLamp(x, loadY);
      else if(ci.tipo==='Contactos') loadSymbol = symbolRecept(x, loadY);
      else if(ci.tipo==='Contacto especial') loadSymbol = symbolSpecial(x, loadY);
      else if(ci.tipo==='Bomba') loadSymbol = symbolPump(x, loadY);
      else if(ci.tipo==='Contacto específico') loadSymbol = symbolSpecific(x, loadY); // NUEVO
      else loadSymbol = symbolLamp(x, loadY);

      const vdText = ci.vd_pct!=null? `${ci.vd_pct.toFixed(2)}%`:'—';
      const vdColor = (ci.vd_pct!=null && ci.vd_pct>3)? COLORS.vdWarn : COLORS.text;

      const t1 = breakerY+22;
      const t2 = t1 + lineGap;
      const t3 = t2 + lineGap;
      const t4 = t3 + lineGap;

      // Canalización (tubo) por tipo de circuito – incluye contactos específicos
      const tubo = tuboForType(ci.tipo);
      const tuboY = groundY + 68;

      // Etiqueta amigable del tipo
      function tipoLabel(tipo){
        if(tipo==='Luminarias') return 'LUMINARIAS';
        if(tipo==='Contactos') return 'CONTACTOS';
        if(tipo==='Contacto especial') return 'Contacto especial';
        if(tipo==='Contacto específico') return 'Contacto específico';
        if(tipo==='Bomba') return 'Bomba';
        return String(tipo||'CIRCUITO');
      }

      const itemsIsDedicated = (ci.tipo==='Contacto especial' || ci.tipo==='Bomba' || ci.tipo==='Contacto específico');
      const itemsText = itemsIsDedicated ? '' : ` ${T(ci.items)||1}`;

      body += `
        <g>
          <line x1="${x}" y1="${busY}" x2="${x}" y2="${verticalEnd}" stroke="${conductorColor}" stroke-width="7"/>
          ${symbolBreaker(x, breakerY)}
          <text x="${x}" y="${breakerY-40}" font-size="15" text-anchor="middle" fill="${COLORS.breakerBranch}" font-weight="700">
            ${T(ci.breaker)}A
          </text>
          <text x="${x}" y="${busY-26}" font-size="15" text-anchor="middle" fill="${COLORS.text}" font-weight="700">
            C${T(ci.idx)}
          </text>
          <text x="${x}" y="${t1}" font-size="12" text-anchor="middle" fill="${COLORS.text}">
            ${Math.round(ci.VA||0)} VA
          </text>
          <text x="${x}" y="${t2}" font-size="12" text-anchor="middle" fill="${COLORS.text}">
            ${T(ci.cal)} TW
          </text>
          <text x="${x}" y="${t3}" font-size="12" text-anchor="middle" fill="${COLORS.text}">
            Fase F${T(ci.fase)}
          </text>
          <text x="${x}" y="${t4}" font-size="12" text-anchor="middle" fill="${vdColor}">
            L=${T(ci.L_m)}m • VD=${vdText}
          </text>
          ${loadSymbol}
          <text x="${x}" y="${loadY+42}" font-size="12" text-anchor="middle" fill="#000" font-weight="600">
            ${tipoLabel(ci.tipo)}${itemsText}
          </text>
          ${symbolGround(x, groundY)}
          <text x="${x}" y="${groundY+54}" font-size="11" text-anchor="middle" fill="${COLORS.ground}">
            Tierra ${s.ground?.calibre||'—'}
          </text>
          ${tubo ? `<text x="${x}" y="${tuboY}" font-size="11" text-anchor="middle" fill="#374151">Tubo ${tubo}</text>`:''}
        </g>
      `;
    });

    return `
      <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"
           xmlns="http://www.w3.org/2000/svg"
           style="background:${COLORS.bgLight}; font-family:Arial, system-ui;">
        ${header}
        ${phaseBars}
        ${busBlack}
        ${body}
      </svg>
    `;
  }

  window.generateSLD = generateSLD;
})();
