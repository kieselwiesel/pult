/* ============================================================
   Pult. — Notenverwaltung (Prototyp)
   Reines HTML/CSS/JS, Persistenz über localStorage.
   Punktesystem 0–15 (Oberstufe), 2 Halbjahre,
   schriftlich/mündlich mit Gewichtung, Sonstige Leistungen als Bonus,
   Endjahresnote aus HY1/HY2, manuelle Überschreibung.
   ============================================================ */

'use strict';

/* ---------- Persistenz ---------- */
const STORE_KEY = 'pult.data.v3';

const DEFAULT_DATA = () => ({
  meta: {
    ferienDatum: '',
    ferienLabel: 'Ferien',
    zeugnisDatum: '',
    lastBackup: '',      // ISO-Datum des letzten JSON-Backups
  },
  courses: [],
  grades: {},          // grades[studentId][columnId] = punkte(0..15)
  sonstigeValues: {},  // sonstigeValues[studentId][sonstigeId] = punkte(0..15)
  weightOverride: {},  // weightOverride[studentId][hyKey] = wSchriftlich(0..100)
  manual: {},          // manual[studentId] = { g1, g2, end } manuelle Note (punkte)
  kaPoints: {},        // kaPoints[studentId][columnId][taskId] = erreichte Rohpunkte
});

/* Standard-Bewertungsbogen (Oberstufe 0–15 Punkte, Prozent-Grenzen) */
const STANDARD_SCHEME = [
  { points: 15, minPercent: 95 }, { points: 14, minPercent: 90 },
  { points: 13, minPercent: 85 }, { points: 12, minPercent: 80 },
  { points: 11, minPercent: 75 }, { points: 10, minPercent: 70 },
  { points: 9,  minPercent: 65 }, { points: 8,  minPercent: 60 },
  { points: 7,  minPercent: 55 }, { points: 6,  minPercent: 50 },
  { points: 5,  minPercent: 45 }, { points: 4,  minPercent: 40 },
  { points: 3,  minPercent: 33 }, { points: 2,  minPercent: 27 },
  { points: 1,  minPercent: 20 }, { points: 0,  minPercent: 0 },
];

let data = load();

function load() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return seed();
    return Object.assign(DEFAULT_DATA(), JSON.parse(raw));
  } catch (e) {
    console.warn('Konnte Daten nicht laden, starte neu.', e);
    return DEFAULT_DATA();
  }
}
function save() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(data)); }
  catch (e) { toast('Speichern fehlgeschlagen (Speicher voll?)'); }
}
const uid = () => Math.random().toString(36).slice(2, 9);

