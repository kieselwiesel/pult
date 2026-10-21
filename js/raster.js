/* ============================================================
   Pult. — Bewertungsraster
   ------------------------------------------------------------
   Vorlage (data.rubrics): Kriterien (Spalten, je mit Gewicht in %) ×
   Stufen (Zeilen, je mit Punktebereich 0–15). In jeder Zelle steht, wie
   die Stufe bei diesem Kriterium aussieht.

   Einschätzung: eine Notenspalte mit `col.raster`. Beim Anlegen wird die
   Vorlage hineinkopiert (`def`) — spätere Änderungen an der Vorlage
   verändern also keine fertigen Einschätzungen. Pro Schüler:in:
     ratings[sId] = { v: { critId: punkte }, self: { critId: levelId }, comment }
   Aus den Punkten ergibt sich gewichtet ein Notenvorschlag. Solange die
   Note nicht abweichend festgelegt ist (manual[sId]), folgt die
   Notenspalte dem Vorschlag.

   Wird vor pult.js geladen: hier stehen nur Definitionen.
   ============================================================ */
'use strict';

/* ---------- Beispiel-Vorlage (fachunabhängig) ---------- */
const RASTER_INTRO = 'Schätze deine eigene Mitarbeit ein. Markiere Sätze, die deiner Meinung nach auf dich zutreffen.';
const RASTER_STD_LEVELS = () => ([
  { id: 'l1', label: 'sehr gut', min: 13, max: 15,
    desc: 'Die Leistung entspricht den Anforderungen in besonderen Maßen.' },
  { id: 'l2', label: 'gut', min: 10, max: 12,
    desc: 'Die Leistung entspricht voll den Anforderungen.' },
  { id: 'l3', label: 'befriedigend', min: 7, max: 9,
    desc: 'Die Leistung entspricht im Allgemeinen den Anforderungen.' },
  { id: 'l4', label: 'ausreichend', min: 4, max: 6,
    desc: 'Die Leistung weist zwar Mängel auf, entspricht aber im Ganzen noch den Anforderungen.' },
  { id: 'l5', label: 'mangelhaft', min: 1, max: 3,
    desc: 'Die Leistung entspricht nicht den Anforderungen. Mängel können in absehbarer Zeit behoben werden.' },
  { id: 'l6', label: 'ungenügend', min: 0, max: 0,
    desc: 'Die Leistung entspricht nicht den Anforderungen und selbst Grundkenntnisse sind so lückenhaft, dass Mängel in absehbarer Zeit nicht behoben werden können.' },
]);
function rasterExample(id, name, crits) {
  const levels = RASTER_STD_LEVELS();
  return {
    id, name, subject: '', intro: RASTER_INTRO, levels,
    criteria: crits.map(([cid, label, weight, texts]) => ({
      id: cid, label, weight,
      texts: Object.fromEntries(levels.map((l, i) => [l.id, texts[i] || ''])),
    })),
  };
}
function rasterExamples() {
  return [
    rasterExample('ex-mitarbeit', 'Beispielraster Mitarbeit', [
      ['beteiligung', 'Beteiligung am Unterricht', 20, [
        'Ich bin immer aufmerksam und beteilige mich in jeder Stunde von mir aus am Unterricht.',
        'Ich bin aufmerksam und beteilige mich meistens von mir aus am Unterricht.',
        'Ich bin aufmerksam und beteilige mich regelmäßig am Unterricht.',
        'Ich beteilige mich selten von mir aus. Nach Aufforderung kann ich meistens etwas beitragen.',
        'Ich beteilige mich fast nie und kann auch nach Aufforderung nur selten etwas beitragen.',
        'Ich beteilige mich nie. Auch nach Aufforderung kann ich nichts zum Unterricht beitragen.',
      ]],
      ['qualitaet', 'Qualität der Beiträge', 25, [
        'Meine Beiträge sind fachlich richtig, durchdacht und bringen den Unterricht voran.',
        'Meine Beiträge sind fachlich richtig und enthalten eigene Gedanken.',
        'Ich kann Gelerntes wiedergeben und auf ähnliche Aufgaben übertragen.',
        'Ich kann Gelerntes teilweise wiedergeben, meine Beiträge sind manchmal ungenau.',
        'Meine Beiträge gehen kaum auf das Unterrichtsthema ein.',
        'Meine Beiträge gehen nicht auf das Unterrichtsthema ein.',
      ]],
      ['fachsprache', 'Fachsprache und Ausdruck', 15, [
        'Ich drücke mich klar aus und verwende Fachbegriffe immer sicher und richtig.',
        'Ich drücke mich verständlich aus und verwende Fachbegriffe meistens richtig.',
        'Ich verwende ab und zu Fachbegriffe und schlage unbekannte Begriffe selbstständig nach.',
        'Ich verwende selten Fachbegriffe, kenne aber die meisten.',
        'Ich verwende fast nie Fachbegriffe und kenne nur wenige.',
        'Ich verwende keine Fachbegriffe und kenne sie nicht.',
      ]],
      ['selbststaendig', 'Selbstständiges Arbeiten', 15, [
        'Ich arbeite ausdauernd und eigenständig, weiß, was zu tun ist, und helfe anderen.',
        'Ich arbeite weitgehend selbstständig und frage gezielt nach, wenn es nötig ist.',
        'Ich brauche manchmal Hilfe, erledige dann aber die gestellten Aufgaben.',
        'Ich bin öfter abgelenkt, arbeite nach Aufforderung aber weiter.',
        'Ich arbeite nur mit viel Hilfe und erledige Aufgaben meist unvollständig.',
        'Ich arbeite auch mit Hilfe nicht an den Aufgaben.',
      ]],
      ['zusammenarbeit', 'Zusammenarbeit', 10, [
        'Ich arbeite gut mit anderen zusammen und bringe Gruppen- und Partnerarbeiten voran.',
        'Ich bin in Gruppen- und Partnerarbeiten verlässlich und gehe auf andere ein.',
        'Ich bringe mich in Gruppen- und Partnerarbeiten ein.',
        'Ich bringe mich in Gruppen- und Partnerarbeiten nur wenig ein, störe aber nicht.',
        'Ich lenke andere ab und zu von der Arbeit ab und trage kaum etwas bei.',
        'Ich halte andere von der Arbeit ab und trage nichts bei.',
      ]],
      ['hausaufgaben', 'Hausaufgaben und Unterlagen', 15, [
        'Meine Hausaufgaben sind immer vollständig und sorgfältig, meine Unterlagen ordentlich geführt.',
        'Meine Hausaufgaben und Unterlagen sind meistens vollständig und gut bearbeitet.',
        'Ich habe meine Hausaufgaben meistens oder hole sie selbstständig nach. Meine Unterlagen enthalten das Wichtigste.',
        'Meine Hausaufgaben sind öfter unvollständig, in meinen Unterlagen fehlt einiges.',
        'Ich erledige meine Hausaufgaben oft nicht, in meinen Unterlagen fehlt vieles.',
        'Ich erledige keine Hausaufgaben und habe keine Unterlagen.',
      ]],
    ]),
  ];
}

/* Beim ersten Start mit Rastern die Beispiele einmalig anlegen. Gelöschte
   Beispiele kommen nicht ungefragt zurück (dafür gibt es einen Knopf). */
function migrateRaster() {
  if (!Array.isArray(data.rubrics)) data.rubrics = [];
  if (!data.meta.rasterExamples) {
    rasterExamples().forEach(ex => { if (!data.rubrics.some(r => r.id === ex.id)) data.rubrics.push(ex); });
    data.meta.rasterExamples = true;
    save();
  }
}

/* ---------- Rechnen ---------- */
const rasterClone = o => JSON.parse(JSON.stringify(o));
const rasterMid = l => Math.round((Number(l.min) + Number(l.max)) / 2);
const rasterW = cr => Math.max(0, Number(cr.weight) || 0);
const rasterWeightSum = def => def.criteria.reduce((a, cr) => a + rasterW(cr), 0);

/* Stufe (Index) zu einem Punktwert; außerhalb aller Bereiche die nächstgelegene */
function rasterLevelIdx(def, pts) {
  if (pts == null || isNaN(pts) || !def.levels.length) return -1;
  let i = def.levels.findIndex(l => pts >= l.min && pts <= l.max);
  if (i < 0) {
    let best = Infinity;
    def.levels.forEach((l, j) => {
      const d = Math.min(Math.abs(pts - l.min), Math.abs(pts - l.max));
      if (d < best) { best = d; i = j; }
    });
  }
  return i;
}
function rasterRating(col, sId) { return ((col.raster && col.raster.ratings) || {})[sId] || {}; }
function rasterEnsureRating(col, sId) {
  const r = col.raster;
  if (!r.ratings) r.ratings = {};
  if (!r.ratings[sId]) r.ratings[sId] = { v: {}, self: {}, comment: '' };
  const rt = r.ratings[sId];
  if (!rt.v) rt.v = {};
  if (!rt.self) rt.self = {};
  return rt;
}
const rasterHasRating = (col, sId) => Object.keys(rasterRating(col, sId).v || {}).length > 0;

