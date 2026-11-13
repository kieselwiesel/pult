/* ============================================================
   Pult. — Einstellungen
   ------------------------------------------------------------
   Eine Seite mit Unterseiten (route.setPage). Breit: links die Liste,
   rechts der Inhalt. Schmal: erst die Liste, dann die Unterseite.

   Jede Einstellung wird sofort gespeichert (kein Speichern-Knopf), damit
   nichts verloren geht, wenn man die Seite einfach verlässt.

   Wird vor pult.js geladen: hier stehen nur Definitionen.
   ============================================================ */
'use strict';

const SET_PAGES = [
  { key: 'schuljahr',   title: 'Schuljahr',        sub: 'Ferien, Zeugniskonferenz, Halbjahr' },
  { key: 'stundenplan', title: 'Stundenplan',      sub: 'Rhythmus und Stundenzeiten' },
  { key: 'darstellung', title: 'Darstellung',      sub: 'Hell/Dunkel, Notentabelle' },
  { key: 'noten',       title: 'Noten',            sub: 'Kategorien, Vorgaben für neue Kurse' },
  { key: 'raster',      title: 'Bewertungsraster', sub: 'Vorlagen für Einschätzungen' },
  { key: 'sicherheit',  title: 'Sicherheit',       sub: 'App-Sperre' },
  { key: 'daten',       title: 'Daten',            sub: 'Backup, Sicherungsstände, Speicher' },
  { key: 'ueber',       title: 'Über Pult.',       sub: 'Version, Updates, Datenschutz' },
];

/* Vorgaben für neue Kurse */
function courseDefaults() {
  const d = Object.assign({ scale: 'punkte', weightWritten: 40, weightHY1: 30 }, data.meta.courseDefaults || {});
  /* Gewichte je Kategorie; ältere Vorgaben kennen nur „% schriftlich" */
  const cw = Object.assign({}, d.catWeights || {});
  if (cw.schriftlich == null && cw.muendlich == null) { cw.schriftlich = d.weightWritten; cw.muendlich = 100 - d.weightWritten; }
  d.catWeights = cw;
  return d;
}

function renderSettings() {
  if (route.setPage === 'kategorien') route.setPage = 'noten';   // frühere Seite „Notenkategorien"
  const page = SET_PAGES.some(p => p.key === route.setPage) ? route.setPage : null;
  const shown = page || 'schuljahr';
  const nav = SET_PAGES.map(p => {
    const dot = p.key === 'ueber' && updateInfo ? '<span class="upd-dot"></span>' : '';
    const warn = p.key === 'daten' && backupIsOverdue() ? '<span class="upd-dot warn"></span>' : '';
    return `<button class="set-nav-item ${p.key === shown ? 'active' : ''}" data-sp="${p.key}">
      <span><b>${p.title}${dot}${warn}</b><small>${p.sub}</small></span><span class="set-nav-chev">›</span></button>`;
  }).join('');
  const meta = SET_PAGES.find(p => p.key === shown);

  app().innerHTML = `
    <div class="page-head"><div><h1>Einstellungen</h1></div></div>
    <div class="set-layout ${page ? 'has-page' : 'no-page'}">
      <nav class="set-nav" aria-label="Bereiche">${nav}</nav>
      <div class="set-content ${shown === 'raster' ? 'wide' : ''}">
        <button class="set-back" id="setBack">‹ Alle Einstellungen</button>
        <h2 class="set-title">${meta.title}</h2>
        <div id="setBody"></div>
      </div>
    </div>`;

  app().querySelectorAll('[data-sp]').forEach(b => b.onclick = () => go({ name: 'settings', setPage: b.dataset.sp, rasterId: null }));
  document.getElementById('setBack').onclick = () => go({ name: 'settings', setPage: null });

  const body = document.getElementById('setBody');
  ({ schuljahr: setSchuljahr, stundenplan: setStundenplan, darstellung: setDarstellung, noten: setNoten, raster: setRaster,
     sicherheit: setSicherheit, daten: setDaten, ueber: setUeber })[shown](body);
}
const setSaved = () => { save(); toast('Gespeichert.'); };

