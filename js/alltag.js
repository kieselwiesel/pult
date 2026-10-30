/* ============================================================
   Pult. — Alltag: Hell/Dunkel, „Jetzt"-Stunde, Suche,
   Stundenplan als Kalender, Schuljahreswechsel mit Archiv
   ------------------------------------------------------------
   Wird vor pult.js geladen: hier stehen nur Definitionen.
   ============================================================ */
'use strict';

/* ---------- Hell / Dunkel ----------
   data.meta.theme: 'auto' (Systemeinstellung) | 'light' | 'dark'.
   html[data-theme] steuert die Farbvariablen, html.is-dark die Korrekturen. */
const darkQuery = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
function applyTheme() {
  const t = (data && data.meta && data.meta.theme) || 'auto';
  const root = document.documentElement;
  if (t === 'auto') delete root.dataset.theme; else root.dataset.theme = t;
  root.classList.toggle('is-dark', t === 'dark' || (t === 'auto' && !!darkQuery && darkQuery.matches));
}
if (darkQuery && darkQuery.addEventListener) darkQuery.addEventListener('change', () => { if (typeof data !== 'undefined' && data) applyTheme(); });

/* ---------- „Jetzt"-Stunde ----------
   Liefert { now: {period, lesson, course}|null, next: {…}|null } für heute. */
const hhmm = t => { const [h, m] = String(t || '').split(':').map(Number); return (h || 0) * 60 + (m || 0); };
function lessonNow() {
  const wd = todayWeekday();
  if (!wd) return { now: null, next: null };
  const week = abActive() ? abWeekOf() : 0;
  const d = new Date(), mins = d.getHours() * 60 + d.getMinutes();
  const periods = data.timetable.periods || [];
  let now = null, next = null;
  periods.forEach((p, i) => {
    const l = lessonAt(wd, i, week);
    if (!l) return;
    const info = { index: i, period: p, lesson: l, course: l.placeholder ? null : getCourse(l.courseId) };
    if (mins >= hhmm(p.start) && mins < hhmm(p.end)) now = info;
    else if (!next && hhmm(p.start) > mins) next = info;
  });
  return { now, next };
}
/* Startseite jede Minute auffrischen, sobald eine Stunde beginnt oder endet */
let nowKey = '';
setInterval(() => {
  if (typeof route === 'undefined' || route.name !== 'home' || planEdit || document.hidden) return;
  if (!document.getElementById('modalBackdrop').hidden) return;
  const { now, next } = lessonNow();
  const key = `${now ? now.index : '-'}|${next ? next.index : '-'}|${todayISO()}`;
  if (key !== nowKey) { nowKey = key; renderHome(); }
}, 30000);

/* ---------- Suche (⌘K) ---------- */
const fold = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
function openSearch() {
  modal('Suchen', `
    <input id="srQ" type="search" placeholder="Name oder Kurs …" autocomplete="off">
    <div id="srRes" class="sr-res"></div>`, [{ label: 'Schließen', onClick: closeModal }]);
  const q = document.getElementById('srQ'), res = document.getElementById('srRes');
  let hits = [];
  const run = () => {
    const t = fold(q.value.trim());
    hits = [];
    if (t) {
      data.courses.forEach(c => {
        if (fold(`${c.subject} ${c.className}`).includes(t)) hits.push({ kind: 'course', c });
        c.students.forEach(s => { if (fold(`${s.firstName} ${s.lastName}`).includes(t) || fold(`${s.lastName} ${s.firstName}`).includes(t)) hits.push({ kind: 'student', c, s }); });
      });
    }
    res.innerHTML = hits.slice(0, 30).map((h, i) => h.kind === 'course'
      ? `<button class="sr-hit" data-i="${i}"><b>${esc(h.c.subject)} ${esc(h.c.className)}</b><span>Kurs · ${h.c.students.length} Schüler:innen</span></button>`
      : `<button class="sr-hit" data-i="${i}"><b>${esc(studentName(h.s))}</b><span>${esc(h.c.subject)} ${esc(h.c.className)}${studentActive(h.s) ? '' : ' · ausgetreten'}</span></button>`).join('')
      || (t ? '<div class="cs-sub">Nichts gefunden.</div>' : '<div class="cs-sub">Tipp: ⌘K öffnet die Suche von überall.</div>');
    res.querySelectorAll('.sr-hit').forEach(b => b.onclick = () => openHit(hits[+b.dataset.i]));
  };
  const openHit = h => {
    if (!h) return;
    closeModal();
    if (h.kind === 'course') go({ name: 'course', courseId: h.c.id, hy: defaultHalfYear(h.c), view: 'simpel' });
    else go({ name: 'student', courseId: h.c.id, studentId: h.s.id });
  };
  q.oninput = run;
  q.onkeydown = e => { if (e.key === 'Enter') openHit(hits[0]); };
  run();
  setTimeout(() => q.focus(), 30);
}
document.addEventListener('keydown', e => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
    if (document.querySelector('.lockscreen')) return;
    e.preventDefault();
    openSearch();
  }
});

