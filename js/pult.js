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
    tableLayout: 'standard',  // 'standard' | 'invers' (Notentabelle)
    halfYear: 'auto',    // 'auto' | '1' | '2' — Halbjahr beim Öffnen eines Kurses
  },
  courses: [],
  grades: {},          // grades[studentId][columnId] = punkte(0..15)
  sonstigeValues: {},  // sonstigeValues[studentId][sonstigeId] = punkte(0..15)
  weightOverride: {},  // weightOverride[studentId][hyKey] = wSchriftlich(0..100)
  manual: {},          // manual[studentId] = { g1, g2, end } manuelle Note (punkte)
  kaPoints: {},        // kaPoints[studentId][columnId][taskId] = erreichte Rohpunkte
  notes: [],           // { id, courseId, studentId|null, date, text }
  lists: [],           // { id, courseId, title, dueDate, status:{studentId:'offen'|'abgegeben'|'befreit'} }
  timetable: {         // Stundenplan (Mo–Fr)
    periods: DEFAULT_PERIODS(),   // [{ label, start, end }]
    lessons: [],       // { id, day:1..5, period:0-basiert, courseId, room, week:0|1|2 }
    abWeeks: false,    // Zwei-Wochen-Rhythmus (Woche A / Woche B)
    anchorMonday: '',  // ISO-Montag einer Woche A — Bezugspunkt für den Wechsel
  },
  todos: [],           // { id, text, done, created, due, courseId|null }
  termine: [],         // { id, title, date, start, end, allDay, location, note, courseId|null, uid }
  history: [],         // Notenprotokoll, siehe unten — { id, at, label, courseId, changes[], undone }
  rubrics: [],         // Bewertungsraster-Vorlagen, siehe raster.js
});

/* Standard-Stundenraster (editierbar unter „Zeiten") */
const DEFAULT_PERIODS = () => ([
  { label: '1.', start: '08:00', end: '08:45' },
  { label: '2.', start: '08:45', end: '09:30' },
  { label: '3.', start: '09:50', end: '10:35' },
  { label: '4.', start: '10:35', end: '11:20' },
  { label: '5.', start: '11:40', end: '12:25' },
  { label: '6.', start: '12:25', end: '13:10' },
  { label: '7.', start: '13:50', end: '14:35' },
  { label: '8.', start: '14:35', end: '15:20' },
]);

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

let data;   // wird am Dateiende initialisiert (nach allen const/function-Definitionen)

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
  if (typeof archiveMode !== 'undefined' && archiveMode) return;   // Archiv ansehen: nichts speichern
  try { localStorage.setItem(STORE_KEY, JSON.stringify(data)); }
  catch (e) { toast('Speichern fehlgeschlagen (Speicher voll?)'); }
}
const uid = () => Math.random().toString(36).slice(2, 9);

/* ---------- Datenstand (Schema) ----------
   data.meta.schema zählt, welche Umbauten der Daten schon gelaufen sind.
   Jede Migration läuft genau einmal — beim Start und nach dem Einlesen
   eines (älteren) Backups. Neue Umbauten hinten anhängen, SCHEMA erhöhen. */
const SCHEMA = 2;
const MIGRATIONS = [
  { to: 1, run: () => migrateHaLog() },    // Hausaufgaben: 3-Zustands-Modell
  { to: 2, run: () => migrateRaster() },   // Bewertungsraster + Beispiel-Vorlagen
];
function runMigrations() {
  const from = Number(data.meta.schema) || 0;
  if (from >= SCHEMA) return;              // aktuell — oder aus einer neueren Version: nichts anfassen
  MIGRATIONS.filter(m => m.to > from).forEach(m => m.run());
  data.meta.schema = SCHEMA;
  save();
}

/* ============================================================
   Notenprotokoll (Rückgängig)
   ------------------------------------------------------------
   Festgehalten wird nur, was Noten betrifft: eingetragene, geänderte und
   entfernte Werte, manuelle Überschreibungen sowie Löschungen, die Noten
   mitnehmen (Schüler:in, Notenspalte, Klassenarbeit, Kurs).

   Ein Eintrag speichert keine Kopie des ganzen Datenbestands, sondern nur die
   betroffenen Stellen mit Wert davor/danach. Dadurch bleibt das Protokoll
   klein, jeder Eintrag lässt sich einzeln zurücknehmen, und es übersteht einen
   Neustart (es liegt in den Daten und damit auch im Backup).
   ============================================================ */
const HISTORY_MAX = 60;
/* Einträge derselben Stelle innerhalb dieser Zeit werden zusammengefasst,
   damit Tippen in einem Feld nicht das halbe Protokoll füllt. */
const HISTORY_MERGE_MS = 60 * 1000;

const histClone = v => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
const histSame = (a, b) => JSON.stringify(a === undefined ? null : a) === JSON.stringify(b === undefined ? null : b);

/* Ein Pfad beschreibt eine Stelle in `data`, z. B. ['grades', sId, colId].
   Steht dort ein Array, gilt das nächste Stück als id des Elements —
   ['courses', cId, 'students'] meint also die Schülerliste dieses Kurses. */
function pathStep(node, key) {
  if (node == null) return undefined;
  if (Array.isArray(node)) return node.find(x => x && x.id === key);
  return node[key];
}
function pathGet(path) {
  let node = data;
  for (const key of path) { node = pathStep(node, key); if (node == null) return node === null ? null : undefined; }
  return histClone(node);
}
/* Wert an einen Pfad schreiben (undefined = Schlüssel entfernen).
   false, wenn das Ziel nicht mehr existiert — etwa ein gelöschter Kurs. */
function pathSet(path, value) {
  let node = data;
  for (let i = 0; i < path.length - 1; i++) {
    let next = pathStep(node, path[i]);
    if (next == null) {
      if (Array.isArray(node)) return false;
      next = {}; node[path[i]] = next;
    }
    node = next;
  }
  const last = path[path.length - 1];
  if (Array.isArray(node) || node == null) return false;
  if (value === undefined) delete node[last]; else node[last] = histClone(value);
  return true;
}

/* Zustand der Pfade festhalten — vor der Änderung aufrufen */
function beginChange(paths) { return paths.map(p => ({ path: p, before: pathGet(p) })); }
/* … und nach der Änderung mit einer Beschriftung abschließen.
   opts: { courseId, mergeKey } */
function commitChange(label, snap, opts) {
  opts = opts || {};
  const changes = snap
    .map(ch => ({ path: ch.path, before: ch.before, after: pathGet(ch.path) }))
    .filter(ch => !histSame(ch.before, ch.after));
  if (!changes.length) return null;                  // nichts passiert, nichts protokollieren
  if (!Array.isArray(data.history)) data.history = [];
  const now = new Date();
  const last = data.history[data.history.length - 1];
  if (opts.mergeKey && last && last.mergeKey === opts.mergeKey && !last.undone &&
      now - new Date(last.at) < HISTORY_MERGE_MS) {
    /* gleiche Stelle, kurz danach: alten „davor"-Wert behalten, Rest ersetzen */
    changes.forEach(ch => {
      const prev = last.changes.find(x => histSame(x.path, ch.path));
      if (prev) prev.after = ch.after; else last.changes.push(ch);
    });
    last.changes = last.changes.filter(ch => !histSame(ch.before, ch.after));
    if (!last.changes.length) { data.history.pop(); return null; }   // wieder auf Anfang: Eintrag entfällt
    last.label = label; last.at = now.toISOString();
    return last;
  }
  const entry = {
    id: uid(), at: now.toISOString(), label,
    courseId: opts.courseId || null, mergeKey: opts.mergeKey || null, changes,
  };
  data.history.push(entry);
  while (data.history.length > HISTORY_MAX) data.history.shift();
  return entry;
}

/* Bequemer Weg für den Normalfall: eine einzelne Note setzen.
   store: 'grades' (Notenspalte) | 'sonstigeValues' (Bonus) */
function gradeStr(v, c) { return v == null ? 'leer' : fmtGrade(v, c ? c.scale : 'punkte', false); }
function setGradeLogged(c, store, sId, key, v, what) {
  const snap = beginChange([[store, sId, key]]);
  if (!data[store][sId]) data[store][sId] = {};
  if (v == null) delete data[store][sId][key]; else data[store][sId][key] = v;
  const s = c && c.students.find(x => x.id === sId);
  const e = commitChange(`${s ? studentName(s) : 'Schüler:in'} — ${what}: ${gradeStr(snap[0].before, c)} → ${gradeStr(v, c)}`,
    snap, { courseId: c && c.id, mergeKey: `${store}:${sId}:${key}` });
  save();
  if (e) toast(`${s ? s.firstName : ''} · ${what}: ${gradeStr(v, c)}`, { label: 'Rückgängig', fn: () => undoEntry(e.id) });
}
/* Sonstige Leistung über beide Halbjahre suchen (ids sind eindeutig) */
function findSonstige(c, soId) {
  return c.halfYears['1'].sonstige.find(x => x.id === soId)
      || c.halfYears['2'].sonstige.find(x => x.id === soId) || null;
}
/* Wie viele Noten hängen an einer Spalte / an Schüler:innen? (für Lösch-Beschriftungen) */
function gradeCountForColumn(c, colId) {
  return c.students.filter(s => (data.grades[s.id] || {})[colId] != null).length;
}
function gradeCountForStudent(sId) {
  return Object.keys(data.grades[sId] || {}).filter(k => data.grades[sId][k] != null).length;
}

/* Einen Eintrag zurücknehmen (oder eine Rücknahme wieder herstellen) */
function applyHistoryEntry(entryId, direction) {
  const e = (data.history || []).find(x => x.id === entryId);
  if (!e) return;
  const target = direction === 'redo' ? 'after' : 'before';
  const expect = direction === 'redo' ? 'before' : 'after';
  /* Wurde die Stelle seither erneut geändert, ist das Zurücknehmen nicht mehr eindeutig. */
  const drifted = e.changes.some(ch => !histSame(pathGet(ch.path), ch[expect]));
  const run = () => {
    let ok = true;
    e.changes.forEach(ch => { if (!pathSet(ch.path, ch[target])) ok = false; });
    e.undone = direction === 'redo' ? null : new Date().toISOString();
    save();
    toast(ok ? (direction === 'redo' ? 'Wiederhergestellt.' : 'Rückgängig gemacht.')
             : 'Nur teilweise möglich — ein Ziel existiert nicht mehr.');
    render();
    openHistory(historyScope);
  };
  if (!drifted) return run();
  modal('Sicher?', `<p>Diese Stelle wurde seit dem Eintrag noch einmal geändert. Beim Zurücknehmen geht die neuere Änderung verloren.</p>
    <p><b>${esc(e.label)}</b></p>`, [
    { label: 'Abbrechen', onClick: () => openHistory(historyScope) },
    { label: 'Trotzdem zurücknehmen', cls: 'danger', onClick: run },
  ]);
}

/* Schnelles Rückgängig aus dem Hinweis heraus (ohne Protokoll-Fenster) */
function undoEntry(entryId) {
  const e = (data.history || []).find(x => x.id === entryId);
  if (!e || e.undone) return;
  if (e.changes.some(ch => !histSame(pathGet(ch.path), ch.after))) return toast('Inzwischen erneut geändert — über das Notenprotokoll zurücknehmen.');
  e.changes.forEach(ch => pathSet(ch.path, ch.before));
  e.undone = new Date().toISOString();
  save(); render();
  toast('Rückgängig gemacht.');
}

/* Zeitstempel menschlich: „Heute, 14:32" */
function fmtHistTime(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return '';
  const time = d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
  const days = Math.round((new Date().setHours(0,0,0,0) - new Date(d).setHours(0,0,0,0)) / 86400000);
  const day = days === 0 ? 'Heute' : days === 1 ? 'Gestern'
    : d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
  return `${day}, ${time} Uhr`;
}