/* ---------- Schuljahr ---------- */
function setSchuljahr(body) {
  const m = data.meta;
  const today = todayISO();
  const list = freeDays().slice().sort((a, b) => (a.from || '').localeCompare(b.from || ''));
  const past = list.filter(f => (f.to || f.from) < today);
  const nf = nextFerien();
  const rows = list.map(f => {
    const over = (f.to || f.from) < today, now = !over && f.from <= today;
    const n = freeLen(f);
    /* „Ferien" mit nur einem Tag — meist aus dem früheren Feld „Nächster Ferienbeginn" */
    const noEnd = !over && n === 1 && /ferien/i.test(f.label || '') ? '<span class="pl-off">Ende eintragen?</span>' : '';
    const sub = [fmtFreeRange(f), n > 1 ? `${n} Tage` : '', over ? 'vorbei' : now ? 'läuft' : '', nf && nf.id === f.id ? 'Countdown' : '', noEnd].filter(Boolean).join(' · ');
    return `<div class="chip ${over ? 'fd-past' : ''}">
      <div class="chip-main"><b>${esc(f.label || 'Frei')}</b><span>${sub}</span></div>
      <div style="display:flex;gap:8px">
        <button class="btn small" data-fdedit="${f.id}">Ändern</button>
        <button class="btn small danger" data-fddel="${f.id}" aria-label="Löschen">×</button>
      </div></div>`;
  }).join('');
  body.innerHTML = `
    <section class="set-card">
      <h2>Ferien und freie Tage</h2>
      <div class="chip-list">${rows || '<div class="notice">Noch nichts eingetragen.</div>'}</div>
      <div class="set-buttons" style="margin-top:12px">
        <button class="btn small primary" id="fdNew">+ Ferien / freier Tag</button>
        <button class="btn small" id="fdIcs">Aus Kalenderdatei (.ics) …</button>
        ${past.length ? `<button class="btn small" id="fdPast">Vergangene entfernen (${past.length})</button>` : ''}
        <input type="file" id="fdFile" accept=".ics,text/calendar" hidden>
      </div>
      <div class="hint" style="margin-top:8px">An diesen Tagen gibt es keinen Unterricht: Die Planung überspringt sie, der Stundenplan zeigt sie grau. Der Countdown auf der Startseite zählt bis zu den nächsten Ferien (Einträge mit „Ferien“ im Namen oder ab drei Tagen).
        Ferientermine deines Bundeslands gibt es als Kalenderdatei (.ics) z. B. bei schulferien.org.</div>
    </section>
    <section class="set-card">
      <div class="field"><label>Nächste Zeugniskonferenz</label><input id="mZeugnis" type="date" value="${m.zeugnisDatum || ''}"></div>
      <div class="field"><label>Halbjahr beim Öffnen eines Kurses</label>
        <select id="mHalfYear">
          <option value="auto" ${(m.halfYear || 'auto') === 'auto' ? 'selected' : ''}>Automatisch — das 2., sobald dort Noten stehen</option>
          <option value="1" ${m.halfYear === '1' ? 'selected' : ''}>Immer das 1. Halbjahr</option>
          <option value="2" ${m.halfYear === '2' ? 'selected' : ''}>Immer das 2. Halbjahr</option>
        </select>
      </div>
    </section>`;
  document.getElementById('fdNew').onclick = () => openFreeDayForm(null);
  body.querySelectorAll('[data-fdedit]').forEach(b => b.onclick = () => openFreeDayForm(b.dataset.fdedit));
  body.querySelectorAll('[data-fddel]').forEach(b => b.onclick = () => {
    const f = freeDays().find(x => x.id === b.dataset.fddel); if (!f) return;
    m.freeDays = freeDays().filter(x => x !== f); save(); renderSettings();
    toast(`„${f.label || 'Frei'}“ entfernt.`, { label: 'Rückgängig', fn: () => { m.freeDays.push(f); save(); renderSettings(); } });
  });
  const fp = document.getElementById('fdPast');
  if (fp) fp.onclick = () => {
    const keep = freeDays().filter(f => (f.to || f.from) >= today);
    const removed = freeDays().filter(f => (f.to || f.from) < today);
    m.freeDays = keep; save(); renderSettings();
    toast(`${removed.length} entfernt.`, { label: 'Rückgängig', fn: () => { m.freeDays = m.freeDays.concat(removed); save(); renderSettings(); } });
  };
  const file = document.getElementById('fdFile');
  document.getElementById('fdIcs').onclick = () => file.click();
  file.onchange = () => { const f = file.files[0]; if (f) f.text().then(importFreeDaysICS, () => toast('Die Datei konnte nicht gelesen werden.')); };
  document.getElementById('mZeugnis').onchange = e => { m.zeugnisDatum = e.target.value; setSaved(); };
  document.getElementById('mHalfYear').onchange = e => { m.halfYear = e.target.value || 'auto'; setSaved(); };
}