/* Gewichteter Schnitt der angekreuzten Kriterien. Nicht angekreuzte zählen
   nicht; ihr Gewicht verteilt sich auf die übrigen. */
function rasterSuggest(def, rating) {
  const v = (rating && rating.v) || {};
  const rated = def.criteria.filter(cr => v[cr.id] != null);
  const total = def.criteria.length;
  if (!rated.length) return { raw: null, points: null, n: 0, total };
  const ws = rated.reduce((a, cr) => a + rasterW(cr), 0);
  const raw = ws > 0
    ? rated.reduce((a, cr) => a + rasterW(cr) * v[cr.id], 0) / ws
    : rated.reduce((a, cr) => a + v[cr.id], 0) / rated.length;
  return { raw, points: clamp(Math.round(raw), 0, 15), n: rated.length, total };
}

/* Punktebereich einer Stufe in der Skala des Kurses */
function rasterRangeLabel(l, scale) {
  if (scale === 'noten') {
    const a = noteFromPoints(l.max), b = noteFromPoints(l.min);
    return a === b ? `Note ${a}` : `Note ${a}–${b}`;
  }
  return l.min === l.max ? `${l.min} P.` : `${l.min}–${l.max} P.`;
}
/* „11 Punkte (2)" bzw. „Note 2" */
function rasterGradeLong(p, scale) {
  if (p == null) return '–';
  return scale === 'noten' ? `Note ${NOTE_MAP[p]}` : `${pad2(p)} Punkte (${NOTE_MAP[p]})`;
}
function rasterChip(p, scale) {
  const gc = gradeColor(p);
  const fg = gc.fg === 'var(--line)' ? 'var(--ink-faint)' : gc.fg;
  return `<span class="sd-chip" style="background:${gc.bg};color:${fg}">${p == null ? '–' : fmtGrade(p, scale, false)}</span>`;
}
function rasterPill(col) {
  if (!col || !col.raster) return '';
  return ` <span class="pill ka-pill" data-kind="raster">Raster</span>${col.noCount ? ' <span class="pill ka-pill" data-kind="nocount">zählt nicht</span>' : ''}`;
}

/* Halbjahr, in dem eine Spalte liegt */
function rasterHyOf(c, col) { return c.halfYears['2'].columns.includes(col) ? '2' : '1'; }
function findRasterColumn(c) {
  for (const h of ['1', '2']) {
    const col = c.halfYears[h].columns.find(x => x.id === route.columnId && x.raster);
    if (col) return { col, hyKey: h };
  }
  return null;
}
function openRasterCol(c, col, sId) {
  go({ name: 'raster', courseId: c.id, columnId: col.id, hy: rasterHyOf(c, col),
       rTab: sId ? 'bogen' : 'liste', rStudent: sId || null });
}

/* Vorherige Einschätzung mit derselben Vorlage, in der die Person bewertet wurde */
function rasterPrevRound(c, col, sId) {
  const order = (x, h, i) => `${x.date || ''}|${h}|${String(i).padStart(4, '0')}`;
  const myH = rasterHyOf(c, col);
  const me = order(col, myH, c.halfYears[myH].columns.indexOf(col));
  let best = null, bestKey = '';
  ['1', '2'].forEach(h => c.halfYears[h].columns.forEach((x, i) => {
    if (!x.raster || x.id === col.id || x.raster.sourceId !== col.raster.sourceId) return;
    const k = order(x, h, i);
    if (k < me && k > bestKey && rasterHasRating(x, sId)) { best = x; bestKey = k; }
  }));
  return best;
}

/* Notenspalte an den Vorschlag angleichen — außer bei abweichend festgelegter Note */
function rasterApplyGrades(c, col, sIds) {
  const r = col.raster;
  if (!r.manual) r.manual = {};
  const ids = sIds.filter(id => !r.manual[id]);
  if (!ids.length) return;
  const snap = beginChange(ids.map(id => ['grades', id, col.id]));
  ids.forEach(id => {
    const p = rasterSuggest(r.def, rasterRating(col, id)).points;
    if (!data.grades[id]) data.grades[id] = {};
    if (p == null) delete data.grades[id][col.id]; else data.grades[id][col.id] = p;
  });
  let label = `${col.label} (Raster): Notenvorschläge neu berechnet`;
  if (ids.length === 1) {
    const s = c.students.find(x => x.id === ids[0]);
    label = `${s ? studentName(s) : 'Schüler:in'} — ${col.label} (Raster): ${gradeStr(snap[0].before, c)} → ${gradeStr((data.grades[ids[0]] || {})[col.id], c)}`;
  }
  /* gleicher Schlüssel wie setGradeLogged: Tippen im Raster und am Notenpad fließen zusammen */
  commitChange(label, snap, { courseId: c.id, mergeKey: ids.length === 1 ? `grades:${ids[0]}:${col.id}` : null });
}

/* kleines Bestätigungsfenster */
function rasterConfirm(title, html, okLabel, onOk, back) {
  modal(title, html, [
    { label: 'Abbrechen', onClick: back || closeModal },
    { label: okLabel, cls: 'danger', onClick: onOk },
  ]);
}
const rasterSlug = s => String(s || '').toLowerCase()
  .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
  .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'raster';

/* ============================================================
   Einschätzung im Kurs anlegen
   ============================================================ */
function createRasterRound(c) {
  const tpls = (data.rubrics || []).slice().sort((a, b) =>
    (b.subject === c.subject) - (a.subject === c.subject) || a.name.localeCompare(b.name, 'de'));
  if (!tpls.length) {
    modal('Bewertungsraster', `<div class="notice">Noch keine Raster-Vorlage vorhanden.</div>`, [
      { label: 'Abbrechen', onClick: closeModal },
      { label: 'Vorlagen öffnen', cls: 'primary', onClick: () => go(RASTER_LIST) },
    ]);
    return;
  }
  let count = 'muendlich';
  modal('Einschätzung mit Raster', `
    <div class="field"><label>Vorlage</label>
      <select id="rcTpl">${tpls.map(t => `<option value="${t.id}">${esc(t.name)}${t.subject ? ' · ' + esc(t.subject) : ''}</option>`).join('')}</select>
      <div class="hint">Die Vorlage wird kopiert — spätere Änderungen an ihr verändern diese Einschätzung nicht.</div>
    </div>
    <div class="row2">
      <div class="field"><label>Bezeichnung</label><input id="rcLabel" type="text" value="Mitarbeit"></div>
      <div class="field"><label>Datum</label><input id="rcDate" type="date" value="${todayISO()}"></div>
    </div>
    <div class="field" style="margin-top:14px"><label>Zählt als</label>
      <div class="seg" id="rcCount" style="width:100%">
        <button type="button" data-v="muendlich" style="flex:1" class="active">Mündlich</button>
        <button type="button" data-v="schriftlich" style="flex:1">Schriftlich</button>
        <button type="button" data-v="none" style="flex:1">Gar nicht</button>
      </div>
      <div class="hint">„Gar nicht" = nur Rückmeldung bzw. Zwischenstand, fließt nicht in die Note ein.</div>
    </div>
  `, [
    { label: 'Vorlagen verwalten', onClick: () => go(RASTER_LIST) },
    { label: 'Abbrechen', onClick: closeModal },
    { label: 'Anlegen', cls: 'primary', onClick: () => {
      const tpl = tpls.find(t => t.id === val('rcTpl'));
      if (!tpl) return;
      const def = rasterClone(tpl); delete def.id;
      const col = {
        id: uid(), type: count === 'schriftlich' ? 'schriftlich' : 'muendlich',
        label: val('rcLabel').trim() || 'Mitarbeit', date: val('rcDate'),
        raster: { sourceId: tpl.id, def, ratings: {}, manual: {} },
      };
      if (count === 'none') col.noCount = true;
      c.halfYears[route.hy].columns.push(col);
      save(); closeModal();
      go({ name: 'raster', courseId: c.id, columnId: col.id, rTab: 'bogen', rStudent: null });
    }},
  ]);
  document.querySelectorAll('#rcCount button').forEach(b => b.onclick = () => {
    count = b.dataset.v;
    document.querySelectorAll('#rcCount button').forEach(x => x.classList.toggle('active', x === b));
  });
}

/* ============================================================
   Seite einer Einschätzung: Übersicht / Einschätzen
   ============================================================ */
let rasterMode = 'lk';   // Eingabe als Lehrkraft ('lk') oder Selbsteinschätzung ('self')

