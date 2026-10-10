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
  { key: 'noten',       title: 'Darstellung',      sub: 'Hell/Dunkel, Notentabelle, neue Kurse' },
  { key: 'raster',      title: 'Bewertungsraster', sub: 'Vorlagen für Einschätzungen' },
  { key: 'sicherheit',  title: 'Sicherheit',       sub: 'App-Sperre' },
  { key: 'daten',       title: 'Daten',            sub: 'Backup, Sicherungsstände, Speicher' },
  { key: 'ueber',       title: 'Über Pult.',       sub: 'Version und Updates' },
];

/* Vorgaben für neue Kurse */
function courseDefaults() {
  return Object.assign({ scale: 'punkte', weightWritten: 40, weightHY1: 30 }, data.meta.courseDefaults || {});
}

function renderSettings() {
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
    <div class="page-head"><div><h1>Einstellungen</h1><div class="sub">Änderungen werden sofort gespeichert.</div></div></div>
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
  ({ schuljahr: setSchuljahr, stundenplan: setStundenplan, noten: setNoten, raster: setRaster,
     sicherheit: setSicherheit, daten: setDaten, ueber: setUeber })[shown](body);
}
const setSaved = () => { save(); toast('Gespeichert.'); };

/* ---------- Schuljahr ---------- */
function setSchuljahr(body) {
  const m = data.meta;
  body.innerHTML = `
    <section class="set-card">
      <div class="field"><label>Nächster Ferienbeginn</label>
        <div class="row2">
          <input id="mFerienDate" type="date" value="${m.ferienDatum || ''}">
          <input id="mFerienLabel" type="text" value="${esc(m.ferienLabel || '')}" placeholder="z. B. Sommerferien">
        </div>
        <div class="hint">Erscheint als Countdown auf der Startseite.</div>
      </div>
      <div class="field"><label>Nächste Zeugniskonferenz</label><input id="mZeugnis" type="date" value="${m.zeugnisDatum || ''}"></div>
      <div class="field"><label>Halbjahr beim Öffnen eines Kurses</label>
        <select id="mHalfYear">
          <option value="auto" ${(m.halfYear || 'auto') === 'auto' ? 'selected' : ''}>Automatisch — das 2., sobald dort Noten stehen</option>
          <option value="1" ${m.halfYear === '1' ? 'selected' : ''}>Immer das 1. Halbjahr</option>
          <option value="2" ${m.halfYear === '2' ? 'selected' : ''}>Immer das 2. Halbjahr</option>
        </select>
      </div>
    </section>`;
  document.getElementById('mFerienDate').onchange = e => { m.ferienDatum = e.target.value; setSaved(); };
  document.getElementById('mFerienLabel').onchange = e => { m.ferienLabel = e.target.value.trim() || 'Ferien'; setSaved(); };
  document.getElementById('mZeugnis').onchange = e => { m.zeugnisDatum = e.target.value; setSaved(); };
  document.getElementById('mHalfYear').onchange = e => { m.halfYear = e.target.value || 'auto'; setSaved(); };
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
      <div class="field"><label>Stundenzeiten</label>
        <div class="set-buttons"><button class="btn" id="mPeriods">Zeiten bearbeiten</button></div>
        <div class="hint">${periods.length} Stunden, ${periods[0] ? periods[0].start : '–'} bis ${periods.length ? periods[periods.length - 1].end : '–'} Uhr.</div>
      </div>
      <div class="field"><label>Im Kalender des Geräts</label>
        <div class="set-buttons"><button class="btn" id="mTtIcs">Als Kalenderdatei sichern (.ics)</button></div>
        <div class="hint">In den Kalender importiert, zeigt dann das Kalender-Widget die nächste Stunde. Wiederholt sich wöchentlich bis zu den nächsten Ferien. Nach Änderungen neu importieren.</div>
      </div>
    </section>`;
  const abSel = document.getElementById('mAB'), abWrap = document.getElementById('mABWeekWrap'), abWeek = document.getElementById('mABWeek');
  const applyAB = () => {
    const wantAB = abSel.value === '1';
    abWrap.style.display = wantAB ? '' : 'none';
    data.timetable.abWeeks = wantAB;
    if (wantAB) abSetCurrentWeek(Number(abWeek.value) || 1);
    planWeek = null;                       // Stundenplan wieder auf die laufende Woche
    setSaved();
  };
  abSel.onchange = applyAB;
  abWeek.onchange = applyAB;
  document.getElementById('mPeriods').onclick = openPeriodsEditor;
  document.getElementById('mTtIcs').onclick = exportTimetableICS;
}

/* ---------- Noten ---------- */
function setNoten(body) {
  const m = data.meta, cd = courseDefaults();
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
          <option value="standard" ${(m.tableLayout || 'standard') !== 'invers' ? 'selected' : ''}>Standard — Noten links, Gesamt rechts</option>
          <option value="invers" ${m.tableLayout === 'invers' ? 'selected' : ''}>Invertiert — Gesamt und Neuestes zuerst</option>
        </select>
      </div>
      <div class="field"><label>Hinweis „keine aktuelle mündliche Note"</label>
        <select id="mBlind">${[14, 21, 28, 42].map(d => `<option value="${d}" ${blindDays() === d ? 'selected' : ''}>nach ${d} Tagen</option>`).join('')}</select>
        <div class="hint">Markiert Schüler:innen mit einem Punkt, deren letzte mündliche Note länger zurückliegt.</div>
      </div>
    </section>
    <section class="set-card">
      <h2>Vorgaben für neue Kurse</h2>
      <div class="field"><label>Notensystem</label>
        <select id="mScale">
          <option value="punkte" ${cd.scale === 'punkte' ? 'selected' : ''}>Punkte 0–15</option>
          <option value="noten" ${cd.scale === 'noten' ? 'selected' : ''}>Noten 1–6 mit Tendenz</option>
        </select></div>
      <div class="row2">
        <div class="field"><label>Schriftlich %</label><input id="mWW" type="number" min="0" max="100" value="${cd.weightWritten}"></div>
        <div class="field"><label>1. Halbjahr % (Endjahr)</label><input id="mWH" type="number" min="0" max="100" value="${cd.weightHY1}"></div>
      </div>
      <div class="hint" style="margin-top:6px">Bestehende Kurse bleiben unverändert — dort unter <b>Mehr → Kurs bearbeiten</b>.</div>
    </section>`;
  document.getElementById('mLayout').onchange = e => { m.tableLayout = e.target.value || 'standard'; setSaved(); };
  document.getElementById('mTheme').onchange = e => { m.theme = e.target.value; applyTheme(); setSaved(); };
  document.getElementById('mBlind').onchange = e => { m.blindDays = Number(e.target.value) || 21; setSaved(); };
  const keep = () => {
    m.courseDefaults = {
      scale: val('mScale') || 'punkte',
      weightWritten: clamp(parseInt(val('mWW'), 10) || 0, 0, 100),
      weightHY1: clamp(parseInt(val('mWH'), 10) || 0, 0, 100),
    };
    setSaved();
  };
  ['mScale', 'mWW', 'mWH'].forEach(id => document.getElementById(id).onchange = keep);
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
  body.innerHTML = `
    <section class="set-card">
      <h2>Backup als Datei</h2>
      <div class="field">
        <div class="set-buttons">
          <button class="btn primary" id="mBackup">Backup sichern</button>
          <button class="btn" id="mBackupEnc">Verschlüsselt sichern</button>
          <button class="btn" id="mBackupImport">Backup einlesen</button>
          <input type="file" id="mBackupFile" accept="application/json,.json" hidden>
        </div>
        <div class="hint">${m.lastBackup ? 'Letztes Backup: ' + fmtDateLong(m.lastBackup) + '.' : 'Noch kein Backup gesichert.'} Die Daten liegen nur auf diesem Gerät — ein Backup als Datei ist die einzige Sicherung gegen Verlust.</div>
      </div>
      <div class="field"><label>Erinnern, wenn das letzte Backup älter ist als</label>
        <select id="mRemind">${[[3, '3 Tage'], [7, '1 Woche'], [14, '2 Wochen'], [30, '1 Monat'], [0, 'nie erinnern']].map(([v, l]) =>
          `<option value="${v}" ${backupRemindDays() === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
      </div>
      <details class="set-more"><summary>Pseudonymes Backup</summary>
        <div class="hint">Namen werden durch Nummern ersetzt (je Kurs alphabetisch), Kurzinfos, Raster-Rückmeldungen und Notenprotokoll entfallen. Zum Teilen oder Ablegen ohne Namen — keine vollwertige Sicherung. Freitext in Notizen, Todos und Terminen bleibt.</div>
        <button class="btn small" id="mBackupPseudo" style="margin-top:8px">Pseudonym sichern</button>
      </details>
    </section>

    <section class="set-card">
      <h2>Interne Sicherungsstände</h2>
      <div class="hint" style="margin-bottom:10px">Täglich automatisch sowie vor Updates, dem Einlesen eines Backups und dem Löschen. Die letzten ${SNAP_MAX} bleiben erhalten, Schuljahres-Archive dauerhaft. „Ansehen" öffnet einen Stand, ohne etwas zu verändern. Liegen auf diesem Gerät — ersetzen kein Backup als Datei.</div>
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
      <div class="hint" style="font-size:13px">Ein Lehreralltagshelfer für Noten, Stundenplan, Todos und Termine. Alle Daten bleiben auf diesem Gerät — es gibt keinen Server, der sie sieht.</div>
    </section>`;
  bindUpdateSection();
}
