/* ============================================================
   Pult. — Ausdrucke
   ------------------------------------------------------------
   Notenübersicht eines Kurses, Zeugnisübersicht aller Kurse,
   Schülerbogen, Klassenliste und Sitzplan. Alles läuft über die
   Druckansicht aus print.js; hier entstehen nur die Seiten.

   Die zuletzt gewählten Optionen je Ausdruck stehen in
   data.meta.printOpts[art].

   Wird vor pult.js geladen: hier stehen nur Definitionen.
   ============================================================ */
'use strict';

const PD_FIT = ['pd-fit1', 'pd-fit2', 'pd-fit3'];

/* ---------- Bausteine ---------- */
function pdOpts(kind, defaults) {
  if (!data.meta.printOpts) data.meta.printOpts = {};
  return Object.assign({}, defaults, data.meta.printOpts[kind] || {});
}
function pdKeep(kind, o) {
  if (!data.meta.printOpts) data.meta.printOpts = {};
  data.meta.printOpts[kind] = o;
  save();
}
function pdHead(sub, title, meta) {
  return `<header class="pd-head">
    <div class="pd-titles"><div class="pd-sub">${sub}</div><div class="pd-title">${title}</div></div>
    <div class="pd-meta">${meta || ''}</div>
  </header>`;
}
const pdStand = () => `Stand ${fmtDateLong(todayISO())}`;
/* data-pp-*: siehe splitSheets in print.js (Fußzeile auf jedem Blatt, mit Seitenzahl) */
const pdFoot = extra => `<div class="pd-foot" data-pp-repeat>${extra ? extra + ' · ' : ''}Pult. · ${pdStand()} · vertraulich<span data-pp-part></span></div>`;
const pdCourseSub = c => `${esc(c.subject)} · ${esc(c.className)}`;
/* Einzelnote / Schnitt in der Skala des Kurses; leer bleibt leer */
const pdG = (p, c, avg) => (p == null || isNaN(p) ? '' : fmtGrade(p, c.scale, avg));
const pdGL = (p, c) => (p == null || isNaN(p) ? '–' : fmtGrade(p, c.scale, true) + (c.scale === 'noten' ? '' : ` (${noteLabel(p)})`));

/* Anzeigenamen — auf Wunsch Nummern statt Namen (alphabetisch nach Nachname,
   wie beim pseudonymen Backup) */
function pdNames(c, pseudo) {
  const map = new Map();
  if (!pseudo) { c.students.forEach(s => map.set(s.id, esc(studentName(s)))); return map; }
  c.students.slice().sort((a, b) =>
    (a.lastName || '').localeCompare(b.lastName || '', 'de') || (a.firstName || '').localeCompare(b.firstName || '', 'de'))
    .forEach((s, i) => map.set(s.id, `Nr. ${String(i + 1).padStart(2, '0')}`));
  return map;
}
/* Mittelwert einer Spalte über aktive Schüler:innen */
function pdMean(c, fn) {
  const vals = c.students.filter(studentActive).map(s => fn(s)).filter(v => v != null && !isNaN(v));
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
}
function pdColHead(col) {
  const tag = col.ka ? kaKind(col).pill : col.raster ? 'Raster' : '';
  return `<th>${esc(col.label)}<small>${[col.date ? fmtDate(col.date) : '', tag, weightLabel(col), col.noCount ? 'zählt nicht' : ''].filter(Boolean).join(' · ')}</small></th>`;
}

/* gemeinsame Optionen-Bausteine für die Dialoge */
const pdChk = (key, label, on, hint) => `<label class="check-row"><input type="checkbox" data-o="${key}" ${on ? 'checked' : ''}>
  <span>${label}${hint ? ` <small>${hint}</small>` : ''}</span></label>`;
const pdSeg = (id, items, cur) => `<div class="seg" id="${id}" style="width:100%">${items.map(([v, l]) =>
  `<button type="button" data-v="${v}" style="flex:1" class="${String(cur) === String(v) ? 'active' : ''}">${l}</button>`).join('')}</div>`;
function pdBindSeg(id, onPick) {
  document.querySelectorAll(`#${id} button`).forEach(b => b.onclick = () => {
    document.querySelectorAll(`#${id} button`).forEach(x => x.classList.toggle('active', x === b));
    onPick(b.dataset.v);
  });
}
/* sel: nur die Häkchen in diesem Bereich lesen (Dialoge mit mehreren Optionssätzen) */
const pdReadChecks = (o, sel) => document.querySelectorAll(`${sel || '.modal-body'} [data-o]`).forEach(i => o[i.dataset.o] = i.checked);

/* ============================================================
   Einstieg: Drucken im Kurs
   ============================================================ */