function renderRaster() {
  const c = getCourse(route.courseId);
  if (!c) return go({ name: 'home' });
  const found = findRasterColumn(c);
  if (!found) return go({ name: 'course', courseId: c.id });
  const { col, hyKey } = found;
  route.hy = hyKey;
  const tab = route.rTab === 'bogen' ? 'bogen' : 'liste';
  const active = c.students.filter(studentActive);
  const done = active.filter(s => rasterHasRating(col, s.id)).length;
  const countTxt = col.noCount ? 'zählt nicht zur Note' : `zählt ${col.type === 'schriftlich' ? 'schriftlich' : 'mündlich'}`;

  app().innerHTML = `
    <div class="page-head">
      <div>
        <h1>${esc(col.label)}</h1>
        <div class="sub">Raster „${esc(col.raster.def.name)}" · ${esc(c.subject)} ${esc(c.className)} · ${hyKey}. Halbjahr${col.date ? ' · ' + fmtDateLong(col.date) : ''} · ${countTxt}</div>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn small" id="rsPrint">Drucken …</button>
        <button class="btn small" id="rsSettings">Einstellungen</button>
      </div>
    </div>
    <div class="tabs">
      <button class="tab ${tab === 'liste' ? 'active' : ''}" data-t="liste">Übersicht <span class="tab-count">${done}/${active.length}</span></button>
      <button class="tab ${tab === 'bogen' ? 'active' : ''}" data-t="bogen">Einschätzen</button>
    </div>
    <div id="rsBody"></div>`;

  app().querySelectorAll('.tab').forEach(t => t.onclick = () => go({ rTab: t.dataset.t }));
  document.getElementById('rsPrint').onclick = () => openRasterPrint(c, col, tab === 'bogen' ? route.rStudent : null);
  document.getElementById('rsSettings').onclick = () => openRasterSettings(c, col);

  if (tab === 'bogen') renderRasterBogen(c, col);
  else renderRasterListe(c, col);
}

/* --- Reiter: Übersicht der Klasse --- */
function renderRasterListe(c, col) {
  const body = document.getElementById('rsBody');
  const def = col.raster.def, scale = c.scale;
  if (!c.students.length) {
    body.innerHTML = `<div class="empty-state"><p>Noch keine Schüler:innen in diesem Kurs.</p></div>`;
    return;
  }
  const head = def.criteria.map(cr =>
    `<th class="grp-muend rs-crit-h" title="${esc(cr.label)}">${esc(cr.label)}<span class="ch-date">${fmtNum(cr.weight)} %</span></th>`).join('');
  const rows = c.students.map(s => {
    const rt = rasterRating(col, s.id), v = rt.v || {};
    const sug = rasterSuggest(def, rt);
    const g = (data.grades[s.id] || {})[col.id];
    const manual = !!(col.raster.manual || {})[s.id];
    const cells = def.criteria.map(cr => {
      const p = v[cr.id];
      if (p == null) return `<td><div class="cell rs-lvl-cell empty">·</div></td>`;
      const l = def.levels[rasterLevelIdx(def, p)];
      return `<td><div class="cell rs-lvl-cell" style="color:${gradeInk(p)}"><b>${fmtGrade(p, scale, false)}</b><small>${esc(l ? l.label : '')}</small></div></td>`;
    }).join('');
    const selfN = Object.keys(rt.self || {}).length;
    return `<tr class="rs-row ${studentActive(s) ? '' : 'inactive'}" data-s="${s.id}">
      <td class="col-name"><span class="sname">${esc(studentName(s))}${infoBadge(s)}${rt.comment ? ' <span class="rs-mark" title="Rückmeldung vorhanden">✎</span>' : ''}${selfN ? ' <span class="rs-mark" title="Selbsteinschätzung erfasst">S</span>' : ''}</span></td>
      ${cells}
      <td class="avg"><div class="cell">${sug.raw == null ? '–' : fmtGrade(sug.raw, scale, true)}</div></td>
      <td class="ka-note" title="${manual ? 'abweichend festgelegt' : 'folgt dem Vorschlag'}">${kaNoteCell(col.noCount ? null : g, scale)}${manual ? '<span class="rs-manual">*</span>' : ''}</td>
    </tr>`;
  }).join('');

  body.innerHTML = `
    <div class="notice">Zeile antippen, um einzuschätzen. Der Vorschlag ist der nach Gewicht gemittelte Wert der angekreuzten Kriterien${col.noCount ? '.' : ' und landet als Note in der Notentabelle — außer du legst sie abweichend fest (*).'}</div>
    <div class="table-wrap"><table class="grades rs-list">
      <thead><tr><th class="col-name">Schüler:in</th>${head}<th class="grp-muend">Ø Vorschlag</th><th class="grp-final">Note</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>`;
  body.querySelectorAll('tr.rs-row').forEach(tr => tr.onclick = () => go({ rTab: 'bogen', rStudent: tr.dataset.s }));
  bindInfoBadges(body, c);
}