/* ---------- Beispiel-Datensätze beim ersten Start ---------- */
/* deterministischer Zufall, damit die Beispielnoten stabil bleiben */
function rng(seed) { return function () { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

function buildCourse(d, cfg) {
  const c = newCourse(cfg.subject, cfg.className);
  c.weightWritten = cfg.weightWritten; c.weightOral = 100 - cfg.weightWritten;
  const hy = c.halfYears['1'];
  cfg.columns.forEach(col => hy.columns.push({ id: uid(), type: col.type, label: col.label, date: col.date }));
  const son = { id: uid(), label: cfg.sonstige.label, scope: 'allgemein', percent: cfg.sonstige.percent };
  hy.sonstige.push(son);

  const rnd = rng(cfg.seed);
  cfg.students.forEach(n => {
    const s = { id: uid(), firstName: n[0], lastName: n[1], entry: '', exit: '' };
    c.students.push(s);
    // Grundniveau je Schüler:in (3..13), pro Note leichte Streuung
    const base = 3 + Math.floor(rnd() * 11);
    d.grades[s.id] = {};
    hy.columns.forEach(col => {
      const v = clamp(Math.round(base + (rnd() * 6 - 3)), 0, 15);
      d.grades[s.id][col.id] = v;
    });
    d.sonstigeValues[s.id] = { [son.id]: clamp(base + 2 + Math.floor(rnd() * 3), 0, 15) };
  });
  d.courses.push(c);
  return c;
}

function seed() {
  const d = DEFAULT_DATA();
  d.meta.ferienDatum = '2026-07-30';
  d.meta.ferienLabel = 'Sommerferien';
  d.meta.zeugnisDatum = '2026-07-13';

  buildCourse(d, {
    subject: 'Mathematik', className: '9b', weightWritten: 40, seed: 1907,
    columns: [
      { type: 'schriftlich', label: '1. Klassenarbeit', date: '2026-03-06' },
      { type: 'schriftlich', label: '2. Klassenarbeit', date: '2026-05-22' },
      { type: 'muendlich',  label: 'Mitarbeit',        date: '2026-04-15' },
      { type: 'muendlich',  label: 'Kopfrechnen',      date: '2026-05-04' },
    ],
    sonstige: { label: 'Heftführung', percent: 10 },
    students: [
      ['Emma','L.'],['Ben','K.'],['Mia','S.'],['Noah','W.'],['Hannah','R.'],
      ['Leon','B.'],['Lea','T.'],['Finn','H.'],['Lina','M.'],['Paul','D.'],
      ['Marie','G.'],['Luca','F.'],['Sophie','N.'],['Elias','P.'],['Clara','V.'],
      ['Jonas','Z.'],['Nele','A.'],['Tim','O.'],['Ida','C.'],['Max','E.'],
    ],
  });

  buildCourse(d, {
    subject: 'Geschichte', className: '10a', weightWritten: 30, seed: 4711,
    columns: [
      { type: 'schriftlich', label: 'Klausur',    date: '2026-04-09' },
      { type: 'muendlich',  label: 'Mitarbeit',  date: '2026-04-15' },
      { type: 'muendlich',  label: 'Referat',    date: '2026-05-11' },
    ],
    sonstige: { label: 'Mappe', percent: 15 },
    students: [
      ['Amelie','B.'],['Felix','K.'],['Charlotte','S.'],['Moritz','W.'],['Johanna','R.'],
      ['Julian','H.'],['Emilia','T.'],['David','M.'],['Greta','P.'],['Anton','F.'],
      ['Frida','N.'],['Samuel','D.'],['Mathilda','G.'],['Vincent','Z.'],['Pauline','A.'],
      ['Jakob','O.'],['Helena','C.'],['Oskar','E.'],['Romy','L.'],['Theo','B.'],
      ['Alma','K.'],['Henry','S.'],['Mira','V.'],
    ],
  });

  try { localStorage.setItem(STORE_KEY, JSON.stringify(d)); } catch (e) {}
  return d;
}

function newCourse(subject, className) {
  return {
    id: uid(),
    subject, className,
    scale: 'punkte',                  // 'punkte' (0–15) | 'noten' (1–6 mit Tendenz)
    weightWritten: 40, weightOral: 60,
    weightHY1: 30, weightHY2: 70,     // Endjahresnote
    students: [],
    halfYears: {
      '1': { columns: [], sonstige: [] },
      '2': { columns: [], sonstige: [] },
    },
  };
}

/* ---------- Notensystem (Punkte 0–15) ---------- */
const NOTE_MAP = {
  15:'1+',14:'1',13:'1-',12:'2+',11:'2',10:'2-',
  9:'3+',8:'3',7:'3-',6:'4+',5:'4',4:'4-',
  3:'5+',2:'5',1:'5-',0:'6',
};
function noteLabel(pts) {
  if (pts == null || isNaN(pts)) return '-';
  return NOTE_MAP[clamp(Math.round(pts), 0, 15)] ?? '-';
}
/* Notenpunkte (0–15) -> Schulnote (1–6): 0=6, 1..3=5, 4..6=4, 7..9=3, 10..12=2, 13..15=1 */
function noteFromPoints(pts) {
  if (pts == null || isNaN(pts)) return null;
  const p = Math.round(pts);
  return p >= 13 ? 1 : p >= 10 ? 2 : p >= 7 ? 3 : p >= 4 ? 4 : p >= 1 ? 5 : 6;
}
/* Punkte -> kontinuierliche Kommanote (1,0–6,0) für Durchschnitte im 1–6-Modus */
function pointsToNoteDecimal(pts) {
  if (pts == null || isNaN(pts)) return null;
  return clamp((17 - pts) / 3, 1, 6);
}
/* Skalenabhängige Anzeige eines Punktwerts.
   scale: 'punkte' | 'noten'; avg=true → Kommawert, sonst diskrete Note/Punkt. */
function fmtGrade(pts, scale, avg) {
  if (pts == null || isNaN(pts)) return '–';
  if (scale === 'noten') return avg ? fmtNum(pointsToNoteDecimal(pts)) : (NOTE_MAP[clamp(Math.round(pts), 0, 15)] ?? '–');
  return avg ? fmtNum(pts) : String(Math.round(pts));
}
/* <option>-Liste für manuelle Note-Auswahl (Wert = Punkte 0–15) */
function manualOptions(scale, current) {
  let out = `<option value="">— berechnet verwenden —</option>`;
  for (let p = 15; p >= 0; p--) {
    const lbl = scale === 'noten' ? `${NOTE_MAP[p]}  (${p} P.)` : `${p} Pkt  ·  ${NOTE_MAP[p]}`;
    out += `<option value="${p}" ${current === p ? 'selected' : ''}>${lbl}</option>`;
  }
  return out;
}
function scaleName(scale) { return scale === 'noten' ? 'Noten 1–6' : 'Punkte 0–15'; }
function gradeColor(pts) {
  if (pts == null || isNaN(pts)) return { bg: 'transparent', fg: 'var(--line)' };
  const p = Math.round(pts);
  if (p >= 13) return { bg: 'var(--g-top)',  fg: 'var(--g-top-fg)' };
  if (p >= 10) return { bg: 'var(--g-good)', fg: 'var(--g-good-fg)' };
  if (p >= 7)  return { bg: 'transparent',   fg: 'var(--g-mid-fg)' };
  if (p >= 4)  return { bg: 'var(--g-low)',  fg: 'var(--g-low-fg)' };
  if (p >= 1)  return { bg: 'var(--g-bad)',  fg: 'var(--g-bad-fg)' };
  return { bg: 'var(--g-fail)', fg: 'var(--g-fail-fg)' };
}

/* ---------- Notenberechnung ---------- */
function studentActive(s) { return !s.exit; }
function mean(arr) {
  const vals = arr.filter(v => typeof v === 'number' && !isNaN(v));
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
}
/* Sonstige Leistung als Bonus: mischt sich anteilig ein, aber NUR wenn sie den Schnitt hebt. */
function applyBonus(base, sonstigeList, sId) {
  if (base == null) return null;
  let val = base;
  sonstigeList.forEach(so => {
    const sv = (data.sonstigeValues[sId] || {})[so.id];
    if (sv == null || isNaN(sv)) return;
    const p = (so.percent || 0) / 100;
    const blended = val * (1 - p) + sv * p;
    if (blended > val) val = blended;   // ersetzt nur eine schlechtere Note, keine bessere
  });
  return val;
}
function getWeight(course, sId, hyKey) {
  const ov = (data.weightOverride[sId] || {})[hyKey];
  if (ov != null && !isNaN(ov)) return { w: ov, m: 100 - ov, custom: true };
  return { w: course.weightWritten, m: course.weightOral, custom: false };
}
/* Reine Rechnung eines Halbjahres (ohne manuelle Überschreibung) */
function computeHalf(course, hyKey, sId) {
  const hy = course.halfYears[hyKey];
  const gr = data.grades[sId] || {};
  const schriftCols = hy.columns.filter(c => c.type === 'schriftlich');
  const muendCols   = hy.columns.filter(c => c.type === 'muendlich');

  const wRaw = mean(schriftCols.map(c => gr[c.id]));
  const mRaw = mean(muendCols.map(c => gr[c.id]));
  const wAvg = applyBonus(wRaw, hy.sonstige.filter(s => s.scope === 'schriftlich'), sId);
  const mAvg = applyBonus(mRaw, hy.sonstige.filter(s => s.scope === 'muendlich'),  sId);

  const wt = getWeight(course, sId, hyKey);
  let gesamt;
  if (wAvg == null && mAvg == null) gesamt = null;
  else if (wAvg == null) gesamt = mAvg;
  else if (mAvg == null) gesamt = wAvg;
  else gesamt = wAvg * (wt.w / 100) + mAvg * (wt.m / 100);
  gesamt = applyBonus(gesamt, hy.sonstige.filter(s => s.scope === 'allgemein'), sId);

  return { wRaw, mRaw, wAvg, mAvg, gesamt, wt };
}
/* effektive Gesamtnote eines Halbjahres (manuell vor berechnet) */
function effGesamt(course, hyKey, sId) {
  const manKey = hyKey === '1' ? 'g1' : 'g2';
  const man = (data.manual[sId] || {})[manKey];
  const comp = computeHalf(course, hyKey, sId).gesamt;
  return { value: (man != null ? man : comp), computed: comp, manual: (man != null ? man : null) };
}
/* Endjahresnote aus beiden Halbjahren */
function effEndjahr(course, sId) {
  const g1 = effGesamt(course, '1', sId).value;
  const g2 = effGesamt(course, '2', sId).value;
  let comp;
  if (g1 == null && g2 == null) comp = null;
  else if (g1 == null) comp = g2;
  else if (g2 == null) comp = g1;
  else comp = g1 * (course.weightHY1 / 100) + g2 * (course.weightHY2 / 100);
  const man = (data.manual[sId] || {}).end;
  return { value: (man != null ? man : comp), computed: comp, manual: (man != null ? man : null), g1, g2 };
}
/* aktuelle Note für Kachel/Übersicht: HY2 falls vorhanden, sonst HY1 (bzw. Endjahr wenn beide) */
function currentGrade(course, sId) {
  const has2 = course.halfYears['2'].columns.some(c => (data.grades[sId]||{})[c.id] != null);
  const has1 = course.halfYears['1'].columns.some(c => (data.grades[sId]||{})[c.id] != null);
  if (has1 && has2) return effEndjahr(course, sId).value;
  if (has2) return effGesamt(course, '2', sId).value;
  return effGesamt(course, '1', sId).value;
}
function courseMean(course) {
  const vals = course.students.filter(studentActive).map(s => currentGrade(course, s.id)).filter(v => v != null);
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
}

/* ---------- Verlauf / Trend / Simulation ---------- */
/* benotete Leistungen in Reihenfolge (optional halbjahrübergreifend) */
function gradeSeries(course, sId, hyKeys) {
  const out = [];
  (hyKeys || ['1', '2']).forEach(hyKey => {
    course.halfYears[hyKey].columns.forEach(col => {
      const v = (data.grades[sId] || {})[col.id];
      if (v != null && !isNaN(v)) out.push({ hy: hyKey, type: col.type, value: v, label: col.label, date: col.date });
    });
  });
  return out;
}
/* Tendenz: erste vs. letzte Hälfte der benoteten Leistungen im Halbjahr */
function trendDir(course, hyKey, sId) {
  const vals = gradeSeries(course, sId, [hyKey]).map(p => p.value);
  if (vals.length < 3) return null;
  const half = Math.floor(vals.length / 2);
  const m = a => a.reduce((x, y) => x + y, 0) / a.length;
  const d = m(vals.slice(vals.length - half)) - m(vals.slice(0, half));
  return d >= 1 ? 'up' : d <= -1 ? 'down' : null;
}
function trendArrowSvg(dir) {
  if (!dir) return '';
  const up = dir === 'up';
  const color = up ? 'var(--g-top)' : 'var(--g-fail)';
  const path = up ? 'M2 10 L10 2 M6 2 L10 2 L10 6' : 'M2 2 L10 10 M6 10 L10 10 L10 6';
  return `<svg width="12" height="12" viewBox="0 0 12 12" style="vertical-align:middle;margin-left:3px"><path d="${path}" stroke="${color}" stroke-width="1.7" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}
function sparkSvg(values) {
  const n = values.length; if (n < 2) return '';
  const W = 74, H = 20, p = 2;
  const x = i => p + i * (W - 2 * p) / (n - 1);
  const y = v => p + (15 - v) / 15 * (H - 2 * p);
  const pts = values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" style="display:block"><polyline points="${pts}" fill="none" stroke="var(--accent)" stroke-width="1.3"/></svg>`;
}
function verlaufSvg(series, scale) {
  const n = series.length;
  if (n < 2) return `<div class="cs-sub">Zu wenige benotete Leistungen für einen Verlauf.</div>`;
  const W = 620, H = 200, padL = 34, padR = 12, padT = 12, padB = 26;
  const x = i => padL + i * (W - padL - padR) / (n - 1);
  const y = v => padT + (15 - v) / 15 * (H - padT - padB);
  const ticks = [15, 12, 9, 6, 3, 0];
  const grid = ticks.map(v => `<line x1="${padL}" y1="${y(v).toFixed(1)}" x2="${W-padR}" y2="${y(v).toFixed(1)}" stroke="var(--line-soft)"/>
    <text x="${padL-6}" y="${(y(v)+3).toFixed(1)}" text-anchor="end" font-size="9" fill="var(--ink-faint)">${fmtGrade(v, scale, false)}</text>`).join('');
  let boundary = '';
  const bIdx = series.findIndex(p => p.hy === '2');
  if (bIdx > 0) {
    const bx = ((x(bIdx) + x(bIdx - 1)) / 2).toFixed(1);
    boundary = `<line x1="${bx}" y1="${padT}" x2="${bx}" y2="${H-padB}" stroke="var(--line)" stroke-dasharray="3 3"/><text x="${bx}" y="${H-padB+12}" text-anchor="middle" font-size="9" fill="var(--ink-faint)">2. HJ</text>`;
  }
  const line = `<polyline points="${series.map((p,i)=>`${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ')}" fill="none" stroke="var(--accent)" stroke-width="1.5" opacity=".5"/>`;
  const dots = series.map((p, i) => {
    const col = p.type === 'schriftlich' ? '#3f6fb0' : '#7a63bd';
    return `<circle cx="${x(i).toFixed(1)}" cy="${y(p.value).toFixed(1)}" r="4" fill="${col}"><title>${esc(p.label)}: ${fmtGrade(p.value, scale, false)}${p.date?' ('+fmtDate(p.date)+')':''}</title></circle>`;
  }).join('');
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" preserveAspectRatio="xMidYMid meet" style="display:block">${grid}${boundary}${line}${dots}</svg>
    <div class="legend" style="margin-top:6px"><span><i style="background:#3f6fb0"></i> schriftlich</span><span><i style="background:#7a63bd"></i> mündlich</span></div>`;
}
/* Simulation: Gesamtnote eines Halbjahres mit einer hypothetisch ergänzten Note */
function simulateGesamt(course, hyKey, sId, extra) {
  const hy = course.halfYears[hyKey];
  const gr = data.grades[sId] || {};
  let schrift = hy.columns.filter(c => c.type === 'schriftlich').map(c => gr[c.id]).filter(v => v != null && !isNaN(v));
  let muend = hy.columns.filter(c => c.type === 'muendlich').map(c => gr[c.id]).filter(v => v != null && !isNaN(v));
  if (extra) { if (extra.type === 'schriftlich') schrift = schrift.concat(extra.value); else muend = muend.concat(extra.value); }
  const avg = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : null;
  const wAvg = applyBonus(avg(schrift), hy.sonstige.filter(s => s.scope === 'schriftlich'), sId);
  const mAvg = applyBonus(avg(muend), hy.sonstige.filter(s => s.scope === 'muendlich'), sId);
  const wt = getWeight(course, sId, hyKey);
  let g;
  if (wAvg == null && mAvg == null) g = null;
  else if (wAvg == null) g = mAvg;
  else if (mAvg == null) g = wAvg;
  else g = wAvg * (wt.w / 100) + mAvg * (wt.m / 100);
  return applyBonus(g, hy.sonstige.filter(s => s.scope === 'allgemein'), sId);
}
function targetOptions(scale, current) {
  let out = '';
  for (let p = 15; p >= 0; p--) {
    const lbl = scale === 'noten' ? `${NOTE_MAP[p]}  (${p} P.)` : `${p} Pkt  ·  ${NOTE_MAP[p]}`;
    out += `<option value="${p}" ${current === p ? 'selected' : ''}>${lbl}</option>`;
  }
  return out;
}

/* ---------- Klassenarbeit ---------- */
function schemeGrade(scheme, percent) {
  if (percent == null) return null;
  for (const row of scheme) if (percent >= row.minPercent) return row.points;
  return 0;
}
function kaTotals(col, sId) {
  const pts = (data.kaPoints[sId] || {})[col.id] || {};
  const tasks = col.ka.tasks;
  const filled = tasks.some(t => pts[t.id] != null && pts[t.id] !== '');
  const max = tasks.reduce((a, t) => a + (Number(t.max) || 0), 0);
  if (!filled) return { achieved: null, max, percent: null, grade: null };
  const achieved = tasks.reduce((a, t) => a + (Number(pts[t.id]) || 0), 0);
  const percent = max > 0 ? (achieved / max) * 100 : null;
  return { achieved, max, percent, grade: schemeGrade(col.ka.scheme, percent) };
}
/* KA-Ergebnisse in die Notentabelle schreiben */
function syncKaGrades(course, col) {
  course.students.forEach(s => {
    const { grade } = kaTotals(col, s.id);
    if (!data.grades[s.id]) data.grades[s.id] = {};
    if (grade == null) delete data.grades[s.id][col.id];
    else data.grades[s.id][col.id] = grade;
  });
}
function median(arr) {
  const v = arr.filter(x => x != null).slice().sort((a, b) => a - b);
  if (!v.length) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

/* ---------- Routing ---------- */
let route = { name: 'home', courseId: null, hy: '1', view: 'gesamt' };
function go(r) { route = Object.assign({}, route, r); render(); }

/* ---------- Datum ---------- */
function fmtDate(iso) { if (!iso) return ''; const [y,m,d] = iso.split('-'); return `${d}.${m}.`; }
function fmtDateLong(iso) { if (!iso) return ''; return new Date(iso + 'T00:00:00').toLocaleDateString('de-DE', { day:'2-digit', month:'long', year:'numeric' }); }
function todayISO() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
function weeksUntil(iso) {
  if (!iso) return null;
  const today = new Date(); today.setHours(0,0,0,0);
  const days = Math.round((new Date(iso + 'T00:00:00') - today) / 86400000);
  return { days, weeks: Math.round(days / 7) };
}
function daysSince(iso) {
  if (!iso) return Infinity;
  const today = new Date(); today.setHours(0,0,0,0);
  return Math.round((today - new Date(iso + 'T00:00:00')) / 86400000);
}

/* ---------- Backup (JSON export / import) ---------- */
function exportBackup() {
  data.meta.lastBackup = todayISO();
  save();
  const payload = JSON.stringify({ app: 'Pult', version: 3, exportedAt: new Date().toISOString(), data }, null, 2);
  const blob = new Blob([payload], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `pult-backup-${todayISO()}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast('Backup gespeichert.');
  if (route.name === 'home') render();
}
function importBackupFile(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const parsed = JSON.parse(reader.result);
      const incoming = parsed && parsed.data ? parsed.data : parsed;
      if (!incoming || !Array.isArray(incoming.courses)) throw new Error('kein Pult-Backup');
      modal('Backup einlesen?', `<p>Das Backup enthält <b>${incoming.courses.length} Kurse</b>. Der aktuelle Datenbestand in diesem Browser wird <b>ersetzt</b>.</p>`, [
        { label: 'Abbrechen', onClick: closeModal },
        { label: 'Ersetzen', cls: 'primary', onClick: () => {
          data = Object.assign(DEFAULT_DATA(), incoming);
          save(); closeModal(); go({ name: 'home' });
          toast('Backup eingelesen.');
        }},
      ]);
    } catch (e) {
      toast('Datei ist kein gültiges Pult-Backup.');
    }
  };
  reader.readAsText(file);
}

/* ============================================================
   RENDER
   ============================================================ */
const app = () => document.getElementById('app');

function render() {
  renderCrumbs();
  renderTopbarRight();
  if (route.name === 'ka') return renderKA();
  if (route.name === 'student') return renderStudent();
  if (route.name === 'course') return renderCourse();
  return renderHome();
}
function renderCrumbs() {
  const el = document.getElementById('crumbs');
  if (route.name === 'home') { el.innerHTML = `<span class="here">Kurse</span>`; return; }
  const c = getCourse(route.courseId);
  const base = c ? c.subject + ' · ' + c.className : '';
  if (route.name === 'ka' || route.name === 'student') {
    let leaf = 'Klassenarbeit';
    if (route.name === 'ka') { const col = findKaColumn(c); leaf = col ? col.label : 'Klassenarbeit'; }
    else { const s = c && c.students.find(x => x.id === route.studentId); leaf = s ? `${s.firstName} ${s.lastName||''}` : 'Schüler:in'; }
    el.innerHTML = `<a class="here" id="crumbCourse" style="cursor:pointer;color:#bfdad4">${esc(base)}</a><span class="sep">›</span><span class="here">${esc(leaf)}</span>`;
    const cc = document.getElementById('crumbCourse'); if (cc) cc.onclick = () => go({ name: 'course', courseId: c.id });
    return;
  }
  el.innerHTML = `<span class="here">${esc(base)}</span>`;
}
function renderTopbarRight() {
  const el = document.getElementById('topbarRight');
  if (route.name === 'home') {
    el.innerHTML = `<button class="btn ghost small" id="btnSettings">Termine</button>`;
    document.getElementById('btnSettings').onclick = openMetaSettings;
  } else if (route.name === 'ka' || route.name === 'student') {
    el.innerHTML = `<button class="btn ghost small" id="btnBack">‹ Kurs</button>`;
    document.getElementById('btnBack').onclick = () => go({ name: 'course', courseId: route.courseId });
  } else {
    el.innerHTML = `<button class="btn ghost small" id="btnBack">‹ Kurse</button>`;
    document.getElementById('btnBack').onclick = () => go({ name: 'home' });
  }
}
function findKaColumn(c) {
  if (!c) return null;
  return c.halfYears[route.hy].columns.find(x => x.id === route.columnId && x.ka);
}

/* ---------- Home / Dashboard ---------- */
function renderHome() {
  const ferien = weeksUntil(data.meta.ferienDatum);
  const zeugnis = weeksUntil(data.meta.zeugnisDatum);
  const studCount = data.courses.reduce((a, c) => a + c.students.length, 0);
  const backupOverdue = data.courses.length && (!data.meta.lastBackup || daysSince(data.meta.lastBackup) > 7);
  const weekTile = (w, label, dateIso) => {
    if (!w) return `<div class="value">–</div><div class="foot">Datum festlegen ›</div>`;
    const txt = w.days < 0 ? 'vorbei' : (w.weeks <= 0 ? `<1<small> Woche</small>` : `${w.weeks}<small> Wochen</small>`);
    return `<div class="value">${txt}</div><div class="foot">${fmtDateLong(dateIso)}</div>`;
  };

  app().innerHTML = `
    ${backupOverdue ? `<div class="notice" id="backupNote" style="display:flex;justify-content:space-between;align-items:center;gap:12px;border-color:var(--amber)">
      <span>${data.meta.lastBackup ? 'Letztes Backup: '+fmtDateLong(data.meta.lastBackup)+'.' : 'Noch kein Backup erstellt.'} Sichere deine Daten regelmäßig.</span>
      <button class="btn small" id="backupNow">Backup jetzt</button></div>` : ''}
    <section class="dash">
      <div class="dash-card clickable" id="dashFerien">
        <div class="label">${esc(data.meta.ferienLabel || 'Nächste Ferien')}</div>
        ${weekTile(ferien, '', data.meta.ferienDatum)}
      </div>
      <div class="dash-card clickable" id="dashZeugnis">
        <div class="label">Zeugniskonferenz</div>
        ${weekTile(zeugnis, '', data.meta.zeugnisDatum)}
      </div>
      <div class="dash-card">
        <div class="label">Kurse</div>
        <div class="value">${data.courses.length}</div>
        <div class="foot">${studCount} Schüler:innen insgesamt</div>
      </div>
    </section>

    <div class="page-head">
      <div><h1>Kurse</h1><div class="sub">Fach- / Klassenkombinationen</div></div>
      <button class="btn primary" id="btnNewCourse">+ Neuer Kurs</button>
    </div>

    <div class="course-grid" id="courseGrid"></div>
  `;

  document.getElementById('btnNewCourse').onclick = () => openCourseForm();
  document.getElementById('dashFerien').onclick = openMetaSettings;
  document.getElementById('dashZeugnis').onclick = openMetaSettings;
  const bn = document.getElementById('backupNow'); if (bn) bn.onclick = exportBackup;

  const grid = document.getElementById('courseGrid');
  if (!data.courses.length) {
    grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1"><p>Noch keine Kurse. Lege deinen ersten Kurs an.</p></div>`;
  }
  data.courses.forEach(c => {
    const m = courseMean(c);
    const col = gradeColor(m);
    const card = document.createElement('div');
    card.className = 'course-card';
    card.innerHTML = `
      <div class="cc-top">
        <div class="cc-subject">${esc(c.subject)}</div>
        <div class="cc-class">${esc(c.className)}</div>
        <span class="cc-tag" style="background:${m==null?'var(--accent-soft)':col.bg};color:${m==null?'var(--accent-ink)':col.fg}">
          Ø ${fmtGrade(m, c.scale, true)}${m==null||c.scale==='noten'?'':' · '+noteLabel(m)}</span>
      </div>
      <div class="cc-foot"><span>${c.students.length} Schüler:innen</span><span>Notenschnitt</span></div>
    `;
    card.onclick = () => go({ name: 'course', courseId: c.id, hy: '1', view: 'gesamt' });
    grid.appendChild(card);
  });
  const add = document.createElement('div');
  add.className = 'course-card add-card';
  add.innerHTML = `<span class="plus">+</span> Neuer Kurs`;
  add.onclick = () => openCourseForm();
  grid.appendChild(add);
}

/* ---------- Kurs-Detail ---------- */
function renderCourse() {
  const c = getCourse(route.courseId);
  if (!c) return go({ name: 'home' });
  const hy = c.halfYears[route.hy];

  app().innerHTML = `
    <div class="page-head">
      <div>
        <h1>${esc(c.subject)} <span style="color:var(--ink-faint);font-weight:600">${esc(c.className)}</span></h1>
        <div class="sub">${scaleName(c.scale)} · Gewichtung ${c.weightWritten}% schr. · ${c.weightOral}% mündl.${route.hy==='2'?` · Endjahr ${c.weightHY1}/${c.weightHY2}`:''}</div>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn small" id="btnZwischen">+ Zwischenstand</button>
        <button class="btn small" id="btnStudents">Schüler:innen</button>
        <button class="btn small" id="btnCourseEdit">Kurs bearbeiten</button>
      </div>
    </div>

    <div class="tabs">
      <button class="tab ${route.hy==='1'?'active':''}" data-hy="1">1. Halbjahr</button>
      <button class="tab ${route.hy==='2'?'active':''}" data-hy="2">2. Halbjahr</button>
    </div>

    <div class="toolbar">
      <div class="seg" id="viewSeg">
        <button data-v="gesamt" class="${route.view==='gesamt'?'active':''}">Gesamt</button>
        <button data-v="schriftlich" class="${route.view==='schriftlich'?'active':''}">Schriftlich</button>
        <button data-v="muendlich" class="${route.view==='muendlich'?'active':''}">Mündlich</button>
      </div>
      <div class="spacer"></div>
      <button class="btn small" id="btnAddSchrift">+ Schriftlich</button>
      <button class="btn small" id="btnAddKA">+ KA</button>
      <button class="btn small" id="btnAddMuend">+ Mündlich</button>
      <button class="btn small" id="btnMitarbeit">+ Mitarbeit</button>
      <button class="btn small" id="btnSonstige">Sonstige (${hy.sonstige.length})</button>
    </div>

    <div id="tableHost"></div>

    <div class="legend">
      <span><i style="background:var(--g-top)"></i> 13–15 (1)</span>
      <span><i style="background:var(--g-good)"></i> 10–12 (2)</span>
      <span><i style="background:#fff"></i> 7–9 (3)</span>
      <span><i style="background:var(--g-low)"></i> 4–6 (4)</span>
      <span><i style="background:var(--g-bad)"></i> 1–3 (5)</span>
      <span><i style="background:var(--g-fail)"></i> 0 (6)</span>
      <span><i style="background:#fdf8ee;border-color:var(--amber)"></i> Sonstige (Bonus)</span>
    </div>
  `;

  document.querySelectorAll('.tab').forEach(t => t.onclick = () => go({ hy: t.dataset.hy }));
  document.querySelectorAll('#viewSeg button').forEach(b => b.onclick = () => go({ view: b.dataset.v }));
  document.getElementById('btnCourseEdit').onclick = () => openCourseForm(c);
  document.getElementById('btnStudents').onclick = () => openStudents(c);
  document.getElementById('btnZwischen').onclick = () => createZwischenstand(c);
  document.getElementById('btnAddSchrift').onclick = () => openColumnForm(c, 'schriftlich');
  document.getElementById('btnAddKA').onclick = () => createKA(c);
  document.getElementById('btnAddMuend').onclick = () => openColumnForm(c, 'muendlich');
  document.getElementById('btnMitarbeit').onclick = () => quickMitarbeit(c);
  document.getElementById('btnSonstige').onclick = () => openSonstige(c);

  renderTable(c);
}

/* Schnell: Mitarbeitsspalte (mündlich, heutiges Datum) */
function quickMitarbeit(c) {
  const hy = c.halfYears[route.hy];
  hy.columns.push({ id: uid(), type: 'muendlich', label: 'Mitarbeit', date: todayISO() });
  save(); renderCourse();
  toast('Mitarbeit-Spalte hinzugefügt.');
}

/* ============================================================
   Zwischenstand — eingefrorener Notenstand (nicht in Berechnung)
   ============================================================ */
function snapshotValues(c, hyKey) {
  const v = {};
  c.students.forEach(s => { const g = effGesamt(c, hyKey, s.id).value; if (g != null) v[s.id] = g; });
  return v;
}
function createZwischenstand(c) {
  const hyKey = route.hy;
  modal('Zwischenstand einfügen', `
    <div class="notice">Friert den aktuellen Gesamtstand (${hyKey}. Halbjahr) zum gewählten Datum ein — z. B. als Leistungsrückmeldung vor den Ferien. Fließt <b>nicht</b> in die Notenberechnung ein.</div>
    <div class="row2">
      <div class="field"><label>Bezeichnung</label><input id="zwLabel" type="text" value="Zwischenstand" placeholder="z. B. vor Osterferien"></div>
      <div class="field"><label>Datum</label><input id="zwDate" type="date" value="${todayISO()}"></div>
    </div>
  `, [
    { label: 'Abbrechen', onClick: closeModal },
    { label: 'Einfügen', cls: 'primary', onClick: () => {
      const col = { id: uid(), type: 'zwischenstand', label: val('zwLabel').trim() || 'Zwischenstand', date: val('zwDate'), values: snapshotValues(c, hyKey) };
      c.halfYears[hyKey].columns.push(col);
      save(); closeModal(); renderCourse();
      toast('Zwischenstand eingefroren.');
    }},
  ]);
}
function openZwischenstand(c, colId) {
  const hy = c.halfYears[route.hy];
  const col = hy.columns.find(x => x.id === colId);
  if (!col) return;
  modal('Zwischenstand', `
    <div class="notice">Eingefrorener Gesamtstand vom ${col.date?fmtDateLong(col.date):'—'}. Nur Anzeige, ändert die Noten nicht.</div>
    <div class="row2">
      <div class="field"><label>Bezeichnung</label><input id="zwLabel" type="text" value="${esc(col.label||'')}"></div>
      <div class="field"><label>Datum</label><input id="zwDate" type="date" value="${col.date||''}"></div>
    </div>
    <button class="btn small" id="zwRefresh" style="margin-top:4px">Werte auf heutigen Stand aktualisieren</button>
  `, [
    { label: 'Löschen', cls: 'danger', onClick: () => {
      hy.columns = hy.columns.filter(x => x.id !== col.id);
      save(); closeModal(); renderCourse();
    }},
    { label: 'Abbrechen', onClick: closeModal },
    { label: 'Speichern', cls: 'primary', onClick: () => {
      col.label = val('zwLabel').trim() || 'Zwischenstand'; col.date = val('zwDate');
      save(); closeModal(); renderCourse();
    }},
  ]);
  document.getElementById('zwRefresh').onclick = () => {
    col.values = snapshotValues(c, route.hy); save(); toast('Zwischenstand aktualisiert.');
  };
}

/* ============================================================
   Schüler-Detailseite (Hub: alle Noten + Rechenweg)
   ============================================================ */
function renderStudent() {
  const c = getCourse(route.courseId);
  if (!c) return go({ name: 'home' });
  const s = c.students.find(x => x.id === route.studentId);
  if (!s) return go({ name: 'course', courseId: c.id });
  const scale = c.scale;

  const valChip = (pts, avg) => {
    const gc = gradeColor(pts);
    const fg = (gc.fg === 'var(--g-top-fg)' || gc.fg === 'var(--g-fail-fg)') ? gc.fg : (gc.fg === 'var(--line)' ? 'var(--ink-faint)' : gc.fg);
    const bg = gc.bg === 'transparent' ? 'transparent' : gc.bg;
    return `<span class="sd-chip" style="background:${bg};color:${fg}">${fmtGrade(pts, scale, avg)}</span>`;
  };

  const leistungRow = (col, hyKey) => {
    const v = (data.grades[s.id] || {})[col.id];
    return `<div class="cs-line sd-grade" data-col="${col.id}" data-hy="${hyKey}">
      <span>${esc(col.label)}${col.ka?' <span class="pill" style="font-size:9px;padding:0 5px">KA</span>':''}${col.date?` <span class="cs-sub">${fmtDate(col.date)}</span>`:''}</span>
      <span class="cs-vals">${valChip(v, false)}</span></div>`;
  };
  const sonstRow = (so) => {
    const v = (data.sonstigeValues[s.id] || {})[so.id];
    return `<div class="cs-line sd-sonst" data-so="${so.id}" data-hy-sonst><span>Bonus: ${esc(so.label)} (${so.percent}%)</span><span class="cs-vals">${valChip(v, false)}</span></div>`;
  };

  const hyBlock = (hyKey) => {
    const hy = c.halfYears[hyKey];
    const comp = computeHalf(c, hyKey, s.id);
    const eff = effGesamt(c, hyKey, s.id);
    const schrift = hy.columns.filter(x => x.type === 'schriftlich');
    const muend = hy.columns.filter(x => x.type === 'muendlich');
    const manual = eff.manual != null && eff.computed != null;
    return `<div class="calc-block">
      <h3>${hyKey}. Halbjahr</h3>
      <div class="cs-sub" style="margin-bottom:4px">Schriftlich</div>
      ${schrift.length ? schrift.map(col => leistungRow(col, hyKey)).join('') : '<div class="cs-line cs-sub"><span>keine</span><span></span></div>'}
      ${hy.sonstige.filter(x=>x.scope==='schriftlich').map(sonstRow).join('')}
      <div class="cs-line"><span><b>Ø schriftlich</b></span><span class="cs-vals">${fmtGrade(comp.wAvg, scale, true)}</span></div>
      <div class="cs-sub" style="margin:8px 0 4px">Mündlich</div>
      ${muend.length ? muend.map(col => leistungRow(col, hyKey)).join('') : '<div class="cs-line cs-sub"><span>keine</span><span></span></div>'}
      ${hy.sonstige.filter(x=>x.scope==='muendlich').map(sonstRow).join('')}
      <div class="cs-line"><span><b>Ø mündlich</b></span><span class="cs-vals">${fmtGrade(comp.mAvg, scale, true)}</span></div>
      ${hy.sonstige.filter(x=>x.scope==='allgemein').map(sonstRow).join('')}
      <div class="cs-line total"><span>Gesamtnote${manual?' (manuell)':''}</span>
        <span class="cs-vals">${valChip(eff.value, true)}${manual?` <span class="cs-sub">(${fmtGrade(eff.computed, scale, true)})</span>`:''}</span></div>
      <button class="btn small sd-calc" data-hy="${hyKey}" style="margin-top:8px">Rechenweg & Note setzen</button>
    </div>`;
  };

  const endj = effEndjahr(c, s.id);
  const endManual = endj.manual != null && endj.computed != null;
  const series = gradeSeries(c, s.id);

  app().innerHTML = `
    <div class="page-head">
      <div>
        <h1>${esc(s.firstName)} ${esc(s.lastName||'')}</h1>
        <div class="sub">${esc(c.subject)} ${esc(c.className)} · ${scaleName(scale)}${s.entry?' · Eintritt '+fmtDateLong(s.entry):''}${s.exit?' · Austritt '+fmtDateLong(s.exit):''}</div>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn small" id="sdSim">Was brauche ich noch?</button>
        <button class="btn small" id="sdEdit">Stammdaten</button>
      </div>
    </div>

    <div class="calc-block">
      <h3>Notenverlauf</h3>
      ${verlaufSvg(series, scale)}
    </div>

    <div class="row2" style="align-items:start;gap:20px">
      ${hyBlock('1')}
      ${hyBlock('2')}
    </div>

    <div class="calc-block" style="border-left:4px solid var(--accent)">
      <h3>Endjahresnote (${c.weightHY1}/${c.weightHY2})</h3>
      <div class="cs-line"><span>Gesamt 1. Halbjahr</span><span class="cs-vals">${fmtGrade(endj.g1, scale, true)}</span></div>
      <div class="cs-line"><span>Gesamt 2. Halbjahr</span><span class="cs-vals">${fmtGrade(endj.g2, scale, true)}</span></div>
      <div class="cs-line total"><span>Endjahr${endManual?' (manuell)':''}</span>
        <span class="cs-vals">${valChip(endj.value, true)}${endManual?` <span class="cs-sub">(${fmtGrade(endj.computed, scale, true)})</span>`:''}</span></div>
      <button class="btn small" id="sdEndCalc" style="margin-top:8px">Rechenweg & Note setzen</button>
    </div>

    <div class="notice" style="margin-top:16px">Notenverlauf-Grafik und Beobachtungsnotizen folgen in den nächsten Phasen.</div>
  `;

  document.getElementById('sdEdit').onclick = () => openStudentForm(c, s.id);
  document.getElementById('sdSim').onclick = () => openSimulator(c, s.id);
  app().querySelectorAll('.sd-grade').forEach(row => row.onclick = () => {
    const col = c.halfYears[row.dataset.hy].columns.find(x => x.id === row.dataset.col);
    if (col.ka) return go({ name: 'ka', courseId: c.id, columnId: col.id, kaTab: 'eingabe' });
    const cur = (data.grades[s.id] || {})[col.id];
    openPad(`${esc(s.firstName)} — ${esc(col.label)}`, cur, v => {
      if (!data.grades[s.id]) data.grades[s.id] = {};
      if (v == null) delete data.grades[s.id][col.id]; else data.grades[s.id][col.id] = v;
      save(); renderStudent();
    }, scale);
  });
  app().querySelectorAll('.sd-sonst').forEach(row => row.onclick = () => {
    const soId = row.dataset.so;
    const cur = (data.sonstigeValues[s.id] || {})[soId];
    openPad(`${esc(s.firstName)} — Bonus`, cur, v => {
      if (!data.sonstigeValues[s.id]) data.sonstigeValues[s.id] = {};
      if (v == null) delete data.sonstigeValues[s.id][soId]; else data.sonstigeValues[s.id][soId] = v;
      save(); renderStudent();
    }, scale);
  });
  app().querySelectorAll('.sd-calc').forEach(b => b.onclick = () => { route.hy = b.dataset.hy; openCalc(c, s.id, 'gesamt'); });
  document.getElementById('sdEndCalc').onclick = () => openCalc(c, s.id, 'endjahr');
}

/* ============================================================
   Klassenarbeit — eigene Seite (Eingabe / Bewertung / Statistik)
   ============================================================ */
function createKA(c) {
  const hy = c.halfYears[route.hy];
  const col = {
    id: uid(), type: 'schriftlich', label: 'Klassenarbeit', date: todayISO(),
    ka: {
      tasks: [
        { id: uid(), label: 'Aufgabe 1', max: 10 },
        { id: uid(), label: 'Aufgabe 2', max: 10 },
        { id: uid(), label: 'Aufgabe 3', max: 10 },
      ],
      scheme: STANDARD_SCHEME.map(r => ({ ...r })),
    },
  };
  hy.columns.push(col);
  save();
  go({ name: 'ka', courseId: c.id, columnId: col.id, kaTab: 'eingabe' });
}

function renderKA() {
  const c = getCourse(route.courseId);
  if (!c) return go({ name: 'home' });
  const col = findKaColumn(c);
  if (!col) return go({ name: 'course', courseId: c.id });
  const tab = route.kaTab || 'eingabe';

  app().innerHTML = `
    <div class="page-head">
      <div>
        <h1>${esc(col.label)}</h1>
        <div class="sub">${esc(c.subject)} ${esc(c.className)} · ${route.hy}. Halbjahr${col.date?' · '+fmtDateLong(col.date):''}</div>
      </div>
    </div>
    <div class="tabs">
      <button class="tab ${tab==='eingabe'?'active':''}" data-t="eingabe">Punkteeingabe</button>
      <button class="tab ${tab==='bewertung'?'active':''}" data-t="bewertung">Bewertungsbogen</button>
      <button class="tab ${tab==='statistik'?'active':''}" data-t="statistik">Statistik</button>
    </div>
    <div id="kaBody"></div>
  `;
  document.querySelectorAll('.tab').forEach(t => t.onclick = () => go({ kaTab: t.dataset.t }));

  if (tab === 'eingabe') renderKaEingabe(c, col);
  else if (tab === 'bewertung') renderKaBewertung(c, col);
  else renderKaStatistik(c, col);
}

/* --- Reiter: Punkteeingabe --- */
function renderKaEingabe(c, col) {
  const body = document.getElementById('kaBody');
  if (!col.ka.tasks.length) {
    body.innerHTML = `<div class="notice">Noch keine Aufgaben angelegt. Wechsle zum <b>Bewertungsbogen</b>, um Aufgaben und Punktegrenzen festzulegen.</div>`;
    return;
  }
  const maxTotal = col.ka.tasks.reduce((a, t) => a + (Number(t.max) || 0), 0);
  const head = col.ka.tasks.map(t =>
    `<th class="ka-task grp-schrift">${esc(t.label)}<span class="ch-max">von ${t.max}</span></th>`).join('');

  const rows = c.students.map(s => {
    const pts = (data.kaPoints[s.id] || {})[col.id] || {};
    const tot = kaTotals(col, s.id);
    const cells = col.ka.tasks.map(t =>
      `<td class="ka-input"><input type="number" min="0" max="${t.max}" step="0.5" inputmode="decimal"
         data-s="${s.id}" data-task="${t.id}" value="${pts[t.id] != null ? pts[t.id] : ''}"></td>`).join('');
    return `<tr>
      <td class="col-name"><span class="sname">${esc(s.firstName)} ${esc(s.lastName||'')}</span></td>
      ${cells}
      <td class="ka-sum" data-sum="${s.id}"><div class="cell">${tot.achieved==null?'–':fmtNum(tot.achieved)}/${maxTotal}</div></td>
      <td class="ka-pct" data-pct="${s.id}"><div class="cell">${tot.percent==null?'–':Math.round(tot.percent)+'%'}</div></td>
      <td class="ka-note" data-note="${s.id}">${kaNoteCell(tot.grade, c.scale)}</td>
    </tr>`;
  }).join('');

  body.innerHTML = `
    <div class="notice">Punkte pro Aufgabe eintragen. Note, Prozent und Summe berechnen sich automatisch und landen in der Notentabelle. Leere Zeile = nicht mitgeschrieben.</div>
    <div class="table-wrap"><table class="grades">
      <thead><tr><th class="col-name">Schüler:in</th>${head}
        <th class="grp-schrift">Summe</th><th class="grp-schrift">Prozent</th><th class="grp-final">Note</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
  `;

  body.querySelectorAll('input[data-task]').forEach(inp => {
    inp.oninput = () => {
      const sId = inp.dataset.s, taskId = inp.dataset.task;
      const task = col.ka.tasks.find(t => t.id === taskId);
      if (!data.kaPoints[sId]) data.kaPoints[sId] = {};
      if (!data.kaPoints[sId][col.id]) data.kaPoints[sId][col.id] = {};
      const store = data.kaPoints[sId][col.id];
      if (inp.value === '') { delete store[taskId]; }
      else {
        let v = clamp(parseFloat(inp.value) || 0, 0, Number(task.max) || 0);
        store[taskId] = v;
      }
      // Zeile live aktualisieren
      const tot = kaTotals(col, sId);
      body.querySelector(`[data-sum="${sId}"] .cell`).textContent = (tot.achieved==null?'–':fmtNum(tot.achieved)) + '/' + maxTotal;
      body.querySelector(`[data-pct="${sId}"] .cell`).textContent = tot.percent==null?'–':Math.round(tot.percent)+'%';
      body.querySelector(`[data-note="${sId}"]`).innerHTML = kaNoteCell(tot.grade, c.scale);
      syncKaGrades(c, col);
      save();
    };
  });
}
function kaNoteCell(grade, scale) {
  scale = scale || 'punkte';
  const col = gradeColor(grade);
  const sub = scale === 'noten' ? '' : `<span class="nt" style="color:${col.fg}">${noteLabel(grade)}</span>`;
  return `<div class="cell" style="background:${col.bg};color:${col.fg}">
    <span>${grade==null?'–':fmtGrade(grade, scale, false)}</span>${grade==null?'':sub}</div>`;
}

/* --- Reiter: Bewertungsbogen (Aufgaben + Punkte/Prozent-Schema) --- */
function renderKaBewertung(c, col) {
  const body = document.getElementById('kaBody');
  const maxTotal = col.ka.tasks.reduce((a, t) => a + (Number(t.max) || 0), 0);

  const taskRows = col.ka.tasks.map(t => `
    <div class="task-edit" data-task="${t.id}">
      <input type="text" class="te-label" value="${esc(t.label)}" placeholder="Aufgabe">
      <input type="number" class="te-max" min="0" step="0.5" value="${t.max}" placeholder="max">
      <button class="btn small danger te-del">×</button>
    </div>`).join('');

  const schemeRows = col.ka.scheme.map((r, i) => `
    <div class="scheme-row" data-i="${i}">
      <span class="sr-note">${r.points}<small>${NOTE_MAP[r.points]}</small></span>
      <input type="range" min="0" max="100" value="${r.minPercent}" class="sr-range">
      <input type="number" min="0" max="100" value="${r.minPercent}" class="sr-pct">
    </div>`).join('');

  body.innerHTML = `
    <div class="row2" style="align-items:start;gap:20px">
      <div>
        <div class="field"><label>Bezeichnung</label><input type="text" id="kaLabel" value="${esc(col.label)}"></div>
        <div class="field"><label>Datum</label><input type="date" id="kaDate" value="${col.date||''}"></div>

        <div class="calc-block">
          <h3>Aufgaben (Gesamt: ${fmtNum(maxTotal)} Punkte)</h3>
          <div id="taskList">${taskRows || '<div class="cs-sub">noch keine Aufgaben</div>'}</div>
          <button class="btn small" id="kaAddTask">+ Aufgabe</button>
        </div>
      </div>

      <div>
        <div class="calc-block">
          <h3>Bewertungsbogen — ab wie viel Prozent welche Note</h3>
          <div class="scheme-head"><span>Punkte</span><span>ab Prozent</span><span>%</span></div>
          <div id="schemeList">${schemeRows}</div>
          <button class="btn small" id="kaStdScheme" style="margin-top:10px">Standardvorschlag einsetzen</button>
        </div>
      </div>
    </div>
    <div class="toolbar" style="margin-top:16px">
      <button class="btn danger" id="kaDelete">Klassenarbeit löschen</button>
      <div class="spacer"></div>
      <button class="btn primary" id="kaToEntry">Zur Punkteeingabe ›</button>
    </div>
  `;

  const recompute = () => { syncKaGrades(c, col); save(); };

  document.getElementById('kaLabel').oninput = e => { col.label = e.target.value; save(); };
  document.getElementById('kaDate').onchange = e => { col.date = e.target.value; save(); };

  // Aufgaben
  body.querySelectorAll('.task-edit').forEach(row => {
    const id = row.dataset.task; const task = col.ka.tasks.find(t => t.id === id);
    row.querySelector('.te-label').oninput = e => { task.label = e.target.value; save(); };
    row.querySelector('.te-max').oninput = e => { task.max = clamp(parseFloat(e.target.value) || 0, 0, 999); recompute(); };
    row.querySelector('.te-del').onclick = () => {
      col.ka.tasks = col.ka.tasks.filter(t => t.id !== id);
      Object.values(data.kaPoints).forEach(byCol => { if (byCol[col.id]) delete byCol[col.id][id]; });
      recompute(); renderKaBewertung(c, col);
    };
  });
  document.getElementById('kaAddTask').onclick = () => {
    col.ka.tasks.push({ id: uid(), label: 'Aufgabe ' + (col.ka.tasks.length + 1), max: 10 });
    save(); renderKaBewertung(c, col);
  };

  // Bewertungsbogen
  body.querySelectorAll('.scheme-row').forEach(row => {
    const i = +row.dataset.i;
    const range = row.querySelector('.sr-range'), pct = row.querySelector('.sr-pct');
    const setVal = v => { v = clamp(Math.round(v), 0, 100); col.ka.scheme[i].minPercent = v; range.value = v; pct.value = v; recompute(); };
    range.oninput = () => setVal(+range.value);
    pct.oninput = () => setVal(+pct.value);
  });
  document.getElementById('kaStdScheme').onclick = () => {
    col.ka.scheme = STANDARD_SCHEME.map(r => ({ ...r }));
    recompute(); renderKaBewertung(c, col);
    toast('Standard-Bewertungsbogen eingesetzt.');
  };

  document.getElementById('kaToEntry').onclick = () => go({ kaTab: 'eingabe' });
  document.getElementById('kaDelete').onclick = () => {
    modal('Klassenarbeit löschen?', `<p>Die Klassenarbeit <b>${esc(col.label)}</b> inkl. aller eingetragenen Punkte wird gelöscht.</p>`, [
      { label: 'Abbrechen', onClick: closeModal },
      { label: 'Löschen', cls: 'danger', onClick: () => {
        const hy = c.halfYears[route.hy];
        hy.columns = hy.columns.filter(x => x.id !== col.id);
        Object.values(data.grades).forEach(g => delete g[col.id]);
        Object.values(data.kaPoints).forEach(k => delete k[col.id]);
        save(); closeModal(); go({ name: 'course', courseId: c.id });
      }},
    ]);
  };
}

/* --- Reiter: Statistik --- */
function renderKaStatistik(c, col) {
  const body = document.getElementById('kaBody');
  const parts = c.students.map(s => ({ s, tot: kaTotals(col, s.id) })).filter(x => x.tot.grade != null);
  if (!parts.length) {
    body.innerHTML = `<div class="empty-state"><p>Noch keine Punkte eingetragen. Statistik erscheint, sobald Ergebnisse vorliegen.</p></div>`;
    return;
  }
  const grades = parts.map(x => x.tot.grade);
  const rawPts = parts.map(x => x.tot.achieved);
  const percents = parts.map(x => x.tot.percent);
  const maxTotal = col.ka.tasks.reduce((a, t) => a + (Number(t.max) || 0), 0);

  const avg = a => a.reduce((x, y) => x + y, 0) / a.length;
  const avgGrade = avg(grades), avgRaw = avg(rawPts), avgPct = avg(percents);
  const medGrade = median(grades), medRaw = median(rawPts);
  const bestanden = grades.filter(g => g >= 5).length; // ab 5 Pkt = ausreichend (Note 4)
  const durchgef = grades.filter(g => g < 5).length;

  // Notenspiegel im 6er-System (1..6)
  const noteBucket = { 1:0,2:0,3:0,4:0,5:0,6:0 };
  grades.forEach(g => { noteBucket[noteFromPoints(g)]++; });
  const maxCount = Math.max(...Object.values(noteBucket), 1);
  const noteColorPts = { 1:14, 2:11, 3:8, 4:5, 5:2, 6:0 };
  let spiegel = '';
  for (let n = 1; n <= 6; n++) {
    const gc = gradeColor(noteColorPts[n]);
    const bg = gc.bg === 'transparent' ? '#c8ccd2' : gc.bg;
    spiegel += `<span class="sp-pts">${n}</span>
      <div class="sp-bar-wrap"><div class="sp-bar" style="width:${noteBucket[n]/maxCount*100}%;background:${bg}"></div></div>
      <span class="sp-cnt">${noteBucket[n]||''}</span>`;
  }

  // Durchschnitt pro Aufgabe
  const taskStats = col.ka.tasks.map(t => {
    const vals = parts.map(x => Number((data.kaPoints[x.s.id]||{})[col.id]?.[t.id]) || 0);
    const m = avg(vals);
    return { label: t.label, max: t.max, m, pct: t.max ? m / t.max * 100 : 0 };
  });
  const taskRows = taskStats.map(ts => `
    <div class="cs-line"><span>${esc(ts.label)}</span>
      <span class="cs-vals">Ø ${fmtNum(ts.m)} / ${fmtNum(ts.max)} (${Math.round(ts.pct)}%)</span></div>`).join('');

  const gcAvg = gradeColor(avgGrade);
  const scale = c.scale;
  const noteUnit = scale === 'noten' ? '' : ' Pkt';
  body.innerHTML = `
    <div class="stat-grid">
      <div class="dash-card"><div class="label">Teilgenommen</div><div class="value">${parts.length}<small> / ${c.students.length}</small></div></div>
      <div class="dash-card" style="border-left-color:${gcAvg.bg==='transparent'?'var(--accent)':gcAvg.bg}">
        <div class="label">Ø Note</div><div class="value">${fmtGrade(avgGrade, scale, true)}<small>${noteUnit}${scale==='noten'?'':' · '+noteLabel(avgGrade)}</small></div></div>
      <div class="dash-card"><div class="label">Ø Punkte (roh)</div><div class="value">${fmtNum(avgRaw)}<small> / ${fmtNum(maxTotal)} · ${Math.round(avgPct)}%</small></div></div>
      <div class="dash-card"><div class="label">Median Note</div><div class="value">${fmtGrade(medGrade, scale, true)}<small>${noteUnit}${scale==='noten'?'':' · '+noteLabel(medGrade)}</small></div></div>
      <div class="dash-card"><div class="label">Median Punkte</div><div class="value">${fmtNum(medRaw)}<small> roh</small></div></div>
      <div class="dash-card"><div class="label">Bestanden (≥5 Pkt)</div><div class="value">${bestanden}<small> · ${durchgef} unter 05</small></div></div>
    </div>

    <div class="row2" style="align-items:start;gap:20px">
      <div class="calc-block">
        <h3>Notenspiegel (Note 1–6)</h3>
        <div class="spiegel">${spiegel}</div>
      </div>
      <div class="calc-block">
        <h3>Durchschnitt pro Aufgabe</h3>
        ${taskRows}
      </div>
    </div>
  `;
}

function renderTable(c) {
  const host = document.getElementById('tableHost');
  const hy = c.halfYears[route.hy];
  if (!c.students.length) {
    host.innerHTML = `<div class="empty-state"><p>Noch keine Schüler:innen in diesem Kurs.</p>
      <button class="btn primary" id="es1">+ Schüler:innen hinzufügen</button></div>`;
    document.getElementById('es1').onclick = () => openStudents(c);
    return;
  }

  const scale = c.scale || 'punkte';
  const isGesamt = route.view === 'gesamt';
  const showS = isGesamt || route.view === 'schriftlich';
  const showM = isGesamt || route.view === 'muendlich';
  const schriftCols = hy.columns.filter(x => x.type === 'schriftlich');
  const muendCols = hy.columns.filter(x => x.type === 'muendlich');
  const sonstS = hy.sonstige.filter(s => s.scope === 'schriftlich');
  const sonstM = hy.sonstige.filter(s => s.scope === 'muendlich');
  const sonstA = hy.sonstige.filter(s => s.scope === 'allgemein');
  const zwCols = hy.columns.filter(x => x.type === 'zwischenstand');

  const headCols = (cols, grpClass) => cols.map(col => `
    <th class="colhead ${grpClass}" data-col="${col.id}">
      <span class="ch-label">${esc(col.label)}${col.ka ? ' <span class="pill" style="font-size:9px;padding:1px 5px;vertical-align:middle">KA</span>' : ''}</span>
      ${col.date ? `<span class="ch-date">${fmtDate(col.date)}</span>` : ''}
    </th>`).join('');
  const headSonst = list => list.map(so => `<th class="grp-sonst">${esc(so.label)}<span class="ch-date">${so.percent}%</span></th>`).join('');

  let thead = `<tr><th class="col-name">Schüler:in</th>`;
  if (route.hy === '2') thead += `<th class="grp-prev">Ges. HJ1</th>`;
  if (showS) { thead += headCols(schriftCols, 'grp-schrift'); thead += `<th class="grp-schrift">Ø schr.</th>`; thead += headSonst(sonstS); }
  if (showM) { thead += headCols(muendCols, 'grp-muend'); thead += `<th class="grp-muend">Ø mündl.</th>`; thead += headSonst(sonstM); }
  const stickyGesamt = isGesamt && route.hy !== '2';   // in HJ1 ist Gesamt die letzte Spalte
  const stickyEndjahr = isGesamt && route.hy === '2';  // in HJ2 ist Endjahr die letzte Spalte
  const zwHead = zwCols.map(col => `<th class="grp-prev zw-head" data-zw="${col.id}">${esc(col.label||'Zwischenstand')}<span class="ch-date">${fmtDate(col.date)}</span></th>`).join('');
  if (isGesamt) {
    thead += headSonst(sonstA);
    thead += zwHead;
    thead += `<th class="grp-final ${stickyGesamt?'col-sticky-r':''}">Gesamt</th>`;
    if (route.hy === '2') thead += `<th class="grp-final col-sticky-r">Endjahr</th>`;
  }
  thead += `</tr>`;

  const cell = (pts) => {
    const col = gradeColor(pts);
    const has = pts != null && !isNaN(pts);
    return `<div class="cell ${has?'':'empty'}" style="background:${col.bg};color:${col.fg}">${has ? fmtGrade(pts, scale, false) : '·'}</div>`;
  };
  const avgCell = (v) => {
    const col = gradeColor(v);
    const fg = (col.fg === 'var(--g-top-fg)' || col.fg === 'var(--g-fail-fg)') ? 'var(--ink)' : col.fg;
    return `<div class="cell" style="color:${fg}">${fmtGrade(v, scale, true)}</div>`;
  };
  const finalCell = (eff, extra) => {
    const v = eff.value, col = gradeColor(v);
    const manual = eff.manual != null && eff.computed != null;
    return `<div class="cell ${manual?'manual':''}" style="background:${col.bg};color:${col.fg}">
      <span class="pt">${fmtGrade(v, scale, true)}${extra||''}</span>
      ${scale==='noten'?'':`<span class="nt" style="color:${col.fg}">${v==null?'':noteLabel(v)}</span>`}
      ${manual?`<span class="calc" style="color:${col.fg}">(${fmtGrade(eff.computed, scale, true)})</span>`:''}</div>`;
  };

  const rows = c.students.map(s => {
    const gr = data.grades[s.id] || {};
    const comp = computeHalf(c, route.hy, s.id);
    const sparkVals = gradeSeries(c, s.id, [route.hy]).map(p => p.value);
    const spark = sparkVals.length >= 2 ? `<div class="spark">${sparkSvg(sparkVals)}</div>` : '';
    let tr = `<tr class="${studentActive(s)?'':'inactive'}"><td class="col-name"><span class="sname sname-link" data-student="${s.id}">${esc(s.firstName)} ${esc(s.lastName||'')}${s.exit?' <small>(aus)</small>':''}</span>${spark}</td>`;
    if (route.hy === '2') {
      const g1 = effGesamt(c, '1', s.id).value;
      tr += `<td class="prev-cell"><div class="cell">${fmtGrade(g1, scale, true)}</div></td>`;
    }
    if (showS) {
      schriftCols.forEach(col => tr += `<td class="grade-cell" data-s="${s.id}" data-col="${col.id}">${cell(gr[col.id])}</td>`);
      tr += `<td class="avg">${avgCell(comp.wAvg)}</td>`;
      sonstS.forEach(so => tr += sonstCell(s.id, so.id));
    }
    if (showM) {
      muendCols.forEach(col => tr += `<td class="grade-cell" data-s="${s.id}" data-col="${col.id}">${cell(gr[col.id])}</td>`);
      tr += `<td class="avg">${avgCell(comp.mAvg)}</td>`;
      sonstM.forEach(so => tr += sonstCell(s.id, so.id));
    }
    if (isGesamt) {
      sonstA.forEach(so => tr += sonstCell(s.id, so.id));
      zwCols.forEach(col => tr += `<td class="prev-cell"><div class="cell">${fmtGrade((col.values||{})[s.id], scale, true)}</div></td>`);
      tr += `<td class="final ${stickyGesamt?'col-sticky-r':''}" data-final="gesamt" data-s="${s.id}">${finalCell(effGesamt(c, route.hy, s.id), trendArrowSvg(trendDir(c, route.hy, s.id)))}</td>`;
      if (route.hy === '2') tr += `<td class="final col-sticky-r" data-final="endjahr" data-s="${s.id}">${finalCell(effEndjahr(c, s.id))}</td>`;
    }
    tr += `</tr>`;
    return tr;
  }).join('');

  host.innerHTML = `<div class="table-wrap"><table class="grades"><thead>${thead}</thead><tbody>${rows}</tbody></table></div>`;

  host.querySelectorAll('td.grade-cell').forEach(td =>
    td.onclick = () => openGradeCell(c, td.dataset.s, td.dataset.col));
  host.querySelectorAll('td.sonst-cell').forEach(td =>
    td.onclick = () => openSonstCell(c, td.dataset.s, td.dataset.so));
  host.querySelectorAll('th.colhead').forEach(th =>
    th.onclick = () => {
      const col = hy.columns.find(x => x.id === th.dataset.col);
      if (col && col.ka) go({ name: 'ka', courseId: c.id, columnId: col.id, kaTab: 'eingabe' });
      else openColumnForm(c, null, th.dataset.col);
    });
  host.querySelectorAll('td.final').forEach(td =>
    td.onclick = () => openCalc(c, td.dataset.s, td.dataset.final));
  host.querySelectorAll('.sname-link').forEach(el =>
    el.onclick = () => go({ name: 'student', courseId: c.id, studentId: el.dataset.student }));
  host.querySelectorAll('.zw-head').forEach(th =>
    th.onclick = () => openZwischenstand(c, th.dataset.zw));

  function sonstCell(sId, soId) {
    const v = (data.sonstigeValues[sId] || {})[soId];
    const col = gradeColor(v);
    const has = v != null && !isNaN(v);
    return `<td class="sonst-cell" data-s="${sId}" data-so="${soId}"><div class="cell" style="color:${has?col.fg==='var(--g-top-fg)'||col.fg==='var(--g-fail-fg)'?'var(--ink)':col.fg:'var(--line)'}">${has?fmtGrade(v, scale, false):'·'}</div></td>`;
  }
}

/* ============================================================
   Punkte-Pad (generisch)
   ============================================================ */
function openPad(title, current, onPick, scale) {
  scale = scale || 'punkte';
  let pad = '';
  for (let p = 15; p >= 0; p--) {
    const gc = gradeColor(p);
    const bg = gc.bg === 'transparent' ? '#fff' : gc.bg;
    const fg = gc.fg === 'var(--line)' ? 'var(--ink)' : gc.fg;
    const big = scale === 'noten' ? NOTE_MAP[p] : p;
    const sub = scale === 'noten' ? `${p} P.` : NOTE_MAP[p];
    pad += `<button data-p="${p}" class="${current===p?'sel':''}" style="background:${bg};color:${fg}">${big}<span class="nt" style="color:${fg}">${sub}</span></button>`;
  }
  modal(title, `<div class="gradepad">${pad}<button class="gradepad-clear btn" data-p="clear">Note entfernen</button></div>`,
    [{ label: 'Fertig', cls: 'primary', onClick: closeModal }]);
  document.querySelectorAll('.gradepad button').forEach(b => b.onclick = () => {
    onPick(b.dataset.p === 'clear' ? null : parseInt(b.dataset.p));
    closeModal();
  });
}
function openGradeCell(c, sId, colId) {
  const s = c.students.find(x => x.id === sId);
  const col = c.halfYears[route.hy].columns.find(x => x.id === colId);
  if (col && col.ka) return go({ name: 'ka', courseId: c.id, columnId: col.id, kaTab: 'eingabe' });
  const cur = (data.grades[sId] || {})[colId];
  openPad(`${esc(s.firstName)} ${esc(s.lastName||'')} — ${esc(col.label)}`, cur, v => {
    if (!data.grades[sId]) data.grades[sId] = {};
    if (v == null) delete data.grades[sId][colId]; else data.grades[sId][colId] = v;
    save(); renderTable(c);
  }, c.scale);
}
function openSonstCell(c, sId, soId) {
  const s = c.students.find(x => x.id === sId);
  const so = c.halfYears[route.hy].sonstige.find(x => x.id === soId);
  const cur = (data.sonstigeValues[sId] || {})[soId];
  openPad(`${esc(s.firstName)} ${esc(s.lastName||'')} — ${esc(so.label)} (Bonus)`, cur, v => {
    if (!data.sonstigeValues[sId]) data.sonstigeValues[sId] = {};
    if (v == null) delete data.sonstigeValues[sId][soId]; else data.sonstigeValues[sId][soId] = v;
    save(); renderTable(c);
  }, c.scale);
}

/* ============================================================
   Berechnungs-Detail (Gesamt / Endjahr) + manuelle Note
   ============================================================ */
function openCalc(c, sId, mode) {
  const s = c.students.find(x => x.id === sId);
  const name = `${esc(s.firstName)} ${esc(s.lastName||'')}`;
  if (mode === 'endjahr') return openCalcEndjahr(c, s, name);
  return openCalcGesamt(c, s, name);
}

function openCalcGesamt(c, s, name) {
  const hyKey = route.hy;
  const hy = c.halfYears[hyKey];
  const gr = data.grades[s.id] || {};
  const comp = computeHalf(c, hyKey, s.id);
  const wt = comp.wt;
  const eff = effGesamt(c, hyKey, s.id);
  const scale = c.scale;

  const listCols = (cols) => cols.length
    ? cols.map(col => `<div class="cs-line"><span>${esc(col.label)}</span><span class="cs-vals">${fmtGrade(gr[col.id], scale, false)}</span></div>`).join('')
    : `<div class="cs-line cs-sub"><span>keine Noten</span><span></span></div>`;
  const listSonst = (scope, base) => hy.sonstige.filter(x => x.scope === scope).map(so => {
    const sv = (data.sonstigeValues[s.id]||{})[so.id];
    return `<div class="cs-line cs-sub"><span>Bonus: ${esc(so.label)} (${so.percent}%, Pkt ${sv??'–'})</span><span class="cs-vals">${sv!=null&&base!=null&&sv>base?'wirkt':'—'}</span></div>`;
  }).join('');

  modal(`Berechnung — ${name}`, `
    <div class="calc-sheet">
      <div class="calc-block">
        <h3>Schriftlich</h3>
        ${listCols(hy.columns.filter(x=>x.type==='schriftlich'))}
        ${listSonst('schriftlich', comp.wRaw)}
        <div class="cs-line"><span>Ø schriftlich</span><span class="cs-vals">${fmtGrade(comp.wAvg, scale, true)}</span></div>
      </div>
      <div class="calc-block">
        <h3>Mündlich</h3>
        ${listCols(hy.columns.filter(x=>x.type==='muendlich'))}
        ${listSonst('muendlich', comp.mRaw)}
        <div class="cs-line"><span>Ø mündlich</span><span class="cs-vals">${fmtGrade(comp.mAvg, scale, true)}</span></div>
      </div>

      <div class="field">
        <label>Gewichtung für ${name}${wt.custom?' (individuell)':''}</label>
        <div class="row2">
          <div><input id="cwW" type="number" min="0" max="100" value="${wt.w}"> <span class="hint">% schriftlich</span></div>
          <div><input id="cwM" type="number" min="0" max="100" value="${wt.m}" disabled> <span class="hint">% mündlich</span></div>
        </div>
        ${wt.custom?`<button class="btn small" id="cwReset" style="margin-top:8px">Auf Kurs-Standard (${c.weightWritten}/${c.weightOral}) zurück</button>`:`<div class="hint">Standard aus Kurs: ${c.weightWritten}/${c.weightOral}. Änderung gilt nur für ${name}.</div>`}
      </div>

      ${listSonst('allgemein', comp.gesamt)}
      <div class="cs-line total"><span>Berechnete Gesamtnote</span><span class="cs-vals">${eff.computed==null?'–':fmtGrade(eff.computed, scale, true)+(scale==='noten'?'':' · '+noteLabel(eff.computed))}</span></div>

      <div class="field" style="margin-top:14px">
        <label>Manuell überschreiben</label>
        <select id="cManual">${manualOptions(scale, eff.manual)}</select>
        <div class="hint">Wird gesetzt, erscheint die berechnete Kommanote klein in Klammern.</div>
      </div>
    </div>
  `, [
    { label: 'Abbrechen', onClick: closeModal },
    { label: 'Speichern', cls: 'primary', onClick: () => {
      const w = clamp(parseInt(val('cwW')) || 0, 0, 100);
      if (!data.weightOverride[s.id]) data.weightOverride[s.id] = {};
      if (w === c.weightWritten) delete data.weightOverride[s.id][hyKey];
      else data.weightOverride[s.id][hyKey] = w;
      const manKey = hyKey === '1' ? 'g1' : 'g2';
      if (!data.manual[s.id]) data.manual[s.id] = {};
      const mv = val('cManual');
      if (mv === '') delete data.manual[s.id][manKey];
      else data.manual[s.id][manKey] = clamp(parseInt(mv) || 0, 0, 15);
      save(); closeModal(); render();
    }},
  ]);
  const cw = document.getElementById('cwW'), cm = document.getElementById('cwM');
  cw.oninput = () => { cm.value = clamp(100 - (parseInt(cw.value) || 0), 0, 100); };
  const rst = document.getElementById('cwReset');
  if (rst) rst.onclick = () => { cw.value = c.weightWritten; cm.value = c.weightOral; };
}

function openCalcEndjahr(c, s, name) {
  const eff = effEndjahr(c, s.id);
  const scale = c.scale;
  const sv = (p) => p == null ? '–' : fmtGrade(p, scale, true) + (scale === 'noten' ? '' : ' · ' + noteLabel(p));
  modal(`Endjahresnote — ${name}`, `
    <div class="calc-sheet">
      <div class="cs-line"><span>Gesamtnote 1. Halbjahr</span><span class="cs-vals">${sv(eff.g1)}</span></div>
      <div class="cs-line"><span>Gesamtnote 2. Halbjahr</span><span class="cs-vals">${sv(eff.g2)}</span></div>

      <div class="field" style="margin-top:12px">
        <label>Gewichtung 1. / 2. Halbjahr (gilt für den Kurs)</label>
        <div class="row2">
          <div><input id="ehW1" type="number" min="0" max="100" value="${c.weightHY1}"> <span class="hint">% 1. HJ</span></div>
          <div><input id="ehW2" type="number" min="0" max="100" value="${c.weightHY2}" disabled> <span class="hint">% 2. HJ</span></div>
        </div>
        <div class="hint">Standard 30 / 70.</div>
      </div>

      <div class="cs-line total"><span>Berechnete Endjahresnote</span><span class="cs-vals" id="ehCalc">${sv(eff.computed)}</span></div>

      <div class="field" style="margin-top:14px">
        <label>Manuell überschreiben</label>
        <select id="ehManual">${manualOptions(scale, eff.manual)}</select>
      </div>
    </div>
  `, [
    { label: 'Abbrechen', onClick: closeModal },
    { label: 'Speichern', cls: 'primary', onClick: () => {
      const w1 = clamp(parseInt(val('ehW1')) || 0, 0, 100);
      c.weightHY1 = w1; c.weightHY2 = 100 - w1;
      if (!data.manual[s.id]) data.manual[s.id] = {};
      const mv = val('ehManual');
      if (mv === '') delete data.manual[s.id].end;
      else data.manual[s.id].end = clamp(parseInt(mv) || 0, 0, 15);
      save(); closeModal(); render();
    }},
  ]);
  const w1 = document.getElementById('ehW1'), w2 = document.getElementById('ehW2');
  w1.oninput = () => { w2.value = clamp(100 - (parseInt(w1.value) || 0), 0, 100); };
}

/* ---------- Simulator „Was brauche ich noch?" ----------
   Modell: mündliche Leistung bleibt konstant, variabel ist die nächste
   schriftliche Note. Standard-Szenarien für die Notengrenzen 13/10/07/04. */
function simNeed(c, hyKey, sId, target) {
  const cur = simulateGesamt(c, hyKey, sId, null);
  if (cur != null && cur >= target - 1e-9) return { cur, reached: true };
  let needed = null;
  for (let x = 0; x <= 15; x++) {
    const g = simulateGesamt(c, hyKey, sId, { type: 'schriftlich', value: x });
    if (g != null && g >= target - 1e-9) { needed = x; break; }
  }
  const bestG = simulateGesamt(c, hyKey, sId, { type: 'schriftlich', value: 15 });
  return { cur, reached: false, needed, bestG };
}
function openSimulator(c, sId) {
  const s = c.students.find(x => x.id === sId);
  const scale = c.scale;
  modal(`Was brauche ich noch? — ${esc(s.firstName)} ${esc(s.lastName||'')}`, `
    <div class="field"><label>Halbjahr</label>
      <select id="simHy"><option value="1">1. Halbjahr</option><option value="2" ${route.hy==='2'?'selected':''}>2. Halbjahr</option></select></div>
    <div class="calc-block" style="margin-top:4px">
      <h3>Erreichbar bei gleichbleibender mündlicher Leistung</h3>
      <div class="cs-sub" id="simCur" style="margin-bottom:6px"></div>
      <div id="simScenarios"></div>
    </div>
    <div class="field"><label>Eigene Zielnote prüfen</label>
      <select id="simTarget"><option value="">— Zielnote wählen —</option>${targetOptions(scale, null)}</select></div>
    <div id="simCustom"></div>
  `, [{ label: 'Schließen', cls: 'primary', onClick: closeModal }]);

  const statusHtml = (t) => {
    const r = simNeed(c, val('simHy'), sId, t);
    if (r.reached) return `<span class="sim-status good">bereits erreicht</span>`;
    if (r.needed != null) return `<span class="sim-status">ab ${fmtGrade(r.needed, scale, false)} in der nächsten Klausur</span>`;
    return `<span class="sim-status bad">nicht erreichbar</span>`;
  };
  const run = () => {
    const hyKey = val('simHy');
    const cur = simulateGesamt(c, hyKey, sId, null);
    document.getElementById('simCur').textContent = `Aktuelle Gesamtnote: ${fmtGrade(cur, scale, true)}. Variabel: die nächste schriftliche Note.`;
    document.getElementById('simScenarios').innerHTML = [13, 10, 7, 4].map(t => {
      const extra = scale === 'noten' ? '' : `  <span class="cs-sub">(ab ${t} P.)</span>`;
      return `<div class="cs-line"><span>Gesamtnote ${noteFromPoints(t)}${extra}</span><span class="cs-vals">${statusHtml(t)}</span></div>`;
    }).join('');

    const tv = val('simTarget');
    const box = document.getElementById('simCustom');
    if (tv === '') { box.innerHTML = ''; return; }
    const target = parseInt(tv), r = simNeed(c, hyKey, sId, target);
    const note = scale === 'noten' ? '' : ' · ' + noteLabel(target);
    if (r.reached) box.innerHTML = `<div class="sim-out good"><b>Sicher.</b> ${fmtGrade(target, scale, false)}${note} steht bereits — auch die schlechteste nächste Klausur hält die Note.</div>`;
    else if (r.needed != null) box.innerHTML = `<div class="sim-out"><b>Mindestens ${fmtGrade(r.needed, scale, false)}</b> in der nächsten Klausur nötig für ${fmtGrade(target, scale, false)}${note}.</div>`;
    else box.innerHTML = `<div class="sim-out bad"><b>Nicht mehr erreichbar.</b> Selbst mit ${fmtGrade(15, scale, false)} käme nur ${fmtGrade(r.bestG, scale, true)} heraus.</div>`;
  };
  ['simHy', 'simTarget'].forEach(id => document.getElementById(id).onchange = run);
  run();
}

/* ============================================================
   MODAL-HELFER
   ============================================================ */
function modal(title, bodyHtml, footButtons) {
  document.getElementById('modalTitle').textContent = title;
  document.getElementById('modalBody').innerHTML = bodyHtml;
  const foot = document.getElementById('modalFoot');
  foot.innerHTML = '';
  (footButtons || []).forEach(b => {
    const btn = document.createElement('button');
    btn.className = 'btn ' + (b.cls || '');
    btn.textContent = b.label;
    btn.onclick = b.onClick;
    foot.appendChild(btn);
  });
  document.getElementById('modalBackdrop').hidden = false;
}
function closeModal() { document.getElementById('modalBackdrop').hidden = true; }
document.getElementById('modalClose').onclick = closeModal;
document.getElementById('modalBackdrop').addEventListener('click', e => { if (e.target.id === 'modalBackdrop') closeModal(); });
document.getElementById('navHome').onclick = () => go({ name: 'home' });

/* ---------- Kurs anlegen / bearbeiten ---------- */
function openCourseForm(course) {
  const editing = !!course;
  const c = course || { subject: '', className: '', weightWritten: 40, weightOral: 60, weightHY1: 30, weightHY2: 70 };
  modal(editing ? 'Kurs bearbeiten' : 'Neuer Kurs', `
    <div class="row2">
      <div class="field"><label>Fach</label><input id="fSubject" type="text" value="${esc(c.subject)}" placeholder="z. B. Mathematik"></div>
      <div class="field"><label>Klasse / Kurs</label><input id="fClass" type="text" value="${esc(c.className)}" placeholder="z. B. 9b oder EF"></div>
    </div>
    <div class="field">
      <label>Notenskala (Eingabe & Anzeige)</label>
      <select id="fScale">
        <option value="punkte" ${(c.scale||'punkte')==='punkte'?'selected':''}>Punkte 0–15 (Oberstufe)</option>
        <option value="noten" ${c.scale==='noten'?'selected':''}>Noten 1–6 mit Tendenz</option>
      </select>
      <div class="hint">Intern wird immer gleich gerechnet — nur Eingabe und Anzeige ändern sich.</div>
    </div>
    <div class="field">
      <label>Gewichtung schriftlich / mündlich</label>
      <div class="row2">
        <div><input id="fW" type="number" min="0" max="100" value="${c.weightWritten}"> <span class="hint">% schriftlich</span></div>
        <div><input id="fM" type="number" min="0" max="100" value="${c.weightOral}" disabled> <span class="hint">% mündlich (autom.)</span></div>
      </div>
      <div class="hint">Standard: 40 % schriftlich / 60 % mündlich.</div>
    </div>
    <div class="field">
      <label>Endjahresnote: Gewichtung 1. / 2. Halbjahr</label>
      <div class="row2">
        <div><input id="fH1" type="number" min="0" max="100" value="${c.weightHY1}"> <span class="hint">% 1. HJ</span></div>
        <div><input id="fH2" type="number" min="0" max="100" value="${c.weightHY2}" disabled> <span class="hint">% 2. HJ (autom.)</span></div>
      </div>
      <div class="hint">Standard: 30 / 70.</div>
    </div>
  `, [
    ...(editing ? [{ label: 'Kurs löschen', cls: 'danger', onClick: () => confirmDeleteCourse(c) }] : []),
    { label: 'Abbrechen', onClick: closeModal },
    { label: 'Speichern', cls: 'primary', onClick: () => {
      const subject = val('fSubject').trim(), className = val('fClass').trim();
      if (!subject) return toast('Bitte ein Fach angeben.');
      const w = clamp(parseInt(val('fW')) || 0, 0, 100);
      const h1 = clamp(parseInt(val('fH1')) || 0, 0, 100);
      const scale = val('fScale') || 'punkte';
      if (editing) { c.subject = subject; c.className = className; c.scale = scale; c.weightWritten = w; c.weightOral = 100 - w; c.weightHY1 = h1; c.weightHY2 = 100 - h1; }
      else { const nc = newCourse(subject, className); nc.scale = scale; nc.weightWritten = w; nc.weightOral = 100 - w; nc.weightHY1 = h1; nc.weightHY2 = 100 - h1; data.courses.push(nc); }
      save(); closeModal(); render();
    }},
  ]);
  const fw = document.getElementById('fW'), fm = document.getElementById('fM');
  fw.oninput = () => { fm.value = clamp(100 - (parseInt(fw.value) || 0), 0, 100); };
  const fh1 = document.getElementById('fH1'), fh2 = document.getElementById('fH2');
  fh1.oninput = () => { fh2.value = clamp(100 - (parseInt(fh1.value) || 0), 0, 100); };
}
function confirmDeleteCourse(c) {
  modal('Kurs löschen?', `<p>Der Kurs <b>${esc(c.subject)} ${esc(c.className)}</b> und alle zugehörigen Noten werden gelöscht.</p>`, [
    { label: 'Abbrechen', onClick: () => openCourseForm(c) },
    { label: 'Endgültig löschen', cls: 'danger', onClick: () => {
      c.students.forEach(s => { delete data.grades[s.id]; delete data.sonstigeValues[s.id]; delete data.manual[s.id]; delete data.weightOverride[s.id]; delete data.kaPoints[s.id]; });
      data.courses = data.courses.filter(x => x.id !== c.id);
      save(); closeModal(); go({ name: 'home' });
    }},
  ]);
}

/* ---------- Notenspalte anlegen / bearbeiten ---------- */
function openColumnForm(c, type, colId) {
  const hy = c.halfYears[route.hy];
  const editing = !!colId;
  const col = editing ? hy.columns.find(x => x.id === colId) : { type, label: '', date: '' };
  const t = col.type;
  modal(editing ? 'Note bearbeiten' : (t === 'schriftlich' ? 'Neue schriftliche Note' : 'Neue mündliche Note'), `
    <div class="field"><label>Bezeichnung</label>
      <input id="cLabel" type="text" value="${esc(col.label)}" placeholder="${t==='schriftlich'?'z. B. 1. Klausur':'z. B. Mitarbeit'}"></div>
    <div class="field"><label>Datum (optional)</label><input id="cDate" type="date" value="${col.date||''}"></div>
    <div class="field"><label>Art</label>
      <div class="seg" style="width:100%">
        <button type="button" data-t="schriftlich" style="flex:1" class="${t==='schriftlich'?'active':''}">Schriftlich</button>
        <button type="button" data-t="muendlich" style="flex:1" class="${t==='muendlich'?'active':''}">Mündlich</button>
      </div>
    </div>
  `, [
    ...(editing ? [{ label: 'Löschen', cls: 'danger', onClick: () => {
      hy.columns = hy.columns.filter(x => x.id !== col.id);
      Object.values(data.grades).forEach(g => delete g[col.id]);
      save(); closeModal(); renderCourse();
    }}] : []),
    { label: 'Abbrechen', onClick: closeModal },
    { label: 'Speichern', cls: 'primary', onClick: () => {
      const label = val('cLabel').trim();
      if (!label) return toast('Bitte eine Bezeichnung angeben.');
      col.label = label; col.date = val('cDate');
      if (!editing) { col.id = uid(); hy.columns.push(col); }
      save(); closeModal(); renderCourse();
    }},
  ]);
  let chosen = col.type;
  document.querySelectorAll('.modal-body .seg button').forEach(b => b.onclick = () => {
    chosen = b.dataset.t; col.type = chosen;
    document.querySelectorAll('.modal-body .seg button').forEach(x => x.classList.toggle('active', x.dataset.t === chosen));
  });
}

/* ---------- Sonstige Leistungen ---------- */
function openSonstige(c) {
  const hy = c.halfYears[route.hy];
  const list = hy.sonstige.map(so => `
    <div class="chip">
      <div class="chip-main"><b>${esc(so.label)}</b><span>Bonus ${so.percent}% · zählt nur, wenn sie den Schnitt hebt</span></div>
      <div style="display:flex;gap:8px;align-items:center">
        <span class="chip-scope scope-${so.scope}">${scopeLabel(so.scope)}</span>
        <button class="btn small" data-edit="${so.id}">Ändern</button>
        <button class="btn small danger" data-del="${so.id}">Löschen</button>
      </div>
    </div>`).join('') || `<div class="notice">Noch keine Sonstigen Leistungen. Diese wirken als Bonus und ersetzen anteilig eine schlechtere Note – nie eine bessere.</div>`;

  modal('Sonstige Leistungen', `
    <div class="chip-list">${list}</div>
    <div style="margin-top:14px"><button class="btn small" id="soAdd">+ Sonstige Leistung</button></div>
    ${hy.sonstige.length ? `<div class="notice" style="margin-top:14px">Werte kannst du direkt in den gelben Tabellenspalten oder hier gesammelt eintragen.</div>
      <button class="btn" id="soValues" style="width:100%">Werte pro Schüler:in eintragen ›</button>` : ''}
  `, [{ label: 'Schließen', cls: 'primary', onClick: () => { closeModal(); renderCourse(); } }]);

  document.getElementById('soAdd').onclick = () => openSonstigeForm(c);
  const sv = document.getElementById('soValues'); if (sv) sv.onclick = () => openSonstigeValues(c);
  document.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => openSonstigeForm(c, b.dataset.edit));
  document.querySelectorAll('[data-del]').forEach(b => b.onclick = () => {
    hy.sonstige = hy.sonstige.filter(x => x.id !== b.dataset.del);
    save(); openSonstige(c);
  });
}
function openSonstigeForm(c, id) {
  const hy = c.halfYears[route.hy];
  const editing = !!id;
  const so = editing ? hy.sonstige.find(x => x.id === id) : { label: '', scope: 'allgemein', percent: 10 };
  modal(editing ? 'Sonstige Leistung bearbeiten' : 'Neue Sonstige Leistung', `
    <div class="field"><label>Bezeichnung</label><input id="soLabel" type="text" value="${esc(so.label)}" placeholder="z. B. Heftführung, Projekt"></div>
    <div class="row2">
      <div class="field"><label>Gewichtung (Bonus)</label><input id="soPct" type="number" min="1" max="100" value="${so.percent}"><div class="hint">Anteil in %</div></div>
      <div class="field"><label>Bereich</label>
        <select id="soScope">
          <option value="allgemein" ${so.scope==='allgemein'?'selected':''}>Allgemein (Gesamtnote)</option>
          <option value="schriftlich" ${so.scope==='schriftlich'?'selected':''}>Nur schriftlich</option>
          <option value="muendlich" ${so.scope==='muendlich'?'selected':''}>Nur mündlich</option>
        </select>
      </div>
    </div>
    <div class="notice">Bonus-Logik: Der Wert mischt sich anteilig ein – aber nur, wenn er den betroffenen Schnitt <b>verbessert</b>. Eine bereits bessere Note wird nie verschlechtert.</div>
  `, [
    { label: 'Abbrechen', onClick: () => openSonstige(c) },
    { label: 'Speichern', cls: 'primary', onClick: () => {
      const label = val('soLabel').trim();
      if (!label) return toast('Bitte eine Bezeichnung angeben.');
      so.label = label; so.percent = clamp(parseInt(val('soPct')) || 0, 1, 100); so.scope = val('soScope');
      if (!editing) { so.id = uid(); hy.sonstige.push(so); }
      save(); openSonstige(c);
    }},
  ]);
}
function openSonstigeValues(c) {
  const hy = c.halfYears[route.hy];
  const rows = c.students.map(s => {
    const cells = hy.sonstige.map(so => {
      const v = (data.sonstigeValues[s.id] || {})[so.id];
      return `<td style="padding:6px"><input type="number" min="0" max="15" value="${v==null?'':v}" data-s="${s.id}" data-so="${so.id}" style="width:64px;min-height:38px;text-align:center"></td>`;
    }).join('');
    return `<tr><td style="padding:6px 10px;font-weight:600;white-space:nowrap">${esc(s.firstName)} ${esc(s.lastName||'')}</td>${cells}</tr>`;
  }).join('');
  const head = hy.sonstige.map(so => `<th style="padding:6px;font-size:12px">${esc(so.label)}<br><small style="color:var(--ink-faint)">${scopeLabel(so.scope)}</small></th>`).join('');
  modal('Sonstige Leistungen — Werte (Punkte 0–15)', `
    <div class="table-wrap" style="box-shadow:none">
      <table class="grades"><thead><tr><th class="col-name" style="min-width:120px">Schüler:in</th>${head}</tr></thead>
      <tbody>${rows}</tbody></table>
    </div>
  `, [{ label: 'Speichern', cls: 'primary', onClick: () => {
    document.querySelectorAll('.modal-body input[data-so]').forEach(inp => {
      const sId = inp.dataset.s, soId = inp.dataset.so;
      if (!data.sonstigeValues[sId]) data.sonstigeValues[sId] = {};
      if (inp.value === '') delete data.sonstigeValues[sId][soId];
      else data.sonstigeValues[sId][soId] = clamp(parseInt(inp.value) || 0, 0, 15);
    });
    save(); closeModal(); renderTable(c);
  }}]);
}
const scopeLabel = s => ({ allgemein: 'Allgemein', schriftlich: 'Schriftlich', muendlich: 'Mündlich' }[s] || s);

