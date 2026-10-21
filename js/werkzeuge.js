/* ============================================================
   Pult. — Werkzeuge im Kurs (unter „Mehr")
   ------------------------------------------------------------
   Gruppen bilden: Größe oder Anzahl, „heute fehlt", Regeln (nie / immer
   zusammen), optional leistungsgemischt. Ergebnis lässt sich von Hand
   umsortieren, speichern, groß zeigen (Beamer) und drucken.
     c.groups = { rules: [{ id, type: 'apart'|'together', a, b }],
                  saved: [{ id, name, date, groups: [[sId]] }],
                  current: { groups: [[sId]], absent: [sId] } }
   Zufallsaufruf: fair gewichtet — wer länger keine mündliche Note hat,
   kommt eher dran. Timer: groß, mit Ton am Ende.

   Wird vor pult.js geladen: hier stehen nur Definitionen.
   ============================================================ */
'use strict';

/* ---------- Bildschirm wach halten (Beamer, Timer) ---------- */
let wakeLock = null, wakeWanted = false;
async function keepAwake(on) {
  wakeWanted = on;
  try {
    if (on && !wakeLock && navigator.wakeLock) {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    } else if (!on && wakeLock) { await wakeLock.release(); wakeLock = null; }
  } catch (e) { /* nicht unterstützt oder abgelehnt — dann eben ohne */ }
}
/* Das System gibt die Sperre beim Verlassen der App frei — beim Zurückkehren erneuern */
document.addEventListener('visibilitychange', () => { if (!document.hidden && wakeWanted) keepAwake(true); });

/* Großansicht über der App (Beamer): Inhalt + Schließen */
function openStage(html, onClose) {
  closeStage();
  const el = document.createElement('div');
  el.id = 'stage';
  el.innerHTML = `<button class="stage-close" aria-label="Schließen">×</button><div class="stage-body">${html}</div>`;
  document.body.appendChild(el);
  keepAwake(true);
  const onKey = e => { if (e.key === 'Escape' && !document.querySelector('.lockscreen')) { e.stopPropagation(); closeStage(); } };
  document.addEventListener('keydown', onKey, true);
  el.querySelector('.stage-close').onclick = closeStage;
  stageCleanup = () => { document.removeEventListener('keydown', onKey, true); el.remove(); keepAwake(false); if (onClose) onClose(); };
  return el;
}
let stageCleanup = null;
function closeStage() { if (stageCleanup) { const f = stageCleanup; stageCleanup = null; f(); } }

/* ============================================================
   Gruppen
   ============================================================ */
function ensureGroups(c) {
  if (!c.groups) c.groups = { rules: [], saved: [], current: null };
  if (!c.groups.rules) c.groups.rules = [];
  if (!c.groups.saved) c.groups.saved = [];
  return c.groups;
}
const groupOpts = () => Object.assign({ mode: 'size', size: 4, count: 6, mixed: false }, data.meta.groupOpts || {});
let groupMove = null;    // angetippte Person beim Umsortieren

/* Regeln prüfen: Liste der verletzten Regeln */
function groupViolations(groups, rules, present) {
  const where = new Map();
  groups.forEach((g, i) => g.forEach(id => where.set(id, i)));
  return rules.filter(r => {
    if (!present.has(r.a) || !present.has(r.b)) return false;
    const same = where.get(r.a) === where.get(r.b);
    return r.type === 'apart' ? same : !same;
  });
}