/* --- Reiter: Einschätzen (Bogen einer Person) --- */
function renderRasterBogen(c, col) {
  const body = document.getElementById('rsBody');
  const r = col.raster, def = r.def, scale = c.scale;
  const list = c.students.filter(studentActive);
  if (!list.length) {
    body.innerHTML = `<div class="empty-state"><p>Keine aktiven Schüler:innen in diesem Kurs.</p></div>`;
    return;
  }
  let s = list.find(x => x.id === route.rStudent);
  if (!s) s = list.find(x => !rasterHasRating(col, x.id)) || list[0];
  route.rStudent = s.id;
  const idx = list.indexOf(s);
  const rt = rasterRating(col, s.id), v = rt.v || {}, self = rt.self || {};
  const prev = rasterPrevRound(c, col, s.id);
  const prevV = prev ? (rasterRating(prev, s.id).v || {}) : {};
  const sug = rasterSuggest(def, rt);
  const g = (data.grades[s.id] || {})[col.id];
  const manual = !!(r.manual || {})[s.id];
  const next = list[idx + 1];

  const headRow = def.criteria.map(cr => `<th>${esc(cr.label)}<span class="rs-w">${fmtNum(cr.weight)} %${v[cr.id] != null ? ` · <b>${fmtGrade(v[cr.id], scale, false)}</b>` : ''}</span></th>`).join('');
  const rows = def.levels.map((l, li) => {
    const cells = def.criteria.map(cr => {
      const sel = rasterLevelIdx(def, v[cr.id]) === li;
      const isSelf = self[cr.id] === l.id;
      const isPrev = !!prev && rasterLevelIdx(prev.raster.def, prevV[cr.id]) === li;
      const tags = (isSelf ? '<i class="rs-tag self" title="Selbsteinschätzung">S</i>' : '')
                 + (isPrev ? `<i class="rs-tag prev" title="Einschätzung vom ${esc(fmtDateLong(prev.date) || prev.label)}">zuvor</i>` : '');
      let pts = '';
      if (sel && l.max > l.min) {
        const opts = [];
        for (let p = l.max; p >= l.min; p--) opts.push(p);
        pts = `<div class="rs-pts">${opts.map(p => `<button data-p="${p}" class="${v[cr.id] === p ? 'on' : ''}">${fmtGrade(p, scale, false)}</button>`).join('')}</div>`;
      }
      return `<td class="rs-cell ${sel ? 'sel' : ''} ${isSelf ? 'self' : ''} ${isPrev ? 'prev' : ''}" data-c="${cr.id}" data-l="${li}">
        ${tags ? `<div class="rs-tags">${tags}</div>` : ''}
        <div class="rs-text">${esc((cr.texts || {})[l.id] || '')}</div>${pts}</td>`;
    }).join('');
    return `<tr><th class="rs-lvl"><b>${esc(l.label)}</b><span class="rs-range">${rasterRangeLabel(l, scale)}</span>${l.desc ? `<span class="rs-desc">${esc(l.desc)}</span>` : ''}</th>${cells}</tr>`;
  }).join('');

  const legend = [
    `<span><i class="rs-key sel"></i> ${rasterMode === 'lk' ? 'Antippen kreuzt an, nochmal antippen entfernt' : 'Einschätzung Lehrkraft'}</span>`,
    `<span><i class="rs-key self"></i> Selbsteinschätzung</span>`,
    prev ? `<span><i class="rs-key prev"></i> zuvor: ${esc(prev.label)}${prev.date ? ' vom ' + fmtDateLong(prev.date) : ''}</span>` : '',
  ].join('');

  const statusTxt = col.noCount ? 'zählt nicht zur Note' : manual ? 'abweichend festgelegt' : 'folgt dem Vorschlag';
  body.innerHTML = `
    <div class="rs-nav">
      <button class="btn small" id="rsPrev" ${idx === 0 ? 'disabled' : ''} aria-label="Vorherige:r">‹</button>
      <select id="rsPick">${list.map(x => `<option value="${x.id}" ${x.id === s.id ? 'selected' : ''}>${rasterHasRating(col, x.id) ? '✓ ' : ''}${esc(studentName(x))}</option>`).join('')}</select>
      <button class="btn small" id="rsNext" ${next ? '' : 'disabled'} aria-label="Nächste:r">›</button>
      <span class="rs-pos">${idx + 1} / ${list.length}</span>
      <div class="spacer"></div>
      <div class="seg" id="rsMode">
        <button data-m="lk" class="${rasterMode === 'lk' ? 'active' : ''}">Lehrkraft</button>
        <button data-m="self" class="${rasterMode === 'self' ? 'active' : ''}">Selbsteinschätzung</button>
      </div>
    </div>
    ${s.info ? `<div class="notice info-note"><span class="info-i">i</span> ${esc(s.info)}</div>` : ''}
    ${rasterMode === 'self' ? `<div class="notice" style="border-color:#7a63bd">Eingabe der <b>Selbsteinschätzung</b> von ${esc(s.firstName)} — fließt nicht in den Vorschlag ein, erscheint aber im Ausdruck.</div>` : ''}
    <div class="rs-grid-wrap"><table class="rs-grid ${rasterMode === 'self' ? 'rs-mode-self' : ''}">
      <colgroup><col class="rs-col-lvl">${def.criteria.map(() => '<col>').join('')}</colgroup>
      <thead><tr><th class="rs-lvl-h">Stufe</th>${headRow}</tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
    <div class="rs-legend">${legend}</div>

    <div class="rs-summary">
      <div class="rs-sum-box">
        <span class="dt-lbl">Vorschlag aus dem Raster</span>
        <div class="rs-sum-val">${rasterChip(sug.points, scale)}
          <span class="cs-sub">${sug.n ? `Ø ${fmtGrade(sug.raw, scale, true)}${scale === 'noten' ? '' : ' P.'} · ${sug.n} von ${sug.total} Kriterien` : 'noch nichts angekreuzt'}</span></div>
      </div>
      <div class="rs-sum-box">
        <span class="dt-lbl">Note in der Notentabelle</span>
        <div class="rs-sum-val">${rasterChip(col.noCount ? null : g, scale)} <span class="cs-sub">${statusTxt}</span></div>
        ${col.noCount ? '' : `<div class="set-buttons" style="margin-top:8px">
          <button class="btn small" id="rsPickGrade">Andere Note …</button>
          ${manual ? '<button class="btn small" id="rsUseSug">Vorschlag übernehmen</button>' : ''}</div>`}
      </div>
    </div>

    <div class="field" style="margin-top:14px"><label>Rückmeldung an ${esc(s.firstName)} <span class="cs-sub">— erscheint im Ausdruck</span></label>
      <textarea id="rsComment" placeholder="z. B. Du bringst dich regelmäßig ein. Achte noch stärker auf …">${esc(rt.comment || '')}</textarea>
    </div>

    <div class="toolbar">
      <button class="btn small danger" id="rsClear">Bogen leeren</button>
      <div class="spacer"></div>
      <button class="btn small" id="rsPrintOne">Bogen drucken</button>
      <button class="btn primary" id="rsNextBig">${next ? `Weiter: ${esc(studentName(next))} ›` : 'Fertig — zur Übersicht'}</button>
    </div>`;

  /* horizontale Scrollposition des Rasters über den Neuaufbau retten */
  const keepScroll = fn => {
    const w = body.querySelector('.rs-grid-wrap'); const left = w ? w.scrollLeft : 0;
    fn();
    const w2 = document.querySelector('#rsBody .rs-grid-wrap'); if (w2) w2.scrollLeft = left;
  };
  const changed = (gradeToo) => {
    if (gradeToo && !col.noCount) rasterApplyGrades(c, col, [s.id]);
    save();
    keepScroll(renderRaster);
  };
  const goStudent = id => { route.rStudent = id; renderRaster(); window.scrollTo(0, 0); };

  body.querySelectorAll('td.rs-cell').forEach(td => td.onclick = e => {
    const crId = td.dataset.c, li = +td.dataset.l;
    const level = def.levels[li];
    const pb = e.target.closest('.rs-pts button');
    const st = rasterEnsureRating(col, s.id);
    if (pb) { st.v[crId] = +pb.dataset.p; return changed(true); }
    if (rasterMode === 'self') {
      if (st.self[crId] === level.id) delete st.self[crId]; else st.self[crId] = level.id;
      return changed(false);
    }
    if (rasterLevelIdx(def, st.v[crId]) === li) delete st.v[crId];
    else st.v[crId] = rasterMid(level);
    changed(true);
  });
  body.querySelectorAll('#rsMode button').forEach(b => b.onclick = () => { rasterMode = b.dataset.m; keepScroll(renderRaster); });
  document.getElementById('rsPick').onchange = e => goStudent(e.target.value);
  document.getElementById('rsPrev').onclick = () => { if (idx > 0) goStudent(list[idx - 1].id); };
  document.getElementById('rsNext').onclick = () => { if (next) goStudent(next.id); };
  document.getElementById('rsNextBig').onclick = () => {
    if (next) return goStudent(next.id);
    go({ rTab: 'liste' }); toast('Alle durch.');
  };
  document.getElementById('rsComment').oninput = e => { rasterEnsureRating(col, s.id).comment = e.target.value; save(); };
  document.getElementById('rsPrintOne').onclick = () => openRasterPrint(c, col, s.id);
  document.getElementById('rsClear').onclick = () => rasterConfirm('Bogen leeren?',
    `<p>Kreuze, Selbsteinschätzung und Rückmeldung von <b>${esc(studentName(s))}</b> in dieser Einschätzung werden entfernt.</p>`,
    'Leeren', () => {
      delete r.ratings[s.id];
      if (r.manual) delete r.manual[s.id];
      closeModal(); changed(true);
    });
  const pg = document.getElementById('rsPickGrade');
  if (pg) pg.onclick = () => openPad(`${esc(studentName(s))} — ${esc(col.label)}`, g, p => {
    if (!r.manual) r.manual = {};
    if (p != null && p === sug.points) delete r.manual[s.id]; else r.manual[s.id] = true;
    setGradeLogged(c, 'grades', s.id, col.id, p, `${col.label} (Raster)`);
    renderRaster();
  }, scale);
  const us = document.getElementById('rsUseSug');
  if (us) us.onclick = () => { delete r.manual[s.id]; changed(true); };
  bindInfoBadges(body, c);
}

/* --- Einstellungen einer Einschätzung --- */
function openRasterSettings(c, col) {
  const r = col.raster, def = r.def;
  const tpl = (data.rubrics || []).find(t => t.id === r.sourceId);
  let count = col.noCount ? 'none' : col.type;
  const critRows = def.criteria.map(cr => `
    <div class="rs-w-row"><span>${esc(cr.label)}</span>
      <input type="number" min="0" max="100" step="1" data-w="${cr.id}" value="${fmtNum(cr.weight).replace(',', '.')}"><span class="cs-sub">%</span></div>`).join('');
  modal('Einschätzung — Einstellungen', `
    <div class="row2">
      <div class="field"><label>Bezeichnung</label><input id="reLabel" type="text" value="${esc(col.label)}"></div>
      <div class="field"><label>Datum</label><input id="reDate" type="date" value="${col.date || ''}"></div>
    </div>
    <div class="field" style="margin-top:14px"><label>Zählt als</label>
      <div class="seg" id="reCount" style="width:100%">
        <button type="button" data-v="muendlich" style="flex:1" class="${count === 'muendlich' ? 'active' : ''}">Mündlich</button>
        <button type="button" data-v="schriftlich" style="flex:1" class="${count === 'schriftlich' ? 'active' : ''}">Schriftlich</button>
        <button type="button" data-v="none" style="flex:1" class="${count === 'none' ? 'active' : ''}">Gar nicht</button>
      </div>
    </div>
    <div class="field" id="reFactorWrap" style="${count === 'none' ? 'display:none' : ''}"><label>Zählt n-fach</label>
      <input id="reFactor" type="number" min="0.1" max="20" step="0.5" value="${fmtNum(colFactor(col)).replace(',', '.')}">
      <div class="hint">Standard 1 — wiegt wie eine einfache Note desselben Bereichs.</div>
    </div>
    <div class="field"><label>Gewichtung der Kriterien</label>
      ${critRows}
      <div class="hint" id="reWSum"></div>
    </div>
    ${tpl ? `<button class="btn small" id="reReload">Texte und Stufen aus der Vorlage neu übernehmen</button>
      <div class="hint" style="margin-top:4px">Nötig, wenn du die Vorlage nachträglich korrigiert hast. Kreuze bleiben erhalten, solange es die Kriterien noch gibt.</div>` : ''}
  `, [
    { label: 'Löschen', cls: 'danger', onClick: () => confirmDeleteRaster(c, col) },
    { label: 'Abbrechen', onClick: closeModal },
    { label: 'Speichern', cls: 'primary', onClick: () => {
      col.label = val('reLabel').trim() || col.label;
      col.date = val('reDate');
      if (count === 'none') { col.noCount = true; col.type = 'muendlich'; }
      else { delete col.noCount; col.type = count; }
      delete col.factor;
      const f = clamp(parseFloat(val('reFactor').replace(',', '.')) || 1, 0.1, 20);
      if (f !== 1) col.factor = f;
      document.querySelectorAll('[data-w]').forEach(inp => {
        const cr = def.criteria.find(x => x.id === inp.dataset.w);
        if (cr) cr.weight = clamp(parseFloat(inp.value.replace(',', '.')) || 0, 0, 100);
      });
      if (!col.noCount) rasterApplyGrades(c, col, c.students.map(s => s.id));
      save(); closeModal(); renderRaster();
    }},
  ]);
  const sumHint = () => {
    let sum = 0;
    document.querySelectorAll('[data-w]').forEach(inp => sum += parseFloat(inp.value.replace(',', '.')) || 0);
    const el = document.getElementById('reWSum');
    el.innerHTML = Math.round(sum) === 100 ? `Summe: 100 %`
      : `<span style="color:var(--amber)">Summe: ${fmtNum(sum)} %</span> — wird anteilig umgerechnet.`;
  };
  document.querySelectorAll('[data-w]').forEach(inp => inp.oninput = sumHint);
  sumHint();
  document.querySelectorAll('#reCount button').forEach(b => b.onclick = () => {
    count = b.dataset.v;
    document.querySelectorAll('#reCount button').forEach(x => x.classList.toggle('active', x === b));
    document.getElementById('reFactorWrap').style.display = count === 'none' ? 'none' : '';
  });
  const rl = document.getElementById('reReload');
  if (rl) rl.onclick = () => {
    const fresh = rasterClone(tpl); delete fresh.id;
    r.def = fresh;
    if (!col.noCount) rasterApplyGrades(c, col, c.students.map(s => s.id));
    save(); closeModal(); renderRaster();
    toast('Vorlage neu übernommen.');
  };
}