function openCoursePrint(c, preset) {
  if (preset) return openCoursePrintOpts(c, preset);
  const item = (k, title, sub) => `<button class="btn menu-btn" data-k="${k}">${title}<small>${sub}</small></button>`;
  modal(`Drucken — ${c.subject} ${c.className}`, `<div class="chip-list">
    ${item('noten', 'Notenübersicht', 'Alle Noten des Kurses als Tabelle')}
    ${item('boegen', 'Schülerbögen', 'Eine Seite pro Person: Noten, Rechenweg, Verlauf, Raster')}
    ${item('liste', 'Klassenliste', 'Namen mit leeren Spalten zum Abhaken')}
    ${item('sitzplan', 'Sitzplan', 'Tische mit Namen')}
    ${(c.halfYears['1'].columns.concat(c.halfYears['2'].columns)).some(x => x.raster)
      ? item('raster', 'Bewertungsraster', 'Über die jeweilige Einschätzung — Spaltenkopf „Raster" antippen') : ''}
  </div>`, [{ label: 'Abbrechen', onClick: closeModal }]);
  document.querySelectorAll('.modal-body [data-k]').forEach(b => b.onclick = () => {
    if (b.dataset.k === 'raster') return toast('Raster-Einschätzung öffnen und dort „Drucken …" wählen.');
    openCoursePrintOpts(c, b.dataset.k);
  });
}

/* sId: Schülerbogen für diese Person vorwählen. direct: ohne Auswahlmenü
   aufgerufen (Schülerseite, Sitzplan) — dann gibt es kein „Zurück". */
function openCoursePrintOpts(c, kind, sId, direct) {
  const solo = !!(sId || direct);
  const back = () => (solo ? closeModal() : openCoursePrint(c));
  const show = (title, body, onGo, bind) => {
    modal(title, body, [
      { label: solo ? 'Abbrechen' : '‹ Zurück', onClick: back },
      { label: 'Vorschau ›', cls: 'primary', onClick: onGo },
    ]);
    if (bind) bind();
  };

  if (kind === 'noten') {
    const o = pdOpts('noten', { hy: route.hy || '1', singles: true, mean: true, pseudo: false });
    show('Notenübersicht', `
      <div class="field"><label>Halbjahr</label>${pdSeg('poHy', [['1', '1. Halbjahr'], ['2', '2. Halbjahr'], ['beide', 'Beide + Endjahr']], o.hy)}</div>
      <div class="check-list">
        ${pdChk('singles', 'Einzelnoten', o.singles, 'sonst nur Schnitte und Gesamtnote')}
        ${pdChk('mean', 'Kursschnitt als letzte Zeile', o.mean)}
        ${pdChk('pseudo', 'Nummern statt Namen', o.pseudo, 'z. B. für einen Aushang')}
      </div>`, () => {
        pdReadChecks(o); pdKeep('noten', o); closeModal();
        openPrintView({ title: `Notenübersicht — ${c.subject} ${c.className}`, landscape: true, css: PD_CSS, fit: PD_FIT,
          pages: [pdNotenPage(c, o)], filename: `noten-${rasterSlug(c.subject)}-${rasterSlug(c.className)}` });
      }, () => pdBindSeg('poHy', v => o.hy = v));
    return;
  }

  if (kind === 'boegen') {
    const o = pdOpts('boegen', { hy: 'beide', verlauf: true, raster: true, ha: true, notes: false, info: false });
    let scope = sId ? 'one' : 'all';
    const s = sId ? c.students.find(x => x.id === sId) : null;
    show('Schülerbogen', `
      ${s ? `<div class="field"><label>Umfang</label>${pdSeg('poScope', [['one', esc(studentName(s))], ['all', 'Ganze Klasse']], scope)}</div>` : ''}
      <div class="field"><label>Halbjahr</label>${pdSeg('poHy', [['1', '1. Halbjahr'], ['2', '2. Halbjahr'], ['beide', 'Beide + Endjahr']], o.hy)}</div>
      <div class="check-list">
        ${pdChk('verlauf', 'Notenverlauf', o.verlauf)}
        ${pdChk('raster', 'Raster-Einschätzungen', o.raster)}
        ${pdChk('ha', 'Hausaufgaben', o.ha)}
        ${pdChk('notes', 'Notizen', o.notes, 'privat!')}
        ${pdChk('info', 'Kurzinfo', o.info, 'z. B. Nachteilsausgleich — privat!')}
      </div>
      <div class="hint" style="margin-top:8px">Eine DIN-A4-Seite (hoch) pro Person.</div>`, () => {
        pdReadChecks(o); pdKeep('boegen', o); closeModal();
        const people = scope === 'one' && s ? [s] : c.students.filter(studentActive);
        if (!people.length) return toast('Keine Schüler:innen im Kurs.');
        openPrintView({ title: `Schülerbögen — ${c.subject} ${c.className}`, landscape: false, css: PD_CSS, fit: PD_FIT,
          pages: people.map(p => pdBogenPage(c, p, o)),
          filename: `schuelerbogen-${rasterSlug(c.className)}${scope === 'one' && s ? '-' + rasterSlug(studentName(s)) : ''}` });
      }, () => { pdBindSeg('poHy', v => o.hy = v); if (s) pdBindSeg('poScope', v => scope = v); });
    return;
  }

  if (kind === 'liste') {
    const o = pdOpts('liste', { title: 'Klassenliste', cols: 8, heads: '', sort: 'kurs', dateLine: true });
    show('Klassenliste', `
      <div class="field"><label>Überschrift</label><input id="poTitle" type="text" value="${esc(o.title)}" placeholder="z. B. Einverständnis Klassenfahrt"></div>
      <div class="row2">
        <div class="field"><label>Leere Spalten</label><input id="poCols" type="number" min="0" max="20" value="${o.cols}"></div>
        <div class="field"><label>Reihenfolge</label>
          <select id="poSort"><option value="kurs" ${o.sort === 'kurs' ? 'selected' : ''}>Wie im Kurs</option><option value="nach" ${o.sort === 'nach' ? 'selected' : ''}>Nach Nachname</option><option value="vor" ${o.sort === 'vor' ? 'selected' : ''}>Nach Vorname</option></select></div>
      </div>
      <div class="field" style="margin-top:14px"><label>Spaltenüberschriften (optional)</label>
        <input id="poHeads" type="text" value="${esc(o.heads)}" placeholder="z. B. Geld, Zettel, Foto — mit Komma getrennt">
        <div class="hint">Fehlende Überschriften bleiben leer zum Beschriften.</div></div>
      <div class="check-list">${pdChk('dateLine', 'Zeile für Datum und Notiz', o.dateLine)}</div>`, () => {
        pdReadChecks(o);
        o.title = val('poTitle').trim(); o.cols = clamp(parseInt(val('poCols'), 10) || 0, 0, 20);
        o.heads = val('poHeads'); o.sort = val('poSort');
        pdKeep('liste', o); closeModal();
        openPrintView({ title: `${o.title || 'Klassenliste'} — ${c.subject} ${c.className}`, landscape: false, css: PD_CSS, fit: PD_FIT,
          pages: [pdListePage(c, o)], filename: `liste-${rasterSlug(c.className)}-${rasterSlug(o.title)}` });
      });
    return;
  }

  if (kind === 'sitzplan') {
    const st = ensureSeating(c);
    if (!Object.values(st.seats).some(Boolean)) return toast('Der Sitzplan ist noch leer.');
    const o = pdOpts('sitzplan', { view: 'pult', last: true });
    show('Sitzplan', `
      <div class="field"><label>Blickrichtung</label>${pdSeg('poView', [['pult', 'Vom Pult aus (wie in der App)'], ['klasse', 'Aus der Klasse (Tafel oben)']], o.view)}</div>
      <div class="check-list">${pdChk('last', 'Nachnamen', o.last)}</div>`, () => {
        pdReadChecks(o); pdKeep('sitzplan', o); closeModal();
        openPrintView({ title: `Sitzplan — ${c.subject} ${c.className}`, landscape: true, css: PD_CSS, fit: PD_FIT,
          pages: [pdSitzplanPage(c, o)], filename: `sitzplan-${rasterSlug(c.className)}` });
      }, () => pdBindSeg('poView', v => o.view = v));
  }
}