/* ---------- Stundenplan als Kalenderdatei ----------
   Jede Stunde wird ein wöchentlich (A/B: zweiwöchentlich) wiederholter Termin
   bis zu den nächsten Ferien bzw. ein halbes Jahr. Importiert in den Kalender
   zeigt dann das Kalender-Widget die nächste Stunde. */
function exportTimetableICS() {
  const lessons = (data.timetable.lessons || []).filter(l => l.placeholder || getCourse(l.courseId));
  if (!lessons.length) return toast('Der Stundenplan ist noch leer.');
  const periods = data.timetable.periods || [];
  const monday = mondayOf();
  const ab = abActive(), curWeek = ab ? abWeekOf() : 0;
  const end = data.meta.ferienDatum && data.meta.ferienDatum > todayISO()
    ? data.meta.ferienDatum : dateToISO(new Date(Date.now() + 182 * 86400000));
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Pult//Stundenplan//DE', 'CALSCALE:GREGORIAN', 'X-WR-CALNAME:Stundenplan (Pult.)'];
  lessons.forEach(l => {
    const p = periods[l.period]; if (!p) return;
    const c = l.placeholder ? null : getCourse(l.courseId);
    /* erstes Vorkommen ab dieser Woche (bei A/B in der passenden Woche) */
    const m = new Date(monday);
    if (ab && (l.week || 0) && l.week !== curWeek) m.setDate(m.getDate() + 7);
    const date = isoForWeekday(m, l.day);
    lines.push('BEGIN:VEVENT', `UID:${l.id}@pult-stundenplan`, 'DTSTAMP:' + icsStamp(todayISO(), '00:00'),
      'SUMMARY:' + icsEscape(c ? `${c.subject} ${c.className}` : (l.label || 'Freitext')),
      'DTSTART:' + icsStamp(date, p.start), 'DTEND:' + icsStamp(date, p.end),
      `RRULE:FREQ=WEEKLY;INTERVAL=${ab && (l.week || 0) ? 2 : 1};UNTIL=${end.replace(/-/g, '')}T235959`);
    if (l.room) lines.push('LOCATION:' + icsEscape(l.room));
    lines.push('END:VEVENT');
  });
  lines.push('END:VCALENDAR');
  saveFile(new Blob([lines.join('\r\n')], { type: 'text/calendar' }), `stundenplan-${todayISO()}.ics`)
    .then(ok => { if (ok) toast('Stundenplan als Kalenderdatei gesichert.'); });
}

/* ============================================================
   Schuljahreswechsel & Archiv
   ------------------------------------------------------------
   Abschluss: Das ganze alte Jahr wird als dauerhafter interner Stand
   gesichert (fällt nicht der Aufräumregel zum Opfer) — dazu wird ein Backup
   als Datei empfohlen. Danach werden gewählte Kurse mit ihren Schüler:innen
   ins neue Jahr übernommen, ohne Noten.

   Archiv ansehen: Ein Sicherungsstand wird zum Anschauen geladen; Pult.
   speichert dann nichts (save() ruht), bis das Archiv verlassen wird.
   ============================================================ */
let archiveMode = null;   // { live: data, label }

function nextClassName(name) {
  const m = String(name || '').match(/^(\d+)(.*)$/);
  return m ? `${Number(m[1]) + 1}${m[2]}` : name;
}
/* Das Schuljahr, das gerade zu Ende geht: gewechselt wird meist im Sommer —
   von Januar bis Oktober ist das (Jahr−1)/Jahr, danach Jahr/(Jahr+1) */
function schoolYearLabel() {
  const d = new Date(), y = d.getFullYear();
  const start = d.getMonth() <= 9 ? y - 1 : y;
  return `${start}/${String(start + 1).slice(2)}`;
}

