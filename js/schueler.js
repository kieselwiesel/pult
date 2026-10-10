/* ============================================================
   Pult. — Schüler:in (Detailseite)
   ------------------------------------------------------------
   Kopf mit dem Wichtigsten auf einen Blick, blättern zur nächsten Person
   (Knöpfe oder Pfeiltasten), Noten beider Halbjahre mit Rechenweg,
   Verlauf mit Kursschnitt, Raster-Einschätzungen und Notizen als
   Zeitleiste.

   Gesprächsmodus: blendet Kurzinfo und Notizen aus — zum Zeigen im
   Elterngespräch.

   Wird vor pult.js geladen: hier stehen nur Definitionen.
   ============================================================ */
'use strict';

let studentTalk = false;          // Gesprächsmodus
let studentVerlauf = 'alle';      // 'alle' | 'muendlich' | 'schriftlich'

function renderStudent() {
  const c = getCourse(route.courseId);
  if (!c) return go({ name: 'home' });
  const s = c.students.find(x => x.id === route.studentId);
  if (!s) return go({ name: 'course', courseId: c.id });
  const scale = c.scale;
  const list = c.students;
  const idx = list.indexOf(s);
  const hyNow = defaultHalfYear(c);

  const valChip = (pts, avg) => {
    const gc = gradeColor(pts);
    const fg = gc.fg === 'var(--line)' ? 'var(--ink-faint)' : gc.fg;
    return `<span class="sd-chip" style="background:${gc.bg};color:${fg}">${fmtGrade(pts, scale, avg)}</span>`;
  };

  /* ---------- Kopf: das Wichtigste ---------- */
  const has2 = hasEntries(c, '2');
  const cur = has2 ? effEndjahr(c, s.id).value : effGesamt(c, '1', s.id).value;
  const curLbl = has2 ? 'Endjahr (Stand)' : '1. Halbjahr';
  const trend = trendDir(c, hyNow, s.id);
  const mean = courseMean(c);
  const mCols = ['1', '2'].flatMap(h => c.halfYears[h].columns.filter(x => x.type === 'muendlich'));
  const mDates = mCols.filter(col => (data.grades[s.id] || {})[col.id] != null && col.date).map(col => col.date).sort();
  const lastM = mDates.length ? daysSince(mDates[mDates.length - 1]) : null;
  const ha = haCounts(c, s.id);
  const haQuote = ha.gemacht + ha.nicht ? Math.round(ha.gemacht / (ha.gemacht + ha.nicht) * 100) : null;
  const openLists = data.lists.filter(l => l.courseId === c.id && !['abgegeben', 'befreit'].includes((l.status || {})[s.id]));
  const notes = courseNotes(c, s.id);

  const card = (label, value, foot, cls) => `<div class="sd-card ${cls || ''}"><div class="sd-card-l">${label}</div><div class="sd-card-v">${value}</div><div class="sd-card-f">${foot || ''}</div></div>`;
  const cards = [
    card(curLbl, `${valChip(cur, true)}${trendArrowSvg(trend)}`, mean != null ? `Kursschnitt ${fmtGrade(mean, scale, true)}` : ''),
    card('Mündlich zuletzt', lastM == null ? '—' : lastM === 0 ? 'heute' : `vor ${lastM} ${lastM === 1 ? 'Tag' : 'Tagen'}`,
      blindSpot(c, hyNow, s.id) ? '<span class="blind-dot"></span> länger nichts' : `${mDates.length} mündliche Noten`, blindSpot(c, hyNow, s.id) ? 'warn' : ''),
    card('Hausaufgaben', haQuote == null ? '—' : `${haQuote} %`, `${ha.gemacht}× gemacht · ${ha.nicht}× nicht`, ha.nicht >= 3 ? 'warn' : ''),
    openLists.length ? card('Offen', `${openLists.length}`, esc(openLists.map(l => l.title).slice(0, 2).join(', ')), 'warn') : '',
  ].join('');

  /* ---------- Halbjahre ---------- */
  const leistungRow = (col, hyKey, parts) => {
    const v = (data.grades[s.id] || {})[col.id];
    const p = (parts || []).find(x => x.col.id === col.id);
    const share = p ? ` <span class="cs-sub">· ${fmtNum(p.pct)} %${p.fixed ? ' fest' : ''}</span>`
      : (colWeighted(col) ? ` <span class="cs-sub">· ${weightLabel(col)}</span>` : '');
    return `<div class="cs-line sd-grade" data-col="${col.id}" data-hy="${hyKey}">
      <span>${esc(col.label)}${kaPill(col)}${rasterPill(col)}${col.date ? ` <span class="cs-sub">${fmtDate(col.date)}</span>` : ''}${share}</span>
      <span class="cs-vals">${valChip(v, false)}</span></div>`;
  };
  const sonstRow = so => {
    const v = (data.sonstigeValues[s.id] || {})[so.id];
    return `<div class="cs-line sd-sonst" data-so="${so.id}"><span>Bonus: ${esc(so.label)} (${so.percent}%)</span><span class="cs-vals">${valChip(v, false)}</span></div>`;
  };
  const hyBlock = hyKey => {
    const hy = c.halfYears[hyKey];
    const comp = computeHalf(c, hyKey, s.id);
    const eff = effGesamt(c, hyKey, s.id);
    const schrift = hy.columns.filter(x => x.type === 'schriftlich');
    const muend = hy.columns.filter(x => x.type === 'muendlich');
    const manual = eff.manual != null && eff.computed != null;
    return `<div class="calc-block calc-sheet">
      <h3>${hyKey}. Halbjahr</h3>
      <div class="cs-sub" style="margin-bottom:4px">Schriftlich</div>
      ${schrift.length ? schrift.map(col => leistungRow(col, hyKey, comp.wParts)).join('') : '<div class="cs-line cs-sub"><span>keine</span><span></span></div>'}
      ${hy.sonstige.filter(x => x.scope === 'schriftlich').map(sonstRow).join('')}
      <div class="cs-line"><span><b>Ø schriftlich</b></span><span class="cs-vals">${fmtGrade(comp.wAvg, scale, true)}</span></div>
      <div class="cs-sub" style="margin:8px 0 4px">Mündlich</div>
      ${muend.length ? muend.map(col => leistungRow(col, hyKey, comp.mParts)).join('') : '<div class="cs-line cs-sub"><span>keine</span><span></span></div>'}
      ${hy.sonstige.filter(x => x.scope === 'muendlich').map(sonstRow).join('')}
      <div class="cs-line"><span><b>Ø mündlich</b></span><span class="cs-vals">${fmtGrade(comp.mAvg, scale, true)}</span></div>
      ${hy.sonstige.filter(x => x.scope === 'allgemein').map(sonstRow).join('')}
      <div class="cs-line total"><span>Gesamtnote${manual ? ' (manuell)' : ''}</span>
        <span class="cs-vals">${valChip(eff.value, true)}${manual ? ` <span class="cs-sub">(${fmtGrade(eff.computed, scale, true)})</span>` : ''}</span></div>
      <button class="btn small sd-calc" data-hy="${hyKey}" style="margin-top:8px">Rechenweg & Note setzen</button>
    </div>`;
  };
  const endj = effEndjahr(c, s.id);
  const endManual = endj.manual != null && endj.computed != null;

  /* ---------- Raster ---------- */
  const rCols = ['1', '2'].flatMap(h => c.halfYears[h].columns.filter(x => x.raster && rasterHasRating(x, s.id)));
  const rasterHtml = rCols.map(col => {
    const def = col.raster.def, rt = rasterRating(col, s.id), v = rt.v || {};
    const sug = rasterSuggest(def, rt);
    return `<button class="sd-raster" data-raster="${col.id}">
      <div class="sd-raster-h"><b>${esc(col.label)}</b><span class="cs-sub">${col.date ? fmtDate(col.date) + ' · ' : ''}${esc(def.name)}</span>
        ${valChip(col.noCount ? sug.points : (data.grades[s.id] || {})[col.id], false)}</div>
      <div class="sd-raster-crit">${def.criteria.map(cr => {
        const li = rasterLevelIdx(def, v[cr.id]);
        return `<span><small>${esc(cr.label)}</small><b>${li < 0 ? '–' : esc(def.levels[li].label)}</b></span>`;
      }).join('')}</div>
      ${!studentTalk && (rt.comment || '').trim() ? `<div class="sd-raster-c">${esc(rt.comment.trim())}</div>` : ''}
    </button>`;
  }).join('');

  /* ---------- Notizen (Zeitleiste) ---------- */
  const notesHtml = `
    <div class="sd-note-add">
      <input id="sdNoteDate" type="date" value="${todayISO()}">
      <textarea id="sdNoteText" placeholder="Beobachtung, Gespräch, Absprache …" rows="2"></textarea>
      <button class="btn small primary" id="sdNoteAdd">Notiz hinzufügen</button>
    </div>
    <div class="sd-timeline">${notes.map(n => `<div class="sd-note">
      <div class="sd-note-d">${n.date ? fmtDateLong(n.date) : 'ohne Datum'}</div>
      <div class="sd-note-t">${esc(n.text)}</div>
      <button class="icon-btn sd-note-del" data-del="${n.id}" aria-label="Notiz löschen">×</button>
    </div>`).join('') || '<div class="cs-sub">Noch keine Notizen.</div>'}</div>`;

  /* ---------- Verlauf ---------- */
  const verlaufTabs = `<div class="seg sd-vseg" id="sdVSeg">${[['alle', 'Alle'], ['muendlich', 'Mündlich'], ['schriftlich', 'Schriftlich']].map(([k, l]) =>
    `<button data-v="${k}" class="${studentVerlauf === k ? 'active' : ''}">${l}</button>`).join('')}</div>`;

  const prev = list[idx - 1], next = list[idx + 1];
  app().innerHTML = `
    ${studentTalk ? `<div class="sd-talk">Gesprächsmodus — Kurzinfo und Notizen sind ausgeblendet. <button class="btn small" id="sdTalkOff">Beenden</button></div>` : ''}
    <div class="sd-nav">
      <button class="btn small" id="sdPrev" ${prev ? '' : 'disabled'} title="${prev ? esc(studentName(prev)) : ''}">‹</button>
      <select id="sdPick" aria-label="Schüler:in wählen">${list.map(x => `<option value="${x.id}" ${x.id === s.id ? 'selected' : ''}>${esc(studentName(x))}${studentActive(x) ? '' : ' (aus)'}</option>`).join('')}</select>
      <button class="btn small" id="sdNext" ${next ? '' : 'disabled'} title="${next ? esc(studentName(next)) : ''}">›</button>
      <span class="rs-pos">${idx + 1} / ${list.length}</span>
    </div>
    <div class="page-head">
      <div>
        <h1>${esc(studentName(s))}${!studentTalk ? infoBadge(s) : ''}</h1>
        <div class="sub">${esc(c.subject)} ${esc(c.className)} · ${scaleName(scale)}${s.entry ? ' · Eintritt ' + fmtDateLong(s.entry) : ''}${s.exit ? ' · Austritt ' + fmtDateLong(s.exit) : ''}</div>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn small" id="sdSim">Was brauche ich noch?</button>
        ${studentTalk ? '' : '<button class="btn small" id="sdInfo">Kurzinfo</button>'}
        <button class="btn small" id="sdEdit">Stammdaten</button>
        <button class="btn small" id="sdPrint">Drucken</button>
        ${studentTalk ? '' : '<button class="btn small" id="sdTalk" title="Kurzinfo und Notizen ausblenden">Gesprächsmodus</button>'}
      </div>
    </div>

    ${s.info && !studentTalk ? `<div class="notice info-note"><span class="info-i" title="Kurzinfo">i</span> ${esc(s.info)}</div>` : ''}

    <div class="sd-cards">${cards}</div>

    <div class="sd-layout">
      <div>
        ${hyBlock('1')}
        ${hyBlock('2')}
        <div class="calc-block calc-sheet" style="border-left:4px solid var(--accent)">
          <h3>Endjahresnote (${c.weightHY1}/${c.weightHY2})</h3>
          <div class="cs-line"><span>Gesamt 1. Halbjahr</span><span class="cs-vals">${fmtGrade(endj.g1, scale, true)}</span></div>
          <div class="cs-line"><span>Gesamt 2. Halbjahr</span><span class="cs-vals">${fmtGrade(endj.g2, scale, true)}</span></div>
          <div class="cs-line total"><span>Endjahr${endManual ? ' (manuell)' : ''}</span>
            <span class="cs-vals">${valChip(endj.value, true)}${endManual ? ` <span class="cs-sub">(${fmtGrade(endj.computed, scale, true)})</span>` : ''}</span></div>
          <button class="btn small" id="sdEndCalc" style="margin-top:8px">Rechenweg & Note setzen</button>
        </div>
      </div>
      <div>
        <div class="calc-block">
          <div class="sd-block-h"><h3>Notenverlauf</h3>${verlaufTabs}</div>
          ${sdVerlaufSvg(c, s, studentVerlauf)}
        </div>
        ${rasterHtml ? `<div class="calc-block"><h3>Raster-Einschätzungen</h3>${rasterHtml}</div>` : ''}
        ${studentTalk ? '' : `<div class="calc-block"><h3>Notizen</h3>${notesHtml}</div>`}
      </div>
    </div>`;

  /* ---------- Ereignisse ---------- */
  const goTo = id => { route.studentId = id; render(); window.scrollTo(0, 0); };
  document.getElementById('sdPrev').onclick = () => prev && goTo(prev.id);
  document.getElementById('sdNext').onclick = () => next && goTo(next.id);
  document.getElementById('sdPick').onchange = e => goTo(e.target.value);
  document.getElementById('sdEdit').onclick = () => openStudentForm(c, s.id);
  document.getElementById('sdSim').onclick = () => openSimulator(c, s.id);
  document.getElementById('sdPrint').onclick = () => openCoursePrintOpts(c, 'boegen', s.id);
  const info = document.getElementById('sdInfo'); if (info) info.onclick = () => openInfoEdit(c, s, () => renderStudent());
  const talk = document.getElementById('sdTalk'); if (talk) talk.onclick = () => { studentTalk = true; renderStudent(); };
  const talkOff = document.getElementById('sdTalkOff'); if (talkOff) talkOff.onclick = () => { studentTalk = false; renderStudent(); };
  app().querySelectorAll('#sdVSeg button').forEach(b => b.onclick = () => { studentVerlauf = b.dataset.v; renderStudent(); });

  app().querySelectorAll('.sd-grade').forEach(row => row.onclick = () => {
    const col = c.halfYears[row.dataset.hy].columns.find(x => x.id === row.dataset.col);
    if (col.ka) return go({ name: 'ka', courseId: c.id, hy: row.dataset.hy, columnId: col.id, kaTab: 'eingabe' });
    if (col.raster) return openRasterCol(c, col, s.id);
    const cur = (data.grades[s.id] || {})[col.id];
    openPad(`${esc(s.firstName)} — ${esc(col.label)}`, cur, v => {
      setGradeLogged(c, 'grades', s.id, col.id, v, col.label);
      renderStudent();
    }, scale);
  });
  app().querySelectorAll('.sd-sonst').forEach(row => row.onclick = () => {
    const soId = row.dataset.so;
    const so = findSonstige(c, soId);
    const cur = (data.sonstigeValues[s.id] || {})[soId];
    openPad(`${esc(s.firstName)} — Bonus`, cur, v => {
      setGradeLogged(c, 'sonstigeValues', s.id, soId, v, `${so ? so.label : 'Bonus'} (Bonus)`);
      renderStudent();
    }, scale);
  });
  app().querySelectorAll('.sd-calc').forEach(b => b.onclick = () => { route.hy = b.dataset.hy; openCalc(c, s.id, 'gesamt'); });
  document.getElementById('sdEndCalc').onclick = () => openCalc(c, s.id, 'endjahr');
  app().querySelectorAll('[data-raster]').forEach(b => b.onclick = () => {
    const col = rCols.find(x => x.id === b.dataset.raster); if (col) openRasterCol(c, col, s.id);
  });
  const add = document.getElementById('sdNoteAdd');
  if (add) add.onclick = () => {
    const text = val('sdNoteText').trim();
    if (!text) return toast('Bitte Text eingeben.');
    data.notes.push({ id: uid(), courseId: c.id, studentId: s.id, date: val('sdNoteDate'), text });
    save(); renderStudent();
  };
  app().querySelectorAll('.sd-note-del').forEach(b => b.onclick = () => {
    const n = data.notes.find(x => x.id === b.dataset.del); if (!n) return;
    modal('Notiz löschen?', `<p>${esc(n.text)}</p>`, [
      { label: 'Abbrechen', onClick: closeModal },
      { label: 'Löschen', cls: 'danger', onClick: () => { data.notes = data.notes.filter(x => x.id !== n.id); save(); closeModal(); renderStudent(); } },
    ]);
  });
  bindInfoBadges(app(), c);
}