/* Ferien / freien Tag anlegen oder ändern */
function openFreeDayForm(id) {
  const f = id ? freeDays().find(x => x.id === id) : null;
  modal(f ? 'Ferien / freier Tag' : 'Ferien oder freien Tag eintragen', `
    <div class="field"><label>Bezeichnung</label><input id="fdLabel" type="text" value="${esc(f ? f.label : '')}" placeholder="z. B. Herbstferien, Brückentag, Studientag" maxlength="80"></div>
    <div class="row2">
      <div class="field"><label>Von</label><input id="fdFrom" type="date" value="${f ? f.from : ''}"></div>
      <div class="field"><label>Bis (einschließlich)</label><input id="fdTo" type="date" value="${f ? f.to || f.from : ''}"></div>
    </div>
    <div class="hint">Ein einzelner Tag: „Bis“ leer lassen oder gleich „Von“.</div>`, [
    { label: 'Abbrechen', onClick: closeModal },
    { label: 'Speichern', cls: 'primary', onClick: () => {
      const from = val('fdFrom'); let to = val('fdTo') || from;
      if (!from) return toast('Bitte ein Datum angeben.');
      if (to < from) return toast('„Bis“ liegt vor „Von“.');
      const label = val('fdLabel').trim() || (to === from ? 'Freier Tag' : 'Ferien');
      if (f) Object.assign(f, { label, from, to });
      else data.meta.freeDays = freeDays().concat([{ id: uid(), label, from, to }]);
      save(); closeModal(); renderSettings();
    }},
  ]);
  /* „Bis" folgt „Von", solange es leer oder davor ist */
  const fromEl = document.getElementById('fdFrom'), toEl = document.getElementById('fdTo');
  fromEl.addEventListener('change', () => { if (!toEl.value || toEl.value < fromEl.value) toEl.value = fromEl.value; });
  setTimeout(() => { const el = document.getElementById('fdLabel'); if (el && !f) el.focus(); }, 50);
}

/* Ferien aus einer Kalenderdatei: jeder Termin ist ein Kandidat. Vorschau
   mit Häkchen — vorausgewählt ist, was noch nicht vorbei und noch nicht
   eingetragen ist. Ganztägige Termine enden in iCalendar am Folgetag. */
function importFreeDaysICS(text) {
  let evs = [];
  try { evs = parseICS(text); } catch (e) {}
  const prevDay = iso => { const d = new Date(iso + 'T00:00:00'); d.setDate(d.getDate() - 1); return dateToISO(d); };
  const seen = new Set();
  const items = evs.filter(e => e.date).map(e => {
    let to = e.endDate || e.date;
    if (e.endDate && e.endAllDay && e.endDate > e.date) to = prevDay(e.endDate);
    if (to < e.date) to = e.date;
    return { label: String(e.title || 'Ferien').trim().slice(0, 80), from: e.date, to };
  }).filter(x => { const k = `${x.from}|${x.to}|${x.label}`; if (seen.has(k)) return false; seen.add(k); return true; })
    .sort((a, b) => a.from.localeCompare(b.from));
  if (!items.length) return toast('Keine Termine in der Datei gefunden.');
  const today = todayISO();
  const have = x => freeDays().some(f => f.from === x.from && (f.to || f.from) === x.to);
  const rows = items.map((x, i) => {
    const dup = have(x), over = x.to < today;
    return `<label class="check-row fd-imp ${dup || over ? 'fd-past' : ''}"><input type="checkbox" data-i="${i}" ${dup || over ? '' : 'checked'}>
      <span><b>${esc(x.label)}</b><small>${fmtFreeRange(x)}${dup ? ' · schon eingetragen' : over ? ' · vorbei' : ''}</small></span></label>`;
  }).join('');
  modal('Ferien aus Kalenderdatei', `
    <p class="cs-sub" style="margin-top:0">${items.length} ${items.length === 1 ? 'Termin' : 'Termine'} gefunden. Jeder ausgewählte Termin wird als Ferien bzw. freier Tag übernommen — die Bezeichnung lässt sich danach ändern.</p>
    <div class="fd-imp-list">${rows}</div>`, [
    { label: 'Abbrechen', onClick: closeModal },
    { label: 'Übernehmen', cls: 'primary', onClick: () => {
      const pick = [...document.querySelectorAll('.fd-imp input:checked')].map(i => items[+i.dataset.i]).filter(x => !have(x));
      if (!pick.length) return toast('Nichts ausgewählt.');
      data.meta.freeDays = freeDays().concat(pick.map(x => ({ id: uid(), label: x.label, from: x.from, to: x.to })));
      save(); closeModal(); renderSettings();
      toast(`${pick.length} ${pick.length === 1 ? 'Eintrag' : 'Einträge'} übernommen.`);
    }},
  ]);
}

