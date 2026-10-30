/* ============================================================
   Pult. — Version & manuelle Updates
   ------------------------------------------------------------
   Die installierte Version steht in version.json (aus dem Cache des
   Service Workers). Für die Prüfung wird dieselbe Datei frisch vom Server
   geholt (?fresh=…). Ist sie neuer, kann das Update per Knopf übernommen
   werden: Freigabe setzen → Service Worker neu laden → aktivieren → neu laden.
   Siehe sw.js.

   Einmal am Tag wird beim Start still geprüft; ein neuer Stand zeigt sich
   als Punkt am Einstellungen-Knopf — installiert wird nichts.

   Wird vor pult.js geladen: hier stehen nur Definitionen.
   ============================================================ */
'use strict';

const UPDATE_KEY = 'pult.update.v1';   // { checkedAt, remote } — Gerätezustand, nicht im Backup
let appVersion = null;                 // installierte version.json
let updateInfo = null;                 // neuere version.json vom Server, falls vorhanden

function cmpVersion(a, b) {
  const pa = String(a || '0').split('.').map(Number), pb = String(b || '0').split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d > 0 ? 1 : -1;
  }
  return 0;
}
function loadUpdateState() {
  try { return JSON.parse(localStorage.getItem(UPDATE_KEY) || '{}'); } catch (e) { return {}; }
}
function saveUpdateState(st) { try { localStorage.setItem(UPDATE_KEY, JSON.stringify(st)); } catch (e) {} }

async function loadAppVersion() {
  try {
    const res = await fetch('version.json');
    if (res.ok) appVersion = await res.json();
  } catch (e) { /* ohne Server (file://) gibt es keine Versionsdatei */ }
  /* bekannter neuerer Stand aus der letzten Prüfung */
  const st = loadUpdateState();
  if (st.remote && appVersion && cmpVersion(st.remote.version, appVersion.version) > 0) updateInfo = st.remote;
  return appVersion;
}

/* Prüft den Server. silent: ohne Meldung (Tagesprüfung beim Start).
   Liefert 'neu' | 'aktuell' | 'offline'. */
async function checkForUpdate(silent) {
  let remote;
  try {
    const res = await fetch('version.json?fresh=' + Date.now(), { cache: 'no-store' });
    if (!res.ok) throw new Error(res.status);
    remote = await res.json();
  } catch (e) {
    if (!silent) toast('Keine Verbindung zum Server — später noch einmal versuchen.');
    return 'offline';
  }
  const newer = appVersion && cmpVersion(remote.version, appVersion.version) > 0;
  updateInfo = newer ? remote : null;
  saveUpdateState({ checkedAt: Date.now(), remote: newer ? remote : null });
  renderTopbarRight();
  return newer ? 'neu' : 'aktuell';
}
function dailyUpdateCheck() {
  const st = loadUpdateState();
  if (!navigator.onLine || Date.now() - (st.checkedAt || 0) < 20 * 3600 * 1000) return;
  checkForUpdate(true);
}

/* Änderungen zwischen installierter und neuer Version */
function changesSince(info, fromVersion) {
  return ((info && info.changelog) || []).filter(e => cmpVersion(e.version, fromVersion) > 0);
}
function changelogHtml(entries) {
  if (!entries.length) return '<div class="cs-sub">Keine Angaben.</div>';
  return entries.map(e => `<div class="cl-entry"><div class="cl-head"><b>Version ${esc(e.version)}</b>${e.date ? ` <span>${fmtDateLong(e.date)}</span>` : ''}</div>
    <ul>${(e.changes || []).map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>`).join('');
}