function confirmDeleteRaster(c, col) {
  const hyKey = rasterHyOf(c, col);
  rasterConfirm('Einschätzung löschen?',
    `<p><b>${esc(col.label)}</b> wird mit allen Kreuzen, Rückmeldungen und der daraus entstandenen Notenspalte gelöscht.</p>`,
    'Löschen', () => {
      const hy = c.halfYears[hyKey];
      const n = gradeCountForColumn(c, col.id);
      const snap = beginChange([['courses', c.id, 'halfYears', hyKey, 'columns'],
        ...c.students.map(s => ['grades', s.id, col.id])]);
      hy.columns = hy.columns.filter(x => x.id !== col.id);
      Object.values(data.grades).forEach(gr => delete gr[col.id]);
      commitChange(`Raster-Einschätzung „${col.label}" gelöscht (${n} ${n === 1 ? 'Note' : 'Noten'})`, snap, { courseId: c.id });
      save(); closeModal(); go({ name: 'course', courseId: c.id, hy: hyKey });
    }, () => openRasterSettings(c, col));
}

/* ============================================================
   Vorlagen verwalten
   ============================================================ */
/* Beide Ansichten zeichnen in den Inhaltsbereich der Einstellungen (#setBody) —
   die Leiste mit den übrigen Bereichen bleibt dabei stehen. */
const RASTER_LIST = { name: 'settings', setPage: 'raster', rasterId: null };
function renderRasterVorlagen(host) {
  host = host || document.getElementById('setBody');
  if (!host) return go(RASTER_LIST);
  const list = data.rubrics || [];
  const missingEx = rasterExamples().filter(ex => !list.some(r => r.id === ex.id));
  const rows = list.map(t => {
    const sum = rasterWeightSum(t);
    return `<div class="chip rs-tpl">
      <div class="chip-main"><b>${esc(t.name || 'Ohne Namen')}</b>
        <span>${t.subject ? esc(t.subject) + ' · ' : ''}${t.criteria.length} Kriterien · ${t.levels.length} Stufen${Math.round(sum) === 100 ? '' : ` · <span style="color:var(--amber)">Gewichte ${fmtNum(sum)} %</span>`}</span></div>
      <div class="set-buttons">
        <button class="btn small" data-act="edit" data-id="${t.id}">Bearbeiten</button>
        <button class="btn small" data-act="blank" data-id="${t.id}">Leerer Bogen</button>
        <button class="btn small" data-act="dup" data-id="${t.id}">Duplizieren</button>
        <button class="btn small" data-act="export" data-id="${t.id}">Exportieren</button>
        <button class="btn small danger" data-act="del" data-id="${t.id}">Löschen</button>
      </div>
    </div>`;
  }).join('') || `<div class="notice">Noch keine Vorlagen.</div>`;

  host.innerHTML = `
    <div class="set-toolbar">
      <div class="hint">Vorlagen für Einschätzungen nach Kriterien. Im Kurs über <b>+ Leistung → Bewertungsraster</b> verwenden.</div>
      <div class="set-buttons">
        <button class="btn small" id="rvImport">Importieren</button>
        <button class="btn small primary" id="rvNew">+ Neues Raster</button>
        <input type="file" id="rvFile" accept="application/json,.json" hidden>
      </div>
    </div>
    ${missingEx.length ? `<div class="notice" style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap">
      <span>Beispiele: ${missingEx.map(e => esc(e.name)).join(', ')}</span>
      <button class="btn small" id="rvExamples">Beispiele hinzufügen</button></div>` : ''}
    <div class="chip-list">${rows}</div>`;

  document.getElementById('rvNew').onclick = () => {
    const levels = RASTER_STD_LEVELS().map(l => ({ ...l, id: uid() }));
    const t = {
      id: uid(), name: 'Neues Raster', subject: '', intro: RASTER_INTRO, levels,
      criteria: ['Kriterium 1', 'Kriterium 2', 'Kriterium 3'].map((label, i) =>
        ({ id: uid(), label, weight: i === 0 ? 34 : 33, texts: {} })),
    };
    data.rubrics.push(t); save();
    go({ name: 'settings', setPage: 'raster', rasterId: t.id });
  };
  const fileInput = document.getElementById('rvFile');
  document.getElementById('rvImport').onclick = () => fileInput.click();
  fileInput.onchange = () => { if (fileInput.files[0]) importRasterFile(fileInput.files[0]); };
  const ex = document.getElementById('rvExamples');
  if (ex) ex.onclick = () => {
    missingEx.forEach(e => data.rubrics.push(e));
    save(); renderRasterVorlagen(); toast('Beispiele hinzugefügt.');
  };
  host.querySelectorAll('[data-act]').forEach(b => b.onclick = () => {
    const t = data.rubrics.find(x => x.id === b.dataset.id); if (!t) return;
    const act = b.dataset.act;
    if (act === 'edit') go({ name: 'settings', setPage: 'raster', rasterId: t.id });
    else if (act === 'blank') openRasterBlankPrint(t);
    else if (act === 'dup') {
      const copy = rasterClone(t); copy.id = uid(); copy.name = t.name + ' (Kopie)';
      data.rubrics.push(copy); save(); renderRasterVorlagen();
    } else if (act === 'export') {
      const payload = JSON.stringify({ app: 'Pult', type: 'bewertungsraster', version: 1, raster: t }, null, 2);
      saveFile(new Blob([payload], { type: 'application/json' }), `raster-${rasterSlug(t.name)}.json`);
    } else if (act === 'del') {
      rasterConfirm('Vorlage löschen?', `<p><b>${esc(t.name)}</b> wird gelöscht. Bereits angelegte Einschätzungen in Kursen bleiben erhalten.</p>`,
        'Löschen', () => { data.rubrics = data.rubrics.filter(x => x.id !== t.id); save(); closeModal(); renderRasterVorlagen(); });
    }
  });
}

function importRasterFile(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const parsed = JSON.parse(reader.result);
      const t = parsed && parsed.raster ? parsed.raster : parsed;
      if (!t || !Array.isArray(t.levels) || !Array.isArray(t.criteria) || !t.levels.length)
        throw new Error('kein Raster');
      t.levels.forEach(l => { l.id = l.id || uid(); l.min = clamp(Number(l.min) || 0, 0, 15); l.max = clamp(Number(l.max) || 0, 0, 15); });
      t.criteria.forEach(cr => { cr.id = cr.id || uid(); cr.texts = cr.texts || {}; cr.weight = Number(cr.weight) || 0; });
      t.id = uid();
      t.name = t.name || 'Importiertes Raster';
      data.rubrics.push(t); save(); renderRasterVorlagen();
      toast(`„${t.name}" importiert.`);
    } catch (e) {
      toast('Datei ist kein gültiges Bewertungsraster.');
    }
  };
  reader.readAsText(file);
}

