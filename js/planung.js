/* ============================================================
   Pult. — Planung
   ------------------------------------------------------------
   Unterrichtsplanung je Kurs in zwei Ebenen:
   - Einheit  (data.units):       { id, courseId, title, from, to, body, created }
   - Stunde   (data.lessonPlans): { id, courseId, unitId|null, topic, body,
                                    date ('' = Entwurf), period (0-basiert),
                                    done, created }

   Eine zugeordnete Stunde hängt an einem konkreten Termin des Kurses
   (Datum + Unterrichtsstunde). Diese Termine („Slots") ergeben sich aus dem
   Stundenplan. Direkt aufeinanderfolgende Stunden desselben Kurses gelten
   als Doppelstunde mit einer gemeinsamen Planung — gespeichert wird dann
   die erste der beiden Stunden.

   Verschieben: ↑/↓ tauscht eine Stunde mit dem vorherigen bzw. nächsten
   Termin des Kurses (ist er frei, rückt sie einfach dorthin). ⇊ schiebt sie
   in den nächsten Termin, belegte Termine rücken mit — bis zur ersten freien
   Stunde.

   Drucken / Export (unten): Planung als A4-Seiten oder JSON-Datei, Import
   aus einer solchen Datei in einen beliebigen Kurs.

   body ist formatierter Text (ein kleiner HTML-Ausschnitt: Überschrift,
   fett, kursiv, Liste, Farbe). Er läuft beim Speichern und beim Anzeigen
   durch richSanitize.

   Wird vor pult.js geladen: hier stehen nur Definitionen.
   ============================================================ */
'use strict';

/* ============================================================
   Formatierter Text
   ============================================================ */
/* Farben des Editors. Die erste („Standard") setzt die normale Schriftfarbe
   des Themes (var(--ink)) — wichtig, um innerhalb farbigen Texts zurück-
   zuschalten. Der Browser kennt dafür keinen Befehl; gesetzt wird deshalb
   eine Platzhalterfarbe, die sofort durch var(--ink) ersetzt wird. */
const RT_NO_COLOR = '#010203';
const RT_INK = 'var(--ink)';
const RT_COLORS = [
  [RT_NO_COLOR, 'Standard'], ['#c0392b', 'Rot'], ['#c0762a', 'Orange'],
  ['#2f8a6b', 'Grün'], ['#2a6fb0', 'Blau'], ['#7a63bd', 'Violett'],
];
const RT_BLOCK = { P: 'p', DIV: 'div', H1: 'h3', H2: 'h3', H3: 'h3', H4: 'h4', H5: 'h4', H6: 'h4', UL: 'ul', OL: 'ol', LI: 'li', BLOCKQUOTE: 'div' };
const RT_INLINE = { B: 'b', STRONG: 'b', I: 'i', EM: 'i', U: 'u' };
const RT_DROP = new Set(['SCRIPT', 'STYLE', 'TEMPLATE', 'IFRAME', 'OBJECT', 'EMBED', 'SVG', 'MATH', 'NOSCRIPT', 'TITLE', 'META', 'LINK', 'HEAD']);

function rtHex(v) {
  v = String(v || '').trim().toLowerCase();
  let hex = '';
  if (/^#[0-9a-f]{6}$/.test(v)) hex = v;
  else if (/^#[0-9a-f]{3}$/.test(v)) hex = '#' + v.slice(1).split('').map(x => x + x).join('');
  else {
    const m = v.match(/^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})/);
    if (m) hex = '#' + m.slice(1, 4).map(x => Math.min(255, +x).toString(16).padStart(2, '0')).join('');
  }
  return hex;
}
function rtColor(v) {
  if (String(v || '').replace(/\s+/g, '').toLowerCase() === RT_INK) return RT_INK;
  const hex = rtHex(v);
  return hex === RT_NO_COLOR ? RT_INK : hex;
}
/* Platzhalterfarbe im Editor durch die Schriftfarbe des Themes ersetzen */
function rtFixDefaultColor(body) {
  body.querySelectorAll('[style], font[color]').forEach(n => {
    if (rtHex(n.style.color) === RT_NO_COLOR) n.style.color = RT_INK;
    if (n.tagName === 'FONT' && rtHex(n.getAttribute('color')) === RT_NO_COLOR) { n.removeAttribute('color'); n.style.color = RT_INK; }
  });
}
/* Erlaubt nur die Bausteine des Editors; alles andere wird zu reinem Text.
   Ein <template> wertet nichts aus (keine Skripte, keine Bilder). */
function richSanitize(html) {
  if (!html) return '';
  const tpl = document.createElement('template');
  tpl.innerHTML = String(html);
  const walk = node => {
    let out = '';
    node.childNodes.forEach(n => {
      if (n.nodeType === 3) { out += esc(n.nodeValue); return; }
      if (n.nodeType !== 1 || RT_DROP.has(n.tagName)) return;
      const tag = n.tagName;
      if (tag === 'BR') { out += '<br>'; return; }
      let inner = walk(n);
      const st = n.style || {};
      if (!RT_INLINE[tag]) {   // Safari formatiert teils per style statt per Tag
        if (st.fontWeight === 'bold' || Number(st.fontWeight) >= 600) inner = `<b>${inner}</b>`;
        if (st.fontStyle === 'italic') inner = `<i>${inner}</i>`;
      }
      const color = rtColor(tag === 'FONT' ? n.getAttribute('color') : st.color);
      if (color) inner = `<span style="color:${color}">${inner}</span>`;
      if (RT_BLOCK[tag]) out += `<${RT_BLOCK[tag]}>${inner}</${RT_BLOCK[tag]}>`;
      else if (RT_INLINE[tag]) out += `<${RT_INLINE[tag]}>${inner}</${RT_INLINE[tag]}>`;
      else out += inner;
    });
    return out;
  };
  return walk(tpl.content);
}
/* reiner Text (Suche, Vorschau) */
function richText(html) {
  if (!html) return '';
  const tpl = document.createElement('template');
  tpl.innerHTML = String(html).replace(/<(br|\/p|\/div|\/li|\/h3|\/h4)[^>]*>/gi, ' $&');
  return (tpl.content.textContent || '').replace(/\s+/g, ' ').trim();
}

/* Editor: Leiste + bearbeitbare Fläche. onChange(html) bei jeder Änderung. */
function richEditorHtml(id, html, placeholder) {
  const b = (cmd, label, title) => `<button type="button" class="rt-btn" data-cmd="${cmd}" title="${title}" aria-label="${title}">${label}</button>`;
  return `<div class="rt">
    <div class="rt-bar" role="toolbar" aria-label="Formatierung">
      ${b('h', 'Ü', 'Überschrift')}${b('bold', '<b>F</b>', 'Fett')}${b('italic', '<i>K</i>', 'Kursiv')}${b('ul', RT_LIST_SVG, 'Aufzählung')}
      <span class="rt-sep"></span>
      ${RT_COLORS.map(([c, n]) => `<button type="button" class="rt-col ${c === RT_NO_COLOR ? 'rt-col-none' : ''}" data-cmd="color" data-arg="${c}" title="${n}" aria-label="Farbe ${n}" style="--sw:${c === RT_NO_COLOR ? 'var(--ink)' : c}"></button>`).join('')}
    </div>
    <div class="rt-body" id="${id}" contenteditable="true" role="textbox" aria-multiline="true" data-ph="${esc(placeholder || '')}">${richSanitize(html)}</div>
  </div>`;
}
const RT_LIST_SVG = `<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M6 4h8M6 8h8M6 12h8"/><circle cx="2.6" cy="4" r=".9" fill="currentColor" stroke="none"/><circle cx="2.6" cy="8" r=".9" fill="currentColor" stroke="none"/><circle cx="2.6" cy="12" r=".9" fill="currentColor" stroke="none"/></svg>`;
function bindRichEditor(id, onChange) {
  const body = document.getElementById(id); if (!body) return;
  const root = body.closest('.rt');
  /* Nach „Standard" ohne Markierung färbt der Browser erst den nächsten
     getippten Text — deshalb bei jeder Eingabe nachziehen. */
  const changed = () => { rtFixDefaultColor(body); onChange(richSanitize(body.innerHTML)); };
  root.querySelectorAll('[data-cmd]').forEach(btn => {
    /* Knopf darf den Fokus nicht aus dem Text nehmen — sonst ist die Markierung weg */
    btn.addEventListener('mousedown', e => e.preventDefault());
    btn.addEventListener('pointerdown', e => e.preventDefault());
    btn.onclick = () => {
      if (document.activeElement !== body) body.focus();
      const cmd = btn.dataset.cmd;
      try { document.execCommand('styleWithCSS', false, cmd === 'color'); } catch (e) {}
      if (cmd === 'h') {
        const cur = String(document.queryCommandValue('formatBlock') || '').toLowerCase().replace(/[<>]/g, '');
        document.execCommand('formatBlock', false, cur === 'h3' ? '<div>' : '<h3>');
      } else if (cmd === 'bold' || cmd === 'italic') document.execCommand(cmd);
      else if (cmd === 'ul') document.execCommand('insertUnorderedList');
      else if (cmd === 'color') {
        document.execCommand('foreColor', false, btn.dataset.arg);
      }
      changed();
    };
  });
  body.addEventListener('input', changed);
  /* Einfügen nur als reiner Text — keine fremden Formate, Bilder oder Skripte */
  body.addEventListener('paste', e => {
    e.preventDefault();
    const text = (e.clipboardData && e.clipboardData.getData('text/plain')) || '';
    document.execCommand('insertText', false, text);
  });
}
/* Speichern gebündelt, damit Tippen nicht bei jedem Zeichen schreibt */
let planSaveTimer = null;
function planSaveSoon() { clearTimeout(planSaveTimer); planSaveTimer = setTimeout(save, 500); }