/* Einteilung berechnen. Liefert { groups, violations } */
function buildGroups(c, ids, opts, rules) {
  const n = ids.length;
  if (!n) return { groups: [], violations: [] };
  let k = opts.mode === 'count' ? clamp(opts.count | 0, 1, n) : Math.max(1, Math.round(n / clamp(opts.size | 0, 1, n)));
  k = Math.min(k, n);
  const cap = Array.from({ length: k }, (_, i) => Math.floor(n / k) + (i < n % k ? 1 : 0));
  const present = new Set(ids);
  const act = rules.filter(r => present.has(r.a) && present.has(r.b));

  /* „immer zusammen" → Blöcke (Union-Find) */
  const parent = new Map(ids.map(id => [id, id]));
  const find = x => (parent.get(x) === x ? x : (parent.set(x, find(parent.get(x))), parent.get(x)));
  act.filter(r => r.type === 'together').forEach(r => parent.set(find(r.a), find(r.b)));
  const blocks = new Map();
  ids.forEach(id => { const root = find(id); if (!blocks.has(root)) blocks.set(root, []); blocks.get(root).push(id); });
  const apart = act.filter(r => r.type === 'apart');
  const conflicts = (block, group) => apart.some(r => (block.includes(r.a) && group.includes(r.b)) || (block.includes(r.b) && group.includes(r.a)));
  const grade = id => { const g = currentGrade(c, id); return g == null ? 7.5 : g; };

  let best = null;
  for (let attempt = 0; attempt < 400; attempt++) {
    let order = [...blocks.values()].map(b => ({ b, r: Math.random(), avg: b.reduce((a, id) => a + grade(id), 0) / b.length }));
    /* große Blöcke zuerst; leistungsgemischt: stärkste zuerst, damit sie sich verteilen */
    order.sort((x, y) => (y.b.length - x.b.length) || (opts.mixed ? (y.avg - x.avg) + (x.r - y.r) * 2 : x.r - y.r));
    const groups = Array.from({ length: k }, () => []);
    const sums = new Array(k).fill(0);
    let bad = 0;
    for (const { b } of order) {
      let cand = groups.map((g, i) => i).filter(i => cap[i] - groups[i].length >= b.length && !conflicts(b, groups[i]));
      if (!cand.length) cand = groups.map((g, i) => i).filter(i => !conflicts(b, groups[i]));
      if (!cand.length) { cand = groups.map((g, i) => i); bad++; }
      /* leistungsgemischt: reihum (wer am wenigsten hat, zuerst), und die jeweils
         stärkste verbleibende Person geht an die Gruppe mit der kleinsten Summe */
      cand.sort((i, j) => opts.mixed
        ? (groups[i].length - groups[j].length) || (sums[i] - sums[j])
        : (groups[i].length - cap[i]) - (groups[j].length - cap[j]) || Math.random() - 0.5);
      /* bei Gleichstand zufällig unter den besten wählen */
      const top = cand.filter(i => opts.mixed ? true : (groups[i].length - cap[i]) === (groups[cand[0]].length - cap[cand[0]]));
      const pick = opts.mixed ? cand[0] : top[Math.floor(Math.random() * top.length)];
      groups[pick].push(...b);
      sums[pick] += b.reduce((a, id) => a + grade(id), 0);
    }
    const viol = groupViolations(groups, act, present);
    const over = groups.reduce((a, g, i) => a + Math.max(0, g.length - cap[i]), 0);
    const score = viol.length * 100 + over * 10 + bad;
    if (!best || score < best.score) best = { groups, violations: viol, score };
    if (score === 0) break;
  }
  best.groups.forEach(g => g.sort(() => Math.random() - 0.5));
  return best;
}