/* ---------- Stundenplan ---------- */
function setStundenplan(body) {
  const periods = data.timetable.periods || [];
  body.innerHTML = `
    <section class="set-card">
      <div class="field"><label>Rhythmus</label>
        <select id="mAB">
          <option value="0" ${abActive() ? '' : 'selected'}>Jede Woche derselbe Plan</option>
          <option value="1" ${abActive() ? 'selected' : ''}>Woche A und Woche B im Wechsel</option>
        </select>
      </div>
      <div class="field" id="mABWeekWrap" style="${abActive() ? '' : 'display:none'}"><label>Diese Woche ist</label>
        <select id="mABWeek">
          <option value="1" ${abActive() && abWeekOf() === 2 ? '' : 'selected'}>Woche A</option>
          <option value="2" ${abActive() && abWeekOf() === 2 ? 'selected' : ''}>Woche B</option>
        </select>
        <div class="hint">Danach wechselt es jede Woche automatisch. Einzelne Stunden setzt du im Plan auf A oder B.</div>
      </div>
      <div class="field" id="mABSkipWrap" style="${abActive() ? '' : 'display:none'}"><label>In den Ferien</label>
        <select id="mABSkip">
          <option value="0" ${data.timetable.abSkipFree ? '' : 'selected'}>A/B wechselt weiter, auch in den Ferien</option>
          <option value="1" ${data.timetable.abSkipFree ? 'selected' : ''}>A/B pausiert — nach den Ferien geht es weiter, wo es aufgehört hat</option>
        </select>
        <div class="hint">Als Ferien zählt eine Woche, die Montag bis Freitag frei ist (Einstellungen → Schuljahr).</div>
      </div>
      <div class="field"><label>Stundenzeiten</label>
        <div class="set-buttons"><button class="btn" id="mPeriods">Zeiten bearbeiten</button></div>
        <div class="hint">${periods.length} Stunden, ${periods[0] ? periods[0].start : '–'} bis ${periods.length ? periods[periods.length - 1].end : '–'} Uhr.</div>
      </div>
      <div class="field"><label>Im Kalender des Geräts</label>
        <div class="set-buttons"><button class="btn" id="mTtIcs">Als Kalenderdatei sichern (.ics)</button></div>
      </div>
    </section>`;
  const abSel = document.getElementById('mAB'), abWrap = document.getElementById('mABWeekWrap'), abWeek = document.getElementById('mABWeek');
  const skipWrap = document.getElementById('mABSkipWrap');
  const applyAB = () => {
    const wantAB = abSel.value === '1';
    abWrap.style.display = wantAB ? '' : 'none';
    skipWrap.style.display = wantAB ? '' : 'none';
    data.timetable.abWeeks = wantAB;
    if (wantAB) abSetCurrentWeek(Number(abWeek.value) || 1);
    planWeek = 0;                          // Stundenplan wieder auf die laufende Woche
    setSaved();
  };
  abSel.onchange = applyAB;
  abWeek.onchange = applyAB;
  /* Umschalten lässt die laufende Woche, wie sie ist */
  document.getElementById('mABSkip').onchange = e => {
    const cur = abWeekOf();
    data.timetable.abSkipFree = e.target.value === '1';
    abSetCurrentWeek(cur);
    planWeek = 0;
    setSaved();
  };
  document.getElementById('mPeriods').onclick = openPeriodsEditor;
  document.getElementById('mTtIcs').onclick = exportTimetableICS;
}