/* ============================================================
   Termine eines Kurses aus dem Stundenplan („Slots")
   ============================================================ */
function periodLabel(pi) { const p = (data.timetable.periods || [])[pi]; return (p && p.label) || `${pi + 1}.`; }
/* Slots ab einem Datum: [{ date, period, periods: [..], courseId }] */
function courseSlots(courseId, fromISO, maxSlots, maxDays) {
  const out = [];
  const periods = data.timetable.periods || [];
  if (!(data.timetable.lessons || []).some(l => l.courseId === courseId)) return out;
  const d = new Date((fromISO || todayISO()) + 'T00:00:00');
  const weekOf = new Map();   // A/B je Montag nur einmal berechnen
  for (let i = 0; i < (maxDays || 200) && out.length < maxSlots; i++, d.setDate(d.getDate() + 1)) {
    const wd = d.getDay(); if (wd < 1 || wd > 5) continue;
    const iso = dateToISO(d);
    if (freeDayOf(iso)) continue;                 // Ferien / freier Tag: kein Unterricht
    let week = 0;
    if (abActive()) {
      const mk = dateToISO(mondayOf(iso));
      if (!weekOf.has(mk)) weekOf.set(mk, abWeekOf(iso));
      week = weekOf.get(mk);
    }
    let cur = null;
    for (let pi = 0; pi < periods.length; pi++) {
      const l = lessonAt(wd, pi, week);
      if (l && !l.placeholder && l.courseId === courseId) {
        if (cur && cur.periods[cur.periods.length - 1] === pi - 1) cur.periods.push(pi);   // Doppelstunde
        else { cur = { date: iso, period: pi, periods: [pi], courseId }; out.push(cur); }
      } else cur = null;
    }
  }
  return out.slice(0, maxSlots);
}
/* nächste Termine ab jetzt — heutige, die schon vorbei sind, fallen weg */
function upcomingSlots(courseId, n) {
  const now = new Date(), today = todayISO();
  const hm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  return courseSlots(courseId, today, n + 4).filter(s => {
    if (s.date !== today) return true;
    const p = (data.timetable.periods || [])[s.periods[s.periods.length - 1]];
    return !p || !p.end || p.end > hm;
  }).slice(0, n);
}
function slotKey(s) { return `${s.date}|${s.period}`; }
/* Termin in zwei Teilen: „Mo, 16.11." und „1./2. Std." (Liste „Nächste Stunden") */
function slotDayLabel(s) {
  const d = new Date(s.date + 'T00:00:00');
  return `${WEEKDAYS[d.getDay()] || ''}, ${fmtDate(s.date)}`;
}
const slotPeriodLabel = s => `${(s.periods || [s.period]).map(periodLabel).join('/')} Std.`;
function slotLabel(s, long) {
  const d = new Date(s.date + 'T00:00:00');
  const day = (long ? WEEKDAYS_LONG : WEEKDAYS)[d.getDay()] || '';
  const per = (s.periods || [s.period]).map(periodLabel).join('/');
  return `${day}, ${long ? fmtDateLong(s.date) : fmtDate(s.date)} · ${per} Std.`;
}
/* Slot einer zugeordneten Stunde (mit Doppelstunde), sonst ein einfacher */
function planSlot(p) {
  if (!p || !p.date) return null;
  const s = courseSlots(p.courseId, p.date, 12, 1).find(x => x.periods.includes(p.period));
  return s || { date: p.date, period: p.period, periods: [p.period], courseId: p.courseId };
}
function planLabel(p, long) { return p && p.date ? slotLabel(planSlot(p), long) : 'Entwurf'; }

/* Stunde liegt auf einem freien Tag (z. B. später eingetragene Ferien) */
function planOffHtml(p, long) {
  const f = p && p.date && !p.done ? freeDayOf(p.date) : null;
  return f ? ` <span class="pl-off" title="An diesem Tag ist frei — die Stunde neu zuordnen">· fällt aus${long ? ` (${esc(f.label || 'frei')})` : ''}</span>` : '';
}

/* ---------- Zugriff ---------- */
const coursePlans = courseId => (data.lessonPlans || []).filter(p => p.courseId === courseId);
const courseUnits = courseId => (data.units || []).filter(u => u.courseId === courseId);
function getPlan(id) { return (data.lessonPlans || []).find(p => p.id === id); }
function getUnit(id) { return (data.units || []).find(u => u.id === id); }
/* Planungen in einem Slot (normal höchstens eine) */
function plansAtSlot(s) {
  return (data.lessonPlans || []).filter(p => p.courseId === s.courseId && p.date === s.date && s.periods.includes(p.period));
}
/* Planung, die in genau dieser Stunde beginnt (für das Symbol im Stundenplan) */
function planAt(courseId, date, period) {
  return (data.lessonPlans || []).find(p => p.courseId === courseId && p.date === date && p.period === period);
}
const planTitle = p => (p.topic || '').trim() || 'Ohne Thema';
/* zeitliche Reihenfolge: zugeordnete nach Termin, Entwürfe dahinter nach Anlage */
function planSort(a, b) {
  if (!!a.date !== !!b.date) return a.date ? -1 : 1;
  if (a.date) return a.date.localeCompare(b.date) || a.period - b.period;
  return (a.created || '').localeCompare(b.created || '');
}
function newPlan(courseId, fields) {
  const p = Object.assign({ id: uid(), courseId, unitId: null, topic: '', body: '', date: '', period: null, done: false, created: new Date().toISOString() }, fields || {});
  if (!Array.isArray(data.lessonPlans)) data.lessonPlans = [];
  data.lessonPlans.push(p);
  return p;
}

/* ---------- Nach hinten verschieben ---------- */
/* Die Stunde rückt in den nächsten Termin; was dort liegt, rückt mit — bis
   zur ersten freien Stunde. false, wenn es im Stundenplan keine freie gibt. */
/* Termine ab der Stunde; liegt sie auf einem freien Tag, steht davor ein
   gedachter Termin für sie — so rückt sie in die nächste echte Stunde. */