function renderGruppen() {
  const c = getCourse(route.courseId);
  if (!c) return go({ name: 'home' });
  const G = ensureGroups(c);
  const o = groupOpts();
  const active = c.students.filter(studentActive);
  const absent = new Set((G.current && G.current.absent) || []);
  const present = active.filter(s => !absent.has(s.id));
  const nm = id => { const s = c.students.find(x => x.id === id); return s ? studentName(s) : '—'; };
  const cur = G.current && G.current.groups ? G.current.groups.map(g => g.filter(id => present.some(s => s.id === id))) : null;
  const viol = cur ? groupViolations(cur, G.rules, new Set(present.map(s => s.id))) : [];

  const ruleRows = G.rules.map(r => `<div class="chip grp-rule">
    <div class="chip-main"><b>${esc(nm(r.a))} ${r.type === 'apart' ? '<span class="grp-nie">nie mit</span>' : '<span class="grp-immer">immer mit</span>'} ${esc(nm(r.b))}</b></div>
    <button class="btn small danger" data-rule-del="${r.id}" aria-label="Regel löschen">×</button></div>`).join('');
  const opt = active.map(s => `<option value="${s.id}">${esc(studentName(s))}</option>`).join('');

  const groupsHtml = cur ? cur.map((g, i) => `<div class="grp-card" data-g="${i}">
      <div class="grp-head"><b>Gruppe ${i + 1}</b><span>${g.length}</span></div>
      ${g.map(id => `<button class="grp-name ${groupMove === id ? 'moving' : ''}" data-id="${id}">${esc(nm(id))}</button>`).join('')}
      ${groupMove && !g.includes(groupMove) ? '<button class="grp-drop" data-drop="' + i + '">hierher</button>' : ''}
    </div>`).join('') : '';

  app().innerHTML = `
    <div class="page-head">
      <div><h1>Gruppen</h1><div class="sub">${esc(c.subject)} ${esc(c.className)} · ${present.length} von ${active.length} anwesend</div></div>
      ${cur ? `<div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn small" id="grStage">Groß zeigen</button>
        <button class="btn small" id="grPrint">Drucken</button>
        <button class="btn small" id="grSave">Speichern</button></div>` : ''}
    </div>

    <div class="grp-layout">
      <div>
        <div class="calc-block">
          <h3>Einteilung</h3>
          ${pdSeg('grMode', [['size', 'Gruppengröße'], ['count', 'Anzahl Gruppen']], o.mode)}
          <div class="grp-num"><button class="btn small" id="grMinus">−</button>
            <b id="grNum">${o.mode === 'count' ? o.count : o.size}</b>
            <button class="btn small" id="grPlus">+</button>
            <span class="cs-sub" id="grNumHint"></span></div>
          <label class="check-row"><input type="checkbox" id="grMixed" ${o.mixed ? 'checked' : ''}><span>Leistungsgemischt <small>nach aktueller Note</small></span></label>
          <button class="btn primary" id="grBuild" style="width:100%;margin-top:6px">${cur ? 'Neu mischen' : 'Gruppen bilden'}</button>
        </div>
        <div class="calc-block">
          <h3>Heute fehlt <span class="cs-sub">— antippen</span></h3>
          <div class="chip-wrap">${active.map(s => `<button class="btn small grp-abs ${absent.has(s.id) ? 'off' : ''}" data-abs="${s.id}">${esc(studentName(s))}</button>`).join('')}</div>
        </div>
        <div class="calc-block">
          <h3>Regeln</h3>
          <div class="chip-list">${ruleRows || '<div class="cs-sub">Keine Regeln.</div>'}</div>
          <div class="grp-rule-add">
            <select id="grA">${opt}</select>
            <select id="grT"><option value="apart">nie mit</option><option value="together">immer mit</option></select>
            <select id="grB">${opt}</select>
            <button class="btn small" id="grAddRule">Regel hinzufügen</button>
          </div>
        </div>
        ${G.saved.length ? `<div class="calc-block"><h3>Gespeichert</h3><div class="chip-list">${G.saved.slice().reverse().map(x => `
          <div class="chip"><div class="chip-main"><b>${esc(x.name)}</b><span>${fmtDateLong(x.date)} · ${x.groups.length} Gruppen</span></div>
            <div class="set-buttons"><button class="btn small" data-load="${x.id}">Laden</button><button class="btn small danger" data-sdel="${x.id}">×</button></div></div>`).join('')}</div></div>` : ''}
      </div>
      <div>
        ${cur ? `${viol.length ? `<div class="notice" style="border-color:var(--amber)">Nicht eingehalten: ${viol.map(r => `${esc(nm(r.a))} ${r.type === 'apart' ? 'nie mit' : 'immer mit'} ${esc(nm(r.b))}`).join(' · ')}</div>` : ''}
          <div class="notice">${groupMove ? 'Jetzt eine andere Person (tauschen) oder „hierher“ antippen.' : 'Zum Umsortieren eine Person antippen.'}</div>
          <div class="grp-grid">${groupsHtml}</div>`
          : `<div class="empty-state"><p>Einstellungen links wählen und <b>Gruppen bilden</b>.</p></div>`}
      </div>
    </div>`;

  const keepOpts = () => { data.meta.groupOpts = o; save(); };
  const numHint = () => {
    const n = present.length;
    const k = o.mode === 'count' ? Math.min(o.count, n || 1) : Math.max(1, Math.round(n / Math.max(1, o.size)));
    const lo = Math.floor(n / k), hi = Math.ceil(n / k);
    document.getElementById('grNumHint').textContent = n ? `→ ${k} Gruppen à ${lo === hi ? lo : lo + '–' + hi}` : '';
  };
  numHint();
  pdBindSeg('grMode', v => { o.mode = v; keepOpts(); document.getElementById('grNum').textContent = v === 'count' ? o.count : o.size; numHint(); });
  const step = d => {
    if (o.mode === 'count') o.count = clamp(o.count + d, 1, Math.max(1, present.length)); else o.size = clamp(o.size + d, 1, Math.max(1, present.length));
    document.getElementById('grNum').textContent = o.mode === 'count' ? o.count : o.size;
    keepOpts(); numHint();
  };
  document.getElementById('grMinus').onclick = () => step(-1);
  document.getElementById('grPlus').onclick = () => step(1);
  document.getElementById('grMixed').onchange = e => { o.mixed = e.target.checked; keepOpts(); };
  document.getElementById('grBuild').onclick = () => {
    const res = buildGroups(c, present.map(s => s.id), o, G.rules);
    G.current = { groups: res.groups, absent: [...absent] };
    groupMove = null; save(); renderGruppen();
    if (res.violations.length) toast('Nicht alle Regeln ließen sich einhalten.');
  };
  app().querySelectorAll('[data-abs]').forEach(b => b.onclick = () => {
    const id = b.dataset.abs;
    if (absent.has(id)) absent.delete(id); else absent.add(id);
    G.current = Object.assign({}, G.current || { groups: null }, { absent: [...absent] });
    if (!G.current.groups) G.current.groups = null;
    save(); renderGruppen();
  });
  document.getElementById('grAddRule').onclick = () => {
    const a = val('grA'), b = val('grB'), type = val('grT');
    if (!a || a === b) return toast('Bitte zwei verschiedene Personen wählen.');
    G.rules = G.rules.filter(r => !((r.a === a && r.b === b) || (r.a === b && r.b === a)));
    G.rules.push({ id: uid(), type, a, b });
    save(); renderGruppen();
  };
  app().querySelectorAll('[data-rule-del]').forEach(b => b.onclick = () => { G.rules = G.rules.filter(r => r.id !== b.dataset.ruleDel); save(); renderGruppen(); });

  /* Umsortieren: Person antippen, dann andere Person (tauschen) oder „hierher" */
  app().querySelectorAll('.grp-name').forEach(b => b.onclick = () => {
    const id = b.dataset.id;
    if (!groupMove || groupMove === id) { groupMove = groupMove === id ? null : id; return renderGruppen(); }
    const gs = G.current.groups;
    const gi = gs.findIndex(g => g.includes(groupMove)), gj = gs.findIndex(g => g.includes(id));
    gs[gi][gs[gi].indexOf(groupMove)] = id; gs[gj][gs[gj].indexOf(id)] = groupMove;
    groupMove = null; save(); renderGruppen();
  });
  app().querySelectorAll('[data-drop]').forEach(b => b.onclick = () => {
    const gs = G.current.groups;
    gs.forEach(g => { const i = g.indexOf(groupMove); if (i >= 0) g.splice(i, 1); });
    gs[+b.dataset.drop].push(groupMove);
    G.current.groups = gs.filter(g => g.length);
    groupMove = null; save(); renderGruppen();
  });

  if (cur) {
    document.getElementById('grStage').onclick = () => openStage(`<div class="stage-title">${esc(c.subject)} ${esc(c.className)} — Gruppen</div>
      <div class="stage-groups">${cur.map((g, i) => `<div class="stage-group"><b>Gruppe ${i + 1}</b>${g.map(id => `<div>${esc(nm(id))}</div>`).join('')}</div>`).join('')}</div>`);
    document.getElementById('grPrint').onclick = () => openPrintView({
      title: `Gruppen — ${c.subject} ${c.className}`, landscape: true, css: PD_CSS + GROUP_PRINT_CSS, fit: PD_FIT,
      pages: [`<section class="pp-sheet pd">${pdHead(pdCourseSub(c), 'Gruppen', fmtDateLong(todayISO()))}
        <div class="gp-grid">${cur.map((g, i) => `<div class="gp-box"><h3>Gruppe ${i + 1}</h3>${g.map(id => `<div>${esc(nm(id))}</div>`).join('')}</div>`).join('')}</div>
        ${pdFoot()}</section>`],
      filename: `gruppen-${rasterSlug(c.className)}`,
    });
    document.getElementById('grSave').onclick = () => {
      modal('Einteilung speichern', `<div class="field"><label>Name</label><input id="grName" type="text" placeholder="z. B. Projekt Mittelalter" value="Gruppen ${fmtDate(todayISO())}"></div>`, [
        { label: 'Abbrechen', onClick: closeModal },
        { label: 'Speichern', cls: 'primary', onClick: () => {
          G.saved.push({ id: uid(), name: val('grName').trim() || 'Gruppen', date: todayISO(), groups: rasterClone(cur) });
          save(); closeModal(); renderGruppen(); toast('Einteilung gespeichert.');
        }},
      ]);
    };
  }
  app().querySelectorAll('[data-load]').forEach(b => b.onclick = () => {
    const x = G.saved.find(y => y.id === b.dataset.load); if (!x) return;
    G.current = { groups: rasterClone(x.groups), absent: [] };
    groupMove = null; save(); renderGruppen();
  });
  app().querySelectorAll('[data-sdel]').forEach(b => b.onclick = () => { G.saved = G.saved.filter(y => y.id !== b.dataset.sdel); save(); renderGruppen(); });
}
const GROUP_PRINT_CSS = `
.gp-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(52mm, 1fr)); gap: 4mm; }
.gp-box { border: 0.35mm solid #444; padding: 2.5mm 3mm; break-inside: avoid; font-size: 11pt; }
.gp-box h3 { margin: 0 0 1.5mm; font-size: 8pt; text-transform: uppercase; letter-spacing: .05em; color: #16514b; }
.gp-box div + div { margin-top: 0.8mm; }
`;