/* ---------- Noten ---------- */
function setDarstellung(body) {
  const m = data.meta;
  body.innerHTML = `
    <section class="set-card">
      <div class="field"><label>Erscheinungsbild</label>
        <select id="mTheme">
          <option value="auto" ${(m.theme || 'auto') === 'auto' ? 'selected' : ''}>Automatisch — wie das Gerät</option>
          <option value="light" ${m.theme === 'light' ? 'selected' : ''}>Hell</option>
          <option value="dark" ${m.theme === 'dark' ? 'selected' : ''}>Dunkel</option>
        </select>
      </div>
      <div class="field"><label>Notentabelle</label>
        <select id="mLayout">
          <option value="invers" ${m.tableLayout !== 'standard' ? 'selected' : ''}>Standard — Gesamt und Neuestes zuerst</option>
          <option value="standard" ${m.tableLayout === 'standard' ? 'selected' : ''}>Von links nach rechts — Noten links, Gesamt rechts</option>
        </select>
      </div>
      <div class="field"><label>Hinweis „keine aktuelle mündliche Note"</label>
        <select id="mBlind">${[14, 21, 28, 42].map(d => `<option value="${d}" ${blindDays() === d ? 'selected' : ''}>nach ${d} Tagen</option>`).join('')}</select>
        <div class="hint">Markiert Schüler:innen mit einem Punkt, deren letzte mündliche Note länger zurückliegt.</div>
      </div>
    </section>`;
  document.getElementById('mTheme').onchange = e => { m.theme = e.target.value; applyTheme(); setSaved(); };
  document.getElementById('mLayout').onchange = e => { m.tableLayout = e.target.value || 'invers'; setSaved(); };
  document.getElementById('mBlind').onchange = e => { m.blindDays = Number(e.target.value) || 21; setSaved(); };
}

/* ---------- Noten ----------
   Kategorien und Vorgaben für neue Kurse (die Notentabelle steht unter Darstellung).
   Eigene Kategorien gelten für alle Kurse; welche ein Kurs führt und wie
   stark sie dort zählen, steht im Kurs (Kurs bearbeiten). */
function setNoten(body) {
  const m = data.meta, cd0 = courseDefaults();
  const list = customCats();
  const usage = id => {
    let courses = 0, cols = 0;
    data.courses.forEach(c => {
      const n = catUseInCourse(c, id);
      if (n || (c.cats || []).some(x => x.id === id)) courses++;
      cols += n;
    });
    return { courses, cols };
  };
  const rows = list.map(k => {
    const u = usage(k.id);
    const sub = [u.courses ? `in ${u.courses} ${u.courses === 1 ? 'Kurs' : 'Kursen'}` : 'noch in keinem Kurs', u.cols ? `${u.cols} ${u.cols === 1 ? 'Leistung' : 'Leistungen'}` : ''].filter(Boolean).join(' · ');
    return `<div class="chip">
      <div class="chip-main"><b><i class="cat-dot" style="background:${k.color}"></i>${esc(k.name)}</b><span>${sub}</span></div>
      <div style="display:flex;gap:8px">
        <button class="btn small" data-kedit="${esc(k.id)}">Ändern</button>
        <button class="btn small danger" data-kdel="${esc(k.id)}">Löschen</button>
      </div></div>`;
  }).join('');
  body.innerHTML = `
    <section class="set-card">
      <h2>Kategorien</h2>
      <div class="chip-list">
        ${STD_CATS.map(k => `<div class="chip"><div class="chip-main"><b><i class="cat-dot" style="background:${k.color}"></i>${k.name}</b><span>fest eingebaut</span></div></div>`).join('')}
        ${rows}
      </div>
      <div style="margin-top:12px"><button class="btn small" id="kNew">+ Neue Kategorie</button></div>
      <div class="hint" style="margin-top:8px">Eigene Kategorien stehen allen Kursen zur Verfügung. Im Kurs nimmst du sie unter <b>Mehr → Kurs bearbeiten</b> auf und legst die Gewichtung fest — oder direkt über <b>+ Leistung → Kategorie-Note</b>.</div>
    </section>
    <section class="set-card">
      <h2>Vorgaben für neue Kurse</h2>
      <div class="field"><label>Notensystem</label>
        <select id="mScale">
          <option value="punkte" ${cd0.scale === 'punkte' ? 'selected' : ''}>Punkte 0–15</option>
          <option value="noten" ${cd0.scale === 'noten' ? 'selected' : ''}>Noten 1–6 mit Tendenz</option>
        </select></div>
      <div class="field"><label>Gewichtung der Kategorien</label><div id="kDefaults"></div></div>
      <div class="field"><label>1. Halbjahr % (Endjahr)</label><input id="mWH" type="number" min="0" max="100" value="${cd0.weightHY1}"></div>
      <div class="hint" style="margin-top:6px">Eigene Kategorien mit 0 % werden in neuen Kursen nicht angelegt. Bestehende Kurse bleiben unverändert — dort unter <b>Mehr → Kurs bearbeiten</b>.</div>
    </section>`;
  const keepDefaults = () => {
    m.courseDefaults = Object.assign({}, m.courseDefaults || {}, {
      scale: val('mScale') || 'punkte',
      weightHY1: clamp(parseInt(val('mWH'), 10) || 0, 0, 100),
    });
    setSaved();
  };
  ['mScale', 'mWH'].forEach(id => document.getElementById(id).onchange = keepDefaults);
  document.getElementById('kNew').onclick = () => openCategoryForm(null, () => { closeModal(); renderSettings(); }, closeModal);
  body.querySelectorAll('[data-kedit]').forEach(b => b.onclick = () => openCategoryForm(b.dataset.kedit, () => { closeModal(); renderSettings(); }, closeModal));
  body.querySelectorAll('[data-kdel]').forEach(b => b.onclick = () => openCategoryDelete(b.dataset.kdel));

  const cd = courseDefaults();
  const wl = STD_CATS.concat(list).map(k => ({ id: k.id, weight: cd.catWeights[k.id] || 0 }));
  const r = catWeightRows(document.getElementById('kDefaults'), wl, {
    onChange: () => {
      if (Math.abs(r.total() - 100) > 1e-9) return;      // erst speichern, wenn es aufgeht
      const cw = {}; wl.forEach(x => cw[x.id] = x.weight);
      data.meta.courseDefaults = Object.assign({}, data.meta.courseDefaults || {}, { catWeights: cw, weightWritten: cw.schriftlich || 0 });
      save();
    },
  });
}
/* Eigene Kategorie löschen. Was darin steht (Noten, Bonus, Zwischenstände)
   und ihr Gewicht wandern in eine andere Kategorie — es geht nichts verloren. */