function slotsFromPlan(plan) {
  const slots = courseSlots(plan.courseId, plan.date, 400, 400);
  let idx = slots.findIndex(s => s.date === plan.date && s.periods.includes(plan.period));
  let virtual = false;
  if (idx < 0 && freeDayOf(plan.date)) {
    slots.unshift({ date: plan.date, period: plan.period, periods: [plan.period], courseId: plan.courseId });
    idx = 0; virtual = true;
  }
  return { slots, idx, virtual };
}
function shiftPlanBack(plan) {
  const { slots, idx } = slotsFromPlan(plan);
  if (idx < 0) return false;                    // die Stunde gibt es im Stundenplan nicht (mehr)
  const chain = [[plan]];
  let gap = false;
  for (let i = idx + 1; i < slots.length; i++) {
    const here = plansAtSlot(slots[i]);
    if (!here.length) { gap = true; break; }
    chain.push(here);
  }
  if (!gap) return false;
  for (let k = chain.length - 1; k >= 0; k--) {
    const target = slots[idx + k + 1];
    chain[k].forEach(p => { p.date = target.date; p.period = target.period; });
  }
  return true;
}
/* ---------- Mit dem Nachbartermin tauschen ---------- */
/* Termin der Stunde und der vorherige (dir < 0) bzw. nächste (dir > 0)
   Termin des Kurses; null, wenn die Stunde nicht im Stundenplan steht. */
function neighborSlots(plan, dir) {
  if (!plan.date) return null;
  let from = plan.date, days = 400;
  if (dir < 0) { const d = new Date(plan.date + 'T00:00:00'); d.setDate(d.getDate() - 180); from = dateToISO(d); days = 181; }
  const slots = courseSlots(plan.courseId, from, 2000, days);
  const idx = slots.findIndex(s => s.date === plan.date && s.periods.includes(plan.period));
  if (idx < 0) {
    /* auf einem freien Tag: ↓ führt in die nächste echte Stunde */
    if (dir > 0 && freeDayOf(plan.date)) {
      const f = slotsFromPlan(plan);
      return { cur: f.slots[0], target: f.slots[1] || null, virtual: true };
    }
    return null;
  }
  return { cur: slots[idx], target: slots[idx + (dir < 0 ? -1 : 1)] || null };
}
/* Termin ist schon vorbei (heute: seine letzte Stunde ist zu Ende) */
function slotPast(s) {
  const today = todayISO();
  if (s.date !== today) return s.date < today;
  const now = new Date();
  const hm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const p = (data.timetable.periods || [])[s.periods[s.periods.length - 1]];
  return !!(p && p.end && p.end <= hm);
}
function doSwapPlan(plan, dir, after) {
  const n = neighborSlots(plan, dir);
  if (!n) return toast(freeDayOf(plan.date) ? 'An diesem Tag ist frei — mit ↓ oder ⇊ in die nächste Stunde schieben.' : 'Verschieben nicht möglich — die Stunde steht nicht (mehr) im Stundenplan.');
  if (!n.target) return toast(dir < 0 ? 'Davor gibt es keine Stunde mehr.' : 'Danach gibt es keine Stunde mehr im Stundenplan.');
  if (dir < 0 && slotPast(n.target) && !slotPast(n.cur)) return toast('Die vorherige Stunde ist schon vorbei.');
  const others = plansAtSlot(n.target).filter(q => q.id !== plan.id);
  /* nicht in einen freien Tag hineintauschen */
  if (n.virtual && others.length) return toast(`Die nächste Stunde ist schon geplant — mit ⇊ einschieben.`);
  others.forEach(q => { q.date = n.cur.date; q.period = n.cur.period; });
  plan.date = n.target.date; plan.period = n.target.period;
  save();
  toast(others.length ? `Getauscht mit „${planTitle(others[0])}“.` : `Verschoben auf ${planLabel(plan)}.`);
  if (after) after();
}
/* Knöpfe ↑ ↓ ⇊ für eine zugeordnete Stunde */
/* stack: ↑ über ↓, ⇊ daneben (Liste „Nächste Stunden"); sonst nebeneinander */
function planMoveHtml(p, noUp, stack) {
  return `<span class="pl-move ${stack ? 'stack' : ''}">
    <button class="btn small" data-move-up="${p.id}" ${noUp ? 'disabled' : ''} title="Mit der vorherigen Stunde tauschen" aria-label="Mit der vorherigen Stunde tauschen">↑</button>
    <button class="btn small" data-move-down="${p.id}" title="Mit der nächsten Stunde tauschen" aria-label="Mit der nächsten Stunde tauschen">↓</button>
    <button class="btn small" data-shift="${p.id}" title="Diese und alle folgenden Stunden eine Stunde nach hinten schieben — bis zur nächsten freien" aria-label="Diese und alle folgenden nach hinten schieben">⇊</button>
  </span>`;
}
function bindPlanMove(root, after) {
  root.querySelectorAll('[data-move-up]').forEach(b => b.onclick = () => { const p = getPlan(b.dataset.moveUp); if (p) doSwapPlan(p, -1, after); });
  root.querySelectorAll('[data-move-down]').forEach(b => b.onclick = () => { const p = getPlan(b.dataset.moveDown); if (p) doSwapPlan(p, 1, after); });
  root.querySelectorAll('[data-shift]').forEach(b => b.onclick = () => { const p = getPlan(b.dataset.shift); if (p) doShiftBack(p, after); });
}

function doShiftBack(plan, after) {
  if (!plan.date) return;
  const n = (() => {   // wie viele rücken mit? (für die Meldung)
    const { slots, idx } = slotsFromPlan(plan);
    let k = 0; for (let i = idx + 1; i < slots.length && plansAtSlot(slots[i]).length; i++) k++;
    return k;
  })();
  if (!shiftPlanBack(plan)) return toast('Verschieben nicht möglich — die Stunde steht nicht (mehr) im Stundenplan.');
  save();
  toast(n ? `Verschoben — ${n} weitere ${n === 1 ? 'Stunde rückt' : 'Stunden rücken'} mit.` : `Verschoben auf ${planLabel(plan)}.`);
  if (after) after();
}

/* ---------- Zuordnung zu einem Termin ---------- */
/* Auswahl: Entwurf, die nächsten Termine des Kurses, ein anderes Datum */
function slotPickerHtml(c, plan) {
  const slots = upcomingSlots(c.id, 30);
  const cur = plan && plan.date ? `${plan.date}|${plan.period}` : '';
  const known = slots.some(s => slotKey(s) === cur);
  const opt = s => {
    const busy = plansAtSlot(s).filter(p => !plan || p.id !== plan.id);
    return `<option value="${slotKey(s)}" ${slotKey(s) === cur ? 'selected' : ''}>${esc(slotLabel(s))}${busy.length ? ` — belegt: ${esc(planTitle(busy[0]))}` : ''}</option>`;
  };
  const periods = data.timetable.periods || [];
  return `<select id="plSlot">
      <option value="" ${cur ? '' : 'selected'}>Entwurf — noch keiner Stunde zugeordnet</option>
      ${cur && !known ? `<option value="${cur}" selected>${esc(planLabel(plan))}</option>` : ''}
      ${slots.map(opt).join('')}
      <option value="__custom">Anderes Datum …</option>
    </select>
    <div class="row2" id="plCustom" style="display:none;margin-top:8px">
      <input id="plCDate" type="date" value="${todayISO()}">
      <select id="plCPer">${periods.map((p, i) => `<option value="${i}">${esc(p.label || (i + 1) + '.')} Std.${p.start ? ' · ' + p.start : ''}</option>`).join('')}</select>
    </div>
    ${slots.length ? '' : '<div class="hint">Der Kurs steht noch nicht im Stundenplan — wähle ein Datum über „Anderes Datum“.</div>'}`;
}
function bindSlotPicker() {
  const sel = document.getElementById('plSlot'); if (!sel) return;
  const box = document.getElementById('plCustom');
  const sync = () => { box.style.display = sel.value === '__custom' ? '' : 'none'; };
  sel.addEventListener('change', sync);
  sync();
}
/* gewählter Termin: { date, period } oder null (Entwurf) */
function readSlotPicker() {
  const v = val('plSlot');
  if (!v) return null;
  if (v === '__custom') {
    const date = val('plCDate');
    return date ? { date, period: parseInt(val('plCPer')) || 0 } : null;
  }
  const [date, per] = v.split('|');
  return { date, period: parseInt(per) || 0 };
}
/* Stunde einem Termin zuordnen. Ist er belegt, wird gefragt: einschieben
   (Folgende rücken bis zur nächsten Lücke nach hinten) oder ersetzen
   (die bisherige wird Entwurf). done() nach erfolgreicher Zuordnung. */