/* ============================================================
   Zufallsaufruf — fair gewichtet
   ============================================================ */
let pickSession = null;   // { courseId, drawn: [sId] } — gilt, bis das Fenster geschlossen wird

function pickWeight(c, s) {
  /* Tage seit der letzten mündlichen Note (ohne Note: viel), gedeckelt */
  const cols = ['1', '2'].flatMap(h => c.halfYears[h].columns.filter(x => x.type === 'muendlich'));
  const dates = cols.filter(col => (data.grades[s.id] || {})[col.id] != null && col.date).map(col => col.date).sort();
  const days = dates.length ? daysSince(dates[dates.length - 1]) : 60;
  return { w: 1 + Math.min(Math.max(days, 0), 60) / 10, days: dates.length ? days : null };
}
function openPicker(c) {
  if (!pickSession || pickSession.courseId !== c.id) pickSession = { courseId: c.id, drawn: [], fair: true };
  const draw = () => {
    const pool = c.students.filter(s => studentActive(s) && !pickSession.drawn.includes(s.id));
    if (!pool.length) return null;
    const ws = pool.map(s => pickSession.fair ? pickWeight(c, s).w : 1);
    let r = Math.random() * ws.reduce((a, b) => a + b, 0);
    for (let i = 0; i < pool.length; i++) { r -= ws[i]; if (r <= 0) return pool[i]; }
    return pool[pool.length - 1];
  };
  const show = s => {
    const total = c.students.filter(studentActive).length;
    const pw = s ? pickWeight(c, s) : null;
    modal('Wer ist dran?', `
      <div class="pick-name">${s ? esc(studentName(s)) : 'Alle waren dran.'}</div>
      <div class="pick-why">${s ? (pw.days == null ? 'noch keine mündliche Note' : `letzte mündliche Note vor ${pw.days} ${pw.days === 1 ? 'Tag' : 'Tagen'}`) : ''}</div>
      <label class="check-row"><input type="checkbox" id="pkFair" ${pickSession.fair ? 'checked' : ''}><span>Fair <small>— wer länger keine mündliche Note hat, kommt eher dran</small></span></label>
      <div class="cs-sub">${pickSession.drawn.length} von ${total} dran gewesen · niemand kommt doppelt, bis alle dran waren</div>
    `, [
      { label: 'Neu starten', onClick: () => { pickSession.drawn = []; show(draw()); } },
      ...(s ? [{ label: 'Note geben', onClick: () => pickGrade(c, s) }] : []),
      { label: 'Nächste:r', cls: 'primary', onClick: () => show(next()) },
    ]);
    document.getElementById('pkFair').onchange = e => { pickSession.fair = e.target.checked; };
  };
  const next = () => { const s = draw(); if (s) pickSession.drawn.push(s.id); return s; };
  show(next());
}
/* Note für die gezogene Person — in die heutige Spalte „Mitarbeit" */
function pickGrade(c, s) {
  const hy = c.halfYears[route.hy || defaultHalfYear(c)];
  let col = hy.columns.find(x => x.type === 'muendlich' && x.label === 'Mitarbeit' && x.date === todayISO() && !x.ka && !x.raster);
  openPad(`${esc(studentName(s))} — Mitarbeit heute`, col ? (data.grades[s.id] || {})[col.id] : null, v => {
    if (!col) { col = { id: uid(), type: 'muendlich', label: 'Mitarbeit', date: todayISO() }; hy.columns.push(col); }
    setGradeLogged(c, 'grades', s.id, col.id, v, col.label);
    if (route.name === 'course') renderCourse();
    openPicker(c);
  }, c.scale);
}