/* ============================================================
   Notenübersicht eines Kurses (quer)
   ============================================================ */
function pdNotenPage(c, o) {
  const names = pdNames(c, o.pseudo);
  const hys = o.hy === 'beide' ? ['1', '2'] : [o.hy === '2' ? '2' : '1'];
  const withEnd = o.hy === 'beide';
  let hasManual = false;

  /* Spalten je Halbjahr: [{ head, cell(s), mean(), cls }] */
  const defs = [];
  hys.forEach(h => {
    const hy = c.halfYears[h];
    const grp = [];
    const single = col => ({
      head: pdColHead(col),
      cell: s => pdG((data.grades[s.id] || {})[col.id], c, false),
      mean: () => pdMean(c, s => (data.grades[s.id] || {})[col.id]),
    });
    const sCols = hy.columns.filter(x => x.type === 'schriftlich');
    const mCols = hy.columns.filter(x => x.type === 'muendlich');
    if (o.singles) sCols.forEach(col => grp.push(single(col)));
    grp.push({ head: '<th>Ø schr.</th>', cls: 'pd-avg', cell: s => pdG(computeHalf(c, h, s.id).wAvg, c, true), mean: () => pdMean(c, s => computeHalf(c, h, s.id).wAvg) });
    if (o.singles) mCols.forEach(col => grp.push(single(col)));
    grp.push({ head: '<th>Ø mündl.</th>', cls: 'pd-avg', cell: s => pdG(computeHalf(c, h, s.id).mAvg, c, true), mean: () => pdMean(c, s => computeHalf(c, h, s.id).mAvg) });
    if (o.singles) hy.sonstige.forEach(so => grp.push({
      head: `<th>${esc(so.label)}<small>Bonus ${so.percent} %</small></th>`,
      cell: s => pdG((data.sonstigeValues[s.id] || {})[so.id], c, false),
      mean: () => pdMean(c, s => (data.sonstigeValues[s.id] || {})[so.id]),
    }));
    grp.push({ head: '<th>Gesamt</th>', cls: 'pd-final',
      cell: s => { const e = effGesamt(c, h, s.id); const man = e.manual != null && e.computed != null; if (man) hasManual = true;
        return e.value == null ? '' : pdG(e.value, c, true) + (man ? '*' : ''); },
      mean: () => pdMean(c, s => effGesamt(c, h, s.id).value) });
    defs.push({ label: `${h}. Halbjahr`, cols: grp });
  });
  if (withEnd) defs.push({ label: 'Endjahr', cols: [{ head: `<th>${c.weightHY1}/${c.weightHY2}</th>`, cls: 'pd-final',
    cell: s => { const e = effEndjahr(c, s.id); const man = e.manual != null && e.computed != null; if (man) hasManual = true;
      return e.value == null ? '' : pdG(e.value, c, true) + (man ? '*' : ''); },
    mean: () => pdMean(c, s => effEndjahr(c, s.id).value) }] });

  const all = defs.flatMap(d => d.cols);
  const head1 = `<tr><th rowspan="2">Nr.</th><th rowspan="2" class="pd-name">Name</th>${defs.map(d => `<th class="pd-grp" colspan="${d.cols.length}">${d.label}</th>`).join('')}</tr>`;
  const head2 = `<tr>${all.map(d => d.head).join('')}</tr>`;
  const people = o.pseudo
    ? c.students.slice().sort((a, b) => names.get(a.id).localeCompare(names.get(b.id)))
    : c.students;
  const rows = people.map((s, i) => `<tr class="${studentActive(s) ? '' : 'pd-inactive'}"><td>${i + 1}</td>
    <td class="pd-name">${names.get(s.id)}${studentActive(s) ? '' : ' (ausgetreten)'}</td>
    ${all.map(d => `<td class="${d.cls || ''}">${d.cell(s)}</td>`).join('')}</tr>`).join('');
  const foot = o.mean ? `<tfoot><tr><td></td><td class="pd-name">Ø Kurs</td>${all.map(d => `<td class="${d.cls || ''}">${pdG(d.mean(), c, true)}</td>`).join('')}</tr></tfoot>` : '';

  return `<section class="pp-sheet pd">
    ${pdHead(pdCourseSub(c), 'Notenübersicht', `${scaleName(c.scale)} · Gewichtung ${c.weightWritten}/${c.weightOral}<br>${hys.length === 2 ? 'Schuljahr' : hys[0] + '. Halbjahr'}`)}
    ${c.students.length ? `<table class="pd-t" data-split="2"><thead>${head1}${head2}</thead><tbody>${rows}</tbody>${foot}</table>` : '<p>Keine Schüler:innen.</p>'}
    ${pdFoot(hasManual ? '* manuell festgelegt' : '')}
  </section>`;
}