function assignPlan(plan, target, done) {
  if (!target) { plan.date = ''; plan.period = null; save(); return done && done(); }
  if (plan.date === target.date && plan.period === target.period) return done && done();
  const slot = courseSlots(plan.courseId, target.date, 12, 1).find(s => s.periods.includes(target.period))
    || { date: target.date, period: target.period, periods: [target.period], courseId: plan.courseId };
  const others = plansAtSlot(slot).filter(p => p.id !== plan.id);
  const put = () => { plan.date = slot.date; plan.period = slot.period; save(); if (done) done(); };
  if (!others.length) return put();
  const q = others[0];
  modal('Stunde ist schon geplant', `<p>Am <b>${esc(slotLabel(slot, true))}</b> ist bereits <b>„${esc(planTitle(q))}“</b> geplant.</p>
    <p class="cs-sub">Einschieben: „${esc(planTitle(q))}“ und die folgenden Stunden rücken je eine Stunde nach hinten — bis zur nächsten freien Stunde.</p>`, [
    { label: 'Abbrechen', onClick: () => { closeModal(); render(); } },
    { label: 'Ersetzen', onClick: () => { others.forEach(p => { p.date = ''; p.period = null; }); closeModal(); put(); toast(`„${planTitle(q)}“ ist jetzt ein Entwurf.`); } },
    { label: 'Einschieben', cls: 'primary', onClick: () => {
      plan.date = ''; plan.period = null;            // erst lösen, damit sie nicht selbst mitrückt
      if (!shiftPlanBack(q)) { closeModal(); render(); return toast('Einschieben nicht möglich — keine freie Stunde im Stundenplan gefunden.'); }
      closeModal(); put();
    }},
  ]);
}

/* ============================================================
   Seite „Planung" — Kurswahl, nächste Stunden, Einheiten
   ============================================================ */
function planungCourse() {
  let c = route.courseId ? getCourse(route.courseId) : null;
  if (!c) c = data.courses[0] || null;
  if (c) route.courseId = c.id;
  return c;
}
/* Aktuelle Einheit: die der nächsten geplanten offenen Stunde, sonst die,
   deren Zeitraum heute umfasst, sonst die erste mit offenen Stunden.
   '' = keine Einheit ist aktuell (dann gilt „Ohne Einheit"). */
function currentUnitId(units, plans) {
  const today = todayISO();
  const ids = new Set(units.map(u => u.id));
  const open = plans.filter(p => !p.done && ids.has(p.unitId));
  const next = open.filter(p => p.date && p.date >= today).sort(planSort)[0];
  if (next) return next.unitId;
  const inRange = units.filter(u => u.from && u.from <= today && (!u.to || u.to >= today)).pop();   // units nach Beginn sortiert
  if (inRange) return inRange.id;
  const first = units.find(u => open.some(p => p.unitId === u.id));
  return first ? first.id : '';
}
const plExpanded = new Set();   // per „Mehr anzeigen" aufgeklappte Einheiten (bleibt beim Neuzeichnen)

function renderPlanung() {
  const c = planungCourse();
  if (!c) {
    app().innerHTML = `<div class="page-head"><div><h1>Planung</h1></div></div>
      <div class="empty-state"><p>Noch keine Kurse. Lege zuerst einen Kurs an.</p><button class="btn primary" id="plNoCourse">+ Neuer Kurs</button></div>`;
    document.getElementById('plNoCourse').onclick = () => openCourseForm();
    return;
  }
  const chips = data.courses.map(k => {
    const col = courseColor(k.id);
    return `<button class="pl-course ${k.id === c.id ? 'active' : ''}" data-pc="${k.id}" style="--c-bar:${col.bar};--c-bg:${col.bg};--c-fg:${col.fg}">${esc(k.subject)} <span>${esc(k.className)}</span></button>`;
  }).join('');

  /* nächste Termine mit ihrer Planung */
  const next = upcomingSlots(c.id, 8);
  const slotRows = next.map((s, i) => {
    const p = plansAtSlot(s)[0];
    return `<div class="pl-slot ${p ? '' : 'free'}">
      <span class="pl-slot-when"><span>${esc(slotDayLabel(s))}</span><span>${esc(slotPeriodLabel(s))}</span></span>
      ${p ? `<button class="pl-slot-topic" data-open="${p.id}">${esc(planTitle(p))}${p.unitId && getUnit(p.unitId) ? `<small>${esc(getUnit(p.unitId).title)}</small>` : ''}</button>
             ${planMoveHtml(p, i === 0, true)}`
          : `<span class="pl-slot-topic cs-sub">noch nicht geplant</span>
             <button class="btn small" data-plan-slot="${slotKey(s)}">Planen</button>`}
    </div>`;
  }).join('');

  const units = sortedUnits(c.id);
  const plans = coursePlans(c.id);
  const loose = plans.filter(p => !p.unitId || !getUnit(p.unitId)).sort(planSort);
  const cur = currentUnitId(units, plans);
  const planRow = (p, extra) => `<div class="pl-row ${p.done ? 'done' : ''} ${extra ? 'pl-extra' : ''}">
      <button class="todo-check ${p.done ? 'on' : ''}" data-done="${p.id}" aria-label="${p.done ? 'nicht erledigt' : 'erledigt'}"></button>
      <button class="pl-row-main" data-open="${p.id}"><span class="pl-row-topic">${esc(planTitle(p))}</span>
        <span class="pl-row-when ${p.date ? '' : 'draft'}">${esc(planLabel(p))}${planOffHtml(p)}</span></button>
    </div>`;
  /* Stundenliste: in der aktuellen Einheit die offenen Stunden, alles andere
     hinter „Mehr anzeigen" */
  const rowsHtml = (list, current) => {
    if (!list.length) return '';
    const extra = p => !current || p.done;
    const shown = list.filter(p => !extra(p)).length;
    return `<div class="pl-rows ${shown ? '' : 'only-extra'}">${list.map(p => planRow(p, extra(p))).join('')}</div>
      ${shown < list.length ? `<button class="pl-more" data-more>Mehr anzeigen</button>` : ''}`;
  };
  const groupCls = (key, current) => `${current ? 'current' : ''} ${plExpanded.has(key) ? 'show-all' : ''}`;
  const unitCard = u => {
    const list = plans.filter(p => p.unitId === u.id).sort(planSort);
    const done = list.filter(p => p.done).length;
    const range = [u.from ? fmtDate(u.from) : '', u.to ? fmtDate(u.to) : ''].filter(Boolean).join(' – ');
    const desc = richText(u.body);
    return `<div class="pl-unit ${groupCls(u.id, u.id === cur)}" data-group="${u.id}">
      <div class="pl-unit-head">
        <button class="pl-unit-title" data-unit="${u.id}"><b>${esc(u.title || 'Einheit')}</b>
          <span>${[range, list.length ? `${done}/${list.length} erledigt` : 'noch keine Stunden'].filter(Boolean).join(' · ')}</span></button>
        <button class="btn small" data-add-unit="${u.id}">+ Stunde</button>
      </div>
      ${desc ? `<div class="pl-unit-desc">${esc(desc.length > 180 ? desc.slice(0, 180) + ' …' : desc)}</div>` : ''}
      ${rowsHtml(list, u.id === cur)}
    </div>`;
  };

  app().innerHTML = `
    <div class="page-head">
      <div><h1>Planung</h1><div class="sub">${esc(c.subject)} ${esc(c.className)}</div></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn small" id="plToCourse">Kurs</button>
        <button class="btn small" id="plTransfer">Drucken / Export</button>
        <button class="btn small" id="plNewUnit">+ Einheit</button>
        <button class="btn small primary" id="plNewPlan">+ Stunde</button>
      </div>
    </div>
    <div class="pl-courses">${chips}</div>

    <div class="pl-layout">
      <div class="calc-block">
        <h3>Nächste Stunden</h3>
        ${slotRows || `<div class="cs-sub">${esc(c.subject)} ${esc(c.className)} steht noch nicht im Stundenplan. Stunden lassen sich trotzdem planen — als Entwurf oder mit Datum.</div>`}
      </div>
      <div>
        ${units.map(unitCard).join('') || `<div class="notice">Noch keine Einheiten. Eine Einheit fasst mehrere Stunden zusammen, z. B. eine Unterrichtsreihe.</div>`}
        ${loose.length ? `<div class="pl-unit pl-loose ${groupCls('_loose', cur === '')}" data-group="_loose"><div class="pl-unit-head"><span class="pl-unit-title"><b>Ohne Einheit</b><span>${loose.length} ${loose.length === 1 ? 'Stunde' : 'Stunden'}</span></span></div>
          ${rowsHtml(loose, cur === '')}</div>` : ''}
      </div>
    </div>`;

  app().querySelectorAll('[data-pc]').forEach(b => b.onclick = () => go({ name: 'planung', courseId: b.dataset.pc }));
  document.getElementById('plToCourse').onclick = () => go({ name: 'kurs', courseId: c.id });
  document.getElementById('plTransfer').onclick = () => openPlanungTransfer(c);
  document.getElementById('plNewUnit').onclick = () => openUnitForm(c, null);
  document.getElementById('plNewPlan').onclick = () => openNewPlan(c, {});
  app().querySelectorAll('[data-open]').forEach(b => b.onclick = () => go({ name: 'plan', courseId: c.id, planId: b.dataset.open }));
  app().querySelectorAll('[data-unit]').forEach(b => b.onclick = () => openUnitForm(c, b.dataset.unit));
  app().querySelectorAll('[data-add-unit]').forEach(b => b.onclick = () => openNewPlan(c, { unitId: b.dataset.addUnit }));
  app().querySelectorAll('[data-plan-slot]').forEach(b => b.onclick = () => {
    const [date, per] = b.dataset.planSlot.split('|');
    openNewPlan(c, { date, period: +per });
  });
  app().querySelectorAll('[data-more]').forEach(b => {
    const card = b.closest('[data-group]'), key = card.dataset.group;
    const label = () => { b.textContent = card.classList.contains('show-all') ? 'Weniger anzeigen' : 'Mehr anzeigen'; };
    label();
    b.onclick = () => {
      const on = card.classList.toggle('show-all');
      if (on) plExpanded.add(key); else plExpanded.delete(key);
      label();
    };
  });
  bindPlanMove(app(), renderPlanung);
  app().querySelectorAll('[data-done]').forEach(b => b.onclick = () => {
    const p = getPlan(b.dataset.done); if (!p) return;
    p.done = !p.done; save(); renderPlanung();
  });
}