/* ---------- Schüler:innen verwalten ---------- */
function openStudents(c) {
  const list = c.students.map(s => `
    <div class="chip">
      <div class="chip-main"><b>${esc(s.firstName)} ${esc(s.lastName||'')}</b>
        <span>${s.entry?'Eintritt '+fmtDateLong(s.entry):''}${s.exit?' · Austritt '+fmtDateLong(s.exit):''}${!s.entry&&!s.exit?'aktiv':''}</span></div>
      <div style="display:flex;gap:6px">
        <button class="btn small" data-edit="${s.id}">Ändern</button>
        <button class="btn small danger" data-del="${s.id}">Löschen</button>
      </div>
    </div>`).join('') || `<div class="notice">Noch keine Schüler:innen.</div>`;
  modal(`Schüler:innen — ${esc(c.subject)} ${esc(c.className)}`, `
    <div class="chip-list">${list}</div>
    <div style="display:flex;gap:8px;margin-top:14px;flex-wrap:wrap">
      <button class="btn small" id="stAdd">+ Einzeln</button>
      <button class="btn small" id="stImport">Import (Liste / WebUntis)</button>
    </div>
  `, [{ label: 'Fertig', cls: 'primary', onClick: () => { closeModal(); render(); } }]);
  document.getElementById('stAdd').onclick = () => openStudentForm(c);
  document.getElementById('stImport').onclick = () => openImport(c);
  document.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => openStudentForm(c, b.dataset.edit));
  document.querySelectorAll('[data-del]').forEach(b => b.onclick = () => {
    c.students = c.students.filter(x => x.id !== b.dataset.del);
    delete data.grades[b.dataset.del]; delete data.sonstigeValues[b.dataset.del];
    delete data.manual[b.dataset.del]; delete data.weightOverride[b.dataset.del];
    delete data.kaPoints[b.dataset.del];
    save(); openStudents(c);
  });
}
function openStudentForm(c, id) {
  const editing = !!id;
  const s = editing ? c.students.find(x => x.id === id) : { firstName: '', lastName: '', entry: '', exit: '' };
  modal(editing ? 'Schüler:in bearbeiten' : 'Schüler:in hinzufügen', `
    <div class="row2">
      <div class="field"><label>Vorname *</label><input id="stF" type="text" value="${esc(s.firstName)}"></div>
      <div class="field"><label>Nachname / Initiale</label><input id="stL" type="text" value="${esc(s.lastName||'')}" placeholder="optional"></div>
    </div>
    <div class="row2">
      <div class="field"><label>Eintritt</label><input id="stE" type="date" value="${s.entry||''}"></div>
      <div class="field"><label>Austritt</label><input id="stX" type="date" value="${s.exit||''}"></div>
    </div>
    <div class="hint">Nur der Vorname ist Pflicht.</div>
  `, [
    { label: 'Abbrechen', onClick: () => openStudents(c) },
    { label: 'Speichern', cls: 'primary', onClick: () => {
      const f = val('stF').trim();
      if (!f) return toast('Vorname ist erforderlich.');
      s.firstName = f; s.lastName = val('stL').trim(); s.entry = val('stE'); s.exit = val('stX');
      if (!editing) { s.id = uid(); c.students.push(s); }
      save(); openStudents(c);
    }},
  ]);
}
/* fügt Schüler:innen hinzu, überspringt Duplikate (Vorname+Nachname) */
function addStudents(c, entries) {
  const has = (fn, ln) => c.students.some(s =>
    s.firstName.toLowerCase() === fn.toLowerCase() && (s.lastName||'').toLowerCase() === (ln||'').toLowerCase());
  let added = 0, skipped = 0;
  entries.forEach(e => {
    if (!e.firstName) return;
    if (has(e.firstName, e.lastName)) { skipped++; return; }
    c.students.push({ id: uid(), firstName: e.firstName, lastName: e.lastName || '', entry: e.entry || '', exit: e.exit || '' });
    added++;
  });
  save();
  toast(`${added} hinzugefügt${skipped ? `, ${skipped} Duplikat(e) übersprungen` : ''}.`);
  openStudents(c);
}
function parseGermanDate(s) {
  if (!s) return '';
  const m = s.trim().match(/^(\d{1,2})\.(\d{1,2})\.(\d{2,4})$/);
  if (!m) return /^\d{4}-\d{2}-\d{2}$/.test(s.trim()) ? s.trim() : '';
  const [, d, mo, y] = m; const yr = y.length === 2 ? '20' + y : y;
  return `${yr}-${mo.padStart(2,'0')}-${d.padStart(2,'0')}`;
}
function parseNameLines(text) {
  return text.split('\n').map(l => l.trim()).filter(Boolean).map(line => {
    if (line.includes(',')) { const [ln, fn] = line.split(','); return { lastName: ln.trim(), firstName: (fn||'').trim() }; }
    const parts = line.split(/\s+/); return { firstName: parts.shift(), lastName: parts.join(' ') };
  });
}
function parseWebUntisCsv(text) {
  const rows = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const out = [];
  rows.forEach((line, i) => {
    const cols = line.split(';').map(x => x.trim());
    if (i === 0 && /langname|vorname/i.test(line)) return; // Kopfzeile
    const lastName = cols[0] || '', firstName = cols[1] || '';
    if (!firstName && !lastName) return;
    out.push({ firstName, lastName, entry: parseGermanDate(cols[4]), exit: parseGermanDate(cols[5]) });
  });
  return out;
}
function readFileSmart(file, cb) {
  const reader = new FileReader();
  reader.onload = () => {
    const buf = new Uint8Array(reader.result);
    let text = new TextDecoder('utf-8').decode(buf);
    if (text.includes('�')) { try { text = new TextDecoder('windows-1252').decode(buf); } catch (e) {} }
    cb(text);
  };
  reader.readAsArrayBuffer(file);
}
function openImport(c) {
  modal('Schüler:innen importieren', `
    <div class="field">
      <label>WebUntis-CSV-Datei</label>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn small" id="impCsvBtn">CSV-Datei wählen</button>
        <input type="file" id="impCsvFile" accept=".csv,text/csv,text/plain" hidden>
      </div>
      <div class="hint">Spalten <code>Langname;Vorname;Klasse;…;Eintritt;Austritt</code>. Umlaute (UTF-8/Windows-1252) und Datumsformat werden automatisch erkannt, Duplikate übersprungen.</div>
    </div>
    <hr style="border:none;border-top:1px solid var(--line-soft);margin:14px 0">
    <div class="field">
      <label>Oder Namen einfügen (eine Zeile pro Person)</label>
      <textarea id="impText" placeholder="Lena B.&#10;Jonas K.&#10;Amelie R."></textarea>
      <div class="hint">Erstes Wort = Vorname, Rest = Nachname/Initiale. „Nachname, Vorname" wird auch erkannt.</div>
    </div>
  `, [
    { label: 'Abbrechen', onClick: () => openStudents(c) },
    { label: 'Liste importieren', cls: 'primary', onClick: () => addStudents(c, parseNameLines(val('impText'))) },
  ]);
  const fileInput = document.getElementById('impCsvFile');
  document.getElementById('impCsvBtn').onclick = () => fileInput.click();
  fileInput.onchange = () => {
    if (!fileInput.files[0]) return;
    readFileSmart(fileInput.files[0], text => addStudents(c, parseWebUntisCsv(text)));
  };
}