/* ============================================================
   Drucken für alle Kurse: Zeugnisübersicht (je Kurs eine Seite, hoch)
   oder die komplette Notenübersicht wie im Kurs (je Kurs eine Seite, quer)
   ============================================================ */
function openAllCoursesPrint() {
  if (!data.courses.length) return toast('Noch keine Kurse.');
  const o = pdOpts('zeugnis', { kind: 'zeugnis', hy: '1', remark: true, spiegel: true, skip: [] });
  /* Optionen der Notenübersicht teilen sich Kurs- und Gesamtdruck */
  const on = pdOpts('noten', { hy: '1', singles: true, mean: true, pseudo: false });
  modal('Drucken — alle Kurse', `
    <div class="field"><label>Ausdruck</label>${pdSeg('poKind', [['zeugnis', 'Zeugnisübersicht'], ['noten', 'Notenübersicht komplett']], o.kind)}</div>
    <div id="poZ" style="${o.kind === 'zeugnis' ? '' : 'display:none'}">
      <div class="field"><label>Stand</label>${pdSeg('poHyZ', [['1', '1. Halbjahr'], ['2', '2. Halbjahr + Endjahr']], o.hy)}</div>
    </div>
    <div id="poN" style="${o.kind === 'noten' ? '' : 'display:none'}">
      <div class="field"><label>Halbjahr</label>${pdSeg('poHyN', [['1', '1. Halbjahr'], ['2', '2. Halbjahr'], ['beide', 'Beide + Endjahr']], on.hy)}</div>
    </div>
    <div class="field"><label>Kurse</label><div class="check-list">
      ${data.courses.map(c => `<label class="check-row"><input type="checkbox" data-course="${c.id}" ${o.skip.includes(c.id) ? '' : 'checked'}>
        <span>${esc(c.subject)} ${esc(c.className)} <small>${c.students.filter(studentActive).length} Schüler:innen</small></span></label>`).join('')}
    </div></div>
    <div id="poZChk" style="${o.kind === 'zeugnis' ? '' : 'display:none'}">
      <div class="check-list">
        ${pdChk('remark', 'Spalte für Bemerkungen', o.remark)}
        ${pdChk('spiegel', 'Notenspiegel und Kursschnitt', o.spiegel)}
      </div>
      <div class="hint" style="margin-top:8px">Eine Seite (hoch) pro Kurs — z. B. für die Zeugniskonferenz.</div>
    </div>
    <div id="poNChk" style="${o.kind === 'noten' ? '' : 'display:none'}">
      <div class="check-list">
        ${pdChk('singles', 'Einzelnoten', on.singles, 'sonst nur Schnitte und Gesamtnote')}
        ${pdChk('mean', 'Kursschnitt als letzte Zeile', on.mean)}
        ${pdChk('pseudo', 'Nummern statt Namen', on.pseudo, 'z. B. für einen Aushang')}
      </div>
      <div class="hint" style="margin-top:8px">Die vollständige Notentabelle wie beim Drucken im Kurs — eine Seite (quer) pro Kurs.</div>
    </div>`, [
    { label: 'Abbrechen', onClick: closeModal },
    { label: 'Vorschau ›', cls: 'primary', onClick: () => {
      pdReadChecks(o, '#poZChk'); pdReadChecks(on, '#poNChk');
      o.skip = [...document.querySelectorAll('[data-course]')].filter(i => !i.checked).map(i => i.dataset.course);
      const courses = data.courses.filter(c => !o.skip.includes(c.id));
      if (!courses.length) return toast('Bitte mindestens einen Kurs wählen.');
      pdKeep('zeugnis', o); pdKeep('noten', on); closeModal();
      if (o.kind === 'noten') {
        const hyLbl = on.hy === 'beide' ? 'Schuljahr' : `${on.hy}. Halbjahr`;
        openPrintView({ title: `Notenübersicht — alle Kurse · ${hyLbl}`, landscape: true, css: PD_CSS, fit: PD_FIT,
          pages: courses.map(c => pdNotenPage(c, on)), filename: `notenuebersicht-alle-kurse-${on.hy === 'beide' ? 'schuljahr' : 'hj' + on.hy}` });
        return;
      }
      openPrintView({ title: `Zeugnisübersicht — ${o.hy === '2' ? '2. Halbjahr' : '1. Halbjahr'}`, landscape: false, css: PD_CSS, fit: PD_FIT,
        pages: courses.map(c => pdZeugnisPage(c, o)), filename: `zeugnisuebersicht-${o.hy === '2' ? 'hj2' : 'hj1'}` });
    }},
  ]);
  pdBindSeg('poKind', v => {
    o.kind = v;
    ['poZ', 'poZChk'].forEach(id => document.getElementById(id).style.display = v === 'zeugnis' ? '' : 'none');
    ['poN', 'poNChk'].forEach(id => document.getElementById(id).style.display = v === 'noten' ? '' : 'none');
  });
  pdBindSeg('poHyZ', v => o.hy = v);
  pdBindSeg('poHyN', v => on.hy = v);
}