/* Neue Stunde: Thema, Einheit und Termin — danach geht es zur Ausarbeitung */
function openNewPlan(c, preset) {
  preset = preset || {};
  const units = courseUnits(c.id);
  const draft = { id: null, courseId: c.id, date: preset.date || '', period: preset.period != null ? preset.period : null };
  modal('Neue Stunde', `
    <div class="field"><label>Thema</label><input id="npTopic" type="text" placeholder="z. B. Einführung Steigung" maxlength="120"></div>
    <div class="field"><label>Einheit</label>
      <select id="npUnit"><option value="">Ohne Einheit</option>${units.map(u => `<option value="${u.id}" ${preset.unitId === u.id ? 'selected' : ''}>${esc(u.title)}</option>`).join('')}</select></div>
    <div class="field"><label>Stunde</label>${slotPickerHtml(c, draft.date ? draft : null)}</div>`, [
    { label: 'Abbrechen', onClick: closeModal },
    { label: 'Anlegen', cls: 'primary', onClick: () => {
      const p = newPlan(c.id, { topic: val('npTopic').trim(), unitId: val('npUnit') || null });
      assignPlan(p, readSlotPicker(), () => go({ name: 'plan', courseId: c.id, planId: p.id }));
    }},
  ]);
  bindSlotPicker();
  /* vorgewählter Termin, der nicht in der Liste steht (z. B. heute schon vorbei) */
  if (draft.date && val('plSlot') !== `${draft.date}|${draft.period}`) {
    document.getElementById('plSlot').value = '__custom';
    document.getElementById('plSlot').dispatchEvent(new Event('change'));
    document.getElementById('plCDate').value = draft.date;
    document.getElementById('plCPer').value = String(draft.period);
  }
  setTimeout(() => { const el = document.getElementById('npTopic'); if (el) el.focus(); }, 50);
}

/* ---------- Einheit anlegen / bearbeiten ----------
   onSaved(unit): statt neu zu zeichnen (z. B. gleich einer Stunde zuordnen) */
function openUnitForm(c, id, onSaved) {
  const u = id ? getUnit(id) : null;
  let body = u ? u.body || '' : '';
  modal(u ? 'Einheit bearbeiten' : 'Neue Einheit', `
    <div class="field"><label>Titel</label><input id="unTitle" type="text" value="${esc(u ? u.title : '')}" placeholder="z. B. Lineare Funktionen" maxlength="120"></div>
    <div class="row2">
      <div class="field"><label>Von (optional)</label><input id="unFrom" type="date" value="${u ? u.from || '' : ''}"></div>
      <div class="field"><label>Bis (optional)</label><input id="unTo" type="date" value="${u ? u.to || '' : ''}"></div>
    </div>
    <div class="field"><label>Ziele und Notizen</label>${richEditorHtml('unBody', body, 'Kompetenzen, Material, Ideen …')}</div>
    ${u ? `<div class="hint">Beim Löschen bleiben die Stunden erhalten — sie stehen dann unter „Ohne Einheit“.</div>` : ''}`, [
    ...(u ? [{ label: 'Löschen', cls: 'danger', onClick: () => {
      data.units = data.units.filter(x => x.id !== u.id);
      (data.lessonPlans || []).forEach(p => { if (p.unitId === u.id) p.unitId = null; });
      save(); closeModal(); render();
    }}] : []),
    { label: 'Abbrechen', onClick: closeModal },
    { label: 'Speichern', cls: 'primary', onClick: () => {
      const title = val('unTitle').trim();
      if (!title) return toast('Bitte einen Titel angeben.');
      const rec = u || { id: uid(), courseId: c.id, created: new Date().toISOString() };
      Object.assign(rec, { title, from: val('unFrom'), to: val('unTo'), body });
      if (!u) { if (!Array.isArray(data.units)) data.units = []; data.units.push(rec); }
      save(); closeModal();
      if (onSaved) onSaved(rec); else render();
    }},
  ]);
  bindRichEditor('unBody', html => { body = html; });
  setTimeout(() => { const el = document.getElementById('unTitle'); if (el && !u) el.focus(); }, 50);
}

/* ============================================================
   Seite einer Stunde — Thema, Einheit, Termin, Ausarbeitung
   Änderungen werden sofort gespeichert.
   ============================================================ */