/* Pfeiltasten blättern (Magic Keyboard), solange kein Eingabefeld oder Fenster offen ist */
document.addEventListener('keydown', e => {
  if (route.name !== 'student' || e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
  if (!document.getElementById('modalBackdrop').hidden || document.querySelector('.lockscreen, #printView, #stage')) return;
  if (/^(INPUT|TEXTAREA|SELECT)$/.test((document.activeElement || {}).tagName)) return;
  const b = document.getElementById(e.key === 'ArrowLeft' ? 'sdPrev' : 'sdNext');
  if (b && !b.disabled) { e.preventDefault(); b.click(); }
});

/* Verlauf: Noten der Person chronologisch, dazu der Kursschnitt derselben Leistung */
function sdVerlaufSvg(c, s, type) {
  const pts = [];
  ['1', '2'].forEach(h => c.halfYears[h].columns.forEach(col => {
    if (col.type !== 'schriftlich' && col.type !== 'muendlich') return;
    if (type !== 'alle' && col.type !== type) return;
    const v = (data.grades[s.id] || {})[col.id];
    if (v == null || isNaN(v)) return;
    const others = c.students.filter(studentActive).map(x => (data.grades[x.id] || {})[col.id]).filter(x => x != null && !isNaN(x));
    pts.push({ v, avg: others.length ? others.reduce((a, b) => a + b, 0) / others.length : null, type: col.type, label: col.label, date: col.date, hy: h });
  }));
  if (pts.length < 2) return `<div class="cs-sub">Zu wenige Noten für einen Verlauf.</div>`;
  const scale = c.scale;
  const W = 620, H = 200, pl = 34, pr = 12, pt = 12, pb = 26, n = pts.length;
  const x = i => pl + i * (W - pl - pr) / (n - 1);
  const y = v => pt + (15 - v) / 15 * (H - pt - pb);
  const grid = [15, 12, 9, 6, 3, 0].map(v => `<line x1="${pl}" y1="${y(v).toFixed(1)}" x2="${W - pr}" y2="${y(v).toFixed(1)}" stroke="var(--line-soft)"/>
    <text x="${pl - 6}" y="${(y(v) + 3).toFixed(1)}" text-anchor="end" font-size="9" fill="var(--ink-faint)">${fmtGrade(v, scale, false)}</text>`).join('');
  let bound = '';
  const b = pts.findIndex(p => p.hy === '2');
  if (b > 0) {
    const bx = ((x(b) + x(b - 1)) / 2).toFixed(1);
    bound = `<line x1="${bx}" y1="${pt}" x2="${bx}" y2="${H - pb}" stroke="var(--line)" stroke-dasharray="3 3"/><text x="${bx}" y="${H - pb + 12}" text-anchor="middle" font-size="9" fill="var(--ink-faint)">2. HJ</text>`;
  }
  const avgPts = pts.map((p, i) => (p.avg == null ? null : `${x(i).toFixed(1)},${y(p.avg).toFixed(1)}`)).filter(Boolean).join(' ');
  const avgLine = avgPts ? `<polyline points="${avgPts}" fill="none" stroke="var(--ink-faint)" stroke-width="1.2" stroke-dasharray="4 3"/>` : '';
  const line = `<polyline points="${pts.map((p, i) => `${x(i).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ')}" fill="none" stroke="var(--accent)" stroke-width="1.6" opacity=".55"/>`;
  const dots = pts.map((p, i) => `<circle cx="${x(i).toFixed(1)}" cy="${y(p.v).toFixed(1)}" r="4.5" fill="${p.type === 'schriftlich' ? '#3f6fb0' : '#7a63bd'}"><title>${esc(p.label)}: ${fmtGrade(p.v, scale, false)}${p.date ? ' (' + fmtDate(p.date) + ')' : ''}${p.avg != null ? ' · Kurs Ø ' + fmtGrade(p.avg, scale, true) : ''}</title></circle>`).join('');
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" preserveAspectRatio="xMidYMid meet" style="display:block">${grid}${bound}${avgLine}${line}${dots}</svg>
    <div class="legend" style="margin-top:6px"><span><i style="background:#3f6fb0"></i> schriftlich</span><span><i style="background:#7a63bd"></i> mündlich</span><span><i style="background:transparent;border:none;border-top:2px dashed var(--ink-faint);height:0;width:16px"></i> Kursschnitt</span></div>`;
}