let historyScope = null;   // null = alle Kurse, sonst courseId
function openHistory(courseId) {
  historyScope = courseId || null;
  const all = (data.history || []).slice().reverse();
  const list = historyScope ? all.filter(e => e.courseId === historyScope) : all;
  const scopeCourse = historyScope ? getCourse(historyScope) : null;

  const rows = list.map(e => {
    const c = e.courseId ? getCourse(e.courseId) : null;
    const where = scopeCourse ? '' : (c ? ` · ${esc(c.subject)} ${esc(c.className)}` : '');
    return `<div class="chip" style="${e.undone ? 'opacity:.55' : ''}">
      <div class="chip-main">
        <b>${esc(e.label)}</b>
        <span>${fmtHistTime(e.at)}${where}${e.undone ? ' · zurückgenommen' : ''}</span>
      </div>
      <button class="btn small ${e.undone ? '' : 'danger'}" data-${e.undone ? 'redo' : 'undo'}="${e.id}">${e.undone ? 'Wiederherstellen' : 'Rückgängig'}</button>
    </div>`;
  }).join('') || `<div class="notice">Noch nichts protokolliert.</div>`;

  modal(scopeCourse ? `Notenprotokoll — ${esc(scopeCourse.subject)} ${esc(scopeCourse.className)}` : 'Notenprotokoll', `
    <div class="notice">Die letzten ${HISTORY_MAX} Änderungen an Noten${scopeCourse ? ' in diesem Kurs' : ''} — jeweils einzeln zurücknehmbar.</div>
    <div class="chip-list">${rows}</div>
  `, [
    ...(scopeCourse ? [{ label: 'Alle Kurse', onClick: () => openHistory(null) }] : []),
    { label: 'Schließen', cls: 'primary', onClick: () => { closeModal(); render(); } },
  ]);
  document.querySelectorAll('[data-undo]').forEach(b => b.onclick = () => applyHistoryEntry(b.dataset.undo, 'undo'));
  document.querySelectorAll('[data-redo]').forEach(b => b.onclick = () => applyHistoryEntry(b.dataset.redo, 'redo'));
}

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

  const cMathe = buildCourse(d, {
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

  const cGesch = buildCourse(d, {
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

  // Beispiel-Stundenplan (Mo–Fr, 0-basierte Stunden)
  const L = (day, period, courseId, room) => ({ id: uid(), day, period, courseId, room });
  d.timetable.lessons = [
    L(1, 0, cMathe.id, 'A103'), L(1, 1, cMathe.id, 'A103'), L(1, 3, cGesch.id, 'B201'),
    L(2, 2, cGesch.id, 'B201'), L(2, 4, cMathe.id, 'A103'),
    L(3, 0, cGesch.id, 'B201'), L(3, 1, cGesch.id, 'B201'),
    L(4, 2, cMathe.id, 'A103'), L(4, 3, cMathe.id, 'A103'),
    L(5, 1, cGesch.id, 'B201'),
  ];

  // Beispiel-Todo und -Termin
  d.todos = [
    { id: uid(), text: 'Klausuren 9b korrigieren', done: false, created: todayISO(), due: '', courseId: cMathe.id },
    { id: uid(), text: 'Kopien für Referate machen', done: false, created: todayISO(), due: '', courseId: null },
  ];
  d.termine = [
    { id: uid(), title: 'Elternsprechtag', date: d.meta.zeugnisDatum || '2026-07-13', start: '16:00', end: '19:00', allDay: false, location: 'Aula', note: '', courseId: null, uid: uid() + '@pult' },
  ];

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
    haLog: [],                        // Hausaufgaben-Protokoll: [{id,date,marks:{sId:'malus'|'bonus'}}]
    seating: null,                    // Sitzplan: { cols, rows, seats: { "x,y": studentId } }
    students: [],                     // { id, firstName, lastName, entry, exit, info }
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
/* Einzel-Notenpunkt immer zweistellig: 00–15 (klare Abgrenzung zum 1–6-System) */
function pad2(p) { return String(clamp(Math.round(p), 0, 15)).padStart(2, '0'); }
/* Skalenabhängige Anzeige eines Punktwerts.
   scale: 'punkte' | 'noten'; avg=true → Kommawert (ohne führende Null), sonst diskrete Note/Punkt. */
function fmtGrade(pts, scale, avg) {
  if (pts == null || isNaN(pts)) return '–';
  if (scale === 'noten') return avg ? fmtNum(pointsToNoteDecimal(pts)) : (NOTE_MAP[clamp(Math.round(pts), 0, 15)] ?? '–');
  return avg ? fmtNum(pts) : pad2(pts);
}
/* <option>-Liste für manuelle Note-Auswahl (Wert = Punkte 0–15) */
function manualOptions(scale, current) {
  let out = `<option value="">— berechnet verwenden —</option>`;
  for (let p = 15; p >= 0; p--) {
    const lbl = scale === 'noten' ? `${NOTE_MAP[p]}  (${pad2(p)} P.)` : `${pad2(p)} Pkt  ·  ${NOTE_MAP[p]}`;
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
/* Notenfarbe als reine Schriftfarbe (auf hellem Grund lesbar) — für Einzelnoten */
function gradeInk(pts) {
  if (pts == null || isNaN(pts)) return 'var(--line)';
  const p = Math.round(pts);
  if (p >= 13) return 'var(--g-top)';
  if (p >= 10) return 'var(--g-good-fg)';
  if (p >= 7)  return 'var(--g-mid-fg)';
  if (p >= 4)  return 'var(--g-low-fg)';
  if (p >= 1)  return 'var(--g-bad-fg)';
  return 'var(--g-fail)';
}

/* ---------- Notenberechnung ---------- */
function studentActive(s) { return !s.exit; }
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

/* ---------- Gewichtung einzelner Noten ----------
   Standard: jede Note zählt einfach (Faktor 1). Eine Spalte kann stattdessen
   n-fach zählen (col.factor) oder einen festen Anteil an der Gesamtnote
   bekommen (col.pct). Feste Anteile werden ihrem Bereich vorweg abgezogen:
   bei 60 % mündlich und einer mündlichen 10-%-Note teilen sich die übrigen
   mündlichen Noten nur noch 50 %. Unbenotete Spalten zählen nicht mit — ihr
   Anteil verteilt sich auf die übrigen Noten desselben Bereichs. */
const colFactor = col => { const f = Number(col && col.factor); return isFinite(f) && f > 0 ? f : 1; };
const colPct    = col => { const p = Number(col && col.pct);    return isFinite(p) && p > 0 ? Math.min(p, 100) : null; };
const colWeighted = col => colPct(col) != null || colFactor(col) !== 1;
/* Kurzform der Gewichtung: „10 %" (fest), „×2" (n-fach), '' (Standard) */
function weightLabel(col) {
  const p = colPct(col);
  if (p != null) return `${fmtNum(p)} %`;
  const f = colFactor(col);
  return f === 1 ? '' : `×${fmtNum(f)}`;
}
function weightTitle(col) {
  const p = colPct(col);
  if (p != null) return `zählt fest mit ${fmtNum(p)} % der Gesamtnote`;
  const f = colFactor(col);
  return f === 1 ? '' : `zählt ${fmtNum(f)}-fach`;
}
/* Gewichtungs-Plakette für Spaltenköpfe und Listen */
function weightPill(col, style) {
  const lbl = weightLabel(col);
  return lbl ? ` <span class="pill" style="font-size:9px;padding:1px 5px;vertical-align:middle;${style||''}" title="${esc(weightTitle(col))}">${lbl}</span>` : '';
}

/* benotete Leistungen eines Bereichs als [{ col, v }] */
function blockEntries(cols, sId) {
  const gr = data.grades[sId] || {};
  return cols.filter(col => !col.noCount)   // reine Rückmeldung (Raster „zählt nicht")
    .map(col => ({ col, v: gr[col.id] })).filter(e => e.v != null && !isNaN(e.v));
}
/* Gewichteter Schnitt eines Bereichs.
   blockPct = Anteil des Bereichs an der Gesamtnote (z. B. 60 % mündlich).
   Liefert zusätzlich je Note ihren Anteil — `share` am Bereich (0..1) und
   `pct` an der Gesamtnote — für die Übersicht im Rechenweg. */
function weighEntries(entries, blockPct) {
  if (!entries.length) return { avg: null, parts: [] };
  const B = blockPct > 0 ? blockPct : 100;
  const fixed = entries.filter(e => colPct(e.col) != null);
  const rest  = entries.filter(e => colPct(e.col) == null);
  const fixedSum = fixed.reduce((a, e) => a + colPct(e.col), 0);
  const shares = new Map();
  if (!rest.length) {
    /* nur feste Anteile: sie teilen den Bereich unter sich auf */
    fixed.forEach(e => shares.set(e, colPct(e.col) / fixedSum));
  } else {
    /* mehr als 100 % fest vergeben → proportional kürzen */
    const cut = fixedSum > B ? B / fixedSum : 1;
    fixed.forEach(e => shares.set(e, colPct(e.col) * cut / B));
    const left = (B - fixedSum * cut) / B;
    const fTot = rest.reduce((a, e) => a + colFactor(e.col), 0);
    rest.forEach(e => shares.set(e, left * colFactor(e.col) / fTot));
  }
  let avg = 0;
  const parts = entries.map(e => {
    const share = shares.get(e) || 0;
    avg += share * e.v;
    return { col: e.col, v: e.v, share, pct: share * B, fixed: colPct(e.col) != null };
  });
  return { avg, parts };
}

/* Reine Rechnung eines Halbjahres (ohne manuelle Überschreibung) */
function computeHalf(course, hyKey, sId) {
  const hy = course.halfYears[hyKey];
  const schriftCols = hy.columns.filter(c => c.type === 'schriftlich');
  const muendCols   = hy.columns.filter(c => c.type === 'muendlich');
  const sEnt = blockEntries(schriftCols, sId);
  const mEnt = blockEntries(muendCols, sId);

  const wt = getWeight(course, sId, hyKey);
  /* Fehlt ein Bereich ganz, trägt der andere die volle Note — dann sind auch
     die ausgewiesenen Prozente die an der Gesamtnote. */
  const both = sEnt.length && mEnt.length;
  const wPct = both ? wt.w : 100;
  const mPct = both ? wt.m : 100;
  const wPart = weighEntries(sEnt, wPct);
  const mPart = weighEntries(mEnt, mPct);

  const wRaw = wPart.avg;
  const mRaw = mPart.avg;
  const wAvg = applyBonus(wRaw, hy.sonstige.filter(s => s.scope === 'schriftlich'), sId);
  const mAvg = applyBonus(mRaw, hy.sonstige.filter(s => s.scope === 'muendlich'),  sId);

  let gesamt;
  if (wAvg == null && mAvg == null) gesamt = null;
  else if (wAvg == null) gesamt = mAvg;
  else if (mAvg == null) gesamt = wAvg;
  else gesamt = wAvg * (wt.w / 100) + mAvg * (wt.m / 100);
  gesamt = applyBonus(gesamt, hy.sonstige.filter(s => s.scope === 'allgemein'), sId);

  return { wRaw, mRaw, wAvg, mAvg, gesamt, wt, wPct, mPct, wParts: wPart.parts, mParts: mPart.parts };
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
/* Ist in diesem Halbjahr überhaupt schon etwas eingetragen? */
function hasEntries(course, hyKey) {
  const hy = course.halfYears[hyKey];
  if (!hy) return false;
  const manKey = hyKey === '1' ? 'g1' : 'g2';
  return course.students.some(s => {
    const gr = data.grades[s.id] || {};
    if (hy.columns.some(col => col.type !== 'zwischenstand' && gr[col.id] != null)) return true;
    const sv = data.sonstigeValues[s.id] || {};
    if (hy.sonstige.some(so => sv[so.id] != null)) return true;
    return (data.manual[s.id] || {})[manKey] != null;
  });
}
/* Halbjahr, in dem ein Kurs geöffnet wird.
   'auto': sobald im 2. Halbjahr Noten stehen, startet der Kurs dort. */
function defaultHalfYear(course) {
  const setting = (data.meta && data.meta.halfYear) || 'auto';
  if (setting === '1' || setting === '2') return setting;
  return course && hasEntries(course, '2') ? '2' : '1';
}

function courseMean(course) {
  const vals = course.students.filter(studentActive).map(s => currentGrade(course, s.id)).filter(v => v != null);
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
}

/* ---------- Verlauf / Trend / Simulation ---------- */
/* benotete Leistungen in Reihenfolge (optional halbjahrübergreifend) */
function gradeSeries(course, sId, hyKeys, type) {
  const out = [];
  (hyKeys || ['1', '2']).forEach(hyKey => {
    course.halfYears[hyKey].columns.forEach(col => {
      if (type && col.type !== type) return;
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
  if (n < 2) return `<div class="cs-sub">Zu wenige mündliche Noten für einen Verlauf.</div>`;
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
    <div class="legend" style="margin-top:6px"><span><i style="background:#7a63bd"></i> mündliche Note, chronologisch</span></div>`;
}
/* Simulation: Gesamtnote eines Halbjahres mit einer hypothetisch ergänzten Note */
function simulateGesamt(course, hyKey, sId, extra) {
  const hy = course.halfYears[hyKey];
  let schrift = blockEntries(hy.columns.filter(c => c.type === 'schriftlich'), sId);
  let muend = blockEntries(hy.columns.filter(c => c.type === 'muendlich'), sId);
  /* die hypothetische Note zählt einfach (Faktor 1) */
  if (extra) {
    const e = { col: { id: '__sim' }, v: extra.value };
    if (extra.type === 'schriftlich') schrift = schrift.concat(e); else muend = muend.concat(e);
  }
  const wt = getWeight(course, sId, hyKey);
  const both = schrift.length && muend.length;
  const wAvg = applyBonus(weighEntries(schrift, both ? wt.w : 100).avg, hy.sonstige.filter(s => s.scope === 'schriftlich'), sId);
  const mAvg = applyBonus(weighEntries(muend, both ? wt.m : 100).avg, hy.sonstige.filter(s => s.scope === 'muendlich'), sId);
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
    const lbl = scale === 'noten' ? `${NOTE_MAP[p]}  (${pad2(p)} P.)` : `${pad2(p)} Pkt  ·  ${NOTE_MAP[p]}`;
    out += `<option value="${p}" ${current === p ? 'selected' : ''}>${lbl}</option>`;
  }
  return out;
}
/* Blinde Flecken: keine (aktuelle) mündliche Note */
/* Tage ohne mündliche Note, ab denen jemand als „blinder Fleck" gilt (Einstellungen → Noten) */
const blindDays = () => Number(data.meta.blindDays) || 21;
function blindSpot(course, hyKey, sId) {
  const cols = course.halfYears[hyKey].columns.filter(c => c.type === 'muendlich');
  const graded = cols.filter(c => (data.grades[sId] || {})[c.id] != null);
  if (!graded.length) return true;
  const dated = graded.filter(c => c.date).map(c => c.date).sort();
  if (!dated.length) return false;               // benotet aber undatiert -> nicht flaggen
  return daysSince(dated[dated.length - 1]) > blindDays();
}
/* Hausaufgaben: Zählung aus dem Protokoll (course.haLog).
   Pro Erhebung hat jede:r einen von drei Zuständen: marks[sId] = 'malus'
   (nicht gemacht), 'bonus' (gemacht) oder nicht gesetzt (neutral). */
function haCounts(course, sId) {
  let gemacht = 0, nicht = 0;
  (course.haLog || []).forEach(sess => {
    const st = (sess.marks || {})[sId];
    if (st === 'bonus') gemacht++;
    else if (st === 'malus') nicht++;
  });
  return { gemacht, nicht };
}
/* Migration alter Erhebungen (mode + marks:{sId:true}) auf das 3-Zustands-Modell */
function migrateHaLog() {
  let changed = false;
  (data.courses || []).forEach(c => (c.haLog || []).forEach(sess => {
    if (sess.mode) {
      const state = sess.mode === 'gemacht' ? 'bonus' : 'malus';
      const nm = {};
      Object.keys(sess.marks || {}).forEach(k => { if (sess.marks[k]) nm[k] = state; });
      sess.marks = nm; delete sess.mode; changed = true;
    }
  }));
  if (changed) save();
}

/* ---------- Kurzinfo pro Schüler:in ----------
   Eine kurze Notiz am Schülerdatensatz (z. B. Nachteilsausgleich). Sie erscheint
   als kleines „i" neben dem Namen: Hover zeigt den Text, Antippen öffnet ihn
   (auf dem iPad gibt es kein Hover). Getrennt von den datierten Notizen. */
function infoBadge(s) {
  if (!s || !s.info) return '';
  return `<span class="info-i" data-info="${s.id}" title="${esc(s.info)}" role="button" aria-label="Kurzinfo">i</span>`;
}
/* Klick auf die „i"-Marken innerhalb eines Containers verdrahten */
function bindInfoBadges(root, c) {
  (root || document).querySelectorAll('.info-i[data-info]').forEach(el => el.onclick = ev => {
    ev.stopPropagation();
    const s = c.students.find(x => x.id === el.dataset.info);
    if (s) openInfoView(c, s);
  });
}
function studentName(s) { return `${s.firstName} ${s.lastName || ''}`.trim(); }
function openInfoView(c, s) {
  modal(`Kurzinfo — ${studentName(s)}`, `<div class="info-text">${esc(s.info)}</div>`, [
    { label: 'Bearbeiten', onClick: () => openInfoEdit(c, s) },
    { label: 'Schließen', cls: 'primary', onClick: closeModal },
  ]);
}
function openInfoEdit(c, s, onDone) {
  modal(`Kurzinfo — ${studentName(s)}`, `
    <div class="field"><label>Kurzinfo</label>
      <textarea id="siInfo" placeholder="z. B. Nachteilsausgleich: 25 % Zeitzuschlag, größere Schrift">${esc(s.info || '')}</textarea>
      <div class="hint">Erscheint als „i" neben dem Namen — in der Notentabelle, bei Klassenarbeiten und im Sitzplan. Leer lassen entfernt die Info.</div>
    </div>
  `, [
    { label: 'Abbrechen', onClick: closeModal },
    { label: 'Speichern', cls: 'primary', onClick: () => {
      s.info = val('siInfo').trim();
      save(); closeModal(); (onDone || render)();
    }},
  ]);
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
let route = { name: 'home', courseId: null, hy: '1', view: 'simpel' };
/* Seitenverlauf für den „Zurück"-Knopf unten links. Gestapelt wird nur bei
   echtem Seitenwechsel — Reiter, Halbjahr oder Ansicht bleiben eine Seite. */
let navStack = [];
function samePage(a, b) {
  return a.name === b.name && a.courseId === b.courseId &&
         a.studentId === b.studentId && a.columnId === b.columnId && a.rasterId === b.rasterId &&
         (a.name !== 'settings' || (a.setPage || null) === (b.setPage || null));
}
/* Seite merken: iPadOS beendet Web-Apps im Hintergrund — beim nächsten Start
   geht es dort weiter, wo man war (sofern es nicht zu lange her ist). */
const ROUTE_KEY = 'pult.route.v1';
const ROUTE_MAX_AGE = 3 * 3600 * 1000;
function saveRoute() {
  try { localStorage.setItem(ROUTE_KEY, JSON.stringify({ at: Date.now(), route, stack: navStack.slice(-15) })); } catch (e) {}
}
function restoreRoute() {
  try {
    const st = JSON.parse(localStorage.getItem(ROUTE_KEY) || 'null');
    if (!st || Date.now() - st.at > ROUTE_MAX_AGE || !st.route) return;
    route = Object.assign({}, route, st.route);
    navStack = Array.isArray(st.stack) ? st.stack : [];
  } catch (e) {}
}

function go(r) {
  closeModal();                     // ein Seitenwechsel lässt kein Fenster offen stehen
  closePrintView();
  closeStage();
  const next = Object.assign({}, route, r);
  if (!samePage(next, route)) {
    navStack.push(route);
    if (navStack.length > 40) navStack.shift();
  }
  route = next;
  render();
}
function goBack() {
  if (!navStack.length) return;
  route = navStack.pop();
  render();
}

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

/* ============================================================
   Phase 6 — Planung: Stundenplan, Todos, Termine (ICS)
   ============================================================ */
const WEEKDAYS      = ['', 'Mo', 'Di', 'Mi', 'Do', 'Fr'];
const WEEKDAYS_LONG = ['', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag'];
/* heutiger Wochentag als 1..5 (Mo–Fr), 0 am Wochenende */
function todayWeekday() { const d = new Date().getDay(); return d >= 1 && d <= 5 ? d : 0; }
/* Montag der Woche, in der iso liegt (Default: heute) */
function mondayOf(iso) {
  const d = iso ? new Date(iso + 'T00:00:00') : new Date();
  d.setHours(0, 0, 0, 0);
  const off = (d.getDay() + 6) % 7;   // Mo=0 … So=6
  d.setDate(d.getDate() - off);
  return d;
}
function dateToISO(d) { return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
/* ISO-Datum + Wochentag 1..5 → Datum dieses Tages in der Woche von baseMonday */
function isoForWeekday(baseMonday, wd) { const d = new Date(baseMonday); d.setDate(d.getDate() + (wd - 1)); return dateToISO(d); }

/* stabile, dezente Farbe je Kurs (Index-basiert) fürs Stundenplan-Raster */
const COURSE_COLORS = [
  { bg: '#e7eef7', fg: '#2b4d73', bar: '#6d94c4' },
  { bg: '#f3eef8', fg: '#4a3d73', bar: '#8f7cc4' },
  { bg: '#e6f2ec', fg: '#1f5a44', bar: '#3f9a76' },
  { bg: '#faf1e6', fg: '#8a5a1e', bar: '#c49356' },
  { bg: '#f7eaef', fg: '#7a2f4e', bar: '#bd6f8c' },
  { bg: '#eef2f5', fg: '#40505f', bar: '#7d8fa0' },
  { bg: '#eaf5ec', fg: '#2f6a3a', bar: '#5aa86a' },
  { bg: '#f3f1e6', fg: '#5c5720', bar: '#a89f5a' },
];
function courseColor(courseId) {
  const i = data.courses.findIndex(c => c.id === courseId);
  return COURSE_COLORS[(i < 0 ? 0 : i) % COURSE_COLORS.length];
}
/* ---------- Zwei-Wochen-Rhythmus (Woche A / Woche B) ----------
   lesson.week: 0 = jede Woche, 1 = nur A, 2 = nur B. Ältere Stunden ohne Feld
   gelten als 0 und laufen damit unverändert in beiden Wochen. */
const AB_LABEL = ['', 'A', 'B'];
const MS_WEEK = 7 * 24 * 60 * 60 * 1000;
function abActive() { return !!(data.timetable && data.timetable.abWeeks); }
/* Montag, der als Woche A zählt — ohne Anker ist es der Montag dieser Woche */
function abAnchor() { return mondayOf(data.timetable.anchorMonday || undefined); }
/* Woche (1 = A, 2 = B), in der das Datum liegt; Default heute */
function abWeekOf(iso) {
  const weeks = Math.round((mondayOf(iso) - abAnchor()) / MS_WEEK);   // DST-fest durch Runden
  return ((weeks % 2) + 2) % 2 === 0 ? 1 : 2;
}
/* legt den Anker so, dass die laufende Woche die gewünschte ist */
function abSetCurrentWeek(week) {
  const m = mondayOf();
  if (week === 2) m.setDate(m.getDate() - 7);
  data.timetable.anchorMonday = dateToISO(m);
}
/* Stunde in einem Feld. Im A/B-Plan gewinnt der Eintrag der gezeigten Woche
   vor einem Eintrag „jede Woche". */
function lessonAt(day, period, week) {
  const all = (data.timetable.lessons || []).filter(l => l.day === day && l.period === period);
  const every = all.find(l => !(l.week || 0));
  if (!abActive()) return every || all[0];
  return all.find(l => (l.week || 0) === week) || every;
}

/* ---------- Termine: Sortierung & Filter ---------- */
function termineSorted() {
  return (data.termine || []).slice().sort((a, b) =>
    (a.date || '').localeCompare(b.date || '') || (a.start || '').localeCompare(b.start || ''));
}
function upcomingTermine(limit) {
  const today = todayISO();
  const list = termineSorted().filter(t => (t.date || '') >= today);
  return limit ? list.slice(0, limit) : list;
}
function fmtTerminWhen(t) {
  if (!t.date) return '';
  const day = fmtDateLong(t.date);
  if (t.allDay || !t.start) return day + ' · ganztägig';
  return day + ' · ' + t.start + (t.end ? '–' + t.end : '') + ' Uhr';
}

/* ---------- ICS (iCalendar) Import/Export ---------- */
function icsUnfold(text) {
  const raw = text.split(/\r?\n/);
  const out = [];
  raw.forEach(line => {
    if (/^[ \t]/.test(line) && out.length) out[out.length - 1] += line.slice(1);
    else out.push(line);
  });
  return out;
}
function icsUnescape(v) { return String(v).replace(/\\n/gi, '\n').replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\\\/g, '\\'); }
function icsEscape(v) { return String(v ?? '').replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;'); }
function parseICSDate(value, params) {
  const v = value.trim();
  const isDate = params.some(p => /VALUE=DATE\b/i.test(p)) || /^\d{8}$/.test(v);
  const y = v.slice(0, 4), mo = v.slice(4, 6), d = v.slice(6, 8);
  if (isDate) return { date: `${y}-${mo}-${d}`, time: '', allDay: true };
  let hh = v.slice(9, 11), mi = v.slice(11, 13);
  if (/Z$/.test(v)) {                                   // UTC → lokale Zeit
    const dt = new Date(Date.UTC(+y, +mo - 1, +d, +hh, +mi));
    return { date: dateToISO(dt), time: `${String(dt.getHours()).padStart(2,'0')}:${String(dt.getMinutes()).padStart(2,'0')}`, allDay: false };
  }
  return { date: `${y}-${mo}-${d}`, time: `${hh}:${mi}`, allDay: false };
}
function parseICS(text) {
  const lines = icsUnfold(text);
  const events = [];
  let cur = null;
  lines.forEach(line => {
    const t = line.trim();
    if (t === 'BEGIN:VEVENT') { cur = { allDay: false }; return; }
    if (t === 'END:VEVENT') { if (cur && (cur.title || cur.date)) events.push(cur); cur = null; return; }
    if (!cur) return;
    const idx = line.indexOf(':'); if (idx < 0) return;
    const left = line.slice(0, idx), value = line.slice(idx + 1);
    const parts = left.split(';');
    const name = parts[0].toUpperCase(), params = parts.slice(1);
    if (name === 'SUMMARY') cur.title = icsUnescape(value);
    else if (name === 'LOCATION') cur.location = icsUnescape(value);
    else if (name === 'DESCRIPTION') cur.note = icsUnescape(value);
    else if (name === 'UID') cur.uid = value.trim();
    else if (name === 'DTSTART') { const p = parseICSDate(value, params); cur.date = p.date; cur.start = p.time; cur.allDay = p.allDay; }
    else if (name === 'DTEND') { const p = parseICSDate(value, params); cur.end = p.time; }
  });
  return events;
}
function importICS(text) {
  let parsed;
  try { parsed = parseICS(text); } catch (e) { parsed = []; }
  if (!parsed.length) { toast('Keine Termine in der Datei gefunden.'); return; }
  let added = 0, skipped = 0;
  parsed.forEach(ev => {
    if (ev.uid && data.termine.some(t => t.uid === ev.uid)) { skipped++; return; }
    data.termine.push({
      id: uid(), title: ev.title || 'Termin', date: ev.date || todayISO(),
      start: ev.start || '', end: ev.end || '', allDay: !!ev.allDay,
      location: ev.location || '', note: ev.note || '', courseId: null,
      uid: ev.uid || (uid() + '@pult'),
    });
    added++;
  });
  save();
  toast(`${added} Termin(e) importiert${skipped ? `, ${skipped} Duplikat(e) übersprungen` : ''}.`);
}
function icsStamp(date, time) { return `${(date||'').replace(/-/g,'')}T${(time||'00:00').replace(':','')}00`; }
function exportICS() {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Pult//Termine//DE', 'CALSCALE:GREGORIAN'];
  termineSorted().forEach(t => {
    lines.push('BEGIN:VEVENT');
    lines.push('UID:' + (t.uid || (t.id + '@pult')));
    lines.push('DTSTAMP:' + icsStamp(todayISO(), '00:00'));
    lines.push('SUMMARY:' + icsEscape(t.title));
    if (t.allDay || !t.start) lines.push('DTSTART;VALUE=DATE:' + (t.date || '').replace(/-/g, ''));
    else {
      lines.push('DTSTART:' + icsStamp(t.date, t.start)); if (t.end) lines.push('DTEND:' + icsStamp(t.date, t.end));
      /* Erinnerung im Kalender des Geräts — Pult. selbst kann ohne Server nicht benachrichtigen */
      lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:' + icsEscape(t.title), 'TRIGGER:-PT30M', 'END:VALARM');
    }
    if (t.location) lines.push('LOCATION:' + icsEscape(t.location));
    if (t.note) lines.push('DESCRIPTION:' + icsEscape(t.note));
    lines.push('END:VEVENT');
  });
  lines.push('END:VCALENDAR');
  const blob = new Blob([lines.join('\r\n')], { type: 'text/calendar' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `pult-termine-${todayISO()}.ics`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast('Termine als ICS exportiert.');
}

/* ============================================================
   RENDER
   ============================================================ */
const app = () => document.getElementById('app');

function render() {
  saveRoute();
  renderTopNav();
  renderTopbarRight();
  renderBackFab();
  if (route.name === 'ka') return renderKA();
  if (route.name === 'raster') return renderRaster();
  if (route.name === 'gruppen') return renderGruppen();
  /* frühere eigene Seiten der Raster-Vorlagen — liegen jetzt in den Einstellungen */
  if (route.name === 'rasterVorlagen' || route.name === 'rasterEdit') {
    route = Object.assign({}, route, { name: 'settings', setPage: 'raster', rasterId: route.name === 'rasterEdit' ? route.rasterId : null });
    return renderSettings();
  }
  if (route.name === 'ha') return renderHaPage();
  if (route.name === 'seating') return renderSeating();
  if (route.name === 'student') return renderStudent();
  if (route.name === 'course') return renderCourse();
  if (route.name === 'courses') return renderCourses();
  if (route.name === 'todos') return renderTodos();
  if (route.name === 'termine') return renderTermine();
  if (route.name === 'settings') return renderSettings();
  return renderHome();
}
/* Hauptseiten. „home" (Stundenplan) hängt an der Wortmarke „Pult." und
   erscheint deshalb nicht als eigener Navigationspunkt. */
const TOP_PAGES = [
  { name: 'home',    label: 'Stundenplan', nav: false },
  { name: 'courses', label: 'Kurse' },
  { name: 'todos',   label: 'Todos' },
  { name: 'termine', label: 'Termine' },
];
/* Unterseiten eines Kurses gehören navigatorisch zu „Kurse" */
const COURSE_SUBPAGES = ['course', 'student', 'ka', 'ha', 'seating', 'raster', 'gruppen'];
/* Seiten, die zu den Einstellungen gehören */
const SETTINGS_SUBPAGES = ['settings', 'rasterVorlagen', 'rasterEdit'];
function navActive() { return COURSE_SUBPAGES.includes(route.name) ? 'courses' : route.name; }

function renderTopNav() {
  const el = document.getElementById('topnav');
  const active = navActive();
  const openCount = (data.todos || []).filter(t => !t.done).length;
  el.innerHTML = TOP_PAGES.filter(p => p.nav !== false).map(p => {
    const badge = p.name === 'todos' && openCount ? `<span class="nav-badge">${openCount}</span>` : '';
    return `<button class="tn ${p.name === active ? 'active' : ''}" data-nav="${p.name}">${p.label}${badge}</button>`;
  }).join('');
  el.querySelectorAll('.tn').forEach(b => b.onclick = () => go({ name: b.dataset.nav }));
}
function renderTopbarRight() {
  /* Zurück liegt unten links (backFab), oben rechts stehen die Einstellungen — auf jeder Seite. */
  const el = document.getElementById('topbarRight');
  const active = SETTINGS_SUBPAGES.includes(route.name) ? ' active' : '';
  const lockBtn = lockCfg.enabled
    ? `<button class="icon-btn topbar-lock" id="btnLock" title="Jetzt sperren" aria-label="App sperren">${LOCK_SVG}</button>` : '';
  const dot = updateInfo ? '<span class="upd-dot" title="Update verfügbar"></span>' : '';
  el.innerHTML = `<button class="icon-btn topbar-search" id="btnSearch" title="Suchen (⌘K)" aria-label="Suchen">${SEARCH_SVG}</button>${lockBtn}<button class="btn ghost small topbar-settings${active}" id="btnSettings">Einstellungen${dot}</button>`;
  document.getElementById('btnSearch').onclick = openSearch;
  document.getElementById('btnSettings').onclick = () => go({ name: 'settings', setPage: null });
  if (lockCfg.enabled) document.getElementById('btnLock').onclick = () => lockNow(false);
}
const SEARCH_SVG = `<svg width="19" height="19" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><circle cx="7" cy="7" r="4.6"/><path d="M10.4 10.4 L14 14"/></svg>`;
/* „Zurück" nur zeigen, wenn es eine vorherige Seite gibt */
function renderBackFab() {
  const el = document.getElementById('backFab');
  if (el) el.hidden = !navStack.length;
}
function findKaColumn(c) {
  if (!c) return null;
  return c.halfYears[route.hy].columns.find(x => x.id === route.columnId && x.ka);
}

/* ---------- Kurse (Übersicht) ---------- */
function renderCourses() {
  const studCount = data.courses.reduce((a, c) => a + c.students.length, 0);
  const backupOverdue = backupIsOverdue();

  app().innerHTML = `
    ${backupOverdue ? `<div class="notice" id="backupNote" style="display:flex;justify-content:space-between;align-items:center;gap:12px;border-color:var(--amber)">
      <span>${data.meta.lastBackup ? 'Letztes Backup: '+fmtDateLong(data.meta.lastBackup)+'.' : 'Noch kein Backup erstellt.'} Sichere deine Daten regelmäßig.</span>
      <button class="btn small" id="backupNow">Backup jetzt</button></div>` : ''}

    <div class="page-head">
      <div><h1>Kurse</h1><div class="sub">${data.courses.length} Kurse · ${studCount} Schüler:innen insgesamt</div></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn" id="btnPrintAll" title="Zeugnisübersicht aller Kurse">Drucken</button>
        <button class="btn primary" id="btnNewCourse">+ Neuer Kurs</button>
      </div>
    </div>

    <div class="course-grid" id="courseGrid"></div>
  `;

  document.getElementById('btnNewCourse').onclick = () => openCourseForm();
  document.getElementById('btnPrintAll').onclick = openAllCoursesPrint;
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
    card.onclick = () => go({ name: 'course', courseId: c.id, hy: defaultHalfYear(c), view: 'simpel' });
    grid.appendChild(card);
  });
  const add = document.createElement('div');
  add.className = 'course-card add-card';
  add.innerHTML = `<span class="plus">+</span> Neuer Kurs`;
  add.onclick = () => openCourseForm();
  grid.appendChild(add);
}

/* ============================================================
   Startseite — Stundenplan + „Heute"
   ============================================================ */
let planEdit = false;   // Stundenplan-Bearbeitungsmodus
let planWeek = null;    // im A/B-Plan angezeigte Woche (1|2); null = die laufende

/* kurzer, unaufdringlicher Text zum letzten Backup */
function backupAgeText() {
  const lb = data.meta.lastBackup;
  if (!lb) return 'Noch kein Backup gesichert';
  const d = daysSince(lb);
  if (d <= 0) return 'Letztes Backup: heute';
  if (d === 1) return 'Letztes Backup: gestern';
  return `Letztes Backup: vor ${d} Tagen`;
}

function renderHome() {
  const ab = abActive();
  const curWeek = ab ? abWeekOf() : 0;
  const week = ab ? (planWeek === 1 || planWeek === 2 ? planWeek : curWeek) : 0;
  /* die gezeigte Woche ist entweder die laufende oder die darauffolgende */
  const monday = mondayOf();
  if (ab && week !== curWeek) monday.setDate(monday.getDate() + 7);
  const wdToday = ab && week !== curWeek ? 0 : todayWeekday();
  const periods = data.timetable.periods || [];
  const ferien = weeksUntil(data.meta.ferienDatum);
  const zeugnis = weeksUntil(data.meta.zeugnisDatum);
  const openTodos = (data.todos || []).filter(t => !t.done).length;
  const nextTermin = upcomingTermine(1)[0];
  const backupOverdue = backupIsOverdue();

  const weekTile = (w, dateIso) => {
    if (!w) return `<div class="value">–</div><div class="foot">Datum festlegen ›</div>`;
    const txt = w.days < 0 ? 'vorbei' : (w.weeks <= 0 ? `<1<small> Woche</small>` : `${w.weeks}<small> Wochen</small>`);
    return `<div class="value">${txt}</div><div class="foot">${fmtDateLong(dateIso)}</div>`;
  };

  // Kopfzeile mit Wochentagen + Datum dieser Woche
  const headDays = WEEKDAYS.slice(1).map((wd, i) => {
    const day = i + 1;
    const iso = isoForWeekday(monday, day);
    const isToday = day === wdToday;
    return `<th class="tt-day ${isToday ? 'tt-today' : ''}"><span class="tt-wd">${wd}</span><span class="tt-date">${fmtDate(iso)}</span></th>`;
  }).join('');

  /* laufende Stunde (nur in der aktuellen Woche) */
  const ln = wdToday ? lessonNow() : { now: null };
  const nowPi = ln.now ? ln.now.index : -1;
  const bodyRows = periods.map((p, pi) => {
    const cells = [1, 2, 3, 4, 5].map(day => {
      const isToday = day === wdToday;
      const isNow = isToday && pi === nowPi;
      const l = lessonAt(day, pi, week);
      if (l && l.placeholder) {
        const label = esc(l.label || 'Freitext');
        const mark = ab && (l.week || 0) ? `<span class="tt-ab">${AB_LABEL[l.week]}</span>` : '';
        return `<td class="tt-cell ${isToday ? 'tt-today' : ''}">
          <button class="tt-lesson tt-placeholder" data-day="${day}" data-period="${pi}" ${planEdit ? '' : 'disabled'}>
            ${mark}<span class="tt-subject">${label}</span><span class="tt-meta">${esc(l.room || '')}</span></button></td>`;
      }
      if (l) {
        const c = getCourse(l.courseId);
        const col = courseColor(l.courseId);
        const label = c ? `${esc(c.subject)}` : '<span class="tt-missing">entfernt</span>';
        const sub = c ? `${esc(c.className)}${l.room ? ' · ' + esc(l.room) : ''}` : '';
        /* nur Stunden, die es nicht in beiden Wochen gibt, bekommen die Marke */
        const mark = ab && (l.week || 0) ? `<span class="tt-ab">${AB_LABEL[l.week]}</span>` : '';
        return `<td class="tt-cell ${isToday ? 'tt-today' : ''} ${isNow ? 'tt-now' : ''}">
          <button class="tt-lesson" data-day="${day}" data-period="${pi}" style="--c-bg:${col.bg};--c-fg:${col.fg};--c-bar:${col.bar}">
            ${mark}<span class="tt-subject">${label}</span><span class="tt-meta">${sub}</span></button></td>`;
      }
      return `<td class="tt-cell ${isToday ? 'tt-today' : ''} ${planEdit ? 'tt-editable' : ''}">
        ${planEdit ? `<button class="tt-add" data-day="${day}" data-period="${pi}">+</button>` : ''}</td>`;
    }).join('');
    return `<tr>
      <th class="tt-period"><span class="tt-pl">${esc(p.label)}</span><span class="tt-pt">${p.start || ''}</span></th>
      ${cells}</tr>`;
  }).join('');

  const hasLessons = (data.timetable.lessons || []).length > 0;
  const wdReal = todayWeekday();
  const todayLabel = (wdReal ? WEEKDAYS_LONG[wdReal] + ', ' + fmtDateLong(todayISO()) : 'Wochenende — ' + fmtDateLong(todayISO()))
    + (ab ? ` · Woche ${AB_LABEL[curWeek]}` : '');
  const weekTabs = ab ? `
    <div class="tabs">
      <button class="tab ${week===1?'active':''}" data-tw="1">Woche A${curWeek===1?' <span class="tt-now">jetzt</span>':''}</button>
      <button class="tab ${week===2?'active':''}" data-tw="2">Woche B${curWeek===2?' <span class="tt-now">jetzt</span>':''}</button>
    </div>` : '';

  app().innerHTML = `
    <section class="dash">
      <div class="dash-card clickable" id="dashFerien">
        <div class="label">${esc(data.meta.ferienLabel || 'Nächste Ferien')}</div>${weekTile(ferien, data.meta.ferienDatum)}
      </div>
      <div class="dash-card clickable" id="dashZeugnis">
        <div class="label">Zeugniskonferenz</div>${weekTile(zeugnis, data.meta.zeugnisDatum)}
      </div>
      <div class="dash-card clickable" id="dashTodos">
        <div class="label">Offene Todos</div>
        <div class="value">${openTodos}</div><div class="foot">${openTodos ? 'ansehen ›' : 'alles erledigt'}</div>
      </div>
      <div class="dash-card clickable" id="dashTermin">
        <div class="label">Nächster Termin</div>
        ${nextTermin ? `<div class="value" style="font-size:20px">${esc(nextTermin.title)}</div><div class="foot">${fmtTerminWhen(nextTermin)}</div>`
          : `<div class="value">–</div><div class="foot">Termin anlegen ›</div>`}
      </div>
    </section>

    <div class="page-head">
      <div><h1>Stundenplan</h1><div class="sub">${todayLabel}</div></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn small" id="btnPeriods">Zeiten</button>
        <button class="btn small ${planEdit ? 'primary' : ''}" id="btnPlanEdit">${planEdit ? 'Fertig' : 'Plan bearbeiten'}</button>
      </div>
    </div>

    ${!data.courses.length ? `<div class="notice">Noch keine Kurse angelegt. Lege zuerst unter <b>Kurse</b> Kurse an, dann kannst du sie hier in den Stundenplan eintragen.</div>` : ''}
    ${planEdit ? `<div class="notice">Tippe auf ein Feld, um einen Kurs einzutragen oder zu ändern.</div>`
      : (hasLessons ? '' : `<div class="notice">Noch keine Stunden eingetragen. Tippe auf <b>Plan bearbeiten</b> und fülle das Raster.</div>`)}

    ${planEdit ? '' : nowBarHtml()}
    ${weekTabs}

    <div class="tt-wrap">
      <table class="tt">
        <thead><tr><th class="tt-corner">Std.</th>${headDays}</tr></thead>
        <tbody>${bodyRows}</tbody>
      </table>
    </div>

    <button class="backup-hint ${backupOverdue ? 'due' : ''}" id="backupHint" title="Backup als JSON-Datei sichern">
      ${backupOverdue ? '<span class="bh-dot"></span>' : ''}<span>${backupAgeText()}</span><span class="bh-action">jetzt sichern</span>
    </button>
  `;

  document.getElementById('backupHint').onclick = exportBackup;
  app().querySelectorAll('[data-now]').forEach(b => b.onclick = () => {
    const c = getCourse(b.dataset.now); if (c) go({ name: 'course', courseId: c.id, hy: defaultHalfYear(c), view: 'simpel' });
  });
  document.getElementById('dashFerien').onclick = () => go({ name: 'settings', setPage: 'schuljahr' });
  document.getElementById('dashZeugnis').onclick = () => go({ name: 'settings', setPage: 'schuljahr' });
  document.getElementById('dashTodos').onclick = () => go({ name: 'todos' });
  document.getElementById('dashTermin').onclick = () => go({ name: 'termine' });
  document.getElementById('btnPeriods').onclick = openPeriodsEditor;
  document.getElementById('btnPlanEdit').onclick = () => { planEdit = !planEdit; renderHome(); };
  app().querySelectorAll('.tab[data-tw]').forEach(t => t.onclick = () => { planWeek = +t.dataset.tw; renderHome(); });

  app().querySelectorAll('.tt-lesson').forEach(b => b.onclick = () => {
    const day = +b.dataset.day, period = +b.dataset.period;
    if (planEdit) return openLessonEditor(day, period, week);
    const l = lessonAt(day, period, week);
    if (l && getCourse(l.courseId)) go({ name: 'course', courseId: l.courseId, hy: defaultHalfYear(getCourse(l.courseId)), view: 'simpel' });
    else openLessonEditor(day, period, week);
  });
  app().querySelectorAll('.tt-add').forEach(b => b.onclick = () => openLessonEditor(+b.dataset.day, +b.dataset.period, week));
}

function openLessonEditor(day, period, week) {
  const ab = abActive();
  const existing = lessonAt(day, period, week);
  const p = data.timetable.periods[period];
  /* Vorgabe für den Rhythmus: bestehende Stunde behält ihren, neue gilt für die gezeigte Woche */
  const curRhythm = existing ? (existing.week || 0) : (week || 0);
  const isPlaceholder = !!(existing && existing.placeholder);
  const opts = `<option value="">— frei —</option><option value="__PLATZHALTER__" ${isPlaceholder ? 'selected' : ''}>Freitext</option>` + data.courses.map(c =>
    `<option value="${c.id}" ${existing && existing.courseId === c.id ? 'selected' : ''}>${esc(c.subject)} · ${esc(c.className)}</option>`).join('');
  const rhythmField = ab ? `
    <div class="field"><label>Rhythmus</label>
      <select id="leWeek">
        <option value="0" ${curRhythm === 0 ? 'selected' : ''}>Jede Woche</option>
        <option value="1" ${curRhythm === 1 ? 'selected' : ''}>Nur Woche A</option>
        <option value="2" ${curRhythm === 2 ? 'selected' : ''}>Nur Woche B</option>
      </select>
      <div class="hint">„Jede Woche" gilt in A und B. Sollen in diesem Feld zwei verschiedene Kurse liegen, setze diese Stunde auf eine Woche — das Feld der anderen wird dann frei.</div>
    </div>` : '';
  modal(`${WEEKDAYS_LONG[day]} · ${p ? esc(p.label) + ' Stunde' : period + 1 + '. Stunde'}${ab ? ' · Woche ' + AB_LABEL[week] : ''}`, `
    ${data.courses.length ? '' : '<div class="notice">Noch keine Kurse vorhanden — lege zuerst einen Kurs an, oder trage einen Freitext ein.</div>'}
    <div class="field"><label>Kurs</label><select id="leCourse">${opts}</select></div>
    <div class="field" id="lePlaceholderField" style="${isPlaceholder ? '' : 'display:none'}">
      <label>Bezeichnung</label>
      <input id="lePlaceholderLabel" type="text" value="${esc(isPlaceholder ? existing.label || '' : '')}" placeholder="z. B. Pause, Vertretung, frei">
      <div class="hint">Freier Text statt eines Kurses. Das Feld ist im Stundenplan nicht anklickbar.</div>
    </div>
    <div class="field"><label>Raum (optional)</label><input id="leRoom" type="text" value="${esc(existing ? existing.room || '' : '')}" placeholder="z. B. A103"></div>
    ${rhythmField}
  `, [
    ...(existing ? [{ label: 'Entfernen', cls: 'danger', onClick: () => {
      data.timetable.lessons = data.timetable.lessons.filter(l => l !== existing);
      save(); closeModal(); renderHome();
    }}] : []),
    { label: 'Abbrechen', onClick: closeModal },
    { label: 'Speichern', cls: 'primary', onClick: () => {
      const sel = val('leCourse'), room = val('leRoom').trim();
      const w = ab ? (Number(val('leWeek')) || 0) : 0;
      if (sel === '__PLATZHALTER__') {
        const label = val('lePlaceholderLabel').trim();
        if (existing) { existing.courseId = null; existing.placeholder = true; existing.label = label; existing.room = room; existing.week = w; }
        else data.timetable.lessons.push({ id: uid(), day, period, courseId: null, placeholder: true, label, room, week: w });
      } else if (!sel) {
        if (existing) data.timetable.lessons = data.timetable.lessons.filter(l => l !== existing);
      } else if (existing) { existing.courseId = sel; existing.placeholder = false; existing.label = ''; existing.room = room; existing.week = w; }
      else data.timetable.lessons.push({ id: uid(), day, period, courseId: sel, room, week: w });
      save(); closeModal(); renderHome();
    }},
  ]);
  const leCourseEl = document.getElementById('leCourse');
  if (leCourseEl) leCourseEl.onchange = () => {
    document.getElementById('lePlaceholderField').style.display = leCourseEl.value === '__PLATZHALTER__' ? '' : 'none';
  };
}

function openPeriodsEditor() {
  const rows = () => data.timetable.periods.map((p, i) => `
    <div class="period-row" data-i="${i}">
      <input type="text" class="pr-label" value="${esc(p.label)}" placeholder="Std.">
      <input type="time" class="pr-start" value="${p.start || ''}">
      <input type="time" class="pr-end" value="${p.end || ''}">
      <button class="btn small danger pr-del">×</button>
    </div>`).join('');
  const flush = () => {
    document.querySelectorAll('.period-row').forEach(row => {
      const i = +row.dataset.i;
      if (!data.timetable.periods[i]) return;
      data.timetable.periods[i].label = row.querySelector('.pr-label').value;
      data.timetable.periods[i].start = row.querySelector('.pr-start').value;
      data.timetable.periods[i].end = row.querySelector('.pr-end').value;
    });
  };
  modal('Stundenzeiten', `
    <div class="scheme-head period-head"><span class="ph-label">Bezeichnung</span><span>Beginn</span><span>Ende</span><span></span></div>
    <div id="periodList">${rows()}</div>
    <button class="btn small" id="prAdd" style="margin-top:10px">+ Stunde</button>
  `, [
    { label: 'Abbrechen', onClick: closeModal },
    { label: 'Speichern', cls: 'primary', onClick: () => { flush(); save(); closeModal(); render(); } },
  ]);
  const rebind = () => {
    document.querySelectorAll('.pr-del').forEach(b => b.onclick = () => {
      const i = +b.closest('.period-row').dataset.i;
      flush();
      data.timetable.periods.splice(i, 1);
      // Stunden neu ausrichten: alles ab i rutscht eine hoch, i selbst fällt weg
      data.timetable.lessons = data.timetable.lessons.filter(l => l.period !== i);
      data.timetable.lessons.forEach(l => { if (l.period > i) l.period--; });
      document.getElementById('periodList').innerHTML = rows();
      rebind();
    });
  };
  document.getElementById('prAdd').onclick = () => {
    flush();
    data.timetable.periods.push({ label: (data.timetable.periods.length + 1) + '.', start: '', end: '' });
    document.getElementById('periodList').innerHTML = rows();
    rebind();
  };
  rebind();
}

/* ============================================================
   Todos
   ============================================================ */
function renderTodos() {
  const courseOpt = (sel) => `<option value="">Kein Kurs</option>` + data.courses.map(c =>
    `<option value="${c.id}" ${sel === c.id ? 'selected' : ''}>${esc(c.subject)} · ${esc(c.className)}</option>`).join('');

  const sorted = (data.todos || []).slice().sort((a, b) => {
    if (a.done !== b.done) return a.done ? 1 : -1;
    const ad = a.due || '9999', bd = b.due || '9999';
    if (ad !== bd) return ad.localeCompare(bd);
    return (a.created || '').localeCompare(b.created || '');
  });

  const item = (t) => {
    const c = t.courseId ? getCourse(t.courseId) : null;
    const overdue = !t.done && t.due && t.due < todayISO();
    const meta = [c ? `${esc(c.subject)} ${esc(c.className)}` : '', t.due ? (overdue ? 'überfällig ' : 'fällig ') + fmtDateLong(t.due) : ''].filter(Boolean).join(' · ');
    return `<div class="todo ${t.done ? 'done' : ''}" data-id="${t.id}">
      <button class="todo-check ${t.done ? 'on' : ''}" data-check="${t.id}" aria-label="erledigt"></button>
      <div class="todo-main"><span class="todo-text">${esc(t.text)}</span>${meta ? `<span class="todo-meta ${overdue ? 'over' : ''}">${meta}</span>` : ''}</div>
      <button class="btn small danger" data-del="${t.id}">Löschen</button>
    </div>`;
  };
  const openList = sorted.filter(t => !t.done).map(item).join('') || `<div class="notice">Keine offenen Todos. Trag oben etwas ein.</div>`;
  const doneList = sorted.filter(t => t.done);

  app().innerHTML = `
    <div class="page-head"><div><h1>Todos</h1><div class="sub">Notizen und Aufgaben, unabhängig von Noten</div></div></div>

    <div class="calc-block">
      <div class="todo-add">
        <input id="tdText" type="text" placeholder="Neues Todo … (Enter)">
        <input id="tdDue" type="date" title="Fällig (optional)">
        <select id="tdCourse">${courseOpt('')}</select>
        <button class="btn primary" id="tdAdd">Hinzufügen</button>
      </div>
    </div>

    <div class="todo-list">${openList}</div>

    ${doneList.length ? `<div class="page-head" style="margin-top:22px"><div><h1 style="font-size:18px">Erledigt (${doneList.length})</h1></div>
      <button class="btn small" id="tdClearDone">Erledigte löschen</button></div>
      <div class="todo-list">${doneList.map(item).join('')}</div>` : ''}
  `;

  const addTodo = () => {
    const text = val('tdText').trim();
    if (!text) return toast('Bitte einen Text eingeben.');
    data.todos.push({ id: uid(), text, done: false, created: todayISO(), due: val('tdDue'), courseId: val('tdCourse') || null });
    save(); renderTodos();
  };
  document.getElementById('tdAdd').onclick = addTodo;
  document.getElementById('tdText').addEventListener('keydown', e => { if (e.key === 'Enter') addTodo(); });
  app().querySelectorAll('[data-check]').forEach(b => b.onclick = () => {
    const t = data.todos.find(x => x.id === b.dataset.check); if (t) { t.done = !t.done; save(); renderTodos(); }
  });
  app().querySelectorAll('[data-del]').forEach(b => b.onclick = () => {
    data.todos = data.todos.filter(x => x.id !== b.dataset.del); save(); renderTodos();
  });
  const cd = document.getElementById('tdClearDone');
  if (cd) cd.onclick = () => { data.todos = data.todos.filter(t => !t.done); save(); renderTodos(); };
}

/* ============================================================
   Termine (+ ICS)
   ============================================================ */
function renderTermine() {
  const today = todayISO();
  const all = termineSorted();
  const upcoming = all.filter(t => (t.date || '') >= today);
  const past = all.filter(t => (t.date || '') < today).reverse();

  const item = (t) => {
    const c = t.courseId ? getCourse(t.courseId) : null;
    const meta = [fmtTerminWhen(t), t.location ? esc(t.location) : '', c ? `${esc(c.subject)} ${esc(c.className)}` : ''].filter(Boolean).join(' · ');
    return `<div class="chip termin" data-id="${t.id}">
      <div class="chip-main"><b>${esc(t.title)}</b><span>${meta}</span>${t.note ? `<span class="termin-note">${esc(t.note)}</span>` : ''}</div>
      <button class="btn small" data-edit="${t.id}">Ändern</button>
    </div>`;
  };

  app().innerHTML = `
    <div class="page-head">
      <div><h1>Termine</h1><div class="sub">${upcoming.length} anstehend</div></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn small" id="tmImport">ICS importieren</button>
        <button class="btn small" id="tmExport">ICS exportieren</button>
        <button class="btn primary small" id="tmAdd">+ Termin</button>
        <input type="file" id="tmFile" accept=".ics,text/calendar" hidden>
      </div>
    </div>

    <div class="chip-list">${upcoming.map(item).join('') || `<div class="notice">Keine anstehenden Termine. Lege einen an oder importiere eine ICS-Datei.</div>`}</div>

    ${past.length ? `<div class="page-head" style="margin-top:22px"><div><h1 style="font-size:18px">Vergangen (${past.length})</h1></div></div>
      <div class="chip-list">${past.map(item).join('')}</div>` : ''}
  `;

  document.getElementById('tmAdd').onclick = () => openTerminForm();
  document.getElementById('tmExport').onclick = () => { if (!data.termine.length) return toast('Keine Termine zum Exportieren.'); exportICS(); };
  const file = document.getElementById('tmFile');
  document.getElementById('tmImport').onclick = () => file.click();
  file.onchange = () => { if (file.files[0]) readFileSmart(file.files[0], text => { importICS(text); renderTermine(); }); };
  app().querySelectorAll('[data-edit]').forEach(b => b.onclick = () => openTerminForm(b.dataset.edit));
}

function openTerminForm(id) {
  const editing = !!id;
  const t = editing ? data.termine.find(x => x.id === id) : { title: '', date: todayISO(), start: '', end: '', allDay: false, location: '', note: '', courseId: null };
  const courseOpt = `<option value="">Kein Kurs</option>` + data.courses.map(c =>
    `<option value="${c.id}" ${t.courseId === c.id ? 'selected' : ''}>${esc(c.subject)} · ${esc(c.className)}</option>`).join('');
  modal(editing ? 'Termin bearbeiten' : 'Neuer Termin', `
    <div class="field"><label>Titel *</label><input id="tmTitle" type="text" value="${esc(t.title)}" placeholder="z. B. Konferenz"></div>
    <div class="row2">
      <div class="field"><label>Datum</label><input id="tmDate" type="date" value="${t.date || ''}"></div>
      <div class="field"><label>Ort (optional)</label><input id="tmLoc" type="text" value="${esc(t.location || '')}"></div>
    </div>
    <div class="field"><label><input id="tmAllday" type="checkbox" ${t.allDay ? 'checked' : ''} style="width:auto;min-height:auto;margin-right:8px;vertical-align:middle">Ganztägig</label></div>
    <div class="row2" id="tmTimes" ${t.allDay ? 'style="display:none"' : ''}>
      <div class="field"><label>Beginn</label><input id="tmStart" type="time" value="${t.start || ''}"></div>
      <div class="field"><label>Ende</label><input id="tmEnd" type="time" value="${t.end || ''}"></div>
    </div>
    <div class="field"><label>Kurs (optional)</label><select id="tmCourse">${courseOpt}</select></div>
    <div class="field"><label>Notiz (optional)</label><textarea id="tmNote" placeholder="Details …">${esc(t.note || '')}</textarea></div>
  `, [
    ...(editing ? [{ label: 'Löschen', cls: 'danger', onClick: () => {
      data.termine = data.termine.filter(x => x.id !== id); save(); closeModal(); renderTermine();
    }}] : []),
    { label: 'Abbrechen', onClick: closeModal },
    { label: 'Speichern', cls: 'primary', onClick: () => {
      const title = val('tmTitle').trim();
      if (!title) return toast('Bitte einen Titel eingeben.');
      const allDay = document.getElementById('tmAllday').checked;
      const rec = {
        title, date: val('tmDate'), allDay,
        start: allDay ? '' : val('tmStart'), end: allDay ? '' : val('tmEnd'),
        location: val('tmLoc').trim(), note: val('tmNote').trim(), courseId: val('tmCourse') || null,
      };
      if (editing) Object.assign(t, rec);
      else data.termine.push(Object.assign({ id: uid(), uid: uid() + '@pult' }, rec));
      save(); closeModal(); renderTermine();
    }},
  ]);
  document.getElementById('tmAllday').onchange = e => {
    document.getElementById('tmTimes').style.display = e.target.checked ? 'none' : '';
  };
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
        <button class="btn small" id="btnSeating" title="Sitzplan">${SEAT_ICON} Sitzplan</button>
        <button class="btn small" id="btnStudents">Schüler:innen</button>
        <button class="btn small" id="btnPrint">Drucken</button>
        <button class="btn small" id="btnMore">Mehr</button>
      </div>
    </div>

    <div class="tabs">
      <button class="tab ${route.hy==='1'?'active':''}" data-hy="1">1. Halbjahr</button>
      <button class="tab ${route.hy==='2'?'active':''}" data-hy="2">2. Halbjahr</button>
    </div>

    <div class="toolbar">
      <div class="seg" id="viewSeg">
        <button data-v="simpel" class="${route.view==='simpel'?'active':''}">Simpel</button>
        <button data-v="gesamt" class="${route.view==='gesamt'?'active':''}">Gesamt</button>
        <button data-v="schriftlich" class="${route.view==='schriftlich'?'active':''}">Schriftlich</button>
        <button data-v="muendlich" class="${route.view==='muendlich'?'active':''}">Mündlich</button>
      </div>
      <div class="spacer"></div>
      <button class="btn small" id="btnAdd">+ Leistung</button>
      <button class="btn small primary" id="btnDurch">Durchtippen</button>
      <button class="btn small" id="btnSonstige">Sonstige (${hy.sonstige.length})</button>
    </div>

    <div id="tableHost"></div>

    <div class="legend">
      <span><i style="background:var(--g-top)"></i> 13–15 (1)</span>
      <span><i style="background:var(--g-good)"></i> 10–12 (2)</span>
      <span><i style="background:#fff"></i> 07–09 (3)</span>
      <span><i style="background:var(--g-low)"></i> 04–06 (4)</span>
      <span><i style="background:var(--g-bad)"></i> 01–03 (5)</span>
      <span><i style="background:var(--g-fail)"></i> 00 (6)</span>
      <span><i style="background:#fdf8ee;border-color:var(--amber)"></i> Sonstige (Bonus)</span>
    </div>
  `;

  document.querySelectorAll('.tab').forEach(t => t.onclick = () => go({ hy: t.dataset.hy }));
  document.querySelectorAll('#viewSeg button').forEach(b => b.onclick = () => go({ view: b.dataset.v }));
  document.getElementById('btnStudents').onclick = () => openStudents(c);
  document.getElementById('btnSeating').onclick = () => { seatPending = null; go({ name: 'seating', courseId: c.id, seatMode: initialSeatMode(c) }); };
  document.getElementById('btnZwischen').onclick = () => createZwischenstand(c);
  document.getElementById('btnMore').onclick = () => openMoreMenu(c);
  document.getElementById('btnPrint').onclick = () => openCoursePrint(c);
  document.getElementById('btnAdd').onclick = () => openAddMenu(c);
  document.getElementById('btnDurch').onclick = () => startDurchtippen(c);
  document.getElementById('btnSonstige').onclick = () => openSonstige(c);

  renderTable(c);
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

/* Schüler-Detailseite: siehe schueler.js */

/* ============================================================
   Klassenarbeit — eigene Seite (Eingabe / Bewertung / Statistik)
   ============================================================ */
/* Klassenarbeit und Test teilen dieselbe Maschinerie (Aufgaben, Bewertungsbogen,
   Statistik). Unterschied ist allein der Bereich: die Klassenarbeit zählt
   schriftlich, der Test mündlich. `kaKind` liefert daraus die Beschriftungen. */
function kaKind(col) {
  return col && col.type === 'muendlich'
    ? { key: 'test', name: 'Test', pill: 'Test' }
    : { key: 'ka', name: 'Klassenarbeit', pill: 'KA' };
}
function kaPill(col) {
  if (!col || !col.ka) return '';
  const k = kaKind(col);
  return ` <span class="pill ka-pill" data-kind="${k.key}">${k.pill}</span>`;
}
function createKA(c, type) {
  const hy = c.halfYears[route.hy];
  type = type === 'muendlich' ? 'muendlich' : 'schriftlich';
  const col = {
    id: uid(), type, label: type === 'muendlich' ? 'Test' : 'Klassenarbeit', date: todayISO(),
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
  const kind = kaKind(col);

  app().innerHTML = `
    <div class="page-head">
      <div>
        <h1>${esc(col.label)}</h1>
        <div class="sub">${kind.name} · ${esc(c.subject)} ${esc(c.className)} · ${route.hy}. Halbjahr${col.date?' · '+fmtDateLong(col.date):''} · zählt ${col.type==='muendlich'?'mündlich':'schriftlich'}</div>
      </div>
      <button class="btn small danger" id="kaDeleteTop">${kind.name} löschen</button>
    </div>
    <div class="tabs">
      <button class="tab ${tab==='eingabe'?'active':''}" data-t="eingabe">Punkteeingabe</button>
      <button class="tab ${tab==='bewertung'?'active':''}" data-t="bewertung">Bewertungsbogen</button>
      <button class="tab ${tab==='statistik'?'active':''}" data-t="statistik">Statistik</button>
    </div>
    <div id="kaBody"></div>
  `;
  document.querySelectorAll('.tab').forEach(t => t.onclick = () => go({ kaTab: t.dataset.t }));
  document.getElementById('kaDeleteTop').onclick = () => confirmDeleteKA(c, col);

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
  const grp = col.type === 'muendlich' ? 'grp-muend' : 'grp-schrift';
  const head = col.ka.tasks.map(t =>
    `<th class="ka-task ${grp}">${esc(t.label)}<span class="ch-max">von ${t.max}</span></th>`).join('');

  const rows = c.students.map(s => {
    const pts = (data.kaPoints[s.id] || {})[col.id] || {};
    const tot = kaTotals(col, s.id);
    const cells = col.ka.tasks.map(t =>
      `<td class="ka-input"><input type="number" min="0" max="${t.max}" step="0.5" inputmode="decimal"
         data-s="${s.id}" data-task="${t.id}" value="${pts[t.id] != null ? pts[t.id] : ''}"></td>`).join('');
    return `<tr>
      <td class="col-name"><span class="sname">${esc(s.firstName)} ${esc(s.lastName||'')}${infoBadge(s)}</span></td>
      ${cells}
      <td class="ka-sum" data-sum="${s.id}"><div class="cell">${tot.achieved==null?'–':fmtNum(tot.achieved)}/${maxTotal}</div></td>
      <td class="ka-pct" data-pct="${s.id}"><div class="cell">${tot.percent==null?'–':Math.round(tot.percent)+'%'}</div></td>
      <td class="ka-note" data-note="${s.id}">${kaNoteCell(tot.grade, c.scale)}</td>
    </tr>`;
  }).join('');

  body.innerHTML = `
    <div class="notice">Punkte pro Aufgabe eintragen. Note, Prozent und Summe berechnen sich automatisch und landen als <b>${col.type==='muendlich'?'mündliche':'schriftliche'}</b> Note in der Notentabelle. Leere Zeile = nicht mitgeschrieben.</div>
    <div class="table-wrap"><table class="grades">
      <thead><tr><th class="col-name">Schüler:in</th>${head}
        <th class="${grp}">Summe</th><th class="${grp}">Prozent</th><th class="grp-final">Note</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
  `;

  body.querySelectorAll('input[data-task]').forEach(inp => {
    inp.oninput = () => {
      const sId = inp.dataset.s, taskId = inp.dataset.task;
      const task = col.ka.tasks.find(t => t.id === taskId);
      /* Punkte und die daraus errechnete Note gehören zusammen ins Protokoll */
      const snap = beginChange([['kaPoints', sId, col.id, taskId], ['grades', sId, col.id]]);
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
      const st = c.students.find(x => x.id === sId);
      const shown = inp.value === '' ? 'leer' : `${fmtNum(store[taskId])} P.`;
      commitChange(`${st ? studentName(st) : 'Schüler:in'} — ${col.label} · ${task.label}: ${shown} (Note ${gradeStr(tot.grade, c)})`,
        snap, { courseId: c.id, mergeKey: `ka:${sId}:${col.id}:${taskId}` });
      save();
    };
  });
  bindInfoBadges(body, c);
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
  /* Gewichtung wie bei einer gewöhnlichen Notenspalte — über den Spaltenkopf
     ist sie hier nicht erreichbar, weil der Klick direkt auf diese Seite führt. */
  const fixedPct = colPct(col);
  const wMode = fixedPct != null ? 'pct' : 'factor';

  const taskRows = col.ka.tasks.map(t => `
    <div class="task-edit" data-task="${t.id}">
      <input type="text" class="te-label" value="${esc(t.label)}" placeholder="Aufgabe">
      <input type="number" class="te-max" min="0" step="0.5" value="${t.max}" placeholder="max">
      <button class="btn small danger te-del">×</button>
    </div>`).join('');

  const schemeRows = col.ka.scheme.map((r, i) => `
    <div class="scheme-row" data-i="${i}">
      <span class="sr-note">${pad2(r.points)}<small>${NOTE_MAP[r.points]}</small></span>
      <input type="range" min="0" max="100" value="${r.minPercent}" class="sr-range">
      <input type="number" min="0" max="100" value="${r.minPercent}" class="sr-pct">
    </div>`).join('');

  body.innerHTML = `
    <div class="row2" style="align-items:start;gap:20px">
      <div>
        <div class="field"><label>Bezeichnung</label><input type="text" id="kaLabel" value="${esc(col.label)}"></div>
        <div class="field"><label>Datum</label><input type="date" id="kaDate" value="${col.date||''}"></div>
        <div class="field"><label>Zählt als</label>
          <div class="seg" id="kaType" style="width:100%">
            <button type="button" data-t="schriftlich" style="flex:1" class="${col.type!=='muendlich'?'active':''}">Schriftlich (Klassenarbeit)</button>
            <button type="button" data-t="muendlich" style="flex:1" class="${col.type==='muendlich'?'active':''}">Mündlich (Test)</button>
          </div>
          <div class="hint">Bestimmt, in welchen Notenbereich das Ergebnis einfließt. Punkte und Bewertungsbogen bleiben erhalten.</div>
        </div>
        <div class="field"><label>Gewichtung</label>
          <div class="seg" id="kaWMode" style="width:100%">
            <button type="button" data-w="factor" style="flex:1" class="${wMode==='factor'?'active':''}">Zählt n-fach</button>
            <button type="button" data-w="pct" style="flex:1" class="${wMode==='pct'?'active':''}">Fester Anteil</button>
          </div>
          <div id="kaWFactor" style="margin-top:8px;${wMode==='factor'?'':'display:none'}">
            <input id="kaFactor" type="number" min="0.1" max="20" step="0.5" value="${fmtNum(colFactor(col)).replace(',', '.')}">
            <div class="hint">Standard 1. Bei 2 wiegt dieses Ergebnis so viel wie zwei einfache Noten desselben Bereichs.</div>
          </div>
          <div id="kaWPct" style="margin-top:8px;${wMode==='pct'?'':'display:none'}">
            <input id="kaPct" type="number" min="1" max="100" value="${fixedPct != null ? fmtNum(fixedPct).replace(',', '.') : ''}" placeholder="z. B. 10">
            <div class="hint" id="kaPctHint"></div>
          </div>
        </div>

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
      <button class="btn danger" id="kaDelete">${kaKind(col).name} löschen</button>
      <div class="spacer"></div>
      <button class="btn primary" id="kaToEntry">Zur Punkteeingabe ›</button>
    </div>
  `;

  const recompute = () => { syncKaGrades(c, col); save(); };

  document.getElementById('kaLabel').oninput = e => { col.label = e.target.value; save(); };
  document.getElementById('kaDate').onchange = e => { col.date = e.target.value; save(); };
  body.querySelectorAll('#kaType button').forEach(b => b.onclick = () => {
    if (col.type === b.dataset.t) return;
    col.type = b.dataset.t;
    save(); renderKA();
    toast(`Zählt jetzt ${col.type === 'muendlich' ? 'mündlich' : 'schriftlich'}.`);
  });

  /* Gewichtung — gespeichert wird nur, was vom Standard (einfach) abweicht. */
  let wPick = wMode;
  const pctHint = () => {
    const el = document.getElementById('kaPctHint'); if (!el) return;
    const b = col.type === 'schriftlich' ? c.weightWritten : c.weightOral;
    const lbl = col.type === 'schriftlich' ? 'schriftlich' : 'mündlich';
    const p = clamp(parseFloat(val('kaPct').replace(',', '.')) || 0, 0, 100);
    const restText = p > 0 && p < b
      ? ` Die übrigen ${lbl}en Noten teilen sich dann noch ${fmtNum(b - p)} %.`
      : (p >= b ? ` Das ist bereits der ganze ${lbl}e Anteil — die übrigen ${lbl}en Noten zählen dann nicht mehr.` : '');
    el.textContent = `Anteil an der Gesamtnote. ${lbl.charAt(0).toUpperCase() + lbl.slice(1)} zählt insgesamt ${fmtNum(b)} %.${restText}`;
  };
  const applyWeight = () => {
    delete col.factor; delete col.pct;
    if (wPick === 'pct') {
      const p = clamp(parseFloat(val('kaPct').replace(',', '.')) || 0, 0, 100);
      if (p > 0) col.pct = p;
    } else {
      const f = clamp(parseFloat(val('kaFactor').replace(',', '.')) || 1, 0.1, 20);
      if (f !== 1) col.factor = f;
    }
    save();
  };
  body.querySelectorAll('#kaWMode button').forEach(b => b.onclick = () => {
    wPick = b.dataset.w;
    body.querySelectorAll('#kaWMode button').forEach(x => x.classList.toggle('active', x.dataset.w === wPick));
    document.getElementById('kaWFactor').style.display = wPick === 'factor' ? '' : 'none';
    document.getElementById('kaWPct').style.display = wPick === 'pct' ? '' : 'none';
    applyWeight(); pctHint();
  });
  document.getElementById('kaFactor').oninput = applyWeight;
  document.getElementById('kaPct').oninput = () => { applyWeight(); pctHint(); };
  pctHint();

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
  document.getElementById('kaDelete').onclick = () => confirmDeleteKA(c, col);
}
function confirmDeleteKA(c, col) {
  const kind = kaKind(col);
  modal(`${kind.name} löschen?`, `<p>${kind.key === 'test' ? 'Der Test' : 'Die Klassenarbeit'} <b>${esc(col.label)}</b> inkl. aller eingetragenen Punkte wird gelöscht.</p>`, [
    { label: 'Abbrechen', onClick: closeModal },
    { label: 'Löschen', cls: 'danger', onClick: () => {
      const hy = c.halfYears[route.hy];
      const n = gradeCountForColumn(c, col.id);
      const snap = beginChange([['courses', c.id, 'halfYears', route.hy, 'columns'],
        ...c.students.map(s => ['grades', s.id, col.id]),
        ...c.students.map(s => ['kaPoints', s.id, col.id])]);
      hy.columns = hy.columns.filter(x => x.id !== col.id);
      Object.values(data.grades).forEach(g => delete g[col.id]);
      Object.values(data.kaPoints).forEach(k => delete k[col.id]);
      commitChange(`${kind.name} „${col.label}" gelöscht (${n} ${n === 1 ? 'Note' : 'Noten'})`, snap, { courseId: c.id });
      save(); closeModal(); go({ name: 'course', courseId: c.id });
    }},
  ]);
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
  const isSimpel = route.view === 'simpel';
  const isGesamt = route.view === 'gesamt';
  const showS = isGesamt || route.view === 'schriftlich';
  const showM = isGesamt || route.view === 'muendlich';
  const schriftCols = hy.columns.filter(x => x.type === 'schriftlich');
  const muendCols = hy.columns.filter(x => x.type === 'muendlich');
  const sonstS = hy.sonstige.filter(s => s.scope === 'schriftlich');
  const sonstM = hy.sonstige.filter(s => s.scope === 'muendlich');
  const sonstA = hy.sonstige.filter(s => s.scope === 'allgemein');
  const zwCols = hy.columns.filter(x => x.type === 'zwischenstand');
  const showHA = (c.haLog || []).length > 0;

  // Invertierte Listen-Ansicht: Gesamt/Ø/Neuestes zuerst links
  const inverted = data.meta.tableLayout === 'invers';
  const byNewest = (a, b) => (b.date || '').localeCompare(a.date || '');
  const schriftInv = schriftCols.slice().sort(byNewest);
  const muendInv = muendCols.slice().sort(byNewest);
  const allSonst = hy.sonstige.slice();

  const headCols = (cols, grpClass) => cols.map(col => `
    <th class="colhead ${grpClass}" data-col="${col.id}">
      <span class="ch-label">${esc(col.label)}${kaPill(col)}${rasterPill(col)}${weightPill(col)}</span>
      ${col.date ? `<span class="ch-date">${fmtDate(col.date)}</span>` : ''}
    </th>`).join('');
  const headSonst = list => list.map(so => `<th class="grp-sonst">${esc(so.label)}<span class="ch-date">${so.percent}%</span></th>`).join('');

  const stickyGesamt = isGesamt && route.hy !== '2';   // Standard: Gesamt ist letzte Spalte (HJ1)
  const zwHead = zwCols.map(col => `<th class="grp-prev zw-head" data-zw="${col.id}">${esc(col.label||'Zwischenstand')}<span class="ch-date">${fmtDate(col.date)}</span></th>`).join('');
  const haHead = `<th class="grp-ha ha-head" title="Hausaufgaben: gemacht / fehlt">HA / Fehlt</th>`;

  let thead = `<tr><th class="col-name">Schüler:in</th>`;
  if (isSimpel) {
    if (inverted) {
      thead += `<th class="grp-final sep-final">Gesamt</th>`;
      thead += `<th class="grp-muend">Ø mündl.</th>`;
      thead += headCols(muendInv.slice(0, 2), 'grp-muend');
      thead += `<th class="grp-schrift">Ø schr.</th>`;
      thead += headCols(schriftInv.slice(0, 1), 'grp-schrift');
    } else {
      thead += headCols(schriftCols.slice(-1), 'grp-schrift');
      thead += `<th class="grp-schrift">Ø schr.</th>`;
      thead += headCols(muendCols.slice(-2), 'grp-muend');
      thead += `<th class="grp-muend">Ø mündl.</th>`;
      thead += `<th class="grp-final sep-final col-sticky-r">Gesamt</th>`;
    }
  } else if (inverted && isGesamt) {
    if (route.hy === '2') thead += `<th class="grp-final sep-final">Endjahr</th>`;
    thead += `<th class="grp-final sep-final">Gesamt</th>`;
    if (showHA) thead += haHead;
    thead += headSonst(allSonst);
    thead += `<th class="grp-schrift">Ø schr.</th>`;
    thead += headCols(schriftInv, 'grp-schrift');
    thead += `<th class="grp-muend">Ø mündl.</th>`;
    thead += headCols(muendInv, 'grp-muend');
    thead += zwHead;
  } else if (inverted && showS) {   // invertierter Schriftlich-Tab
    thead += headSonst(sonstS);
    thead += `<th class="grp-schrift">Ø schr.</th>`;
    thead += headCols(schriftInv, 'grp-schrift');
  } else if (inverted && showM) {   // invertierter Mündlich-Tab
    thead += headSonst(sonstM);
    thead += `<th class="grp-muend">Ø mündl.</th>`;
    thead += headCols(muendInv, 'grp-muend');
  } else {
    if (route.hy === '2') thead += `<th class="grp-prev">Ges. HJ1</th>`;
    if (showS) { thead += headCols(schriftCols, 'grp-schrift'); thead += `<th class="grp-schrift">Ø schr.</th>`; thead += headSonst(sonstS); }
    if (showM) { thead += headCols(muendCols, 'grp-muend'); thead += `<th class="grp-muend">Ø mündl.</th>`; thead += headSonst(sonstM); }
    if (isGesamt) {
      thead += headSonst(sonstA);
      if (showHA) thead += haHead;
      thead += zwHead;
      thead += `<th class="grp-final sep-final ${stickyGesamt?'col-sticky-r':''}">Gesamt</th>`;
      if (route.hy === '2') thead += `<th class="grp-final sep-final col-sticky-r">Endjahr</th>`;
    }
  }
  thead += `</tr>`;

  // Einzelnoten: nur farbige Schrift, kein Hintergrund
  const cell = (pts) => {
    const has = pts != null && !isNaN(pts);
    return `<div class="cell ${has?'':'empty'}" style="color:${gradeInk(pts)}">${has ? fmtGrade(pts, scale, false) : '·'}</div>`;
  };
  // Durchschnitte: farbiger Hintergrund
  const avgCell = (v) => {
    const col = gradeColor(v);
    return `<div class="cell" style="background:${col.bg};color:${col.fg}">${fmtGrade(v, scale, true)}</div>`;
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
    const sparkVals = gradeSeries(c, s.id, [route.hy], 'muendlich').map(p => p.value);
    const spark = sparkVals.length >= 2 ? `<div class="spark">${sparkSvg(sparkVals)}</div>` : '';
    const blind = blindSpot(c, route.hy, s.id) ? '<span class="blind-dot" title="keine aktuelle mündliche Note"></span>' : '';
    const gradeTd = col => `<td class="grade-cell" data-s="${s.id}" data-col="${col.id}">${cell(gr[col.id])}</td>`;
    const haTd = () => { const hc = haCounts(c, s.id); return `<td class="ha-cell"><div class="cell">${hc.gemacht} <span style="color:${hc.nicht?'var(--g-fail)':'var(--ink-faint)'}">/ ${hc.nicht}</span></div></td>`; };
    const zwTd = col => `<td class="prev-cell"><div class="cell">${fmtGrade((col.values||{})[s.id], scale, true)}</div></td>`;
    let tr = `<tr class="${studentActive(s)?'':'inactive'}"><td class="col-name"><span class="sname sname-link" data-student="${s.id}">${esc(s.firstName)} ${esc(s.lastName||'')}${blind}${s.exit?' <small>(aus)</small>':''}${infoBadge(s)}</span>${spark}</td>`;
    if (isSimpel) {
      if (inverted) {
        tr += `<td class="final sep-final" data-final="gesamt" data-s="${s.id}">${finalCell(effGesamt(c, route.hy, s.id), trendArrowSvg(trendDir(c, route.hy, s.id)))}</td>`;
        tr += `<td class="avg">${avgCell(comp.mAvg)}</td>`;
        muendInv.slice(0, 2).forEach(col => tr += gradeTd(col));
        tr += `<td class="avg">${avgCell(comp.wAvg)}</td>`;
        schriftInv.slice(0, 1).forEach(col => tr += gradeTd(col));
      } else {
        schriftCols.slice(-1).forEach(col => tr += gradeTd(col));
        tr += `<td class="avg">${avgCell(comp.wAvg)}</td>`;
        muendCols.slice(-2).forEach(col => tr += gradeTd(col));
        tr += `<td class="avg">${avgCell(comp.mAvg)}</td>`;
        tr += `<td class="final sep-final col-sticky-r" data-final="gesamt" data-s="${s.id}">${finalCell(effGesamt(c, route.hy, s.id), trendArrowSvg(trendDir(c, route.hy, s.id)))}</td>`;
      }
    } else if (inverted && isGesamt) {
      if (route.hy === '2') tr += `<td class="final sep-final" data-final="endjahr" data-s="${s.id}">${finalCell(effEndjahr(c, s.id))}</td>`;
      tr += `<td class="final sep-final" data-final="gesamt" data-s="${s.id}">${finalCell(effGesamt(c, route.hy, s.id), trendArrowSvg(trendDir(c, route.hy, s.id)))}</td>`;
      if (showHA) tr += haTd();
      allSonst.forEach(so => tr += sonstCell(s.id, so.id));
      tr += `<td class="avg">${avgCell(comp.wAvg)}</td>`;
      schriftInv.forEach(col => tr += gradeTd(col));
      tr += `<td class="avg">${avgCell(comp.mAvg)}</td>`;
      muendInv.forEach(col => tr += gradeTd(col));
      zwCols.forEach(col => tr += zwTd(col));
    } else if (inverted && showS) {
      sonstS.forEach(so => tr += sonstCell(s.id, so.id));
      tr += `<td class="avg">${avgCell(comp.wAvg)}</td>`;
      schriftInv.forEach(col => tr += gradeTd(col));
    } else if (inverted && showM) {
      sonstM.forEach(so => tr += sonstCell(s.id, so.id));
      tr += `<td class="avg">${avgCell(comp.mAvg)}</td>`;
      muendInv.forEach(col => tr += gradeTd(col));
    } else {
      if (route.hy === '2') {
        const g1 = effGesamt(c, '1', s.id).value;
        tr += `<td class="prev-cell"><div class="cell">${fmtGrade(g1, scale, true)}</div></td>`;
      }
      if (showS) { schriftCols.forEach(col => tr += gradeTd(col)); tr += `<td class="avg">${avgCell(comp.wAvg)}</td>`; sonstS.forEach(so => tr += sonstCell(s.id, so.id)); }
      if (showM) { muendCols.forEach(col => tr += gradeTd(col)); tr += `<td class="avg">${avgCell(comp.mAvg)}</td>`; sonstM.forEach(so => tr += sonstCell(s.id, so.id)); }
      if (isGesamt) {
        sonstA.forEach(so => tr += sonstCell(s.id, so.id));
        if (showHA) tr += haTd();
        zwCols.forEach(col => tr += zwTd(col));
        tr += `<td class="final sep-final ${stickyGesamt?'col-sticky-r':''}" data-final="gesamt" data-s="${s.id}">${finalCell(effGesamt(c, route.hy, s.id), trendArrowSvg(trendDir(c, route.hy, s.id)))}</td>`;
        if (route.hy === '2') tr += `<td class="final sep-final col-sticky-r" data-final="endjahr" data-s="${s.id}">${finalCell(effEndjahr(c, s.id))}</td>`;
      }
    }
    tr += `</tr>`;
    return tr;
  }).join('');

  const blindCount = c.students.filter(s => studentActive(s) && blindSpot(c, route.hy, s.id)).length;
  const blindNote = blindCount ? `<div class="notice" style="border-color:var(--amber);display:flex;align-items:center;gap:8px"><span class="blind-dot"></span> ${blindCount} ohne aktuelle mündliche Note (über ${blindDays()} Tage bzw. keine).</div>` : '';
  // Scroll-Position der Tabelle über den Neuaufbau hinweg bewahren
  const prevWrap = host.querySelector('.table-wrap');
  const prevLeft = prevWrap ? prevWrap.scrollLeft : 0;
  const prevTop = prevWrap ? prevWrap.scrollTop : 0;
  host.innerHTML = `${blindNote}<div class="table-wrap"><table class="grades"><thead>${thead}</thead><tbody>${rows}</tbody></table></div>`;
  if (prevLeft || prevTop) {
    const wrap = host.querySelector('.table-wrap');
    if (wrap) { wrap.scrollLeft = prevLeft; wrap.scrollTop = prevTop; }
  }

  host.querySelectorAll('td.grade-cell').forEach(td =>
    td.onclick = () => openGradeCell(c, td.dataset.s, td.dataset.col));
  host.querySelectorAll('th.ha-head').forEach(th =>
    th.onclick = () => go({ name: 'ha', courseId: c.id }));
  host.querySelectorAll('td.sonst-cell').forEach(td =>
    td.onclick = () => openSonstCell(c, td.dataset.s, td.dataset.so));
  host.querySelectorAll('th.colhead').forEach(th =>
    th.onclick = () => {
      const col = hy.columns.find(x => x.id === th.dataset.col);
      if (col && col.ka) go({ name: 'ka', courseId: c.id, columnId: col.id, kaTab: 'eingabe' });
      else if (col && col.raster) openRasterCol(c, col);
      else openColumnMenu(c, th.dataset.col);
    });
  host.querySelectorAll('td.final').forEach(td =>
    td.onclick = () => openCalc(c, td.dataset.s, td.dataset.final));
  host.querySelectorAll('.sname-link').forEach(el =>
    el.onclick = () => go({ name: 'student', courseId: c.id, studentId: el.dataset.student }));
  bindInfoBadges(host, c);
  host.querySelectorAll('.zw-head').forEach(th =>
    th.onclick = () => openZwischenstand(c, th.dataset.zw));

  function sonstCell(sId, soId) {
    const v = (data.sonstigeValues[sId] || {})[soId];
    const has = v != null && !isNaN(v);
    return `<td class="sonst-cell" data-s="${sId}" data-so="${soId}"><div class="cell" style="color:${gradeInk(v)}">${has?fmtGrade(v, scale, false):'·'}</div></td>`;
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
    const bg = gc.bg === 'transparent' ? 'var(--card)' : gc.bg;
    const fg = gc.fg === 'var(--line)' ? 'var(--ink)' : gc.fg;
    const big = scale === 'noten' ? NOTE_MAP[p] : pad2(p);
    const sub = scale === 'noten' ? `${pad2(p)} P.` : NOTE_MAP[p];
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
  if (col && col.raster) return openRasterCol(c, col, sId);
  const cur = (data.grades[sId] || {})[colId];
  openPad(`${esc(s.firstName)} ${esc(s.lastName||'')} — ${esc(col.label)}`, cur, v => {
    setGradeLogged(c, 'grades', sId, colId, v, col.label);
    renderTable(c);
  }, c.scale);
}
function openSonstCell(c, sId, soId) {
  const s = c.students.find(x => x.id === sId);
  const so = c.halfYears[route.hy].sonstige.find(x => x.id === soId);
  const cur = (data.sonstigeValues[sId] || {})[soId];
  openPad(`${esc(s.firstName)} ${esc(s.lastName||'')} — ${esc(so.label)} (Bonus)`, cur, v => {
    setGradeLogged(c, 'sonstigeValues', sId, soId, v, `${so.label} (Bonus)`);
    renderTable(c);
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

  /* je Note ihr tatsächlicher Anteil an der Gesamtnote — unbenotete Spalten
     zählen nicht mit und stehen deshalb ohne Prozentwert da. */
  const listCols = (cols, parts) => cols.length
    ? cols.map(col => {
        const p = parts.find(x => x.col.id === col.id);
        const share = p
          ? `<span class="cs-sub"> · ${fmtNum(p.pct)} %${p.fixed ? ' fest' : ''}</span>`
          : (colWeighted(col) ? `<span class="cs-sub"> · ${weightLabel(col)}</span>` : '');
        return `<div class="cs-line"><span>${esc(col.label)}${share}</span><span class="cs-vals">${fmtGrade(gr[col.id], scale, false)}</span></div>`;
      }).join('')
    : `<div class="cs-line cs-sub"><span>keine Noten</span><span></span></div>`;
  const listSonst = (scope, base) => hy.sonstige.filter(x => x.scope === scope).map(so => {
    const sv = (data.sonstigeValues[s.id]||{})[so.id];
    return `<div class="cs-line cs-sub"><span>Bonus: ${esc(so.label)} (${so.percent}%, Pkt ${sv??'–'})</span><span class="cs-vals">${sv!=null&&base!=null&&sv>base?'wirkt':'—'}</span></div>`;
  }).join('');

  modal(`Berechnung — ${name}`, `
    <div class="calc-sheet">
      <div class="calc-block">
        <h3>Schriftlich</h3>
        ${listCols(hy.columns.filter(x=>x.type==='schriftlich'), comp.wParts)}
        ${listSonst('schriftlich', comp.wRaw)}
        <div class="cs-line"><span>Ø schriftlich</span><span class="cs-vals">${fmtGrade(comp.wAvg, scale, true)}</span></div>
      </div>
      <div class="calc-block">
        <h3>Mündlich</h3>
        ${listCols(hy.columns.filter(x=>x.type==='muendlich'), comp.mParts)}
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
      const manKey = hyKey === '1' ? 'g1' : 'g2';
      const snap = beginChange([['weightOverride', s.id, hyKey], ['manual', s.id, manKey]]);
      const w = clamp(parseInt(val('cwW')) || 0, 0, 100);
      if (!data.weightOverride[s.id]) data.weightOverride[s.id] = {};
      if (w === c.weightWritten) delete data.weightOverride[s.id][hyKey];
      else data.weightOverride[s.id][hyKey] = w;
      if (!data.manual[s.id]) data.manual[s.id] = {};
      const mv = val('cManual');
      if (mv === '') delete data.manual[s.id][manKey];
      else data.manual[s.id][manKey] = clamp(parseInt(mv) || 0, 0, 15);
      const mNow = data.manual[s.id][manKey];
      commitChange(`${name} — Gesamtnote ${hyKey}. Halbjahr ${mNow == null ? 'wieder berechnet' : 'manuell: ' + gradeStr(mNow, c)}`,
        snap, { courseId: c.id });
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
      const snap = beginChange([['manual', s.id, 'end']]);
      const w1 = clamp(parseInt(val('ehW1')) || 0, 0, 100);
      c.weightHY1 = w1; c.weightHY2 = 100 - w1;
      if (!data.manual[s.id]) data.manual[s.id] = {};
      const mv = val('ehManual');
      if (mv === '') delete data.manual[s.id].end;
      else data.manual[s.id].end = clamp(parseInt(mv) || 0, 0, 15);
      const mNow = data.manual[s.id].end;
      commitChange(`${name} — Endjahresnote ${mNow == null ? 'wieder berechnet' : 'manuell: ' + gradeStr(mNow, c)}`,
        snap, { courseId: c.id });
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
      const extra = scale === 'noten' ? '' : `  <span class="cs-sub">(ab ${pad2(t)} P.)</span>`;
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
   Phase 3 — Alltag: HA, Durchtippen, Notizen, Listen
   ============================================================ */
/* Hausaufgaben-Protokoll — eigene Seite */
function renderHaPage() {
  const c = getCourse(route.courseId);
  if (!c) return go({ name: 'home' });
  const active = c.students.filter(studentActive);
  const log = (c.haLog || []).slice().sort((a, b) => (b.date || '').localeCompare(a.date || ''));

  const totalRows = active.map(s => {
    const h = haCounts(c, s.id);
    return `<tr><td class="col-name"><span class="sname">${esc(s.firstName)} ${esc(s.lastName||'')}</span></td>
      <td class="avg"><div class="cell">${h.gemacht}</div></td>
      <td class="avg"><div class="cell" style="color:${h.nicht?'var(--g-fail)':'var(--ink-soft)'}">${h.nicht}</div></td></tr>`;
  }).join('');

  const sessRows = log.map(sess => {
    const vals = Object.values(sess.marks || {});
    const nicht = vals.filter(x => x === 'malus').length;
    const gemacht = vals.filter(x => x === 'bonus').length;
    const parts = [];
    if (nicht) parts.push(`${nicht}× nicht gemacht`);
    if (gemacht) parts.push(`${gemacht}× gemacht`);
    const lbl = parts.join(' · ') || 'keine Markierung';
    return `<div class="chip ha-sess" data-edit="${sess.id}"><div class="chip-main"><b>${fmtDateLong(sess.date)||'ohne Datum'}</b><span>${lbl}</span></div>
      <button class="btn small danger" data-del="${sess.id}">Löschen</button></div>`;
  }).join('') || `<div class="notice">Noch keine Erhebungen. Lege eine an — z. B. „wer hat die HA nicht gemacht?".</div>`;

  app().innerHTML = `
    <div class="page-head">
      <div><h1>Hausaufgaben</h1><div class="sub">${esc(c.subject)} ${esc(c.className)} · Protokoll, wirkt nicht auf die Note</div></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn small primary" id="haAdd">+ Erhebung</button>
        <button class="btn small danger" id="haReset">Zählung zurücksetzen</button>
      </div>
    </div>
    <div class="row2" style="align-items:start;gap:20px">
      <div class="calc-block" style="padding:0;overflow:hidden">
        <div class="table-wrap" style="box-shadow:none;border:none">
          <table class="grades"><thead><tr><th class="col-name">Schüler:in</th>
            <th class="grp-muend">gemacht</th><th class="grp-muend">fehlt</th></tr></thead>
          <tbody>${totalRows}</tbody></table>
        </div>
      </div>
      <div class="calc-block">
        <h3>Erhebungen (${log.length})</h3>
        <div class="chip-list">${sessRows}</div>
      </div>
    </div>
  `;
  document.getElementById('haAdd').onclick = () => openHaSession(c);
  document.getElementById('haReset').onclick = () => {
    modal('Zählung zurücksetzen?', `<p>Alle ${(c.haLog||[]).length} Hausaufgaben-Erhebungen dieses Kurses werden gelöscht, die Zählung beginnt von vorn.</p>`, [
      { label: 'Abbrechen', onClick: closeModal },
      { label: 'Zurücksetzen', cls: 'danger', onClick: () => { c.haLog = []; save(); closeModal(); renderHaPage(); } },
    ]);
  };
  app().querySelectorAll('[data-del]').forEach(b => b.onclick = () => { c.haLog = c.haLog.filter(x => x.id !== b.dataset.del); save(); renderHaPage(); });
  app().querySelectorAll('.ha-sess .chip-main').forEach(el => el.onclick = () => openHaSession(c, el.closest('.ha-sess').dataset.edit));
}
/* Erhebung anlegen/bearbeiten — pro Schüler:in drei Zustände per Tippen:
   1× rot = nicht gemacht (Malus), 2× grün = gemacht (Bonus), 3× wieder normal. */
function openHaSession(c, sessId) {
  const active = c.students.filter(studentActive);
  const existing = sessId ? (c.haLog || []).find(x => x.id === sessId) : null;
  const marks = Object.assign({}, existing ? existing.marks : {});
  const draw = () => {
    document.getElementById('haStudents').innerHTML = active.map(s => {
      const st = marks[s.id];
      const cls = st === 'malus' ? 'bad' : st === 'bonus' ? 'good' : '';
      return `<button class="btn small ha-mark ${cls}" data-s="${s.id}">${esc(s.firstName)} ${esc(s.lastName||'')}</button>`;
    }).join('');
    document.querySelectorAll('#haStudents .ha-mark').forEach(b => b.onclick = () => {
      const id = b.dataset.s, st = marks[id];
      if (!st) marks[id] = 'malus';
      else if (st === 'malus') marks[id] = 'bonus';
      else delete marks[id];
      draw();
    });
    const vals = Object.values(marks);
    document.getElementById('haSummary').textContent =
      `${vals.filter(x => x === 'malus').length}× nicht gemacht · ${vals.filter(x => x === 'bonus').length}× gemacht`;
  };
  modal(existing ? 'HA-Erhebung bearbeiten' : 'Neue HA-Erhebung', `
    <div class="field"><label>Datum</label><input id="haDate" type="date" value="${existing ? (existing.date || '') : todayISO()}"></div>
   <div class="chip-wrap" id="haStudents"></div>
    <div class="cs-sub" id="haSummary" style="margin-top:10px"></div>
  `, [
    ...(existing ? [{ label: 'Löschen', cls: 'danger', onClick: () => {
      c.haLog = c.haLog.filter(x => x.id !== sessId); save(); closeModal(); renderHaPage();
    }}] : []),
    { label: 'Abbrechen', onClick: closeModal },
    { label: 'Speichern', cls: 'primary', onClick: () => {
      const clean = {};
      Object.keys(marks).forEach(k => { if (marks[k]) clean[k] = marks[k]; });
      if (existing) { existing.date = val('haDate'); existing.marks = clean; }
      else c.haLog.push({ id: uid(), date: val('haDate'), marks: clean });
      save(); closeModal(); renderHaPage();
      toast('Erhebung gespeichert.');
    }},
  ]);
  draw();
}

/* ============================================================
   Sitzplan — Raster, auf das Tische mit Namen gesetzt werden.
   Drei Modi: „Plan" (anordnen), „Note" (mündliche Note direkt eintragen),
   „Hausaufgaben" (Erhebung direkt pflegen).
   ============================================================ */
const SEAT_MODES = ['note', 'ha', 'plan'];
/* Icon für den Sitzplan: vier Tische, darunter die Tafel */
const SEAT_ICON = `<svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="square">
  <rect x="1.4" y="1.6" width="4.4" height="3"/><rect x="10.2" y="1.6" width="4.4" height="3"/>
  <rect x="1.4" y="6.6" width="4.4" height="3"/><rect x="10.2" y="6.6" width="4.4" height="3"/>
  <path d="M2.6 13.6h10.8" stroke-width="2"/></svg>`;
/* Einstieg: solange noch niemand sitzt, direkt in den Bearbeiten-Modus */
function initialSeatMode(c) {
  return c.seating && Object.keys(c.seating.seats || {}).length ? 'note' : 'plan';
}
/* offene Aktion: ein Platz wird verschoben oder ein:e Schüler:in wartet auf einen Platz */
let seatPending = null;   // { type:'move', key } | { type:'student', id }

function ensureSeating(c) {
  if (!c.seating || typeof c.seating !== 'object') c.seating = { cols: 6, rows: 5, seats: {} };
  if (!c.seating.seats) c.seating.seats = {};
  c.seating.cols = clamp(Number(c.seating.cols) || 6, 1, 12);
  c.seating.rows = clamp(Number(c.seating.rows) || 5, 1, 12);
  return c.seating;
}
function seatKey(x, y) { return `${x},${y}`; }
/* je mehr Spalten, desto schmaler die Kacheln — Schriftgrößen ziehen mit */
function seatDensity(cols) { return cols >= 11 ? 'tight' : cols >= 9 ? 'dense' : ''; }
function seatStudent(c, key) {
  const id = ensureSeating(c).seats[key];
  return id ? c.students.find(s => s.id === id) : null;
}
function unseatedStudents(c) {
  const taken = new Set(Object.values(ensureSeating(c).seats).filter(Boolean));
  return c.students.filter(s => studentActive(s) && !taken.has(s.id));
}
/* Plätze, die nach dem Verkleinern des Rasters außerhalb liegen */
function seatsOutside(st) {
  return Object.keys(st.seats).filter(k => {
    const [x, y] = k.split(',').map(Number);
    return x >= st.cols || y >= st.rows;
  });
}

function renderSeating() {
  const c = getCourse(route.courseId);
  if (!c) return go({ name: 'home' });
  const st = ensureSeating(c);
  const mode = SEAT_MODES.includes(route.seatMode) ? route.seatMode : initialSeatMode(c);
  const hy = c.halfYears[route.hy];
  const muendCols = hy.columns.filter(x => x.type === 'muendlich' && !x.raster);   // Raster-Noten entstehen im Raster
  const noteCol = muendCols.find(x => x.id === route.seatCol) || muendCols[muendCols.length - 1] || null;
  const sessions = (c.haLog || []).slice().sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  const sess = sessions.find(x => x.id === route.seatSess) || sessions[0] || null;
  const offen = unseatedStudents(c);

  let tools = '', hint = '';
  if (mode === 'plan') {
    tools = `<button class="btn small" id="spGrid">Raster ${st.cols} × ${st.rows}</button>
      <button class="btn small" id="spFill">Automatisch füllen</button>
      <button class="btn small danger" id="spClear">Plan leeren</button>`;
    hint = seatPending
      ? 'Jetzt auf den Zielplatz tippen. Ist er besetzt, tauschen die beiden.'
      : 'Freier Platz antippen = Tisch mit Namen anlegen. Besetzter Platz = verschieben, räumen, Kurzinfo.';
  } else if (mode === 'note') {
    tools = `<select id="spCol" aria-label="Notenspalte" style="width:auto;min-width:190px">
        ${muendCols.map(col => `<option value="${col.id}" ${noteCol && col.id === noteCol.id ? 'selected' : ''}>${esc(col.label)}${col.date ? ' · ' + fmtDate(col.date) : ''}</option>`).join('') || '<option>keine mündliche Spalte</option>'}
      </select>
      <button class="btn small" id="spNewCol">+ Mitarbeit heute</button>`;
    hint = noteCol
      ? `Antippen trägt die Note in <b>${esc(noteCol.label)}</b> ein (${route.hy}. Halbjahr).`
      : 'Noch keine mündliche Spalte in diesem Halbjahr — lege „Mitarbeit heute" an.';
  } else {
    tools = `<select id="spSess" aria-label="Erhebung" style="width:auto;min-width:190px">
        ${sessions.map(x => `<option value="${x.id}" ${sess && x.id === sess.id ? 'selected' : ''}>${fmtDateLong(x.date) || 'ohne Datum'}</option>`).join('') || '<option>keine Erhebung</option>'}
      </select>
      <button class="btn small" id="spNewSess">+ Erhebung heute</button>`;
    hint = sess
      ? 'Antippen wechselt: neutral → nicht gemacht → gemacht.'
      : 'Noch keine Erhebung — lege eine für heute an.';
  }

  let cells = '';
  for (let y = 0; y < st.rows; y++) {
    for (let x = 0; x < st.cols; x++) {
      const key = seatKey(x, y);
      const s = seatStudent(c, key);
      if (!s) {
        /* Plätze vergeben nur im Bearbeiten-Modus — sonst bleibt die Lücke stumm */
        cells += mode === 'plan'
          ? `<button class="seat empty ${seatPending ? 'target' : ''}" data-key="${key}" aria-label="freier Platz">+</button>`
          : `<div class="seat empty void" aria-hidden="true"></div>`;
        continue;
      }
      let extra = '', cls = '';
      if (mode === 'note') {
        const v = noteCol ? (data.grades[s.id] || {})[noteCol.id] : null;
        const gc = gradeColor(v);
        const bg = gc.bg === 'transparent' ? 'var(--card)' : gc.bg;
        const fg = gc.fg === 'var(--line)' ? 'var(--ink-faint)' : gc.fg;
        extra = `<span class="seat-val" style="background:${bg};color:${fg}">${v == null ? '·' : fmtGrade(v, c.scale, false)}</span>`;
      } else if (mode === 'ha') {
        const mk = sess ? (sess.marks || {})[s.id] : null;
        cls = mk === 'malus' ? 'bad' : mk === 'bonus' ? 'good' : '';
        extra = `<span class="seat-val">${mk === 'malus' ? 'fehlt' : mk === 'bonus' ? 'gemacht' : '·'}</span>`;
      }
      const blind = mode !== 'ha' && blindSpot(c, route.hy, s.id) ? '<span class="blind-dot" title="keine aktuelle mündliche Note"></span>' : '';
      const moving = seatPending && seatPending.type === 'move' && seatPending.key === key ? 'moving' : '';
      cells += `<button class="seat ${cls} ${moving}" data-key="${key}">
        <span class="seat-name"><span class="seat-first">${esc(s.firstName)}</span>${blind}${infoBadge(s)}</span>
        <span class="seat-last">${esc(s.lastName || '')}</span>
        ${extra}</button>`;
    }
  }

  const pool = offen.map(s => `<button class="btn small seat-pool ${seatPending && seatPending.type === 'student' && seatPending.id === s.id ? 'primary' : ''}" data-pool="${s.id}">${esc(s.firstName)} ${esc(s.lastName || '')}</button>`).join('');

  app().innerHTML = `
    <div class="page-head">
      <div><h1>Sitzplan</h1>
        <div class="sub">${esc(c.subject)} ${esc(c.className)} · ${c.students.filter(studentActive).length - offen.length} von ${c.students.filter(studentActive).length} platziert</div></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">${tools}<button class="btn small" id="spPrint">Drucken</button></div>
    </div>

    <div class="tabs">
      <button class="tab ${mode==='note'?'active':''}" data-sm="note">Mündlich</button>
      <button class="tab ${mode==='ha'?'active':''}" data-sm="ha">Hausaufgaben</button>
      <button class="tab ${mode==='plan'?'active':''}" data-sm="plan">Plan bearbeiten</button>
    </div>

    <div class="notice">${hint}</div>

    ${c.students.length ? `
      <div class="seat-board">
        <div class="seat-grid ${seatDensity(st.cols)}" style="grid-template-columns:repeat(${st.cols}, minmax(0, 1fr));max-width:${st.cols * 116 + (st.cols - 1) * 8}px">${cells}</div>
        <div class="seat-front">Tafel · Pult</div>
      </div>
      ${offen.length && mode === 'plan' ? `<div class="calc-block" style="margin-top:16px"><h3>Ohne Platz (${offen.length})</h3>
        <div class="cs-sub" style="margin-bottom:8px">Antippen, dann auf einen Platz im Raster tippen.</div>
        <div class="chip-wrap">${pool}</div></div>` : ''}
    ` : `<div class="empty-state"><p>Noch keine Schüler:innen in diesem Kurs.</p></div>`}
  `;

  app().querySelectorAll('.tab').forEach(t => t.onclick = () => { seatPending = null; go({ seatMode: t.dataset.sm }); });

  document.getElementById('spPrint').onclick = () => openCoursePrintOpts(c, 'sitzplan', null, true);
  const gEl = document.getElementById('spGrid'); if (gEl) gEl.onclick = () => openSeatGrid(c);
  const fEl = document.getElementById('spFill'); if (fEl) fEl.onclick = () => seatingAutoFill(c);
  const cEl = document.getElementById('spClear'); if (cEl) cEl.onclick = () => {
    modal('Plan leeren?', `<p>Alle Tische dieses Sitzplans werden entfernt. Noten und Hausaufgaben bleiben unberührt.</p>`, [
      { label: 'Abbrechen', onClick: closeModal },
      { label: 'Leeren', cls: 'danger', onClick: () => { st.seats = {}; seatPending = null; save(); closeModal(); renderSeating(); } },
    ]);
  };
  const colSel = document.getElementById('spCol');
  if (colSel) colSel.onchange = () => go({ seatCol: colSel.value });
  const newCol = document.getElementById('spNewCol');
  if (newCol) newCol.onclick = () => {
    let col = hy.columns.find(x => x.type === 'muendlich' && x.label === 'Mitarbeit' && x.date === todayISO() && !x.ka && !x.raster);
    if (!col) { col = { id: uid(), type: 'muendlich', label: 'Mitarbeit', date: todayISO() }; hy.columns.push(col); save(); }
    go({ seatCol: col.id });
  };
  const sessSel = document.getElementById('spSess');
  if (sessSel) sessSel.onchange = () => go({ seatSess: sessSel.value });
  const newSess = document.getElementById('spNewSess');
  if (newSess) newSess.onclick = () => {
    let x = (c.haLog || []).find(o => o.date === todayISO());
    if (!x) { x = { id: uid(), date: todayISO(), marks: {} }; c.haLog.push(x); save(); }
    go({ seatSess: x.id });
  };

  app().querySelectorAll('.seat-pool').forEach(b => b.onclick = () => {
    const id = b.dataset.pool;
    seatPending = (seatPending && seatPending.type === 'student' && seatPending.id === id) ? null : { type: 'student', id };
    renderSeating();
  });

  app().querySelectorAll('button.seat').forEach(btn => btn.onclick = () => {
    const key = btn.dataset.key;
    const s = seatStudent(c, key);
    if (mode === 'plan') {
      if (seatPending) return resolveSeatPending(c, key);
      return s ? openSeatMenu(c, key) : openSeatAssign(c, key);
    }
    if (mode === 'note') {
      if (!noteCol) return toast('Erst eine mündliche Spalte anlegen.');
      return openPad(`${studentName(s)} — ${noteCol.label}`, (data.grades[s.id] || {})[noteCol.id], v => {
        setGradeLogged(c, 'grades', s.id, noteCol.id, v, noteCol.label);
        renderSeating();
      }, c.scale);
    }
    if (!sess) return toast('Erst eine Erhebung anlegen.');
    sess.marks = sess.marks || {};
    const mk = sess.marks[s.id];
    if (!mk) sess.marks[s.id] = 'malus';
    else if (mk === 'malus') sess.marks[s.id] = 'bonus';
    else delete sess.marks[s.id];
    save(); renderSeating();
  });

  bindInfoBadges(app(), c);
}

/* offene Aktion auf einen Zielplatz anwenden */
function resolveSeatPending(c, key) {
  const st = ensureSeating(c);
  const p = seatPending;
  seatPending = null;
  if (!p) return renderSeating();
  if (p.type === 'student') {
    st.seats[key] = p.id;                       // besetzter Platz: bisherige:r rückt in die Liste „ohne Platz"
  } else {
    const from = p.key;
    if (from !== key) {
      const a = st.seats[from], b = st.seats[key];
      if (b) st.seats[from] = b; else delete st.seats[from];
      st.seats[key] = a;
    }
  }
  save(); renderSeating();
}

function openSeatAssign(c, key) {
  const offen = unseatedStudents(c);
  const list = offen.map(s => `<button class="btn small" style="width:100%" data-pick="${s.id}">${esc(s.firstName)} ${esc(s.lastName || '')}</button>`).join('')
    || `<div class="notice">Alle aktiven Schüler:innen sitzen schon.</div>`;
  modal('Wer sitzt hier?', `<div class="chip-list">${list}</div>`, [{ label: 'Abbrechen', onClick: closeModal }]);
  document.querySelectorAll('[data-pick]').forEach(b => b.onclick = () => {
    ensureSeating(c).seats[key] = b.dataset.pick;
    save(); closeModal(); renderSeating();
  });
}

function openSeatMenu(c, key) {
  const s = seatStudent(c, key);
  if (!s) return;
  modal(studentName(s), `
    ${s.info ? `<div class="notice info-note"><span class="info-i">i</span> ${esc(s.info)}</div>` : ''}
    <div class="chip-list">
      <button class="btn primary" style="width:100%" id="smMove">Platz tauschen / verschieben</button>
      <button class="btn" style="width:100%" id="smInfo">Kurzinfo bearbeiten</button>
      <button class="btn" style="width:100%" id="smOpen">Schüler:in öffnen</button>
      <button class="btn danger" style="width:100%" id="smFree">Platz räumen</button>
    </div>`, [{ label: 'Abbrechen', onClick: closeModal }]);
  document.getElementById('smMove').onclick = () => {
    seatPending = { type: 'move', key };
    closeModal(); renderSeating();
    toast('Jetzt Zielplatz antippen.');
  };
  document.getElementById('smInfo').onclick = () => openInfoEdit(c, s, () => renderSeating());
  document.getElementById('smOpen').onclick = () => { closeModal(); go({ name: 'student', studentId: s.id }); };
  document.getElementById('smFree').onclick = () => {
    delete ensureSeating(c).seats[key];
    save(); closeModal(); renderSeating();
  };
}

function openSeatGrid(c) {
  const st = ensureSeating(c);
  modal('Raster', `
    <div class="row2">
      <div class="field"><label>Spalten (nach rechts)</label><input id="sgCols" type="number" min="1" max="12" value="${st.cols}"></div>
      <div class="field"><label>Reihen (hinten → vorn)</label><input id="sgRows" type="number" min="1" max="12" value="${st.rows}"></div>
    </div>
    <div class="hint">Die Tafel steht unten, die oberste Reihe ist die hinterste. Wird das Raster kleiner, verlieren Tische außerhalb ihren Platz — die Namen wandern zurück in „Ohne Platz".</div>
  `, [
    { label: 'Abbrechen', onClick: closeModal },
    { label: 'Speichern', cls: 'primary', onClick: () => {
      st.cols = clamp(parseInt(val('sgCols')) || st.cols, 1, 12);
      st.rows = clamp(parseInt(val('sgRows')) || st.rows, 1, 12);
      const lost = seatsOutside(st);
      lost.forEach(k => delete st.seats[k]);
      save(); closeModal(); renderSeating();
      if (lost.length) toast(`${lost.length} Platz/Plätze außerhalb entfernt.`);
    }},
  ]);
}

/* füllt freie Plätze reihenweise mit den noch nicht platzierten Schüler:innen */
function seatingAutoFill(c) {
  const st = ensureSeating(c);
  const free = [];
  for (let y = 0; y < st.rows; y++) for (let x = 0; x < st.cols; x++) if (!st.seats[seatKey(x, y)]) free.push(seatKey(x, y));
  const pool = unseatedStudents(c);
  const n = Math.min(free.length, pool.length);
  for (let i = 0; i < n; i++) st.seats[free[i]] = pool[i].id;
  save(); renderSeating();
  if (!n) toast(pool.length ? 'Kein freier Platz — Raster vergrößern.' : 'Alle sitzen schon.');
  else toast(`${n} platziert${pool.length > n ? `, ${pool.length - n} ohne Platz (Raster zu klein)` : ''}.`);
}

/* Klasse durchtippen (mündliche Mitarbeit, heute) */
function startDurchtippen(c) {
  const hy = c.halfYears[route.hy];
  let col = hy.columns.find(x => x.type === 'muendlich' && x.label === 'Mitarbeit' && x.date === todayISO() && !x.ka && !x.raster);
  if (!col) { col = { id: uid(), type: 'muendlich', label: 'Mitarbeit', date: todayISO() }; hy.columns.push(col); save(); }
  openDurchtippen(c, col.id, 0);
}
/* Aktion für eine bestehende Notenspalte: Durchtippen oder bearbeiten */
function openColumnMenu(c, colId) {
  const col = c.halfYears[route.hy].columns.find(x => x.id === colId);
  if (!col) return;
  const typLbl = col.type === 'schriftlich' ? 'schriftlich' : 'mündlich';
  modal(esc(col.label), `
    <div class="cs-sub" style="margin-bottom:10px">${typLbl}${col.date ? ' · ' + fmtDateLong(col.date) : ''}${colWeighted(col) ? ' · ' + esc(weightTitle(col)) : ''}</div>
    <div class="chip-list">
      <button class="btn primary" style="width:100%" id="cmDurch">Durchtippen — ganze Klasse</button>
      <button class="btn" style="width:100%" id="cmEdit">Spalte bearbeiten</button>
    </div>`, [{ label: 'Abbrechen', onClick: closeModal }]);
  document.getElementById('cmDurch').onclick = () => { closeModal(); openDurchtippen(c, colId, 0); };
  document.getElementById('cmEdit').onclick = () => openColumnForm(c, null, colId);
}
/* bisherige Kennzahlen desselben Typs (ohne die aktuelle Spalte) */
function muendlichInfo(c, hyKey, sId, excludeColId, type) {
  type = type || 'muendlich';
  const cols = c.halfYears[hyKey].columns.filter(x => x.type === type && x.id !== excludeColId);
  const entries = blockEntries(cols, sId);
  const withGrade = entries.map(e => ({ date: e.col.date, v: e.v }));
  const vals = withGrade.map(o => o.v);
  const avg = weighEntries(entries, 100).avg;   // gewichtet wie im Zeugnis
  let trend = null;
  if (vals.length >= 3) {
    const half = Math.floor(vals.length / 2);
    const m = a => a.reduce((x, y) => x + y, 0) / a.length;
    const d = m(vals.slice(vals.length - half)) - m(vals.slice(0, half));
    trend = d >= 1 ? 'up' : d <= -1 ? 'down' : 'flat';
  }
  const dated = withGrade.filter(o => o.date).map(o => o.date).sort();
  return { avg, trend, lastDate: dated.length ? dated[dated.length - 1] : null, count: vals.length };
}
function openDurchtippen(c, colId, idx) {
  const hy = c.halfYears[route.hy]; const col = hy.columns.find(x => x.id === colId);
  const students = c.students.filter(studentActive);
  if (!col || !students.length) { closeModal(); renderCourse(); return; }
  if (idx >= students.length) { closeModal(); renderCourse(); toast('Durchtippen fertig.'); return; }
  const s = students[idx];
  const scale = c.scale;
  const cur = (data.grades[s.id] || {})[colId];
  const info = muendlichInfo(c, route.hy, s.id, colId, col.type);
  const avgLbl = col.type === 'schriftlich' ? 'Ø schriftlich' : 'Ø mündlich';
  const trendTxt = info.trend === 'up' ? `steigend ${trendArrowSvg('up')}` : info.trend === 'down' ? `fallend ${trendArrowSvg('down')}` : info.trend === 'flat' ? 'gleichbleibend' : '—';
  let pad = '';
  for (let p = 15; p >= 0; p--) {
    const gc = gradeColor(p); const bg = gc.bg === 'transparent' ? 'var(--card)' : gc.bg; const fg = gc.fg === 'var(--line)' ? 'var(--ink)' : gc.fg;
    const big = scale === 'noten' ? NOTE_MAP[p] : pad2(p); const sub = scale === 'noten' ? `${pad2(p)} P.` : NOTE_MAP[p];
    pad += `<button data-p="${p}" class="${cur===p?'sel':''}" style="background:${bg};color:${fg}">${big}<span class="nt" style="color:${fg}">${sub}</span></button>`;
  }
  modal(`${esc(col.label)} — ${esc(s.firstName)} ${esc(s.lastName||'')}  (${idx+1}/${students.length})`,
    `${s.info ? `<div class="notice info-note"><span class="info-i">i</span> ${esc(s.info)}</div>` : ''}
     <div class="dt-info">
       <div><span class="dt-lbl">${avgLbl}</span><b>${fmtGrade(info.avg, scale, true)}</b></div>
       <div><span class="dt-lbl">Tendenz</span><b>${trendTxt}</b></div>
       <div><span class="dt-lbl">Letzte Note</span><b>${info.lastDate ? fmtDateLong(info.lastDate) : '—'}</b></div>
     </div>
     <div class="gradepad">${pad}<button class="gradepad-clear btn" data-p="skip">Überspringen (keine Note)</button></div>`, [
    { label: 'Beenden', onClick: () => { closeModal(); renderCourse(); } },
    { label: 'Weiter ohne Note ›', cls: 'primary', onClick: () => openDurchtippen(c, colId, idx + 1) },
  ]);
  document.querySelectorAll('.gradepad button').forEach(b => b.onclick = () => {
    if (b.dataset.p !== 'skip') setGradeLogged(c, 'grades', s.id, colId, parseInt(b.dataset.p), col.label);
    openDurchtippen(c, colId, idx + 1);
  });
}

/* „+ Leistung": alle Arten, eine Note anzulegen */
function openAddMenu(c) {
  const item = (id, title, sub) => `<button class="btn menu-btn" id="${id}">${title}<small>${sub}</small></button>`;
  modal('Leistung hinzufügen', `<div class="chip-list">
    ${item('amMuend', 'Mündliche Note', 'Einzelne Note, z. B. Mitarbeit, Referat')}
    ${item('amSchrift', 'Schriftliche Note', 'Einzelne Note ohne Aufgaben')}
    ${item('amKA', 'Klassenarbeit', 'Aufgaben, Punkte und Bewertungsbogen · zählt schriftlich')}
    ${item('amTest', 'Test', 'Wie eine Klassenarbeit, zählt aber mündlich')}
    ${item('amRaster', 'Bewertungsraster', 'Einschätzung nach Kriterien, schlägt eine Note vor')}
  </div>`, [{ label: 'Abbrechen', onClick: closeModal }]);
  document.getElementById('amMuend').onclick = () => openColumnForm(c, 'muendlich');
  document.getElementById('amSchrift').onclick = () => openColumnForm(c, 'schriftlich');
  document.getElementById('amKA').onclick = () => { closeModal(); createKA(c, 'schriftlich'); };
  document.getElementById('amTest').onclick = () => { closeModal(); createKA(c, 'muendlich'); };
  document.getElementById('amRaster').onclick = () => createRasterRound(c);
}

/* Mehr-Menü */
function openMoreMenu(c) {
  modal('Mehr', `<div class="chip-list">
    <button class="btn" style="width:100%" id="mmGroups">Gruppen bilden</button>
    <button class="btn" style="width:100%" id="mmPick">Wer ist dran?</button>
    <button class="btn" style="width:100%" id="mmTimer">Timer</button>
    <hr style="border:none;border-top:1px solid var(--line-soft);margin:4px 0">
    <button class="btn" style="width:100%" id="mmHa">Hausaufgaben protokollieren</button>
    <button class="btn" style="width:100%" id="mmNotes">Kursnotizen</button>
    <button class="btn" style="width:100%" id="mmLists">Einsammel-Listen</button>
    <button class="btn" style="width:100%" id="mmLog">Notenprotokoll</button>
    <button class="btn" style="width:100%" id="mmEdit">Kurs bearbeiten</button>
  </div>`, [{ label: 'Schließen', onClick: closeModal }]);
  document.getElementById('mmLog').onclick = () => openHistory(c.id);
  document.getElementById('mmGroups').onclick = () => { closeModal(); groupMove = null; go({ name: 'gruppen', courseId: c.id }); };
  document.getElementById('mmPick').onclick = () => openPicker(c);
  document.getElementById('mmTimer').onclick = () => { closeModal(); openTimer(); };
  document.getElementById('mmHa').onclick = () => { closeModal(); go({ name: 'ha', courseId: c.id }); };
  document.getElementById('mmNotes').onclick = () => openNotes(c, null);
  document.getElementById('mmLists').onclick = () => openLists(c);
  document.getElementById('mmEdit').onclick = () => openCourseForm(c);
}

/* Notizen (Schüler:in oder Kurs) */
function courseNotes(c, studentId) {
  return data.notes.filter(n => n.courseId === c.id && (studentId ? n.studentId === studentId : !n.studentId))
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''));
}
function openNotes(c, studentId) {
  const s = studentId ? c.students.find(x => x.id === studentId) : null;
  const list = courseNotes(c, studentId).map(n => `<div class="chip">
    <div class="chip-main"><b>${fmtDateLong(n.date)||'ohne Datum'}</b><span>${esc(n.text)}</span></div>
    <button class="btn small danger" data-del="${n.id}">Löschen</button></div>`).join('') || `<div class="notice">Noch keine Notizen.</div>`;
  modal(s ? `Notizen — ${esc(s.firstName)} ${esc(s.lastName||'')}` : 'Kursnotizen', `
    <div class="field"><label>Neue Notiz</label>
      <input id="ntDate" type="date" value="${todayISO()}" style="margin-bottom:8px">
      <textarea id="ntText" placeholder="${s?'Beobachtung, Gespräch …':'Organisatorisches, z. B. Wandertag geplant'}"></textarea>
    </div>
    <button class="btn small" id="ntAdd">Notiz hinzufügen</button>
    <hr style="border:none;border-top:1px solid var(--line-soft);margin:14px 0">
    <div class="chip-list">${list}</div>
  `, [{ label: 'Schließen', cls: 'primary', onClick: () => { closeModal(); render(); } }]);
  document.getElementById('ntAdd').onclick = () => {
    const text = val('ntText').trim(); if (!text) return toast('Bitte Text eingeben.');
    data.notes.push({ id: uid(), courseId: c.id, studentId: studentId || null, date: val('ntDate'), text });
    save(); openNotes(c, studentId);
  };
  document.querySelectorAll('[data-del]').forEach(b => b.onclick = () => { data.notes = data.notes.filter(n => n.id !== b.dataset.del); save(); openNotes(c, studentId); });
}

/* Einsammel-Listen */
function openLists(c) {
  const active = c.students.filter(studentActive);
  const lists = data.lists.filter(l => l.courseId === c.id);
  const rows = lists.map(l => {
    const done = active.filter(s => ['abgegeben', 'befreit'].includes(l.status[s.id])).length;
    const over = l.dueDate && daysSince(l.dueDate) > 0 && done < active.length;
    return `<div class="chip">
      <div class="chip-main"><b>${esc(l.title)}</b><span>${l.dueDate?(over?'überfällig seit ':'fällig ')+fmtDateLong(l.dueDate)+' · ':''}${done}/${active.length} erledigt</span></div>
      <div style="display:flex;gap:6px"><button class="btn small" data-open="${l.id}">Öffnen</button><button class="btn small danger" data-del="${l.id}">Löschen</button></div></div>`;
  }).join('') || `<div class="notice">Noch keine Listen. Für Zettel, Ordner, Geld … — unabhängig von Noten.</div>`;
  modal('Einsammel-Listen', `
    <div class="row2">
      <div class="field"><label>Neue Liste</label><input id="liTitle" type="text" placeholder="z. B. Einverständnis Klassenfahrt"></div>
      <div class="field"><label>Fällig (optional)</label><input id="liDue" type="date"></div>
    </div>
    <button class="btn small" id="liAdd">Liste anlegen</button>
    <hr style="border:none;border-top:1px solid var(--line-soft);margin:14px 0">
    <div class="chip-list">${rows}</div>
  `, [{ label: 'Schließen', cls: 'primary', onClick: closeModal }]);
  document.getElementById('liAdd').onclick = () => {
    const title = val('liTitle').trim(); if (!title) return toast('Bitte Titel eingeben.');
    data.lists.push({ id: uid(), courseId: c.id, title, dueDate: val('liDue'), status: {} });
    save(); openLists(c);
  };
  document.querySelectorAll('[data-open]').forEach(b => b.onclick = () => openList(c, b.dataset.open));
  document.querySelectorAll('[data-del]').forEach(b => b.onclick = () => { data.lists = data.lists.filter(l => l.id !== b.dataset.del); save(); openLists(c); });
}
function openList(c, listId) {
  const l = data.lists.find(x => x.id === listId); if (!l) return openLists(c);
  const active = c.students.filter(studentActive);
  const cycle = { offen: 'abgegeben', abgegeben: 'befreit', befreit: 'offen' };
  const rows = active.map(s => {
    const st = l.status[s.id] || 'offen';
    const cls = st === 'abgegeben' ? 'good' : st === 'befreit' ? '' : 'bad';
    return `<div class="chip"><div class="chip-main"><b>${esc(s.firstName)} ${esc(s.lastName||'')}</b></div>
      <button class="btn small li-toggle ${cls}" data-s="${s.id}">${st}</button></div>`;
  }).join('');
  const done = active.filter(s => ['abgegeben', 'befreit'].includes(l.status[s.id])).length;
  modal(`${esc(l.title)} — ${done}/${active.length}`, `
    ${l.dueDate?`<div class="cs-sub" style="margin-bottom:8px">Fällig ${fmtDateLong(l.dueDate)}</div>`:''}
    <div class="cs-sub" style="margin-bottom:8px">Antippen wechselt: offen → abgegeben → befreit.</div>
    <div class="chip-list">${rows}</div>
  `, [{ label: 'Zurück', onClick: () => openLists(c) }, { label: 'Fertig', cls: 'primary', onClick: closeModal }]);
  document.querySelectorAll('.li-toggle').forEach(b => b.onclick = () => { const sId = b.dataset.s; l.status[sId] = cycle[l.status[sId] || 'offen']; save(); openList(c, listId); });
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
document.getElementById('backFab').onclick = goBack;

/* ---------- Kurs anlegen / bearbeiten ---------- */
function openCourseForm(course) {
  const editing = !!course;
  const cd = courseDefaults();
  const c = course || { subject: '', className: '', scale: cd.scale, weightWritten: cd.weightWritten, weightOral: 100 - cd.weightWritten, weightHY1: cd.weightHY1, weightHY2: 100 - cd.weightHY1 };
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
      const n = c.students.reduce((a, s) => a + gradeCountForStudent(s.id), 0);
      const snap = beginChange([['courses'], ['notes'], ['lists'],
        ...c.students.flatMap(s => [['grades', s.id], ['sonstigeValues', s.id], ['manual', s.id],
          ['weightOverride', s.id], ['kaPoints', s.id]])]);
      c.students.forEach(s => { delete data.grades[s.id]; delete data.sonstigeValues[s.id]; delete data.manual[s.id]; delete data.weightOverride[s.id]; delete data.kaPoints[s.id]; });
      data.notes = data.notes.filter(n => n.courseId !== c.id);
      data.lists = data.lists.filter(l => l.courseId !== c.id);
      data.courses = data.courses.filter(x => x.id !== c.id);
      commitChange(`Kurs „${c.subject} ${c.className}" gelöscht (${c.students.length} Schüler:innen, ${n} ${n === 1 ? 'Note' : 'Noten'})`, snap);
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
  const fixedPct = colPct(col);
  const wMode = fixedPct != null ? 'pct' : 'factor';
  /* Bereichsgewicht als Bezugsgröße für den festen Anteil (Kurs-Standard) */
  const blockPct = () => (chosen === 'schriftlich' ? c.weightWritten : c.weightOral);
  modal(editing ? 'Note bearbeiten' : (t === 'schriftlich' ? 'Neue schriftliche Note' : 'Neue mündliche Note'), `
    <div class="field"><label>Bezeichnung</label>
      <input id="cLabel" type="text" value="${esc(col.label)}" placeholder="${t==='schriftlich'?'z. B. 1. Klausur':'z. B. Mitarbeit'}"></div>
    <div class="field"><label>Datum (optional)</label><input id="cDate" type="date" value="${col.date||''}"></div>
    <div class="field"><label>Art</label>
      <div class="seg" id="cType" style="width:100%">
        <button type="button" data-t="schriftlich" style="flex:1" class="${t==='schriftlich'?'active':''}">Schriftlich</button>
        <button type="button" data-t="muendlich" style="flex:1" class="${t==='muendlich'?'active':''}">Mündlich</button>
      </div>
    </div>
    <div class="field"><label>Gewichtung</label>
      <div class="seg" id="cWMode" style="width:100%">
        <button type="button" data-w="factor" style="flex:1" class="${wMode==='factor'?'active':''}">Zählt n-fach</button>
        <button type="button" data-w="pct" style="flex:1" class="${wMode==='pct'?'active':''}">Fester Anteil</button>
      </div>
      <div id="cWFactor" style="margin-top:8px;${wMode==='factor'?'':'display:none'}">
        <input id="cFactor" type="number" min="0.1" max="20" step="0.5" value="${fmtNum(colFactor(col)).replace(',', '.')}">
        <div class="hint">Standard 1. Bei 2 wiegt diese Note so viel wie zwei einfache Noten desselben Bereichs.</div>
      </div>
      <div id="cWPct" style="margin-top:8px;${wMode==='pct'?'':'display:none'}">
        <input id="cPct" type="number" min="1" max="100" value="${fixedPct != null ? fmtNum(fixedPct).replace(',', '.') : ''}" placeholder="z. B. 10">
        <div class="hint" id="cPctHint"></div>
      </div>
    </div>
  `, [
    ...(editing ? [{ label: 'Löschen', cls: 'danger', onClick: () => {
      const n = gradeCountForColumn(c, col.id);
      const snap = beginChange([['courses', c.id, 'halfYears', route.hy, 'columns'],
        ...c.students.map(s => ['grades', s.id, col.id])]);
      hy.columns = hy.columns.filter(x => x.id !== col.id);
      Object.values(data.grades).forEach(g => delete g[col.id]);
      commitChange(`Spalte „${col.label}" gelöscht (${n} ${n === 1 ? 'Note' : 'Noten'})`, snap, { courseId: c.id });
      save(); closeModal(); renderCourse();
    }}] : []),
    { label: 'Abbrechen', onClick: closeModal },
    { label: 'Speichern', cls: 'primary', onClick: () => {
      const label = val('cLabel').trim();
      if (!label) return toast('Bitte eine Bezeichnung angeben.');
      col.label = label; col.date = val('cDate');
      /* Gewichtung: nur speichern, was vom Standard abweicht */
      delete col.factor; delete col.pct;
      if (wPick === 'pct') {
        const p = clamp(parseFloat(val('cPct').replace(',', '.')) || 0, 0, 100);
        if (p > 0) col.pct = p;
      } else {
        const f = clamp(parseFloat(val('cFactor').replace(',', '.')) || 1, 0.1, 20);
        if (f !== 1) col.factor = f;
      }
      if (!editing) { col.id = uid(); hy.columns.push(col); }
      save(); closeModal(); renderCourse();
    }},
  ]);
  let chosen = col.type;
  let wPick = wMode;
  const pctHint = () => {
    const el = document.getElementById('cPctHint'); if (!el) return;
    const b = blockPct(), lbl = chosen === 'schriftlich' ? 'schriftlich' : 'mündlich';
    const p = clamp(parseFloat(val('cPct').replace(',', '.')) || 0, 0, 100);
    const restText = p > 0 && p < b
      ? ` Die übrigen ${lbl}en Noten teilen sich dann noch ${fmtNum(b - p)} %.`
      : (p >= b ? ` Das ist bereits der ganze ${lbl}e Anteil — die übrigen ${lbl}en Noten zählen dann nicht mehr.` : '');
    el.textContent = `Anteil an der Gesamtnote. ${lbl.charAt(0).toUpperCase() + lbl.slice(1)} zählt insgesamt ${fmtNum(b)} %.${restText}`;
  };
  document.querySelectorAll('#cType button').forEach(b => b.onclick = () => {
    chosen = b.dataset.t; col.type = chosen;
    document.querySelectorAll('#cType button').forEach(x => x.classList.toggle('active', x.dataset.t === chosen));
    pctHint();
  });
  document.querySelectorAll('#cWMode button').forEach(b => b.onclick = () => {
    wPick = b.dataset.w;
    document.querySelectorAll('#cWMode button').forEach(x => x.classList.toggle('active', x.dataset.w === wPick));
    document.getElementById('cWFactor').style.display = wPick === 'factor' ? '' : 'none';
    document.getElementById('cWPct').style.display = wPick === 'pct' ? '' : 'none';
    pctHint();
  });
  document.getElementById('cPct').oninput = pctHint;
  pctHint();
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
    const inputs = Array.from(document.querySelectorAll('.modal-body input[data-so]'));
    const snap = beginChange(inputs.map(inp => ['sonstigeValues', inp.dataset.s, inp.dataset.so]));
    inputs.forEach(inp => {
      const sId = inp.dataset.s, soId = inp.dataset.so;
      if (!data.sonstigeValues[sId]) data.sonstigeValues[sId] = {};
      if (inp.value === '') delete data.sonstigeValues[sId][soId];
      else data.sonstigeValues[sId][soId] = clamp(parseInt(inp.value) || 0, 0, 15);
    });
    const n = snap.filter(ch => !histSame(ch.before, pathGet(ch.path))).length;
    commitChange(`Sonstige Leistungen bearbeitet (${n} ${n === 1 ? 'Wert' : 'Werte'})`, snap, { courseId: c.id });
    save(); closeModal(); renderTable(c);
  }}]);
}
const scopeLabel = s => ({ allgemein: 'Allgemein', schriftlich: 'Schriftlich', muendlich: 'Mündlich' }[s] || s);

/* ---------- Schüler:innen verwalten ---------- */
function openStudents(c) {
  const list = c.students.map(s => `
    <div class="chip">
      <div class="chip-main"><b>${esc(s.firstName)} ${esc(s.lastName||'')}${infoBadge(s)}</b>
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
  document.querySelectorAll('.info-i[data-info]').forEach(el => el.onclick = ev => {
    ev.stopPropagation();
    const s = c.students.find(x => x.id === el.dataset.info);
    if (s) openInfoEdit(c, s, () => openStudents(c));
  });
  document.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => openStudentForm(c, b.dataset.edit));
  document.querySelectorAll('[data-del]').forEach(b => b.onclick = () => {
    const sId = b.dataset.del;
    const s = c.students.find(x => x.id === sId);
    const n = gradeCountForStudent(sId);
    /* Löschen nimmt alle Noten mit — deshalb kommt der komplette Datensatz ins Protokoll */
    const snap = beginChange([['courses', c.id, 'students'], ['grades', sId], ['sonstigeValues', sId],
      ['manual', sId], ['weightOverride', sId], ['kaPoints', sId], ['notes'],
      ...(c.seating && c.seating.seats ? [['courses', c.id, 'seating', 'seats']] : [])]);
    c.students = c.students.filter(x => x.id !== sId);
    delete data.grades[sId]; delete data.sonstigeValues[sId];
    delete data.manual[sId]; delete data.weightOverride[sId];
    delete data.kaPoints[sId];
    data.notes = data.notes.filter(n => n.studentId !== sId);
    if (c.seating && c.seating.seats) {
      Object.keys(c.seating.seats).forEach(k => { if (c.seating.seats[k] === sId) delete c.seating.seats[k]; });
    }
    commitChange(`Schüler:in „${s ? studentName(s) : '?'}" gelöscht (${n} ${n === 1 ? 'Note' : 'Noten'})`, snap, { courseId: c.id });
    save(); openStudents(c);
  });
}
function openStudentForm(c, id) {
  const editing = !!id;
  const s = editing ? c.students.find(x => x.id === id) : { firstName: '', lastName: '', entry: '', exit: '', info: '' };
  modal(editing ? 'Schüler:in bearbeiten' : 'Schüler:in hinzufügen', `
    <div class="row2">
      <div class="field"><label>Vorname *</label><input id="stF" type="text" value="${esc(s.firstName)}"></div>
      <div class="field"><label>Nachname / Initiale</label><input id="stL" type="text" value="${esc(s.lastName||'')}" placeholder="optional"></div>
    </div>
    <div class="row2">
      <div class="field"><label>Eintritt</label><input id="stE" type="date" value="${s.entry||''}"></div>
      <div class="field"><label>Austritt</label><input id="stX" type="date" value="${s.exit||''}"></div>
    </div>
    <div class="field"><label>Kurzinfo (Nachteilsausgleich, Hinweis)</label>
      <textarea id="stI" placeholder="z. B. Nachteilsausgleich: 25 % Zeitzuschlag" style="min-height:64px">${esc(s.info||'')}</textarea>
      <div class="hint">Erscheint als „i" neben dem Namen — in der Notentabelle, bei Klassenarbeiten und im Sitzplan.</div>
    </div>
    <div class="hint">Nur der Vorname ist Pflicht.</div>
  `, [
    { label: 'Abbrechen', onClick: () => openStudents(c) },
    { label: 'Speichern', cls: 'primary', onClick: () => {
      const f = val('stF').trim();
      if (!f) return toast('Vorname ist erforderlich.');
      s.firstName = f; s.lastName = val('stL').trim(); s.entry = val('stE'); s.exit = val('stX');
      s.info = val('stI').trim();
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
    c.students.push({ id: uid(), firstName: e.firstName, lastName: e.lastName || '', entry: e.entry || '', exit: e.exit || '', info: '' });
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

/* ---------- Dauerhafter Speicher ----------
   true = dauerhaft, false = nicht, null = Browser kennt die Funktion nicht */
async function storagePersist(ask) {
  if (!navigator.storage || !navigator.storage.persisted) return null;
  try {
    if (await navigator.storage.persisted()) return true;
    return ask && navigator.storage.persist ? await navigator.storage.persist() : false;
  } catch (e) { return false; }
}

/* ---------- Utilities ---------- */
function getCourse(id) { return data.courses.find(c => c.id === id); }
function val(id) { const el = document.getElementById(id); return el ? el.value : ''; }
function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }
function fmtNum(n) { if (n == null || isNaN(n)) return '–'; return (Math.round(n * 10) / 10).toString().replace('.', ','); }
function esc(s) { return String(s ?? '').replace(/[&<>"]/g, ch => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[ch])); }
let toastTimer;
/* action: { label, fn } — Knopf im Hinweis (z. B. „Rückgängig"), bleibt dann länger stehen */
function toast(msg, action) {
  document.querySelectorAll('.toast').forEach(t => t.remove());
  const t = document.createElement('div'); t.className = 'toast';
  const span = document.createElement('span'); span.textContent = msg; t.appendChild(span);
  if (action) {
    const b = document.createElement('button'); b.className = 'toast-btn'; b.textContent = action.label;
    b.onclick = () => { t.remove(); action.fn(); };
    t.appendChild(b);
  }
  document.body.appendChild(t);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.remove(), action ? 5000 : 2400);
}
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

/* ---------- Start ---------- */
data = load();
runMigrations();
applyTheme();
restoreRoute();
try { render(); }
catch (e) {
  /* eine gemerkte Seite, die nicht mehr geht, darf den Start nicht blockieren */
  console.error(e);
  route = { name: 'home', courseId: null, hy: '1', view: 'simpel' }; navStack = [];
  render();
}
initLock();
/* installierte Web-App: Speicher als dauerhaft anfragen (sonst darf der Browser bei Platzmangel räumen) */
if (window.matchMedia('(display-mode: standalone)').matches || navigator.standalone) storagePersist(true);
dailySnapshot();
loadAppVersion().then(() => {
  if (SETTINGS_SUBPAGES.includes(route.name)) render();
  else renderTopbarRight();
  dailyUpdateCheck();
});