function pdZeugnisPage(c, o) {
  const h = o.hy === '2' ? '2' : '1';
  const people = c.students.filter(studentActive);
  let hasManual = false;
  const fin = (e) => { const man = e.manual != null && e.computed != null; if (man) hasManual = true; return e.value == null ? '' : pdG(e.value, c, true) + (man ? '*' : ''); };
  const heads = ['Ø schr.', 'Ø mündl.', h === '2' ? 'Gesamt 1. HJ' : null, `Gesamt ${h}. HJ`, h === '2' ? `Endjahr<small>${c.weightHY1}/${c.weightHY2}</small>` : null].filter(Boolean);
  const rows = people.map((s, i) => {
    const comp = computeHalf(c, h, s.id);
    const cells = [
      `<td class="pd-avg">${pdG(comp.wAvg, c, true)}</td>`, `<td class="pd-avg">${pdG(comp.mAvg, c, true)}</td>`,
      h === '2' ? `<td>${fin(effGesamt(c, '1', s.id))}</td>` : '',
      `<td class="pd-final">${fin(effGesamt(c, h, s.id))}</td>`,
      h === '2' ? `<td class="pd-final">${fin(effEndjahr(c, s.id))}</td>` : '',
    ].join('');
    return `<tr><td>${i + 1}</td><td class="pd-name">${esc(studentName(s))}</td>${cells}${o.remark ? '<td class="pd-remark"></td>' : ''}</tr>`;
  }).join('');

  /* Notenspiegel der maßgeblichen Note (Endjahr bzw. Halbjahr) */
  let spiegel = '';
  if (o.spiegel && people.length) {
    const val = s => (h === '2' ? effEndjahr(c, s.id).value : effGesamt(c, h, s.id).value);
    const vals = people.map(val).filter(v => v != null);
    const buckets = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
    vals.forEach(v => buckets[noteFromPoints(v)]++);
    const mean = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
    spiegel = `<table class="pd-t pd-spiegel"><tr><th>Note</th>${[1, 2, 3, 4, 5, 6].map(n => `<th>${n}</th>`).join('')}<th>Ø Kurs</th></tr>
      <tr><td>Anzahl</td>${[1, 2, 3, 4, 5, 6].map(n => `<td>${buckets[n] || ''}</td>`).join('')}<td><b>${pdGL(mean, c)}</b></td></tr></table>`;
  }

  return `<section class="pp-sheet pd">
    ${pdHead(pdCourseSub(c), `Zeugnisübersicht ${h === '2' ? '2. Halbjahr' : '1. Halbjahr'}`, `${scaleName(c.scale)} · Gewichtung ${c.weightWritten}/${c.weightOral}<br>${people.length} Schüler:innen`)}
    ${people.length ? `<table class="pd-t" data-split="2"><thead><tr><th>Nr.</th><th class="pd-name">Name</th>${heads.map(x => `<th>${x}</th>`).join('')}${o.remark ? '<th class="pd-remark">Bemerkung</th>' : ''}</tr></thead>
      <tbody>${rows}</tbody></table>` : '<p>Keine aktiven Schüler:innen.</p>'}
    ${spiegel}
    ${pdFoot(hasManual ? '* manuell festgelegt' : '')}
  </section>`;
}

/* ============================================================
   Schülerbogen (eine Seite pro Person, hoch)
   ============================================================ */