function openCategoryDelete(id) {
  const k = customCats().find(x => x.id === id); if (!k) return;
  let cols = 0, courses = 0;
  data.courses.forEach(c => { const n = catUseInCourse(c, id); cols += n; if (n || (c.cats || []).some(x => x.id === id && x.weight > 0)) courses++; });
  const targets = STD_CATS.concat(customCats().filter(x => x.id !== id));
  modal(`„${esc(k.name)}“ löschen?`, `
    ${cols || courses ? `<p>Die Kategorie wird in <b>${courses} ${courses === 1 ? 'Kurs' : 'Kursen'}</b> verwendet${cols ? ` (${cols} ${cols === 1 ? 'Leistung' : 'Leistungen'})` : ''}. Leistungen und Gewichtsanteil gehen über an:</p>
      <div class="field"><select id="kTarget">${targets.map(x => `<option value="${esc(x.id)}" ${x.id === 'muendlich' ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></div>`
      : '<p>Die Kategorie wird in keinem Kurs verwendet.</p>'}`, [
    { label: 'Abbrechen', onClick: closeModal },
    { label: 'Löschen', cls: 'danger', onClick: () => {
      const tgt = document.getElementById('kTarget') ? val('kTarget') : 'muendlich';
      moveCategory(id, tgt);
      data.meta.categories = customCats().filter(x => x.id !== id);
      save(); closeModal(); renderSettings();
      toast(`„${k.name}“ gelöscht.`);
    }},
  ]);
}
/* Alles einer Kategorie in eine andere verschieben (Kurse, individuelle
   Gewichte, Vorgaben) */
function moveCategory(from, to) {
  data.courses.forEach(c => {
    ['1', '2'].forEach(h => {
      const hy = c.halfYears[h];
      hy.columns.forEach(col => {
        if (col.type === from) col.type = to;
        if (col.type === 'zwischenstand' && col.source === from) col.source = to;
      });
      hy.sonstige.forEach(so => { if (so.scope === from) so.scope = to; });
    });
    if (Array.isArray(c.cats) && c.cats.some(x => x.id === from)) {
      const list = courseCats(c).map(x => ({ id: x.id, weight: x.weight }));
      const f = list.find(x => x.id === from), t = list.find(x => x.id === to);
      if (t) t.weight += f ? f.weight : 0; else list.push({ id: to, weight: f ? f.weight : 0 });
      setCourseCats(c, list.filter(x => x.id !== from));
    }
  });
  Object.values(data.weightOverride || {}).forEach(byHy => Object.values(byHy || {}).forEach(ov => {
    if (!ov || typeof ov !== 'object' || ov[from] == null) return;
    ov[to] = (Number(ov[to]) || 0) + (Number(ov[from]) || 0); delete ov[from];
  }));
  const cd = data.meta.courseDefaults;
  if (cd && cd.catWeights && cd.catWeights[from] != null) {
    cd.catWeights[to] = (cd.catWeights[to] || 0) + cd.catWeights[from]; delete cd.catWeights[from];
    cd.weightWritten = cd.catWeights.schriftlich || 0;
  }
}

/* ---------- Bewertungsraster: Liste bzw. Editor (raster.js) ---------- */
function setRaster(body) {
  if (route.rasterId) renderRasterEdit(body); else renderRasterVorlagen(body);
}

/* ---------- Sicherheit ---------- */
function setSicherheit(body) {
  body.innerHTML = lockSettingsHtml() + `
    <div class="notice">Die Sperre ist ein Sichtschutz. Zum Schutz bei Verlust des Geräts: Gerätecode setzen und Backups <b>verschlüsselt</b> sichern (Einstellungen → Daten).</div>`;
  bindLockSettings();
}

/* ---------- Daten ---------- */
function setDaten(body) {
  const m = data.meta;
  const usage = (localStorage.getItem(STORE_KEY) || '').length;
  const demo = m.demo ? `
    <section class="set-card">
      <h2>Beispieldaten</h2>
      <div class="field">
        <button class="btn" id="mDemoClear">Beispieldaten löschen …</button>
        <div class="hint">Die Kurse, Noten und Termine beim ersten Start sind fiktiv. Einstellungen und Bewertungsraster-Vorlagen bleiben beim Löschen erhalten.</div>
      </div>
    </section>` : '';
  body.innerHTML = demo + `
    <section class="set-card">
      <h2>Backup als Datei</h2>
      <div class="field">
        <div class="set-buttons">
          <button class="btn primary" id="mBackup">Backup sichern</button>
          <button class="btn" id="mBackupEnc">Verschlüsselt sichern</button>
          <button class="btn" id="mBackupImport">Backup einlesen</button>
          <input type="file" id="mBackupFile" accept="application/json,.json" hidden>
        </div>
        <div class="hint">${m.lastBackup ? 'Letztes Backup: ' + fmtDateLong(m.lastBackup) + '.' : 'Noch kein Backup gesichert.'} Die Daten liegen nur auf diesem Gerät — ein Backup als Datei ist die einzige Sicherung gegen Verlust. Es enthält auch die Schuljahres-Archive. Beim Einlesen lässt sich ein Backup ersetzen oder nur als Archiv ablegen.</div>
      </div>
      <div class="field"><label>Erinnern, wenn das letzte Backup älter ist als</label>
        <select id="mRemind">${[[3, '3 Tage'], [7, '1 Woche'], [14, '2 Wochen'], [30, '1 Monat'], [0, 'nie erinnern']].map(([v, l]) =>
          `<option value="${v}" ${backupRemindDays() === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
      </div>
      <details class="set-more"><summary>Pseudonymes Backup</summary>
        <div class="hint">Namen werden durch Nummern ersetzt (je Kurs alphabetisch), Kurzinfos, Raster-Rückmeldungen und Notenprotokoll entfallen. Zum Teilen oder Ablegen ohne Namen — keine vollwertige Sicherung, ohne Schuljahres-Archive. Freitext in Notizen, Todos, Terminen und der Planung bleibt.</div>
        <button class="btn small" id="mBackupPseudo" style="margin-top:8px">Pseudonym sichern</button>
      </details>
    </section>

    <section class="set-card">
      <h2>Interne Sicherungsstände</h2>
      <div class="hint" style="margin-bottom:10px">Täglich automatisch sowie vor Updates, dem Einlesen eines Backups und dem Löschen. Die letzten ${SNAP_MAX} bleiben erhalten, Schuljahres-Archive dauerhaft. „Ansehen" öffnet einen Stand, ohne etwas zu verändern. Liegen auf diesem Gerät — ersetzen kein Backup als Datei; nur die Schuljahres-Archive sind darin enthalten.</div>
      <div id="snapList"><div class="cs-sub">Wird geladen …</div></div>
      <button class="btn small" id="mSnapNow" style="margin-top:10px">Jetzt Stand sichern</button>
    </section>

    <section class="set-card">
      <h2>Speicher</h2>
      <div class="field">
        <div id="mPersist" class="cs-sub">Wird geprüft …</div>
        <div class="hint">Datenbestand: ${fmtBytes(usage)} · ${data.courses.length} Kurse · ${data.courses.reduce((a, c) => a + c.students.length, 0)} Schüler:innen.</div>
      </div>
    </section>

    <section class="set-card">
      <h2>Notenprotokoll</h2>
      <div class="field">
        <button class="btn" id="mLog">Protokoll öffnen</button>
        <div class="hint">Die letzten ${HISTORY_MAX} Änderungen an Noten — einzeln rückgängig zu machen.</div>
      </div>
    </section>

    <section class="set-card">
      <h2>Schuljahr</h2>
      <div class="field">
        <button class="btn" id="mYear">Neues Schuljahr beginnen …</button>
        <div class="hint">Archiviert das laufende Jahr und übernimmt Kurse samt Schüler:innen ohne Noten.</div>
      </div>
    </section>

    <section class="set-card set-danger">
      <h2>Alles löschen</h2>
      <div class="field">
        <button class="btn danger" id="mReset">Alle Daten löschen …</button>
      </div>
    </section>`;

  document.getElementById('mBackup').onclick = exportBackup;
  document.getElementById('mBackupEnc').onclick = exportBackupEncrypted;
  document.getElementById('mBackupPseudo').onclick = exportBackupPseudonym;
  const fileInput = document.getElementById('mBackupFile');
  document.getElementById('mBackupImport').onclick = () => fileInput.click();
  fileInput.onchange = () => { if (fileInput.files[0]) importBackupFile(fileInput.files[0]); fileInput.value = ''; };
  document.getElementById('mRemind').onchange = e => { data.meta.backupRemind = Number(e.target.value); setSaved(); };
  document.getElementById('mLog').onclick = () => openHistory(null);
  document.getElementById('mReset').onclick = confirmResetAll;
  if (m.demo) document.getElementById('mDemoClear').onclick = confirmClearDemoData;
  document.getElementById('mYear').onclick = openYearChange;

  const snapHost = document.getElementById('snapList');
  renderSnapshotList(snapHost);
  document.getElementById('mSnapNow').onclick = async () => {
    try { await takeSnapshot('Manuell'); toast('Stand gesichert.'); renderSnapshotList(snapHost); }
    catch (e) { toast('Interne Sicherung ist in diesem Browser nicht möglich.'); }
  };

  const persistEl = document.getElementById('mPersist');
  const showPersist = st => {
    if (!persistEl.isConnected) return;
    persistEl.innerHTML = st === true
      ? '<b style="color:var(--g-top)">Dauerhaft gespeichert</b> — der Browser räumt die Daten nicht von selbst weg.'
      : st === null ? 'Dieser Browser gibt keine Auskunft, ob die Daten dauerhaft bleiben.'
      : `<b style="color:var(--amber)">Nicht dauerhaft</b> — bei Speichermangel dürfte der Browser aufräumen.<br><button class="btn small" id="mPersistAsk">Dauerhaft anfordern</button>`;
    const ask = document.getElementById('mPersistAsk');
    if (ask) ask.onclick = async () => {
      const r = await storagePersist(true);
      showPersist(r);
      if (!r) toast('Abgelehnt — als Web-App zum Home-Bildschirm hinzufügen hilft meist.');
    };
  };
  storagePersist(false).then(showPersist);
}

/* ---------- Über Pult. ---------- */
function setUeber(body) {
  body.innerHTML = `
    <section class="set-card">
      ${updateSectionHtml()}
    </section>
    <section class="set-card">
      <h2>Pult.</h2>
      <div class="hint" style="font-size:13px">Ein Lehreralltagshelfer für Noten, Stundenplan, Todos und Termine. Es werden alle Daten auf dem Gerät gespeichert und nicht übertragen.</div>
      <div class="set-buttons" style="margin-top:12px">
        <a class="btn" href="${LEGAL_URL}" target="_blank" rel="noopener">Datenschutz &amp; Impressum</a>
        <button class="btn" id="mWelcome">Hinweise zur Installation</button>
      </div>
    </section>`;
  bindUpdateSection();
  document.getElementById('mWelcome').onclick = openWelcome;
}