/* --- Vorlage bearbeiten --- */
function renderRasterEdit(host) {
  host = host || document.getElementById('setBody');
  const t = (data.rubrics || []).find(x => x.id === route.rasterId);
  if (!t || !host) return go(RASTER_LIST);
  const sum = rasterWeightSum(t);

  const critRows = t.criteria.map((cr, i) => `
    <div class="rs-ed-row" data-i="${i}">
      <input type="text" class="ed-crit-label" value="${esc(cr.label)}" placeholder="Kriterium">
      <input type="number" class="ed-crit-w" min="0" max="100" step="1" value="${fmtNum(cr.weight).replace(',', '.')}" title="Gewicht in %">
      <button class="btn small ed-crit-left" ${i === 0 ? 'disabled' : ''} title="nach links">←</button>
      <button class="btn small ed-crit-right" ${i === t.criteria.length - 1 ? 'disabled' : ''} title="nach rechts">→</button>
      <button class="btn small danger ed-crit-del" title="Kriterium löschen">×</button>
    </div>`).join('');
  const lvlRows = t.levels.map((l, i) => `
    <div class="rs-ed-lvl" data-i="${i}">
      <div class="rs-ed-top">
        <input type="text" class="ed-lvl-label" value="${esc(l.label)}" placeholder="Stufe, z. B. gut">
        <input type="number" class="ed-lvl-min" min="0" max="15" value="${l.min}" title="Punkte von">
        <input type="number" class="ed-lvl-max" min="0" max="15" value="${l.max}" title="Punkte bis">
        <button class="btn small ed-lvl-up" ${i === 0 ? 'disabled' : ''} title="nach oben">↑</button>
        <button class="btn small ed-lvl-down" ${i === t.levels.length - 1 ? 'disabled' : ''} title="nach unten">↓</button>
        <button class="btn small danger ed-lvl-del" title="Stufe löschen">×</button>
      </div>
      <textarea class="ed-lvl-desc" placeholder="Beschreibung der Stufe (optional)">${esc(l.desc || '')}</textarea>
    </div>`).join('');
  const gridHead = t.criteria.map(cr => `<th>${esc(cr.label)}</th>`).join('');
  const gridRows = t.levels.map(l => `<tr><th class="rs-lvl"><b>${esc(l.label)}</b><span class="rs-range">${rasterRangeLabel(l, 'punkte')}</span></th>
    ${t.criteria.map(cr => `<td><textarea class="ed-text" data-c="${cr.id}" data-l="${l.id}" placeholder="Beschreibung …">${esc((cr.texts || {})[l.id] || '')}</textarea></td>`).join('')}</tr>`).join('');

  host.innerHTML = `
    <button class="set-back set-back-sub" id="edBack">‹ Alle Vorlagen</button>
    <div class="set-toolbar">
      <div><div class="rs-ed-name">${esc(t.name || 'Raster')}</div>
        <div class="hint">Änderungen werden sofort gespeichert. Bereits angelegte Einschätzungen behalten ihre Fassung.</div></div>
      <div class="set-buttons">
        <button class="btn small" id="edBlank">Leerer Bogen</button>
        <button class="btn small primary" id="edDone">Fertig</button>
      </div>
    </div>

    <div class="rs-ed-cols">
      <div class="calc-block">
        <h3>Allgemein</h3>
        <div class="field"><label>Name</label><input id="edName" type="text" value="${esc(t.name || '')}"></div>
        <div class="field"><label>Fach (optional)</label><input id="edSubject" type="text" value="${esc(t.subject || '')}" placeholder="z. B. Mathematik"></div>
        <div class="field"><label>Hinweis auf dem leeren Bogen</label>
          <textarea id="edIntro" style="min-height:60px">${esc(t.intro || '')}</textarea>
          <div class="hint">Steht über dem Raster, wenn du Bögen zur Selbsteinschätzung druckst.</div></div>
      </div>
      <div class="calc-block">
        <h3>Kriterien und Gewichtung</h3>
        <div id="edCrits">${critRows}</div>
        <div class="hint" id="edWSum" style="margin-bottom:8px">${Math.round(sum) === 100 ? 'Summe: 100 %' : `<span style="color:var(--amber)">Summe: ${fmtNum(sum)} %</span> — wird beim Rechnen anteilig umgerechnet.`}</div>
        <button class="btn small" id="edAddCrit">+ Kriterium</button>
      </div>
    </div>

    <div class="calc-block">
      <h3>Stufen (oben = beste)</h3>
      <div class="hint" style="margin-bottom:8px">Punktebereich 0–15. Beim Antippen einer Stufe wird zunächst die Mitte des Bereichs gesetzt; feiner geht es danach direkt in der Zelle.</div>
      <div id="edLevels">${lvlRows}</div>
      <button class="btn small" id="edAddLvl">+ Stufe</button>
    </div>

    <div class="calc-block">
      <h3>Beschreibungen</h3>
      <div class="rs-grid-wrap"><table class="rs-grid rs-ed-grid">
        <colgroup><col class="rs-col-lvl">${t.criteria.map(() => '<col>').join('')}</colgroup>
        <thead><tr><th class="rs-lvl-h">Stufe</th>${gridHead}</tr></thead>
        <tbody>${gridRows}</tbody>
      </table></div>
    </div>`;

  const rerender = () => { save(); const y = window.scrollY; renderRasterEdit(); window.scrollTo(0, y); };
  document.getElementById('edDone').onclick = () => go(RASTER_LIST);
  document.getElementById('edBack').onclick = () => go(RASTER_LIST);
  document.getElementById('edBlank').onclick = () => openRasterBlankPrint(t);
  document.getElementById('edName').oninput = e => { t.name = e.target.value; save(); };
  document.getElementById('edName').onchange = rerender;
  document.getElementById('edSubject').oninput = e => { t.subject = e.target.value.trim(); save(); };
  document.getElementById('edIntro').oninput = e => { t.intro = e.target.value; save(); };

  /* Kriterien */
  const wSum = () => {
    const s = rasterWeightSum(t);
    document.getElementById('edWSum').innerHTML = Math.round(s) === 100 ? 'Summe: 100 %'
      : `<span style="color:var(--amber)">Summe: ${fmtNum(s)} %</span> — wird beim Rechnen anteilig umgerechnet.`;
  };
  host.querySelectorAll('.rs-ed-row').forEach(row => {
    const i = +row.dataset.i, cr = t.criteria[i];
    row.querySelector('.ed-crit-label').oninput = e => { cr.label = e.target.value; save(); };
    row.querySelector('.ed-crit-label').onchange = rerender;
    row.querySelector('.ed-crit-w').oninput = e => { cr.weight = clamp(parseFloat(e.target.value.replace(',', '.')) || 0, 0, 100); save(); wSum(); };
    row.querySelector('.ed-crit-left').onclick = () => { t.criteria.splice(i - 1, 0, t.criteria.splice(i, 1)[0]); rerender(); };
    row.querySelector('.ed-crit-right').onclick = () => { t.criteria.splice(i + 1, 0, t.criteria.splice(i, 1)[0]); rerender(); };
    row.querySelector('.ed-crit-del').onclick = () => rasterConfirm('Kriterium löschen?',
      `<p><b>${esc(cr.label)}</b> samt seinen Beschreibungen wird aus der Vorlage entfernt.</p>`, 'Löschen',
      () => { t.criteria.splice(i, 1); closeModal(); rerender(); });
  });
  document.getElementById('edAddCrit').onclick = () => {
    t.criteria.push({ id: uid(), label: 'Kriterium ' + (t.criteria.length + 1), weight: 0, texts: {} });
    rerender();
  };

  /* Stufen */
  host.querySelectorAll('.rs-ed-lvl').forEach(row => {
    const i = +row.dataset.i, l = t.levels[i];
    row.querySelector('.ed-lvl-label').oninput = e => { l.label = e.target.value; save(); };
    row.querySelector('.ed-lvl-label').onchange = rerender;
    const minI = row.querySelector('.ed-lvl-min'), maxI = row.querySelector('.ed-lvl-max');
    const setRange = () => {
      l.min = clamp(parseInt(minI.value, 10) || 0, 0, 15);
      l.max = clamp(parseInt(maxI.value, 10) || 0, 0, 15);
      if (l.max < l.min) l.max = l.min;
      rerender();
    };
    minI.onchange = setRange; maxI.onchange = setRange;
    row.querySelector('.ed-lvl-desc').oninput = e => { l.desc = e.target.value; save(); };
    row.querySelector('.ed-lvl-up').onclick = () => { t.levels.splice(i - 1, 0, t.levels.splice(i, 1)[0]); rerender(); };
    row.querySelector('.ed-lvl-down').onclick = () => { t.levels.splice(i + 1, 0, t.levels.splice(i, 1)[0]); rerender(); };
    row.querySelector('.ed-lvl-del').onclick = () => {
      if (t.levels.length <= 1) return toast('Mindestens eine Stufe muss bleiben.');
      rasterConfirm('Stufe löschen?', `<p><b>${esc(l.label)}</b> samt Beschreibungen wird entfernt.</p>`, 'Löschen',
        () => { t.levels.splice(i, 1); t.criteria.forEach(cr => cr.texts && delete cr.texts[l.id]); closeModal(); rerender(); });
    };
  });
  document.getElementById('edAddLvl').onclick = () => {
    t.levels.push({ id: uid(), label: 'Neue Stufe', desc: '', min: 0, max: 0 });
    rerender();
  };

  /* Beschreibungen */
  host.querySelectorAll('textarea.ed-text').forEach(ta => ta.oninput = () => {
    const cr = t.criteria.find(x => x.id === ta.dataset.c); if (!cr) return;
    if (!cr.texts) cr.texts = {};
    cr.texts[ta.dataset.l] = ta.value;
    save();
  });
}

/* ============================================================
   Drucken
   ============================================================ */
const RASTER_PRINT_DEFAULT = () => ({
  kind: 'einschaetzung', note: true, entw: true, next: true, comment: true, self: true,
  levelDesc: true, noten: false, ha: false, notes: false, info: false, onlyRated: true,
});
function rasterPrintOpts() {
  if (!data.meta.rasterPrint) data.meta.rasterPrint = RASTER_PRINT_DEFAULT();
  return Object.assign(RASTER_PRINT_DEFAULT(), data.meta.rasterPrint);
}

