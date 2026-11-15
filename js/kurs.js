/* ============================================================
   Pult. — Kurse (Übersicht und Kurs-Dashboard)
   ------------------------------------------------------------
   „Kurse" zeigt je Kurs das Wichtigste auf einen Blick; ein Kurs öffnet
   sein Dashboard: nächste und letzte Stunde mit Planung, Noten (Schnitt,
   Notenspiegel, grobe Entwicklung), Todos, Termine,
   Kursnotizen, Einsammel-Listen und Hausaufgaben — dazu die Wege zu
   Noten, Planung, Sitzplan und Schüler:innen. Die Karten setzen sich als
   Mosaik zusammen: gleich breit, in der Höhe so groß wie ihr Inhalt.

   Die Notentabelle selbst liegt unter „Noten" (route 'courses' / 'course').

   Wird vor pult.js geladen: hier stehen nur Definitionen.
   ============================================================ */
'use strict';

/* ---------- Übersicht ---------- */
function renderKurse() {
  const studCount = data.courses.reduce((a, c) => a + c.students.length, 0);
  const cards = data.courses.map(c => {
    const col = courseColor(c.id);
    const m = courseMean(c), gc = gradeColor(m);
    const todos = (data.todos || []).filter(t => !t.done && t.courseId === c.id).length;
    const termine = upcomingTermine().filter(t => t.courseId === c.id).length;
    const foot = [todos ? `${todos} ${todos === 1 ? 'Todo' : 'Todos'}` : '', termine ? `${termine} ${termine === 1 ? 'Termin' : 'Termine'}` : ''].filter(Boolean).join(' · ');
    return `<div class="course-card kc" data-kurs="${c.id}" style="--c-bar:${col.bar}">
      <div class="cc-top">
        <div class="kc-head"><div><div class="cc-subject">${esc(c.subject)}</div><div class="cc-class">${esc(c.className)}</div></div>
          <span class="cc-tag" style="background:${m == null ? 'var(--accent-soft)' : gc.bg};color:${m == null ? 'var(--accent-ink)' : gc.fg}">Ø ${fmtGrade(m, c.scale, true)}</span></div>
      </div>
      <div class="cc-foot"><span>${c.students.filter(studentActive).length} Schüler:innen</span><span>${foot}</span></div>
    </div>`;
  }).join('');
  app().innerHTML = `
    ${updateBannerHtml()}
    <div class="page-head">
      <div><h1>Kurse</h1><div class="sub">${data.courses.length} Kurse · ${studCount} Schüler:innen insgesamt</div></div>
      <button class="btn primary" id="kuNew">+ Neuer Kurs</button>
    </div>
    <div class="course-grid">${cards || '<div class="empty-state" style="grid-column:1/-1"><p>Noch keine Kurse. Lege deinen ersten Kurs an.</p></div>'}</div>`;
  bindUpdateBanner();
  document.getElementById('kuNew').onclick = () => openCourseForm();
  app().querySelectorAll('[data-kurs]').forEach(el => el.onclick = () => go({ name: 'kurs', courseId: el.dataset.kurs }));
}

/* ---------- Noten-Kennzahlen für das Dashboard ---------- */
/* Kursschnitt je Leistung, zeitlich — nur Leistungen, die einen guten Teil
   der Klasse betreffen (einzelne Referate verzerren sonst den Verlauf). */