function openYearChange() {
  if (archiveMode) return toast('Erst das Archiv verlassen.');
  const label = schoolYearLabel();
  const rows = data.courses.map(c => `<div class="yc-row">
      <label class="check-row"><input type="checkbox" data-take="${c.id}" checked><span><b>${esc(c.subject)}</b> ${esc(c.className)} <small>${c.students.filter(studentActive).length} Schüler:innen</small></span></label>
      <input type="text" data-cls="${c.id}" value="${esc(nextClassName(c.className))}" aria-label="neue Klasse">
    </div>`).join('');
  modal('Neues Schuljahr', `
    <div class="notice">Das bisherige Jahr wird vollständig als Archiv gesichert und bleibt unter <b>Einstellungen → Daten</b> zum Nachschauen erhalten. Zusätzlich vorher ein <b>Backup als Datei</b> sichern.</div>
    <div class="field"><label>Name des Archivs</label><input id="ycLabel" type="text" value="Schuljahr ${esc(label)}"></div>
    <div class="field"><label>Kurse übernehmen — mit Schüler:innen, ohne Noten</label>${rows || '<div class="cs-sub">Keine Kurse.</div>'}
      <div class="hint">Klasse rechts anpassen (z. B. 7c → 8c). Nicht angehakte Kurse gibt es nur noch im Archiv.</div></div>
    <div class="check-list">
      <label class="check-row"><input type="checkbox" id="ycPlan"><span>Stundenplan behalten</span></label>
      <label class="check-row"><input type="checkbox" id="ycSeat" checked><span>Sitzpläne und Gruppenregeln behalten</span></label>
      <label class="check-row"><input type="checkbox" id="ycNotes"><span>Notizen und Kurzinfos zu Personen behalten</span></label>
      <label class="check-row"><input type="checkbox" id="ycTodo" checked><span>Offene Todos und künftige Termine behalten</span></label>
    </div>
  `, [
    { label: 'Erst Backup sichern', onClick: () => exportBackup() },
    { label: 'Abbrechen', onClick: closeModal },
    { label: 'Schuljahr wechseln', cls: 'primary', onClick: async () => {
      const take = [...document.querySelectorAll('[data-take]')].filter(i => i.checked).map(i => i.dataset.take);
      const cls = Object.fromEntries([...document.querySelectorAll('[data-cls]')].map(i => [i.dataset.cls, i.value.trim()]));
      const o = { plan: document.getElementById('ycPlan').checked, seat: document.getElementById('ycSeat').checked,
        notes: document.getElementById('ycNotes').checked, todo: document.getElementById('ycTodo').checked };
      const archLabel = val('ycLabel').trim() || `Schuljahr ${label}`;
      try { await takeSnapshot(archLabel, false, true); }
      catch (e) { return toast('Archiv konnte nicht angelegt werden — abgebrochen.'); }
      startNewYear(take, cls, o);
      closeModal(); navStack = []; go({ name: 'courses' });
      toast('Neues Schuljahr angelegt. Das alte liegt im Archiv.');
    }},
  ]);
}
function startNewYear(take, cls, o) {
  const old = data;
  const d = DEFAULT_DATA();
  d.meta = Object.assign({}, old.meta, { ferienDatum: '', zeugnisDatum: '', halfYear: 'auto' });
  d.rubrics = old.rubrics;
  d.courses = old.courses.filter(c => take.includes(c.id)).map(c => {
    const n = newCourse(c.subject, cls[c.id] || c.className);
    Object.assign(n, { id: c.id, scale: c.scale, weightWritten: c.weightWritten, weightOral: c.weightOral, weightHY1: c.weightHY1, weightHY2: c.weightHY2 });
    n.students = c.students.filter(studentActive).map(s => ({ id: s.id, firstName: s.firstName, lastName: s.lastName, entry: '', exit: '', info: o.notes ? (s.info || '') : '' }));
    if (o.seat && c.seating) n.seating = rasterClone(c.seating);
    if (o.seat && c.groups) n.groups = { rules: rasterClone(c.groups.rules || []), saved: [], current: null };
    return n;
  });
  const kept = new Set(d.courses.map(c => c.id));
  if (o.plan) { d.timetable = rasterClone(old.timetable); d.timetable.lessons = d.timetable.lessons.filter(l => l.placeholder || kept.has(l.courseId)); }
  else { d.timetable.periods = rasterClone(old.timetable.periods); d.timetable.abWeeks = old.timetable.abWeeks; d.timetable.anchorMonday = old.timetable.anchorMonday; }
  if (o.notes) d.notes = old.notes.filter(n => kept.has(n.courseId));
  if (o.todo) {
    d.todos = old.todos.filter(t => !t.done).map(t => Object.assign({}, t, { courseId: kept.has(t.courseId) ? t.courseId : null }));
    d.termine = old.termine.filter(t => (t.date || '') >= todayISO());
  }
  data = d;
  runMigrations();
  save();
}

/* Sicherungsstand zum Ansehen öffnen (nichts wird gespeichert) */
async function viewArchive(id) {
  const snap = await getSnapshot(id); if (!snap) return;
  if (!archiveMode) archiveMode = { live: data, label: snap.label };
  archiveMode.label = snap.label;
  data = Object.assign(DEFAULT_DATA(), JSON.parse(snap.json));
  closeModal(); navStack = [];
  go({ name: 'courses' });
  renderArchiveBar();
}
function leaveArchive() {
  if (!archiveMode) return;
  data = archiveMode.live; archiveMode = null;
  renderArchiveBar(); navStack = [];
  go({ name: 'settings', setPage: 'daten' });
}
function renderArchiveBar() {
  let el = document.getElementById('archiveBar');
  if (!archiveMode) { if (el) el.remove(); document.body.classList.remove('in-archive'); return; }
  if (!el) { el = document.createElement('div'); el.id = 'archiveBar'; document.body.appendChild(el); }
  el.innerHTML = `<span><b>Archiv: ${esc(archiveMode.label)}</b> — nur zum Ansehen, Änderungen werden nicht gespeichert.</span><button class="btn small" id="arLeave">Archiv verlassen</button>`;
  document.getElementById('arLeave').onclick = leaveArchive;
  document.body.classList.add('in-archive');
}