function renderPlan() {
  const p = getPlan(route.planId);
  const c = p ? getCourse(p.courseId) : null;
  if (!p || !c) return go({ name: 'planung' });
  const units = courseUnits(c.id);
  app().innerHTML = `
    <div class="page-head">
      <div><h1 id="plH">${esc(planTitle(p))}</h1>
        <div class="sub">${esc(c.subject)} ${esc(c.className)} · ${esc(planLabel(p, true))}${planOffHtml(p, true)}</div></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        ${p.date ? planMoveHtml(p, (() => { const n = neighborSlots(p, -1); return !n || !n.target || (slotPast(n.target) && !slotPast(n.cur)); })()) : ''}
        <button class="btn small" id="plPrint">Drucken</button>
        <button class="btn small" id="plToList">Alle Planungen</button>
        <button class="btn small danger" id="plDel">Löschen</button>
      </div>
    </div>
    <div class="pl-edit">
      <div class="field"><label>Thema</label><input id="plTopic" type="text" value="${esc(p.topic || '')}" placeholder="Thema der Stunde" maxlength="120"></div>
      <div class="row2">
        <div class="field"><label>Einheit</label>
          <select id="plUnit"><option value="">Ohne Einheit</option>${units.map(u => `<option value="${u.id}" ${p.unitId === u.id ? 'selected' : ''}>${esc(u.title)}</option>`).join('')}<option value="__new">Neue Einheit …</option></select></div>
        <div class="field"><label>Stunde</label>${slotPickerHtml(c, p)}</div>
      </div>
      <label class="check-row"><input type="checkbox" id="plDone" ${p.done ? 'checked' : ''}><span>Erledigt</span></label>
      <div class="field" style="margin-top:8px"><label>Ablauf und Notizen</label>${richEditorHtml('plBody', p.body, 'Ziel, Ablauf, Material, Hausaufgabe …')}</div>
    </div>`;

  document.getElementById('plTopic').oninput = e => {
    p.topic = e.target.value;
    document.getElementById('plH').textContent = planTitle(p);
    planSaveSoon();
  };
  bindRichEditor('plBody', html => { p.body = html; planSaveSoon(); });
  document.getElementById('plDone').onchange = e => { p.done = e.target.checked; save(); };
  document.getElementById('plUnit').onchange = e => {
    if (e.target.value === '__new') {
      e.target.value = p.unitId || '';
      return openUnitForm(c, null, unit => { p.unitId = unit.id; save(); renderPlan(); });
    }
    p.unitId = e.target.value || null; save();
  };
  bindSlotPicker();
  const applySlot = () => assignPlan(p, readSlotPicker(), () => { toast(p.date ? `Zugeordnet: ${planLabel(p)}` : 'Jetzt ein Entwurf.'); renderPlan(); });
  document.getElementById('plSlot').addEventListener('change', () => { if (val('plSlot') !== '__custom') applySlot(); });
  ['plCDate', 'plCPer'].forEach(id => document.getElementById(id).addEventListener('change', applySlot));
  bindPlanMove(app().querySelector('.page-head'), renderPlan);
  document.getElementById('plPrint').onclick = () => { save(); printSinglePlan(p); };
  document.getElementById('plToList').onclick = () => go({ name: 'planung', courseId: c.id });
  document.getElementById('plDel').onclick = () => modal('Stunde löschen?', `<p><b>${esc(planTitle(p))}</b> (${esc(planLabel(p))}) wird gelöscht.</p>`, [
    { label: 'Abbrechen', onClick: closeModal },
    { label: 'Löschen', cls: 'danger', onClick: () => {
      data.lessonPlans = data.lessonPlans.filter(x => x.id !== p.id);
      save(); closeModal(); goBack();
    }},
  ]);
}
/* Symbol „Stunde planen" (Dokument mit +) im Stundenplan */
const PLAN_ADD_SVG = `<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" stroke-linecap="round"><path d="M9 14.4H3.6V1.6h5.6l3.2 3.2V8"/><path d="M9 1.6v3.4h3.4"/><path d="M5.6 7.4h3.6"/><path d="M12.4 10v4.8M10 12.4h4.8"/></svg>`;
/* Symbol „Planung vorhanden" im Stundenplan */
const PLAN_DOC_SVG = `<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" stroke-linecap="round"><path d="M3.6 1.6h5.6l3.2 3.2v9.6H3.6z"/><path d="M9 1.6v3.4h3.4"/><path d="M5.6 8h4.8M5.6 10.6h4.8"/></svg>`;

/* ============================================================
   Export, Import und Druck der Planung
   ------------------------------------------------------------
   Umfang: ganzer Kurs, eine Einheit oder „Ohne Einheit".
   JSON: { _format, app: 'Pult', type: 'planung', version: 1, exported,
           course: { id, subject, className }, units: [...], plans: [...] }
   _format beschreibt den Aufbau in Worten (JSON kennt keine Kommentare) —
   für Menschen und als Vorlage für ein LLM; der Import liest nur units und
   plans. Auch ohne Planung entsteht eine Datei (leere Vorlage).
   Die Datei enthält keine Schülerdaten. Beim Import entstehen neue
   Einheiten und Stunden im gewählten Kurs; Termine werden übernommen
   (belegte oder nicht im Stundenplan stehende werden zu Entwürfen) oder
   alles kommt als Entwurf.
   ============================================================ */
function sortedUnits(courseId) {
  return courseUnits(courseId).slice().sort((a, b) =>
    (a.from || '9999').localeCompare(b.from || '9999') || (a.created || '').localeCompare(b.created || ''));
}
/* Einheiten und Stunden eines Umfangs: 'all' | '_loose' | Einheiten-ID */
function planScopeData(c, scope) {
  const units = sortedUnits(c.id);
  const plans = coursePlans(c.id).slice().sort(planSort);
  const loose = plans.filter(p => !p.unitId || !getUnit(p.unitId));
  if (scope === '_loose') return { units: [], plans: loose, loose };
  const u = units.find(x => x.id === scope);
  if (u) return { units: [u], plans: plans.filter(p => p.unitId === u.id), loose: [] };
  return { units, plans, loose };
}
function planScopeLabel(c, scope) {
  if (scope === '_loose') return 'Ohne Einheit';
  const u = getUnit(scope);
  return u && u.courseId === c.id ? u.title || 'Einheit' : 'Ganzer Kurs';
}
function planScopeSelect(c, cur) {
  const units = sortedUnits(c.id);
  const hasLoose = coursePlans(c.id).some(p => !p.unitId || !getUnit(p.unitId));
  return `<select id="pxScope">
    <option value="all">Ganzer Kurs</option>
    ${units.map(u => `<option value="${u.id}" ${cur === u.id ? 'selected' : ''}>Einheit: ${esc(u.title || 'Einheit')}</option>`).join('')}
    ${hasLoose ? `<option value="_loose" ${cur === '_loose' ? 'selected' : ''}>Stunden ohne Einheit</option>` : ''}
  </select>`;
}
/* Beschreibung des Dateiaufbaus, steht in jeder Exportdatei */
function planungFormat() {
  const html = 'als HTML. Erlaubt: <p>, <div>, <h3>, <h4>, <ul>, <ol>, <li>, <b>, <i>, <u>, <br> und farbiger Text mit <span style="color:#…"> ('
    + RT_COLORS.filter(([c]) => c !== RT_NO_COLOR).map(([c, n]) => `${n} ${c}`).join(', ') + '). Alles andere wird beim Import zu reinem Text. "" = leer.';
  return {
    hinweis: 'Unterrichtsplanung aus Pult. Felder, die mit _ beginnen, sind nur Erklärung und werden beim Import ignoriert. '
      + 'Eingelesen werden nur "units" (Einheiten) und "plans" (Stunden); Pult. vergibt beim Import neue IDs. '
      + 'Import: Planung → Drucken / Export → Aus Datei importieren.',
    units: {
      id: 'Frei wählbarer Text, z. B. "u1". Stunden verweisen über "unitId" darauf.',
      title: 'Titel der Einheit, z. B. "Lineare Funktionen" (Pflicht, höchstens 120 Zeichen).',
      from: 'Beginn als "JJJJ-MM-TT" oder "".',
      to: 'Ende als "JJJJ-MM-TT" oder "".',
      body: 'Ziele und Notizen der Einheit ' + html,
      created: 'Optional: Zeitpunkt der Anlage (ISO, z. B. "2026-11-13T10:00:00.000Z"); bestimmt die Reihenfolge von Einheiten ohne Beginn und von Entwürfen.',
    },
    plans: {
      id: 'Optional, frei wählbar.',
      unitId: 'Die "id" einer Einheit aus "units" — oder null für eine Stunde ohne Einheit.',
      topic: 'Thema der Stunde (höchstens 120 Zeichen).',
      body: 'Ablauf und Notizen der Stunde ' + html,
      date: 'Termin als "JJJJ-MM-TT" — oder "" für einen Entwurf ohne Termin.',
      period: 'Unterrichtsstunde als Zahl: 0 = 1. Stunde, 1 = 2. Stunde usw.; bei einer Doppelstunde die erste. null bei einem Entwurf.',
      done: 'true = erledigt, sonst false.',
      created: 'Optional, wie bei units.',
    },
    beispiel: {
      units: [{ id: 'u1', title: 'Lineare Funktionen', from: '', to: '', body: '<p>Ziel: <b>Steigung</b> als Änderungsrate verstehen</p>' }],
      plans: [
        { unitId: 'u1', topic: 'Einführung Steigung', date: '', period: null, done: false,
          body: '<h3>Einstieg</h3><p>Treppen-Bilder vergleichen</p><h3>Erarbeitung</h3><ul><li>Steigungsdreieck</li><li>Übung S. 54/3</li></ul>' },
        { unitId: 'u1', topic: 'Übung', date: '', period: null, done: false, body: '' },
      ],
    },
  };
}
const planFileName = (c, scope) => `planung-${rasterSlug(c.subject)}-${rasterSlug(c.className)}${scope !== 'all' ? '-' + rasterSlug(planScopeLabel(c, scope)) : ''}`;