/* ============================================================
   Timer
   ============================================================ */
let timerState = null;   // { total, left, running, tick }
function openTimer() {
  const presets = [1, 2, 3, 5, 10, 15, 20, 30];
  const el = openStage(`
    <div class="tm-display" id="tmDisp">05:00</div>
    <div class="tm-bar"><i id="tmBar"></i></div>
    <div class="tm-presets">${presets.map(m => `<button class="btn" data-min="${m}">${m} min</button>`).join('')}</div>
    <div class="tm-controls">
      <button class="btn" id="tmMinus">−1</button>
      <button class="btn primary" id="tmGo">Start</button>
      <button class="btn" id="tmPlus">+1</button>
      <button class="btn" id="tmReset">Zurück</button>
    </div>`, () => { if (timerState) clearInterval(timerState.tick); timerState = null; });
  el.classList.add('stage-timer');
  timerState = { total: 300, left: 300, running: false, tick: null, endAt: 0 };
  const T = timerState;
  const paint = () => {
    const s = Math.max(0, Math.ceil(T.left));
    document.getElementById('tmDisp').textContent = `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
    document.getElementById('tmBar').style.width = `${T.total ? (1 - T.left / T.total) * 100 : 0}%`;
    document.getElementById('tmGo').textContent = T.running ? 'Pause' : (T.left < T.total && T.left > 0 ? 'Weiter' : 'Start');
    el.classList.toggle('tm-done', T.left <= 0);
  };
  const stop = () => { T.running = false; clearInterval(T.tick); T.tick = null; };
  const set = sec => { stop(); T.total = T.left = clamp(sec, 10, 3 * 3600); paint(); };
  el.querySelectorAll('[data-min]').forEach(b => b.onclick = () => set(+b.dataset.min * 60));
  document.getElementById('tmMinus').onclick = () => { T.left = Math.max(10, T.left - 60); T.total = Math.max(T.total - 60, T.left); if (T.running) T.endAt -= 60000; paint(); };
  document.getElementById('tmPlus').onclick = () => { T.left += 60; T.total += 60; if (T.running) T.endAt += 60000; paint(); };
  document.getElementById('tmReset').onclick = () => set(T.total);
  document.getElementById('tmGo').onclick = () => {
    if (T.running) { stop(); paint(); return; }
    if (T.left <= 0) T.left = T.total;
    unlockBeep();
    T.running = true; T.endAt = Date.now() + T.left * 1000;
    /* gegen die Uhr gerechnet — Timer im Hintergrund laufen auf dem iPad nicht weiter */
    T.tick = setInterval(() => {
      T.left = (T.endAt - Date.now()) / 1000;
      if (T.left <= 0) { T.left = 0; stop(); beep(); }
      paint();
    }, 250);
    paint();
  };
  paint();
}
/* Ton am Ende (WebAudio, auf iOS erst nach einem Fingertipp erlaubt) */
let audioCtx = null;
function unlockBeep() {
  try { if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)(); if (audioCtx.state === 'suspended') audioCtx.resume(); } catch (e) {}
}
function beep() {
  if (!audioCtx) return;
  [0, 0.35, 0.7].forEach(t => {
    const o = audioCtx.createOscillator(), g = audioCtx.createGain();
    o.frequency.value = 880; o.connect(g); g.connect(audioCtx.destination);
    const at = audioCtx.currentTime + t;
    g.gain.setValueAtTime(0.0001, at); g.gain.exponentialRampToValueAtTime(0.3, at + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, at + 0.28);
    o.start(at); o.stop(at + 0.3);
  });
}