/* ---------- Termine / Meta ---------- */
function openMetaSettings() {
  const m = data.meta;
  modal('Termine & Einstellungen', `
    <div class="field"><label>Nächster Ferienbeginn</label>
      <div class="row2">
        <input id="mFerienDate" type="date" value="${m.ferienDatum||''}">
        <input id="mFerienLabel" type="text" value="${esc(m.ferienLabel||'')}" placeholder="z. B. Sommerferien">
      </div>
    </div>
    <div class="field"><label>Nächste Zeugniskonferenz</label><input id="mZeugnis" type="date" value="${m.zeugnisDatum||''}"></div>
    <hr style="border:none;border-top:1px solid var(--line-soft);margin:16px 0">
    <div class="field">
      <label>Datensicherung</label>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn small" id="mBackupExport">Backup exportieren</button>
        <button class="btn small" id="mBackupImport">Backup einlesen</button>
        <input type="file" id="mBackupFile" accept="application/json,.json" hidden>
      </div>
      <div class="hint">${m.lastBackup ? 'Letztes Backup: '+fmtDateLong(m.lastBackup) : 'Noch kein Backup erstellt.'} Daten liegen nur in diesem Browser — regelmäßig sichern.</div>
    </div>
    <hr style="border:none;border-top:1px solid var(--line-soft);margin:16px 0">
    <div class="field"><button class="btn danger small" id="mReset">Alle Daten zurücksetzen</button>
      <div class="hint">Löscht sämtliche Kurse, Schüler:innen und Noten aus diesem Browser.</div></div>
  `, [
    { label: 'Abbrechen', onClick: closeModal },
    { label: 'Speichern', cls: 'primary', onClick: () => {
      m.ferienDatum = val('mFerienDate'); m.ferienLabel = val('mFerienLabel').trim() || 'Ferien'; m.zeugnisDatum = val('mZeugnis');
      save(); closeModal(); render();
    }},
  ]);
  document.getElementById('mBackupExport').onclick = exportBackup;
  const fileInput = document.getElementById('mBackupFile');
  document.getElementById('mBackupImport').onclick = () => fileInput.click();
  fileInput.onchange = () => { if (fileInput.files[0]) importBackupFile(fileInput.files[0]); };
  document.getElementById('mReset').onclick = () => {
    if (!confirm('Wirklich ALLE Daten löschen?')) return;
    localStorage.removeItem(STORE_KEY); data = DEFAULT_DATA(); save(); closeModal(); go({ name: 'home' });
  };
}

/* ---------- Utilities ---------- */
function getCourse(id) { return data.courses.find(c => c.id === id); }
function val(id) { const el = document.getElementById(id); return el ? el.value : ''; }
function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }
function fmtNum(n) { if (n == null || isNaN(n)) return '–'; return (Math.round(n * 10) / 10).toString().replace('.', ','); }
function esc(s) { return String(s ?? '').replace(/[&<>"]/g, ch => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[ch])); }
let toastTimer;
function toast(msg) {
  document.querySelectorAll('.toast').forEach(t => t.remove());
  const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg;
  document.body.appendChild(t);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.remove(), 2400);
}
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

/* ---------- Start ---------- */
render();