/* ---------- Menü ---------- */
function openPlanungTransfer(c, scope) {
  scope = scope || 'all';
  const item = (k, title, sub) => `<button class="btn menu-btn" data-k="${k}">${title}<small>${sub}</small></button>`;
  modal(`Planung — ${c.subject} ${c.className}`, `
    <div class="field"><label>Umfang (für Drucken und Export)</label>${planScopeSelect(c, scope)}</div>
    <div class="chip-list">
      ${item('print', 'Drucken / PDF', 'Einheiten und Stunden mit Ablauf und Notizen als A4-Seiten')}
      ${item('export', 'Als Datei exportieren (JSON)', 'Zum Sichern, Weitergeben oder für einen anderen Kurs')}
      ${item('import', 'Aus Datei importieren (JSON)', 'Einheiten und Stunden aus einer exportierten Planung übernehmen')}
    </div>
    <div class="hint" style="margin-top:12px">Tipp: Die leere Exportdatei kann als Vorlage für ein LLM benutzt werden, um geplante Stunden ins richtige Format zu bringen.
      <button class="px-link" id="pxTemplate">Leere Vorlage exportieren</button></div>
    <input type="file" id="pxFile" accept="application/json,.json" hidden>`, [{ label: 'Schließen', onClick: closeModal }]);
  document.getElementById('pxTemplate').onclick = () => exportPlanungTemplate(c);
  const file = document.getElementById('pxFile');
  file.onchange = () => { if (file.files[0]) readPlanungFile(file.files[0], c); };
  document.querySelectorAll('.modal-body [data-k]').forEach(b => b.onclick = () => {
    const sc = val('pxScope') || 'all';
    if (b.dataset.k === 'print') openPlanungPrintOpts(c, sc);
    else if (b.dataset.k === 'export') exportPlanung(c, sc);
    else file.click();
  });
}

/* ---------- Export ---------- */
function exportPlanung(c, scope) {
  const { units, plans } = planScopeData(c, scope);
  const empty = !units.length && !plans.length;
  const strip = x => { const o = Object.assign({}, x); delete o.courseId; return o; };
  const payload = {
    _format: planungFormat(),
    app: 'Pult', type: 'planung', version: 1, exported: new Date().toISOString(),
    course: { id: c.id, subject: c.subject, className: c.className },
    units: units.map(strip), plans: plans.map(strip),
  };
  closeModal();
  saveFile(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }), planFileName(c, scope) + (empty ? '-vorlage' : '') + '.json')
    .then(ok => { if (ok) toast(empty ? 'Leere Vorlage exportiert.' : `Exportiert: ${units.length} ${units.length === 1 ? 'Einheit' : 'Einheiten'}, ${plans.length} ${plans.length === 1 ? 'Stunde' : 'Stunden'}.`); });
}

/* leere Vorlage: nur Aufbau und Beispiel, keine Einheiten und Stunden */
function exportPlanungTemplate(c) {
  const payload = { _format: planungFormat(), app: 'Pult', type: 'planung', version: 1, exported: new Date().toISOString(),
    course: { id: c.id, subject: c.subject, className: c.className }, units: [], plans: [] };
  closeModal();
  saveFile(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }), `planung-vorlage-${rasterSlug(c.subject)}-${rasterSlug(c.className)}.json`)
    .then(ok => { if (ok) toast('Leere Vorlage exportiert.'); });
}

/* ---------- Import ---------- */
const PL_ISO = /^\d{4}-\d{2}-\d{2}$/;
function readPlanungFile(file, c) {
  file.text().then(txt => {
    let parsed;
    try { parsed = JSON.parse(txt); } catch (e) { parsed = null; }
    if (!parsed || (parsed.type && parsed.type !== 'planung') || !Array.isArray(parsed.plans) && !Array.isArray(parsed.units))
      return toast('Die Datei ist keine exportierte Planung.');
    parsed.units = Array.isArray(parsed.units) ? parsed.units.filter(u => u && typeof u === 'object') : [];
    parsed.plans = Array.isArray(parsed.plans) ? parsed.plans.filter(p => p && typeof p === 'object') : [];
    if (!parsed.units.length && !parsed.plans.length) return toast('Die Datei enthält keine Einheiten oder Stunden — „units“ und „plans“ sind leer.');
    confirmPlanungImport(parsed, c);
  }, () => toast('Die Datei konnte nicht gelesen werden.'));
}
function confirmPlanungImport(parsed, c) {
  const src = parsed.course || {};
  const nU = parsed.units.length, nP = parsed.plans.length;
  const dated = parsed.plans.filter(p => PL_ISO.test(p.date || '')).length;
  let mode = src.id && src.id === c.id && dated ? 'keep' : 'drafts';
  const from = [src.subject, src.className].filter(Boolean).join(' ');
  modal('Planung importieren', `
    <p>${nU} ${nU === 1 ? 'Einheit' : 'Einheiten'} und ${nP} ${nP === 1 ? 'Stunde' : 'Stunden'}${from ? ` aus <b>${esc(from)}</b>` : ''}${PL_ISO.test(String(parsed.exported || '').slice(0, 10)) ? `, exportiert am ${fmtDate(parsed.exported.slice(0, 10))}` : ''}.</p>
    <div class="field"><label>In Kurs</label><select id="piCourse">${data.courses.map(k => `<option value="${k.id}" ${k.id === c.id ? 'selected' : ''}>${esc(k.subject)} · ${esc(k.className)}</option>`).join('')}</select></div>
    ${dated ? `<div class="field"><label>Termine</label>${pdSeg('piMode', [['keep', 'Übernehmen'], ['drafts', 'Alles als Entwurf']], mode)}
      <div class="hint">„Übernehmen“: Stunden behalten Datum und Stunde; ist der Termin schon belegt oder hat der Kurs dann keinen Unterricht, wird die Stunde ein Entwurf. „Als Entwurf“ passt z. B. für ein neues Schuljahr.</div></div>` : ''}
    <div class="hint">Vorhandene Planungen bleiben unverändert; alles Importierte kommt dazu.</div>`, [
    { label: 'Abbrechen', onClick: closeModal },
    { label: 'Importieren', cls: 'primary', onClick: () => {
      const target = getCourse(val('piCourse')) || c;
      const r = importPlanung(parsed, target, dated && mode === 'keep');
      closeModal();
      go({ name: 'planung', courseId: target.id });
      toast(`Importiert: ${r.units} ${r.units === 1 ? 'Einheit' : 'Einheiten'}, ${r.plans} ${r.plans === 1 ? 'Stunde' : 'Stunden'}`
        + (r.clashed ? ` — ${r.clashed} als Entwurf (Termin belegt oder nicht im Stundenplan).` : '.'));
    }},
  ]);
  if (dated) pdBindSeg('piMode', v => mode = v);
}
function importPlanung(parsed, target, keepDates) {
  const str = (v, max) => String(v == null ? '' : v).slice(0, max);
  const now = new Date().toISOString();
  const idMap = new Map();
  if (!Array.isArray(data.units)) data.units = [];
  parsed.units.forEach(u => {
    const rec = {
      id: uid(), courseId: target.id, title: str(u.title, 120).trim() || 'Einheit',
      from: keepDates && PL_ISO.test(u.from || '') ? u.from : '', to: keepDates && PL_ISO.test(u.to || '') ? u.to : '',
      body: richSanitize(str(u.body, 200000)), created: PL_ISO.test(String(u.created || '').slice(0, 10)) ? String(u.created) : now,
    };
    if (u.id != null) idMap.set(String(u.id), rec.id);
    data.units.push(rec);
  });
  let clashed = 0;
  parsed.plans.forEach(p => {
    const fields = {
      topic: str(p.topic, 120), body: richSanitize(str(p.body, 200000)),
      unitId: p.unitId != null ? idMap.get(String(p.unitId)) || null : null,
      done: keepDates ? !!p.done : false,
      created: PL_ISO.test(String(p.created || '').slice(0, 10)) ? String(p.created) : now,
    };
    const per = Number(p.period);
    if (keepDates && PL_ISO.test(p.date || '') && Number.isInteger(per) && per >= 0) {
      /* nur Termine, an denen der Kurs laut Stundenplan Unterricht hat */
      const slot = courseSlots(target.id, p.date, 12, 1).find(s => s.periods.includes(per));
      if (!slot || plansAtSlot(slot).length) clashed++;
      else { fields.date = slot.date; fields.period = slot.period; }
    }
    newPlan(target.id, fields);
  });
  save();
  return { units: parsed.units.length, plans: parsed.plans.length, clashed };
}