function courseGradeSeries(c) {
  const act = c.students.filter(studentActive);
  const pts = [];
  ['1', '2'].forEach(h => c.halfYears[h].columns.forEach((col, idx) => {
    if (col.type === 'zwischenstand' || col.noCount) return;
    const vals = act.map(s => (data.grades[s.id] || {})[col.id]).filter(v => v != null && !isNaN(v));
    if (vals.length < Math.max(2, Math.ceil(act.length * 0.3))) return;
    pts.push({ hy: h, idx, date: col.date || '', label: col.label, type: col.type, v: vals.reduce((a, b) => a + b, 0) / vals.length });
  }));
  return pts.sort((a, b) => a.hy.localeCompare(b.hy) || (a.date && b.date ? a.date.localeCompare(b.date) : a.idx - b.idx));
}
function courseSeriesSvg(c, pts) {
  const W = 320, H = 96, pl = 26, pr = 6, pt = 6, pb = 14, n = pts.length;
  const x = i => pl + (n === 1 ? (W - pl - pr) / 2 : i * (W - pl - pr) / (n - 1));
  const y = v => pt + (15 - v) / 15 * (H - pt - pb);
  const grid = [15, 10, 5, 0].map(v => `<line x1="${pl}" x2="${W - pr}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}" stroke="var(--line-soft)"/>
    <text x="${pl - 4}" y="${(y(v) + 3).toFixed(1)}" font-size="8" text-anchor="end" fill="var(--ink-faint)">${fmtGrade(v, c.scale, false)}</text>`).join('');
  const b = pts.findIndex(p => p.hy === '2');
  const bound = b > 0 ? `<line x1="${((x(b) + x(b - 1)) / 2).toFixed(1)}" x2="${((x(b) + x(b - 1)) / 2).toFixed(1)}" y1="${pt}" y2="${H - pb}" stroke="var(--line)" stroke-dasharray="3 3"/>` : '';
  const line = n > 1 ? `<polyline points="${pts.map((p, i) => `${x(i).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ')}" fill="none" stroke="var(--accent)" stroke-width="1.4" opacity=".55"/>` : '';
  const dots = pts.map((p, i) => `<circle cx="${x(i).toFixed(1)}" cy="${y(p.v).toFixed(1)}" r="3.4" fill="${catColor(p.type)}"><title>${esc(p.label)}${p.date ? ' (' + fmtDate(p.date) + ')' : ''}: Ø ${fmtGrade(p.v, c.scale, true)}</title></circle>`).join('');
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" preserveAspectRatio="xMidYMid meet" style="display:block">${grid}${bound}${line}${dots}</svg>`;
}
/* Notenspiegel 1–6 der aktuellen Noten */
function courseSpiegelHtml(c, vals) {
  const buckets = [0, 0, 0, 0, 0, 0];
  vals.forEach(v => buckets[noteFromPoints(v) - 1]++);
  const max = Math.max(1, ...buckets);
  const pts = [14, 11, 8, 5, 2, 0];   // Farbe je Note
  return `<div class="kd-spiegel">${buckets.map((n, i) => {
    const gc = gradeColor(pts[i]);
    return `<div class="kd-sp-col" title="Note ${i + 1}: ${n}"><span class="kd-sp-n">${n || ''}</span>
      <i style="height:${Math.round(n / max * 100)}%;background:${gc.bg === 'transparent' ? 'var(--line)' : gc.bg}"></i><span class="kd-sp-l">${i + 1}</span></div>`;
  }).join('')}</div>`;
}

/* ---------- Dashboard eines Kurses ---------- */
/* Symbole für die Werkzeug-Leiste im Kurs-Dashboard (Stil wie SEAT_ICON) */
const KD_SVG_OPEN = '<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">';
const KD_GROUPS_SVG = `${KD_SVG_OPEN}<circle cx="4" cy="4.5" r="1.8"/><circle cx="12" cy="4.5" r="1.8"/><circle cx="8" cy="11" r="1.8"/>
  <path d="M1.2 9.2c.5-1.3 1.5-2 2.8-2s2.3.7 2.8 2M9.2 9.2c.5-1.3 1.5-2 2.8-2s2.3.7 2.8 2"/></svg>`;
const KD_PICK_SVG = `${KD_SVG_OPEN}<circle cx="8" cy="8" r="6.4"/><path d="M6.2 6.3a1.9 1.9 0 1 1 2.6 1.8c-.5.2-.8.6-.8 1.1v.4"/><path d="M8 11.6v.1"/></svg>`;
const KD_TIMER_SVG = `${KD_SVG_OPEN}<circle cx="8" cy="9.2" r="5.4"/><path d="M8 9.2V6.4M6.4 1.4h3.2M8 1.4v2.4M12.4 4.3l1-1"/></svg>`;

function renderKurs() {
  const c = getCourse(route.courseId);
  if (!c) return go({ name: 'kurse' });
  const scale = c.scale;
  const act = c.students.filter(studentActive);
  const hyNow = defaultHalfYear(c);
  const toNoten = () => go({ name: 'course', courseId: c.id, hy: defaultHalfYear(c), view: route.view || 'simpel' });

  /* Unterricht: nächste Stunden und die letzte geplante */
  const noPlan = planningHidden();
  const next = upcomingSlots(c.id, 3);
  const today = todayISO();
  const past = noPlan ? [] : coursePlans(c.id).filter(p => p.date && p.date < today).sort(planSort).reverse();
  const last = past[0];
  const slotLine = (s, first) => {
    const p = noPlan ? null : plansAtSlot(s)[0];
    return `<div class="kd-slot ${first ? 'first' : ''}">
      <span class="kd-slot-when">${esc(slotLabel(s))}</span>
      ${noPlan ? '' : p ? `<button class="kd-link" data-open-plan="${p.id}">${esc(planTitle(p))}</button>`
          : `<button class="btn small" data-plan-slot="${slotKey(s)}">Planen</button>`}
    </div>`;
  };
  const unterricht = `
    ${next.length ? next.map((s, i) => slotLine(s, i === 0)).join('') : '<div class="cs-sub">Der Kurs steht noch nicht im Stundenplan.</div>'}
    ${last ? `<div class="kd-last"><span class="cs-sub">Zuletzt · ${esc(planLabel(last))}</span>
      <div class="pl-row ${last.done ? 'done' : ''}"><button class="todo-check ${last.done ? 'on' : ''}" data-done="${last.id}" aria-label="erledigt"></button>
      <button class="pl-row-main" data-open-plan="${last.id}"><span class="pl-row-topic">${esc(planTitle(last))}</span></button></div></div>` : ''}`;

  /* Noten */
  const vals = act.map(s => currentGrade(c, s.id)).filter(v => v != null);
  const mean = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  const mc = gradeColor(mean);
  const series = courseGradeSeries(c);
  const blind = act.filter(s => blindSpot(c, hyNow, s.id)).length;
  const noten = `
    <div class="kd-mean">
      <span class="sd-chip" style="background:${mc.bg};color:${mc.fg === 'var(--line)' ? 'var(--ink-faint)' : mc.fg}">${fmtGrade(mean, scale, true)}</span>
      <span class="cs-sub">Kursschnitt${mean != null && scale !== 'noten' ? ' · ' + noteLabel(mean) : ''}<br>${vals.length} von ${act.length} mit Note</span>
    </div>
    ${vals.length ? courseSpiegelHtml(c, vals) : ''}
    ${series.length >= 2 ? `<div class="kd-sub">Kursschnitt je Leistung</div>${courseSeriesSvg(c, series)}` : ''}
    ${blind ? `<div class="cs-sub" style="margin-top:6px"><span class="blind-dot"></span> ${blind} ohne aktuelle mündliche Note</div>` : ''}`;

  /* Todos, Termine, Notizen, Listen */
  const todos = (data.todos || []).filter(t => !t.done && t.courseId === c.id)
    .sort((a, b) => (a.due || '9999').localeCompare(b.due || '9999'));
  const todoHtml = todos.slice(0, 6).map(t => {
    const over = t.due && t.due < today;
    return `<div class="todo kd-todo"><button class="todo-check" data-todo="${t.id}" aria-label="erledigt"></button>
      <div class="todo-main"><span class="todo-text">${esc(t.text)}</span>${t.due ? `<span class="todo-meta ${over ? 'over' : ''}">${over ? 'überfällig' : 'fällig'} ${fmtDate(t.due)}</span>` : ''}</div></div>`;
  }).join('');
  const termine = upcomingTermine().filter(t => t.courseId === c.id).slice(0, 4);
  const notes = courseNotes(c, null).filter(n => !n.hidden).slice(0, 3);
  const lists = (data.lists || []).filter(l => l.courseId === c.id).map(l => {
    const done = act.filter(s => ['abgegeben', 'befreit'].includes((l.status || {})[s.id])).length;
    return { l, done, open: act.length - done };
  }).filter(x => x.open > 0);
  const ha = act.reduce((a, s) => { const h = haCounts(c, s.id); a.g += h.gemacht; a.n += h.nicht; return a; }, { g: 0, n: 0 });
  const haQuote = ha.g + ha.n ? Math.round(ha.g / (ha.g + ha.n) * 100) : null;
  const units = noPlan ? [] : courseUnits(c.id);
  const curUnit = !noPlan && next.length ? (plansAtSlot(next[0])[0] || {}).unitId : null;

  const card = (title, body, link) => `<div class="calc-block kd-card"><div class="kd-card-h"><h3>${title}</h3>${link || ''}</div>${body}</div>`;
  const linkBtn = (id, label) => `<button class="kd-more" id="${id}">${label} ›</button>`;

  app().innerHTML = `
    <div class="page-head">
      <div><h1>${esc(c.subject)} <span style="color:var(--ink-faint);font-weight:600">${esc(c.className)}</span></h1>
        <div class="sub">${act.length} Schüler:innen · ${scaleName(scale)}${curUnit && getUnit(curUnit) ? ' · Einheit: ' + esc(getUnit(curUnit).title) : ''}</div></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn small primary" id="kdNoten">Noten</button>
        ${noPlan ? '' : '<button class="btn small" id="kdPlanung">Planung</button>'}
        <button class="btn small" id="kdSeat">${SEAT_ICON} Sitzplan</button>
        <button class="btn small" id="kdStudents">Schüler:innen</button>
        <button class="btn small" id="kdEdit">Kurs bearbeiten</button>
      </div>
    </div>
    <div class="kd-tools">
      <button class="btn" id="kdGroups">${KD_GROUPS_SVG}<span>Gruppen bilden</span></button>
      <button class="btn" id="kdPick">${KD_PICK_SVG}<span>Wer ist dran?</span></button>
      <button class="btn" id="kdTimer">${KD_TIMER_SVG}<span>Timer</span></button>
    </div>
    <div class="kd-grid">
      ${card('Unterricht', unterricht + (units.length ? `<div class="cs-sub" style="margin-top:8px">${units.length} ${units.length === 1 ? 'Einheit' : 'Einheiten'} geplant</div>` : ''), noPlan ? '' : linkBtn('kdToPlan', 'Planung'))}
      ${card('Noten', noten, linkBtn('kdToNoten', 'Notentabelle'))}
      ${card('Todos', `${todoHtml || '<div class="cs-sub">Keine offenen Todos.</div>'}
        <div class="kd-add"><input id="kdTodoText" type="text" placeholder="Neues Todo … (Enter)"><button class="btn small" id="kdTodoAdd">+</button></div>`,
        linkBtn('kdToTodos', 'Alle'))}
      ${card('Termine', termine.map(t => `<button class="kd-row" data-termin="${t.id}"><b>${esc(t.title)}</b><span>${esc(fmtTerminWhen(t))}</span></button>`).join('')
        || '<div class="cs-sub">Keine anstehenden Termine.</div>', `<button class="kd-more" id="kdTerminAdd">+ Termin</button>`)}
      ${card('Notizen', notes.map(n => `<div class="kd-note note-item"><button class="note-main" data-note-toggle aria-expanded="false">
          <span class="cs-sub">${n.date ? fmtDate(n.date) : '–'}</span><span class="note-text">${esc(n.text)}</span></button></div>`).join('')
        || '<div class="cs-sub">Noch keine Kursnotizen.</div>', linkBtn('kdNotes', 'Öffnen'))}
      ${card('Einsammeln & Hausaufgaben', `${lists.map(x => `<button class="kd-row" data-list="${x.l.id}"><b>${esc(x.l.title)}</b><span>${x.done}/${act.length} abgegeben${x.l.dueDate ? ' · bis ' + fmtDate(x.l.dueDate) : ''}</span></button>`).join('')
        || '<div class="cs-sub">Keine offenen Listen.</div>'}
        <div class="cs-sub" style="margin-top:8px">Hausaufgaben: ${haQuote == null ? 'noch nichts erfasst' : `${haQuote} % gemacht (${ha.n}× fehlend)`}</div>`, linkBtn('kdLists', 'Listen'))}
    </div>`;

  /* Ereignisse */
  document.getElementById('kdNoten').onclick = toNoten;
  document.getElementById('kdToNoten').onclick = toNoten;
  if (!noPlan) {
    document.getElementById('kdPlanung').onclick = () => go({ name: 'planung', courseId: c.id });
    document.getElementById('kdToPlan').onclick = () => go({ name: 'planung', courseId: c.id });
  }
  document.getElementById('kdSeat').onclick = () => { seatPending = null; go({ name: 'seating', courseId: c.id, seatMode: initialSeatMode(c) }); };
  document.getElementById('kdStudents').onclick = () => openStudents(c, null);
  document.getElementById('kdEdit').onclick = () => openCourseForm(c);
  document.getElementById('kdGroups').onclick = () => { groupMove = null; go({ name: 'gruppen', courseId: c.id }); };
  document.getElementById('kdPick').onclick = () => openPicker(c);
  document.getElementById('kdTimer').onclick = () => openTimer();
  document.getElementById('kdToTodos').onclick = () => go({ name: 'todos' });
  document.getElementById('kdNotes').onclick = () => openNotes(c, null);
  bindNoteToggles(app());
  document.getElementById('kdLists').onclick = () => openLists(c);
  app().querySelectorAll('[data-list]').forEach(b => b.onclick = () => openList(c, b.dataset.list));
  document.getElementById('kdTerminAdd').onclick = () => openTerminForm(null, { courseId: c.id });
  app().querySelectorAll('[data-termin]').forEach(b => b.onclick = () => openTerminForm(b.dataset.termin));
  app().querySelectorAll('[data-open-plan]').forEach(b => b.onclick = () => go({ name: 'plan', courseId: c.id, planId: b.dataset.openPlan }));
  app().querySelectorAll('[data-plan-slot]').forEach(b => b.onclick = () => {
    const [date, per] = b.dataset.planSlot.split('|');
    openNewPlan(c, { date, period: +per });
  });
  app().querySelectorAll('[data-done]').forEach(b => b.onclick = () => { const p = getPlan(b.dataset.done); if (p) { p.done = !p.done; save(); renderKurs(); } });
  app().querySelectorAll('[data-todo]').forEach(b => b.onclick = () => {
    const t = data.todos.find(x => x.id === b.dataset.todo); if (!t) return;
    t.done = true; save(); renderTopNav(); renderKurs();
    toast('Erledigt.', { label: 'Rückgängig', fn: () => { t.done = false; save(); render(); } });
  });
  const addTodo = () => {
    const text = val('kdTodoText').trim(); if (!text) return;
    data.todos.push({ id: uid(), text, done: false, created: todayISO(), due: '', courseId: c.id });
    save(); renderTopNav(); renderKurs();
    setTimeout(() => { const el = document.getElementById('kdTodoText'); if (el) el.focus(); }, 30);
  };
  document.getElementById('kdTodoAdd').onclick = addTodo;
  document.getElementById('kdTodoText').addEventListener('keydown', e => { if (e.key === 'Enter') addTodo(); });
  mosaic(app().querySelector('.kd-grid'));
}

/* Mosaik: das Raster hat feine Zeilen (MOSAIC_ROW px); jede Karte belegt so
   viele, wie ihre Höhe braucht. Ändert sich eine Höhe (Breite des Fensters,
   Schriften), wird nachgezogen. */
const MOSAIC_ROW = 4, MOSAIC_GAP = 14;
let mosaicObserver = null;
function mosaic(grid) {
  if (mosaicObserver) { mosaicObserver.disconnect(); mosaicObserver = null; }
  if (!grid) return;
  const fit = card => { card.style.gridRowEnd = `span ${Math.max(1, Math.ceil((card.getBoundingClientRect().height + MOSAIC_GAP) / MOSAIC_ROW))}`; };
  const cards = [...grid.children];
  cards.forEach(fit);
  if (typeof ResizeObserver === 'function') {
    mosaicObserver = new ResizeObserver(entries => entries.forEach(e => fit(e.target)));
    cards.forEach(card => mosaicObserver.observe(card));
  }
}