/* Update übernehmen */
async function applyUpdate() {
  if (!('serviceWorker' in navigator) || !navigator.serviceWorker.controller) { location.reload(); return; }
  const reg = await navigator.serviceWorker.getRegistration();
  if (!reg) { location.reload(); return; }
  /* Sicherheitsnetz: Stand vor dem Update intern festhalten */
  if (typeof takeSnapshot === 'function') {
    try { await takeSnapshot(`Vor Update auf ${updateInfo ? updateInfo.version : 'neue Version'}`); } catch (e) {}
  }
  toast('Update wird geladen …');
  try {
    await (await caches.open('pult-flags')).put('./update-ok', new Response('1'));
    await reg.update();
    const worker = reg.installing || reg.waiting;
    if (!worker) {
      toast('Auf dem Server liegt kein neuer Service Worker (VERSION in sw.js erhöht?).');
      return;
    }
    await new Promise((resolve, reject) => {
      if (worker.state === 'installed') return resolve();
      worker.addEventListener('statechange', () => {
        if (worker.state === 'installed' || worker.state === 'activated') resolve();
        if (worker.state === 'redundant') reject(new Error('Installation fehlgeschlagen'));
      });
    });
    navigator.serviceWorker.addEventListener('controllerchange', () => location.reload(), { once: true });
    (reg.waiting || worker).postMessage('skipWaiting');
  } catch (e) {
    toast('Update fehlgeschlagen — bitte mit Internet erneut versuchen.');
  }
}

/* Abschnitt für die Einstellungen („Über Pult.") */
function updateSectionHtml() {
  const v = appVersion;
  const cur = v ? `Version ${esc(v.version)}${v.date ? ` · ${fmtDateLong(v.date)}` : ''}` : 'Version unbekannt (ohne Server geöffnet)';
  const st = loadUpdateState();
  return `
    <div class="field">
      <div class="upd-cur"><b>${cur}</b>
        <span class="cs-sub">${st.checkedAt ? 'Zuletzt geprüft: ' + fmtHistTime(new Date(st.checkedAt).toISOString()) : 'Noch nie nach Updates gesucht'}</span></div>
      <div id="updBox">${updateInfo ? updateAvailableHtml() : ''}</div>
      <div class="set-buttons" style="margin-top:10px">
        <button class="btn" id="updCheck">Nach Update suchen</button>
      </div>
      <div class="hint">Pult. läuft komplett offline und ändert sich nur, wenn du hier ein Update übernimmst. Vorher wird automatisch ein interner Sicherungsstand angelegt.</div>
    </div>
    ${v && v.changelog ? `<details class="upd-log"><summary>Was ist neu in dieser Version?</summary>${changelogHtml(v.changelog.filter(e => e.version === v.version))}</details>
    <details class="upd-log"><summary>Alle Versionen (${v.changelog.length})</summary>${changelogHtml(v.changelog.slice().sort((a, b) => cmpVersion(b.version, a.version)))}</details>` : ''}`;
}
function updateAvailableHtml() {
  const entries = changesSince(updateInfo, appVersion ? appVersion.version : '0');
  return `<div class="upd-new">
    <div><b>Version ${esc(updateInfo.version)} ist verfügbar</b>${updateInfo.date ? ` <span class="cs-sub">${fmtDateLong(updateInfo.date)}</span>` : ''}</div>
    ${changelogHtml(entries)}
    <button class="btn primary" id="updApply">Jetzt aktualisieren</button>
  </div>`;
}
function bindUpdateSection() {
  const box = document.getElementById('updBox');
  const bindApply = () => { const b = document.getElementById('updApply'); if (b) b.onclick = applyUpdate; };
  bindApply();
  document.getElementById('updCheck').onclick = async e => {
    const btn = e.currentTarget;
    btn.disabled = true; btn.textContent = 'Suche …';
    const r = await checkForUpdate(false);
    btn.disabled = false; btn.textContent = 'Nach Update suchen';
    if (!box.isConnected) return;
    if (r === 'neu') { box.innerHTML = updateAvailableHtml(); bindApply(); }
    else if (r === 'aktuell') { box.innerHTML = '<div class="upd-ok">Pult. ist auf dem neuesten Stand.</div>'; }
  };
}