function pdBogenPage(c, s, o) {
  const hys = o.hy === 'beide' ? ['1', '2'] : [o.hy === '2' ? '2' : '1'];
  const gr = data.grades[s.id] || {};

  const hyBox = h => {
    const hy = c.halfYears[h];
    const comp = computeHalf(c, h, s.id);
    const eff = effGesamt(c, h, s.id);
    const lines = (cols, parts) => cols.length ? cols.map(col => {
      const p = parts.find(x => x.col.id === col.id);
      const tag = col.ka ? ' · ' + kaKind(col).pill : col.raster ? ' · Raster' : '';
      return `<div class="pd-line"><span>${esc(col.label)}<small>${col.date ? ' ' + fmtDate(col.date) : ''}${tag}${p ? ` · ${fmtNum(p.pct)} %` : col.noCount ? ' · zählt nicht' : ''}</small></span><b>${pdG(gr[col.id], c, false) || '–'}</b></div>`;
    }).join('') : '<div class="pd-line pd-dim"><span>keine</span><span></span></div>';
    const bonus = scope => hy.sonstige.filter(x => x.scope === scope).map(so =>
      `<div class="pd-line pd-dim"><span>Bonus: ${esc(so.label)} (${so.percent} %)</span><span>${pdG((data.sonstigeValues[s.id] || {})[so.id], c, false) || '–'}</span></div>`).join('');
    const man = eff.manual != null && eff.computed != null;
    return `<div class="pd-box"><h3>${h}. Halbjahr</h3>
      <div class="pd-sec">Schriftlich</div>${lines(hy.columns.filter(x => x.type === 'schriftlich'), comp.wParts)}${bonus('schriftlich')}
      <div class="pd-line pd-sum"><span>Ø schriftlich</span><b>${pdG(comp.wAvg, c, true) || '–'}</b></div>
      <div class="pd-sec">Mündlich</div>${lines(hy.columns.filter(x => x.type === 'muendlich'), comp.mParts)}${bonus('muendlich')}
      <div class="pd-line pd-sum"><span>Ø mündlich</span><b>${pdG(comp.mAvg, c, true) || '–'}</b></div>
      ${bonus('allgemein')}
      <div class="pd-line pd-total"><span>Gesamtnote${man ? ' (festgelegt)' : ''}<small> · Gewichtung ${comp.wt.w}/${comp.wt.m}</small></span><b>${pdGL(eff.value, c)}</b></div>
    </div>`;
  };

  const blocks = [];
  blocks.push(`<div class="pd-cols">${hys.map(hyBox).join('')}</div>`);
  if (o.hy === 'beide') {
    const e = effEndjahr(c, s.id);
    blocks.push(`<div class="pd-box pd-end"><div class="pd-line pd-total"><span>Endjahresnote<small> · 1. HJ ${c.weightHY1} % / 2. HJ ${c.weightHY2} %${e.manual != null && e.computed != null ? ' · festgelegt' : ''}</small></span><b>${pdGL(e.value, c)}</b></div></div>`);
  }
  if (o.verlauf) {
    const series = gradeSeries(c, s.id, hys);
    if (series.length >= 2) blocks.push(`<div class="pd-box"><h3>Notenverlauf</h3>${pdVerlaufSvg(series, c.scale)}</div>`);
  }
  if (o.raster) {
    const rCols = hys.flatMap(h => c.halfYears[h].columns.filter(x => x.raster && rasterHasRating(x, s.id)));
    rCols.forEach(col => {
      const def = col.raster.def, rt = rasterRating(col, s.id), v = rt.v || {};
      const sug = rasterSuggest(def, rt);
      const cells = def.criteria.map(cr => {
        const li = rasterLevelIdx(def, v[cr.id]);
        return `<td><span class="pd-dim">${esc(cr.label)}</span><br><b>${li < 0 ? '–' : esc(def.levels[li].label)}</b></td>`;
      }).join('');
      blocks.push(`<div class="pd-box"><h3>${esc(col.label)} · Raster „${esc(def.name)}“${col.date ? ' · ' + fmtDate(col.date) : ''}</h3>
        <table class="pd-t pd-raster"><tr>${cells}<td class="pd-final">${col.noCount ? 'Vorschlag' : 'Note'}<br><b>${pdG(col.noCount ? sug.points : gr[col.id], c, false) || '–'}</b></td></tr></table>
        ${(rt.comment || '').trim() ? `<div class="pd-comment">${esc(rt.comment.trim())}</div>` : ''}</div>`);
    });
  }
  const extra = [];
  if (o.ha) { const hc = haCounts(c, s.id); extra.push(`<div><b>Hausaufgaben:</b> ${hc.gemacht}× gemacht · ${hc.nicht}× nicht gemacht</div>`); }
  if (o.info && s.info) extra.push(`<div><b>Kurzinfo:</b> <span class="pd-comment">${esc(s.info)}</span></div>`);
  if (extra.length) blocks.push(`<div class="pd-box pd-extra">${extra.join('')}</div>`);
  if (o.notes) {
    const ns = courseNotes(c, s.id);
    if (ns.length) blocks.push(`<div class="pd-box"><h3>Notizen</h3>${ns.slice(0, 6).map(n =>
      `<div class="pd-note"><b>${n.date ? fmtDate(n.date) : '–'}</b> ${esc(n.text)}</div>`).join('')}</div>`);
  }

  const meta = [scaleName(c.scale), s.entry ? 'Eintritt ' + fmtDate(s.entry) : '', s.exit ? 'Austritt ' + fmtDate(s.exit) : ''].filter(Boolean).join(' · ');
  return `<section class="pp-sheet pd">
    ${pdHead(pdCourseSub(c), esc(studentName(s)), meta)}
    ${blocks.join('')}
    ${pdFoot()}
  </section>`;
}