/* Druckoptionen. sId gesetzt = vom Bogen einer Person aus aufgerufen. */
function openRasterPrint(c, col, sId) {
  const o = rasterPrintOpts();
  const s = sId ? c.students.find(x => x.id === sId) : null;
  const active = c.students.filter(studentActive);
  let scope = s ? 'one' : 'all';
  const chk = (key, label, hint) => `<label class="check-row"><input type="checkbox" data-o="${key}" ${o[key] ? 'checked' : ''}>
    <span>${label}${hint ? ` <small>${hint}</small>` : ''}</span></label>`;

  modal('Drucken', `
    ${s ? `<div class="field"><label>Umfang</label>
      <div class="seg" id="rpScope" style="width:100%">
        <button type="button" data-v="one" style="flex:1" class="active">${esc(studentName(s))}</button>
        <button type="button" data-v="all" style="flex:1">Ganze Klasse</button>
      </div></div>` : ''}
    <div class="field"><label>Art</label>
      <div class="seg" id="rpKind" style="width:100%">
        <button type="button" data-v="einschaetzung" style="flex:1" class="${o.kind !== 'leer' ? 'active' : ''}">Einschätzung</button>
        <button type="button" data-v="leer" style="flex:1" class="${o.kind === 'leer' ? 'active' : ''}">Leerer Bogen mit Namen</button>
      </div>
      <div class="hint" id="rpKindHint"></div>
    </div>
    <div class="check-list" id="rpOpts">
      ${chk('note', 'Note und Vorschlag')}
      ${chk('entw', 'Entwicklung', 'seit der letzten Einschätzung mit diesem Raster')}
      ${chk('next', 'Nächste Schritte', 'Text der nächsthöheren Stufe bei den schwächsten Kriterien')}
      ${chk('comment', 'Rückmeldung')}
      ${chk('self', 'Selbsteinschätzung markieren')}
      ${chk('levelDesc', 'Beschreibung der Stufen', 'spart ausgeschaltet Platz')}
      ${chk('noten', 'Notenübersicht des Halbjahres')}
      ${chk('ha', 'Hausaufgaben')}
      ${chk('notes', 'Notizen zur Person', 'die letzten drei — privat!')}
      ${chk('info', 'Kurzinfo', 'z. B. Nachteilsausgleich — privat!')}
      <div id="rpOnlyWrap">${chk('onlyRated', 'Nur Schüler:innen mit Einschätzung')}</div>
    </div>
  `, [
    { label: 'Abbrechen', onClick: closeModal },
    { label: 'Vorschau ›', cls: 'primary', onClick: () => {
      document.querySelectorAll('#rpOpts [data-o]').forEach(inp => o[inp.dataset.o] = inp.checked);
      data.meta.rasterPrint = o; save();
      let people = scope === 'one' && s ? [s] : active;
      if (scope !== 'one' && o.kind !== 'leer' && o.onlyRated) people = people.filter(x => rasterHasRating(col, x.id));
      if (!people.length) return toast('Niemand zu drucken — noch keine Einschätzungen.');
      closeModal();
      const pages = people.map(p => rasterSheetHtml({ def: col.raster.def, course: c, col, student: p, opts: o, blank: o.kind === 'leer' }));
      openPrintView({
        title: `${col.label} — ${c.subject} ${c.className}`, pages, landscape: true, css: RASTER_PRINT_CSS, fit: RASTER_FIT,
        filename: `raster-${rasterSlug(c.className)}-${rasterSlug(col.label)}${scope === 'one' && s ? '-' + rasterSlug(studentName(s)) : ''}`,
      });
    }},
  ]);
  const sync = () => {
    const blank = o.kind === 'leer';
    document.getElementById('rpOpts').style.display = blank ? 'none' : '';
    document.getElementById('rpOnlyWrap').style.display = scope === 'one' ? 'none' : '';
    const n = scope === 'one' ? 1 : (blank || !o.onlyRated ? active.length : active.filter(x => rasterHasRating(col, x.id)).length);
    document.getElementById('rpKindHint').textContent = blank
      ? `Raster ohne Kreuze, mit Name und Hinweistext — zum Selbsteinschätzen. ${n} ${n === 1 ? 'Seite' : 'Seiten'}.`
      : `Eine DIN-A4-Seite (quer) pro Person — ${n} ${n === 1 ? 'Seite' : 'Seiten'}.`;
  };
  document.querySelectorAll('#rpScope button').forEach(b => b.onclick = () => {
    scope = b.dataset.v;
    document.querySelectorAll('#rpScope button').forEach(x => x.classList.toggle('active', x === b));
    sync();
  });
  document.querySelectorAll('#rpKind button').forEach(b => b.onclick = () => {
    o.kind = b.dataset.v;
    document.querySelectorAll('#rpKind button').forEach(x => x.classList.toggle('active', x === b));
    sync();
  });
  const only = document.querySelector('[data-o="onlyRated"]');
  if (only) only.onchange = () => { o.onlyRated = only.checked; sync(); };
  sync();
}

/* Leerer Bogen direkt aus einer Vorlage (ohne Kurs, ohne Namen) */
function openRasterBlankPrint(t) {
  openPrintView({
    title: `${t.name} — leerer Bogen`, landscape: true, css: RASTER_PRINT_CSS, fit: RASTER_FIT,
    pages: [rasterSheetHtml({ def: t, blank: true, opts: { levelDesc: true } })],
    filename: `raster-${rasterSlug(t.name)}-leer`,
  });
}

/* Eine A4-Seite. o: { def, course, col, student, opts, blank } */
function rasterSheetHtml(o) {
  const { def, course: c, col, student: s, blank } = o;
  const opts = o.opts || {};
  const scale = c ? c.scale : 'punkte';
  const rt = !blank && col && s ? rasterRating(col, s.id) : {};
  const v = rt.v || {};
  const self = !blank && opts.self ? (rt.self || {}) : {};
  const prev = !blank && opts.entw && c && col && s ? rasterPrevRound(c, col, s.id) : null;
  const prevV = prev ? (rasterRating(prev, s.id).v || {}) : {};
  const subject = c ? c.subject : (def.subject || '');

  const head = `<header class="rs-p-head">
    <div class="rs-p-titles">
      <div class="rs-p-sub">${esc(subject)}${c ? ' · ' + esc(c.className) : ''}</div>
      <div class="rs-p-title">${esc(def.name)}</div>
    </div>
    <div class="rs-p-meta">${col && !blank ? `${esc(col.label)}${col.date ? '<br>' + fmtDateLong(col.date) : ''}` : ''}</div>
    <div class="rs-p-name"><span>Name</span><b>${s ? esc(studentName(s)) : ''}</b></div>
  </header>`;
  const intro = blank && def.intro ? `<div class="rs-p-intro">${esc(def.intro)}</div>` : '';

  const thead = `<tr><th class="rs-p-lvl">Leistungsbewertung</th>${def.criteria.map(cr =>
    `<th>${esc(cr.label)}${!blank ? `<small>${fmtNum(cr.weight)} %</small>` : ''}</th>`).join('')}</tr>`;
  const tbody = def.levels.map((l, li) => `<tr>
    <th class="rs-p-lvl"><b>${esc(l.label)}</b><small>${rasterRangeLabel(l, scale)}</small>${opts.levelDesc !== false && l.desc ? `<span>${esc(l.desc)}</span>` : ''}</th>
    ${def.criteria.map(cr => {
      const sel = !blank && rasterLevelIdx(def, v[cr.id]) === li;
      const isSelf = self[cr.id] === l.id;
      const isPrev = !!prev && rasterLevelIdx(prev.raster.def, prevV[cr.id]) === li;
      const tags = (sel && l.max > l.min ? `<i class="rs-p-tag pts">${fmtGrade(v[cr.id], scale, false)}</i>` : '')
                 + (isSelf ? '<i class="rs-p-tag self">S</i>' : '')
                 + (isPrev ? '<i class="rs-p-tag prev">zuvor</i>' : '');
      return `<td class="${sel ? 'sel' : ''} ${isSelf ? 'self' : ''} ${isPrev ? 'prev' : ''}">${tags ? `<span class="rs-p-tags">${tags}</span>` : ''}${esc((cr.texts || {})[l.id] || '')}</td>`;
    }).join('')}</tr>`).join('');
  const grid = `<table class="rs-p-grid"><colgroup><col class="rs-p-lvlcol">${def.criteria.map(() => '<col>').join('')}</colgroup>
    <thead>${thead}</thead><tbody>${tbody}</tbody></table>`;

  if (blank) return `<section class="pp-sheet rs-p">${head}${intro}${grid}</section>`;

  /* Kästen unter dem Raster */
  const boxes = [];
  if (opts.note) {
    const sug = rasterSuggest(def, rt);
    const g = col.noCount ? null : (data.grades[s.id] || {})[col.id];
    const shown = g != null ? g : sug.points;
    boxes.push(`<div class="rs-p-box"><h4>${g != null ? 'Bewertung' : 'Vorschlag'}</h4>
      <div class="rs-p-big">${rasterGradeLong(shown, scale)}</div>
      ${g != null && sug.points != null && sug.points !== g ? `<div>Vorschlag aus dem Raster: ${rasterGradeLong(sug.points, scale)}</div>` : ''}
      <div class="rs-p-small">${sug.n} von ${sug.total} Kriterien eingeschätzt</div></div>`);
  }
  if (prev) {
    const pdef = prev.raster.def;
    const lines = def.criteria.map(cr => {
      const a = rasterLevelIdx(pdef, prevV[cr.id]), b = rasterLevelIdx(def, v[cr.id]);
      if (a < 0 || b < 0 || a === b) return '';
      const up = b < a;
      return `<li>${esc(cr.label)}: ${esc(pdef.levels[a].label)} → ${esc(def.levels[b].label)} <span class="${up ? 'rs-p-up' : 'rs-p-down'}">${up ? '▲' : '▼'}</span></li>`;
    }).filter(Boolean);
    boxes.push(`<div class="rs-p-box"><h4>Entwicklung seit ${esc(prev.date ? fmtDateLong(prev.date) : prev.label)}</h4>
      ${lines.length ? `<ul>${lines.join('')}</ul>` : '<div>In allen Kriterien gleich geblieben.</div>'}</div>`);
  }
  if (opts.next) {
    const cand = def.criteria
      .map(cr => ({ cr, li: rasterLevelIdx(def, v[cr.id]) }))
      .filter(x => x.li > 0 && ((x.cr.texts || {})[def.levels[x.li - 1].id] || '').trim())
      .sort((a, b) => b.li - a.li || rasterW(b.cr) - rasterW(a.cr))
      .slice(0, 2);
    if (cand.length) boxes.push(`<div class="rs-p-box rs-p-wide"><h4>Nächste Schritte</h4><ul>${cand.map(x =>
      `<li><b>${esc(x.cr.label)}:</b> „${esc(x.cr.texts[def.levels[x.li - 1].id])}“</li>`).join('')}</ul></div>`);
  }
  if (opts.comment && (rt.comment || '').trim())
    boxes.push(`<div class="rs-p-box rs-p-wide"><h4>Rückmeldung</h4><div class="rs-p-comment">${esc(rt.comment.trim())}</div></div>`);
  /* kleine Zusatzdaten teilen sich einen Kasten */
  const more = [];
  if (opts.noten) {
    const hyKey = rasterHyOf(c, col);
    const comp = computeHalf(c, hyKey, s.id);
    const eff = effGesamt(c, hyKey, s.id);
    more.push(`<div><b>Noten ${hyKey}. Halbjahr</b> <span class="rs-p-small">(Stand ${fmtDate(todayISO())})</span><br>
      Ø schriftlich ${fmtGrade(comp.wAvg, scale, true)} · Ø mündlich ${fmtGrade(comp.mAvg, scale, true)} ·
      Gesamt <b>${fmtGrade(eff.value, scale, true)}</b>${eff.value != null && scale !== 'noten' ? ` (${noteLabel(eff.value)})` : ''}</div>`);
  }
  if (opts.ha) {
    const hc = haCounts(c, s.id);
    more.push(`<div><b>Hausaufgaben</b><br>${hc.gemacht}× gemacht · ${hc.nicht}× nicht gemacht</div>`);
  }
  if (opts.info && s.info) more.push(`<div><b>Kurzinfo</b><br><span class="rs-p-comment">${esc(s.info)}</span></div>`);
  if (more.length) boxes.push(`<div class="rs-p-box rs-p-more">${more.join('')}</div>`);
  if (opts.notes) {
    const ns = courseNotes(c, s.id).slice(0, 3);
    if (ns.length) boxes.push(`<div class="rs-p-box rs-p-wide"><h4>Notizen</h4><ul>${ns.map(n =>
      `<li>${n.date ? '<b>' + fmtDate(n.date) + '</b> ' : ''}${esc(n.text)}</li>`).join('')}</ul></div>`);
  }

  const legend = [
    Object.keys(v).length ? 'markiert = Einschätzung der Lehrkraft' : '',
    Object.keys(self).length ? 'S = Selbsteinschätzung' : '',
    prev ? `zuvor = ${esc(prev.label)}${prev.date ? ' vom ' + fmtDateLong(prev.date) : ''}` : '',
  ].filter(Boolean).join(' · ');

  return `<section class="pp-sheet rs-p">${head}${grid}
    ${boxes.length ? `<div class="rs-p-foot">${boxes.join('')}</div>` : ''}
    ${legend ? `<div class="rs-p-legend">${legend}</div>` : ''}</section>`;
}