/* ---------- Drucken ---------- */
function openPlanungPrintOpts(c, scope) {
  const o = pdOpts('planung', { body: true, unitDesc: true, done: true, drafts: true });
  modal('Planung drucken', `
    <div class="field"><label>Umfang</label>${planScopeSelect(c, scope)}</div>
    <div class="check-list">
      ${pdChk('body', 'Ablauf und Notizen', o.body, 'sonst nur Termine und Themen')}
      ${pdChk('unitDesc', 'Ziele und Notizen der Einheiten', o.unitDesc)}
      ${pdChk('done', 'Erledigte Stunden', o.done)}
      ${pdChk('drafts', 'Entwürfe (ohne Termin)', o.drafts)}
    </div>`, [
    { label: '‹ Zurück', onClick: () => openPlanungTransfer(c, val('pxScope')) },
    { label: 'Vorschau ›', cls: 'primary', onClick: () => {
      pdReadChecks(o); pdKeep('planung', o);
      const sc = val('pxScope') || 'all';
      closeModal();
      openPrintView({ title: `Planung — ${c.subject} ${c.className}`, landscape: false, css: PD_CSS + PL_PRINT_CSS, fit: PD_FIT,
        pages: [planPrintPage(c, sc, o)], filename: planFileName(c, sc) });
    }},
  ]);
}
/* eine einzelne Stunde (von ihrer Seite aus) */
function printSinglePlan(p) {
  const c = getCourse(p.courseId); if (!c) return;
  const u = p.unitId ? getUnit(p.unitId) : null;
  openPrintView({ title: `Stunde — ${planTitle(p)}`, landscape: false, css: PD_CSS + PL_PRINT_CSS, fit: PD_FIT,
    filename: `stunde-${rasterSlug(c.className)}-${rasterSlug(planTitle(p))}`,
    pages: [`<section class="pp-sheet pd">
      ${pdHead(`${pdCourseSub(c)}${u ? ' · ' + esc(u.title) : ''}`, esc(planTitle(p)), esc(planLabel(p, true)) + (p.done ? '<br>erledigt' : ''))}
      <table class="pd-t pd-plan pd-plan-solo" data-split="0"><tbody>${planBodyRows(p.body) || '<tr><td class="pd-dim">Noch kein Ablauf notiert.</td></tr>'}</tbody></table>
      ${pdFoot()}
    </section>`] });
}
/* Ausarbeitung für den Druck: Schriftfarbe des Themes wird Schwarz */
const planPrintHtml = html => richSanitize(html).replace(/color:\s*var\(--ink\)/g, 'color:inherit');
/* Ausarbeitung in Tabellenzeilen je Absatz — so kann sie über Seiten umbrechen */
function planBodyRows(html) {
  const tpl = document.createElement('template');
  tpl.innerHTML = planPrintHtml(html);
  const rows = [];
  let inline = '';
  const flush = () => { if (inline.replace(/<br>/g, '').trim()) rows.push(inline); inline = ''; };
  tpl.content.childNodes.forEach(n => {
    if (n.nodeType === 1 && /^(P|DIV|H3|H4|UL|OL)$/.test(n.tagName)) { flush(); rows.push(n.outerHTML); }
    else inline += n.nodeType === 1 ? n.outerHTML : esc(n.nodeValue || '');
  });
  flush();
  return rows.map(r => `<tr><td class="pl-p-body">${r}</td></tr>`).join('');
}
function planPrintPage(c, scope, o) {
  const { units, plans, loose } = planScopeData(c, scope);
  const keep = p => (o.done || !p.done) && (o.drafts || p.date);
  const row = p => `<tr class="${p.done ? 'pl-p-done' : ''}">
      <td class="pl-p-when">${p.date ? esc(planLabel(p)) : '<span class="pd-dim">Entwurf</span>'}</td>
      <td><div class="pl-p-topic">${esc(planTitle(p))}</div>${o.body && p.body ? `<div class="pl-p-body">${planPrintHtml(p.body)}</div>` : ''}</td>
    </tr>`;
  const group = (title, meta, desc, list) => `<tr class="pl-p-unit"><td colspan="2">${title}${meta ? `<small>${meta}</small>` : ''}
      ${desc ? `<div class="pl-p-udesc pl-p-body">${desc}</div>` : ''}</td></tr>
    ${list.length ? list.map(row).join('') : '<tr><td colspan="2" class="pd-dim">Keine Stunden.</td></tr>'}`;
  let count = 0;
  const groups = units.map(u => {
    const list = plans.filter(p => p.unitId === u.id && keep(p));
    count += list.length;
    const range = [u.from ? fmtDate(u.from) : '', u.to ? fmtDate(u.to) : ''].filter(Boolean).join(' – ');
    return group(esc(u.title || 'Einheit'), range, o.unitDesc && u.body ? planPrintHtml(u.body) : '', list);
  });
  const looseList = loose.filter(keep);
  if (looseList.length) { count += looseList.length; groups.push(group('Ohne Einheit', '', '', looseList)); }
  return `<section class="pp-sheet pd">
    ${pdHead(pdCourseSub(c), scope === 'all' ? 'Unterrichtsplanung' : esc(planScopeLabel(c, scope)), `${count} ${count === 1 ? 'Stunde' : 'Stunden'}`)}
    <table class="pd-t pd-plan" data-split="0">
      <thead><tr><th class="pl-p-when">Termin</th><th>Thema · Ablauf und Notizen</th></tr></thead>
      <tbody>${groups.join('') || '<tr><td colspan="2" class="pd-dim">Noch nichts geplant.</td></tr>'}</tbody>
    </table>
    ${pdFoot()}
  </section>`;
}
const PL_PRINT_CSS = `
table.pd-plan th, table.pd-plan td { text-align: left; vertical-align: top; }
table.pd-plan .pl-p-when { white-space: nowrap; width: 1%; font-size: 7.4pt; }
table.pd-plan tr.pl-p-unit td { background: #e2efec; font-weight: 700; font-size: 9pt; }
table.pd-plan tr.pl-p-unit small { font-weight: 500; color: #555; font-size: 7.4pt; margin-left: 2mm; }
.pl-p-udesc { font-weight: 400; font-size: 7.6pt; margin-top: 0.8mm; }
.pl-p-topic { font-weight: 700; font-size: 8.6pt; }
tr.pl-p-done .pl-p-topic::after { content: ' ✓'; color: #2f8a6b; }
.pl-p-body { margin-top: 0.6mm; }
.pl-p-body h3, .pl-p-body h4 { font-size: 8.6pt; margin: 1.2mm 0 0.4mm; }
.pl-p-body ul, .pl-p-body ol { margin: 0.4mm 0; padding-left: 4.5mm; }
.pl-p-body p { margin: 0; }
table.pd-plan-solo td { border: none; padding: 0.4mm 0; font-size: 9pt; }
table.pd-plan-solo h3, table.pd-plan-solo h4 { font-size: 10pt; }
`;