/* Verlauf als SVG mit festen Farben (die Datei-Ausgabe kennt keine CSS-Variablen) */
function pdVerlaufSvg(series, scale) {
  const n = series.length, W = 640, H = 150, pl = 34, pr = 10, pt = 8, pb = 18;
  const x = i => pl + i * (W - pl - pr) / (n - 1);
  const y = v => pt + (15 - v) / 15 * (H - pt - pb);
  const grid = [15, 12, 9, 6, 3, 0].map(v => `<line x1="${pl}" x2="${W - pr}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}" stroke="#ddd" stroke-width="0.6"/>
    <text x="${pl - 5}" y="${(y(v) + 3).toFixed(1)}" font-size="8" text-anchor="end" fill="#777">${fmtGrade(v, scale, false)}</text>`).join('');
  let bound = '';
  const b = series.findIndex(p => p.hy === '2');
  if (b > 0) {
    const bx = ((x(b) + x(b - 1)) / 2).toFixed(1);
    bound = `<line x1="${bx}" x2="${bx}" y1="${pt}" y2="${H - pb}" stroke="#999" stroke-dasharray="3 3" stroke-width="0.7"/><text x="${bx}" y="${H - 5}" font-size="8" text-anchor="middle" fill="#777">2. HJ</text>`;
  }
  const line = `<polyline points="${series.map((p, i) => `${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ')}" fill="none" stroke="#16514b" stroke-width="1.2" opacity=".45"/>`;
  const dots = series.map((p, i) => `<circle cx="${x(i).toFixed(1)}" cy="${y(p.value).toFixed(1)}" r="3.2" fill="${p.type === 'schriftlich' ? '#3f6fb0' : '#7a63bd'}"/>`).join('');
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" style="display:block">${grid}${bound}${line}${dots}</svg>
    <div class="pd-legend"><span style="color:#3f6fb0">●</span> schriftlich · <span style="color:#7a63bd">●</span> mündlich — chronologisch</div>`;
}

/* ============================================================
   Klassenliste (hoch)
   ============================================================ */
function pdListePage(c, o) {
  let people = c.students.filter(studentActive).slice();
  if (o.sort === 'nach') people.sort((a, b) => (a.lastName || '').localeCompare(b.lastName || '', 'de') || a.firstName.localeCompare(b.firstName, 'de'));
  if (o.sort === 'vor') people.sort((a, b) => a.firstName.localeCompare(b.firstName, 'de') || (a.lastName || '').localeCompare(b.lastName || '', 'de'));
  const heads = String(o.heads || '').split(',').map(x => x.trim());
  const cols = Array.from({ length: o.cols }, (_, i) => heads[i] || '');
  const rows = people.map((s, i) => `<tr><td>${i + 1}</td><td class="pd-name">${esc(studentName(s))}</td>${cols.map(() => '<td></td>').join('')}</tr>`).join('');
  return `<section class="pp-sheet pd">
    ${pdHead(pdCourseSub(c), esc(o.title || 'Klassenliste'), `${people.length} Schüler:innen`)}
    ${o.dateLine ? '<div class="pd-dateline"><span>Datum:</span><span>Notiz:</span></div>' : ''}
    <table class="pd-t pd-list" data-split="2"><thead><tr><th>Nr.</th><th class="pd-name">Name</th>${cols.map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead>
      <tbody>${rows}</tbody></table>
    ${pdFoot()}
  </section>`;
}

/* ============================================================
   Sitzplan (quer)
   ============================================================ */
function pdSitzplanPage(c, o) {
  const st = ensureSeating(c);
  const flip = o.view === 'klasse';   // aus Sicht der Klasse: um 180° gedreht, Tafel oben
  let cells = '';
  for (let yy = 0; yy < st.rows; yy++) {
    for (let xx = 0; xx < st.cols; xx++) {
      const x = flip ? st.cols - 1 - xx : xx, y = flip ? st.rows - 1 - yy : yy;
      const s = seatStudent(c, seatKey(x, y));
      cells += s && studentActive(s)
        ? `<div class="pd-seat"><b>${esc(s.firstName)}</b>${o.last && s.lastName ? `<span>${esc(s.lastName)}</span>` : ''}</div>`
        : '<div class="pd-seat empty"></div>';
    }
  }
  const front = '<div class="pd-front">Tafel · Pult</div>';
  return `<section class="pp-sheet pd">
    ${pdHead(pdCourseSub(c), 'Sitzplan', flip ? 'Blick aus der Klasse' : 'Blick vom Pult')}
    ${flip ? front : ''}
    <div class="pd-seats" style="grid-template-columns:repeat(${st.cols}, minmax(0, 1fr))">${cells}</div>
    ${flip ? '' : front}
    ${pdFoot()}
  </section>`;
}

/* ============================================================
   Styles der Druckseiten
   ============================================================ */
const PD_CSS = `
.pd-head { display: flex; align-items: flex-end; gap: 6mm; border-bottom: 0.6mm solid #16514b; padding-bottom: 2mm; margin-bottom: 3mm; }
.pd-titles { flex: 1; min-width: 0; }
.pd-sub { font-size: 7.5pt; color: #555; text-transform: uppercase; letter-spacing: .05em; }
.pd-title { font-size: 14pt; font-weight: 700; }
.pd-meta { font-size: 8pt; color: #333; text-align: right; }
.pd-foot { margin-top: 3mm; font-size: 6.5pt; color: #666; }
.pd-dim { color: #666; }
table.pd-t { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; }
table.pd-t th, table.pd-t td { border: 0.25mm solid #8a8a8a; padding: 1mm 1.4mm; font-size: 8pt; text-align: center; vertical-align: middle; }
table.pd-t thead th { background: #e1e5e9; font-size: 7pt; font-weight: 700; vertical-align: bottom; }
table.pd-t th small { display: block; font-weight: 500; color: #555; font-size: 6.2pt; }
table.pd-t th.pd-grp { background: #cfd6dd; font-size: 7.6pt; vertical-align: middle; }
table.pd-t .pd-name { text-align: left; white-space: nowrap; }
table.pd-t td.pd-avg { background: #f1f3f5; font-weight: 600; }
table.pd-t td.pd-final { background: #e2efec; font-weight: 700; }
table.pd-t tr.pd-inactive td { color: #888; font-style: italic; }
table.pd-t tfoot td { background: #e8ebee; font-weight: 700; border-top: 0.5mm solid #555; }
table.pd-t tr { break-inside: avoid; page-break-inside: avoid; }
table.pd-t td.pd-remark, table.pd-t th.pd-remark { width: 38%; }
table.pd-spiegel { width: auto; margin-top: 3mm; }
table.pd-spiegel th, table.pd-spiegel td { min-width: 10mm; }
.pd-list td { height: 7.5mm; }
.pd-list th:not(.pd-name):not(:first-child) { min-width: 12mm; }
.pd-dateline { display: flex; gap: 8mm; margin-bottom: 2.5mm; font-size: 8.5pt; }
.pd-dateline span { flex: 1; border-bottom: 0.25mm solid #777; padding-bottom: 4mm; }
.pd-dateline span:last-child { flex: 3; }
.pd-cols { display: flex; gap: 4mm; align-items: flex-start; }
.pd-cols > * { flex: 1; min-width: 0; }
.pd-box { border: 0.25mm solid #9a9a9a; padding: 2mm 2.5mm; margin-bottom: 3mm; break-inside: avoid; page-break-inside: avoid; font-size: 8pt; }
.pd-box h3 { font-size: 7pt; text-transform: uppercase; letter-spacing: .05em; color: #555; margin: 0 0 1.5mm; }
.pd-sec { font-size: 6.8pt; color: #555; margin: 1.6mm 0 0.4mm; text-transform: uppercase; letter-spacing: .04em; }
.pd-line { display: flex; justify-content: space-between; gap: 3mm; padding: 0.6mm 0; border-bottom: 0.15mm solid #ddd; }
.pd-line small { color: #666; font-size: 6.6pt; }
.pd-line b { font-variant-numeric: tabular-nums; }
.pd-line.pd-sum { border-bottom-color: #aaa; }
.pd-line.pd-total { font-weight: 700; font-size: 9.5pt; border-top: 0.4mm solid #333; border-bottom: none; margin-top: 1.2mm; padding-top: 1.2mm; }
.pd-end { padding-top: 0; }
.pd-end .pd-line.pd-total { border-top: none; margin-top: 0; }
table.pd-raster td { font-size: 7pt; }
.pd-comment { white-space: pre-wrap; margin-top: 1.5mm; }
.pd-note + .pd-note { margin-top: 1mm; }
.pd-extra > div + div { margin-top: 1mm; }
.pd-legend { font-size: 6.6pt; color: #555; margin-top: 1mm; }
.pd-seats { display: grid; gap: 2.5mm; }
.pd-seat { border: 0.35mm solid #444; min-height: 16mm; display: flex; flex-direction: column; justify-content: center; align-items: center; padding: 1mm; text-align: center; overflow: hidden; }
.pd-seat b { font-size: 10pt; }
.pd-seat span { font-size: 8pt; color: #444; }
.pd-seat.empty { border: 0.25mm dashed #c4c4c4; }
.pd-front { margin: 4mm auto; width: 50%; text-align: center; border: 0.35mm solid #444; background: #e1e5e9; padding: 1.5mm; font-size: 8pt; font-weight: 700; text-transform: uppercase; letter-spacing: .08em; }

/* Verdichtung, falls eine Seite zu hoch oder zu breit wird (siehe fitSheets) */
.pd-fit1 table.pd-t th, .pd-fit1 table.pd-t td { font-size: 7pt; padding: 0.7mm 1mm; }
.pd-fit1 .pd-list td { height: 6.4mm; }
.pd-fit1 .pd-box { font-size: 7.4pt; padding: 1.6mm 2mm; margin-bottom: 2mm; }
.pd-fit1 .pd-seat { min-height: 12mm; }
.pd-fit2 table.pd-t th, .pd-fit2 table.pd-t td { font-size: 6.2pt; padding: 0.5mm 0.7mm; }
.pd-fit2 table.pd-t th small { font-size: 5.4pt; }
.pd-fit2 .pd-list td { height: 5.4mm; }
.pd-fit2 .pd-box { font-size: 6.8pt; }
.pd-fit2 .pd-seat b { font-size: 8.5pt; }
.pd-fit3 table.pd-t th, .pd-fit3 table.pd-t td { font-size: 5.5pt; padding: 0.4mm 0.5mm; }
.pd-fit3 .pd-list td { height: 4.8mm; }
.pd-fit3 .pd-box { font-size: 6.2pt; }
`;