const RASTER_FIT = ['rs-fit1', 'rs-fit2', 'rs-fit3'];

/* Styles der Druckseite (Maße in mm/pt) */
const RASTER_PRINT_CSS = `
.rs-p-head { display: flex; align-items: flex-end; gap: 6mm; border-bottom: 0.6mm solid #16514b; padding-bottom: 2mm; margin-bottom: 2.5mm; }
.rs-p-titles { flex: 1; min-width: 0; }
.rs-p-sub { font-size: 7.5pt; color: #555; text-transform: uppercase; letter-spacing: .05em; }
.rs-p-title { font-size: 13pt; font-weight: 700; }
.rs-p-meta { font-size: 8pt; color: #333; text-align: right; }
.rs-p-name { min-width: 62mm; border: 0.3mm solid #333; padding: 1.5mm 2.5mm; font-size: 10.5pt; display: flex; gap: 2.5mm; align-items: baseline; }
.rs-p-name span { font-size: 7pt; color: #555; }
.rs-p-intro { font-weight: 700; font-size: 8.5pt; margin-bottom: 2mm; }
table.rs-p-grid { width: 100%; border-collapse: collapse; table-layout: fixed; }
col.rs-p-lvlcol { width: 34mm; }
table.rs-p-grid th, table.rs-p-grid td { border: 0.25mm solid #7a7a7a; padding: 1.2mm 1.4mm; vertical-align: middle; text-align: center; font-size: 6.9pt; line-height: 1.22; position: relative; }
table.rs-p-grid thead th { background: #e1e5e9; font-size: 7.6pt; }
table.rs-p-grid thead th small { display: block; font-weight: 500; color: #555; font-size: 6.5pt; }
table.rs-p-grid th.rs-p-lvl { background: #eceff2; font-weight: 400; }
table.rs-p-grid thead th.rs-p-lvl { background: #e1e5e9; font-weight: 700; }
th.rs-p-lvl b { display: block; font-size: 7.6pt; }
th.rs-p-lvl small { display: block; color: #333; font-weight: 600; font-size: 6.6pt; }
th.rs-p-lvl span { display: block; color: #444; font-size: 6.1pt; margin-top: 0.6mm; }
table.rs-p-grid td.sel { background: #cde8e0; box-shadow: inset 0 0 0 0.6mm #16514b; font-weight: 600; color: #000; }
table.rs-p-grid td.self { outline: 0.4mm dashed #6b55b0; outline-offset: -1.1mm; }
table.rs-p-grid td.prev:not(.sel) { background: #f0f0f0; }
.rs-p-tags { display: flex; justify-content: flex-end; gap: 0.6mm; margin: -0.4mm -0.4mm 0.6mm 0; }
.rs-p-tag { font-style: normal; font-size: 5.6pt; font-weight: 700; padding: 0.1mm 0.9mm; border-radius: 0.6mm; background: #fff; border: 0.2mm solid #777; color: #444; }
.rs-p-tag.pts { background: #16514b; border-color: #16514b; color: #fff; }
.rs-p-tag.self { color: #4a3d73; border-color: #6b55b0; }
.rs-p-foot { display: flex; flex-wrap: wrap; gap: 2.5mm; margin-top: 2.5mm; break-inside: avoid; page-break-inside: avoid; }
.rs-p-box { flex: 1 1 40mm; border: 0.25mm solid #9a9a9a; padding: 1.8mm 2.2mm; font-size: 7.6pt; }
.rs-p-wide { flex: 2 1 72mm; }
.rs-p-more > div + div { margin-top: 1.2mm; }
.rs-p-box h4 { margin: 0 0 1mm; font-size: 6.6pt; text-transform: uppercase; letter-spacing: .05em; color: #555; }
.rs-p-box ul { margin: 0; padding-left: 3.5mm; }
.rs-p-box li + li { margin-top: 0.6mm; }
.rs-p-big { font-size: 11pt; font-weight: 700; }
.rs-p-small { font-size: 6.6pt; color: #555; margin-top: 0.6mm; }
.rs-p-up { color: #127a3a; } .rs-p-down { color: #b6362c; }
.rs-p-comment { white-space: pre-wrap; }
.rs-p-legend { margin-top: 1.5mm; font-size: 6.4pt; color: #555; }

/* Verdichtung, falls eine Seite nicht auf ein Blatt passt (siehe fitSheets) */
.rs-fit1 table.rs-p-grid th, .rs-fit1 table.rs-p-grid td { font-size: 6.4pt; padding: 0.8mm 1.1mm; line-height: 1.17; }
.rs-fit1 th.rs-p-lvl span { font-size: 5.6pt; }
.rs-fit1 .rs-p-box { font-size: 7pt; padding: 1.4mm 1.8mm; }
.rs-fit2 th.rs-p-lvl span { display: none; }
.rs-fit2 col.rs-p-lvlcol { width: 24mm; }
.rs-fit3 table.rs-p-grid th, .rs-fit3 table.rs-p-grid td { font-size: 5.9pt; padding: 0.6mm 0.9mm; }
.rs-fit3 .rs-p-box { font-size: 6.4pt; }
`;
