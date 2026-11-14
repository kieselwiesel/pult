/* ============================================================
   Pult. — Datensicherung
   ------------------------------------------------------------
   1. Backup als Datei — mit Namen, verschlüsselt oder pseudonym. Auf dem
      iPad geht die Datei über das Teilen-Menü (Dateien, OneDrive, AirDrop).
      Das volle Backup enthält auch die Schuljahres-Archive (archives[]);
      die übrigen internen Stände bleiben auf dem Gerät.
   2. Verschlüsselung: Passwort → PBKDF2 (SHA-256, 600 000 Runden) →
      AES-GCM 256. Ohne Passwort ist das Backup nicht wiederherstellbar.
   3. Interne Sicherungsstände in IndexedDB: täglich automatisch sowie vor
      Updates, dem Einlesen eines Backups und dem Zurücksetzen. Schützen vor
      Fehlbedienung — nicht vor dem Verlust des Geräts.

   Wird vor pult.js geladen: hier stehen nur Definitionen.
   ============================================================ */
'use strict';

const KDF_ITER = 600000;
const SNAP_DB = 'pult-sicherung';
const SNAP_MAX = 20;            // so viele Stände werden aufgehoben (älteste fallen weg)
const SNAP_AUTO_MS = 20 * 3600 * 1000;

/* ---------- Erinnerung ---------- */
const backupRemindDays = () => (data.meta.backupRemind == null ? 7 : Number(data.meta.backupRemind));
function backupIsOverdue() {
  const d = backupRemindDays();
  if (!d || !data.courses.length) return false;
  return !data.meta.lastBackup || daysSince(data.meta.lastBackup) > d;
}

/* ---------- Backup-Datei ---------- */
function backupPayload(dataObj, extra) {
  return Object.assign({
    app: 'Pult', version: 3, schema: SCHEMA, appVersion: appVersion ? appVersion.version : null,
    exportedAt: new Date().toISOString(),
  }, extra || {}, extra && extra.encrypted ? {} : { data: dataObj });
}
async function writeBackupFile(payload, filename, countsAsBackup) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const ok = await saveFile(blob, filename);
  if (!ok) return false;
  if (countsAsBackup) {
    data.meta.lastBackup = todayISO();
    save();
    if (['home', 'courses', 'settings'].includes(route.name)) render();
  }
  toast(countsAsBackup ? 'Backup gesichert.' : 'Datei gesichert.');
  return true;
}
/* Volles Backup mit Klarnamen — die eigentliche Sicherung, samt Schuljahres-Archiven.
   Ältere Versionen lesen nur „data" und übergehen „archives". */
function exportBackup() {
  if (archiveMode) return toast('Erst das Archiv verlassen.');   // sonst landete das angesehene Archiv im Backup
  if (archiveCache === null) return refreshArchiveCache().then(exportBackup);
  const payload = backupPayload(data);
  const archives = archivePayload();
  if (archives.length) payload.archives = archives;
  return writeBackupFile(payload, `pult-backup-${todayISO()}.json`, true);
}

/* Ersetzt Schülernamen durch eine Nummer je Kurs (alphabetisch nach Nachname).
   Arbeitet auf einem Klon; IDs und alle Noten bleiben verknüpft. */
function pseudonymizeData(d) {
  (d.courses || []).forEach(c => {
    const ordered = (c.students || []).slice().sort((a, b) =>
      (a.lastName || '').localeCompare(b.lastName || '', 'de') ||
      (a.firstName || '').localeCompare(b.firstName || '', 'de'));
    /* Kurzinfos (z. B. Nachteilsausgleich) sind personenbezogen und fliegen mit raus */
    ordered.forEach((s, i) => { s.firstName = String(i + 1).padStart(2, '0'); s.lastName = ''; s.info = ''; });
    /* Rückmeldungen in Raster-Einschätzungen ebenso */
    ['1', '2'].forEach(h => ((c.halfYears || {})[h] || { columns: [] }).columns.forEach(col => {
      if (col.raster) Object.values(col.raster.ratings || {}).forEach(r => { r.comment = ''; r.note = ''; });
    }));
  });
  /* Im Notenprotokoll stehen Klarnamen in den Beschriftungen — fliegt komplett raus */
  d.history = [];
  return d;
}
/* Pseudonymisiertes Backup zum Teilen/Ablegen ohne Namen.
   Setzt den „letztes Backup"-Zähler NICHT zurück (kein vollwertiger Namens-Restore).
   Ohne Archive — die enthalten Klarnamen. Gekennzeichnet, damit das Einlesen warnt. */
function exportBackupPseudonym() {
  if (archiveMode) return toast('Erst das Archiv verlassen.');
  const clone = pseudonymizeData(JSON.parse(JSON.stringify(data)));
  return writeBackupFile(backupPayload(clone, { pseudonym: true }), `pult-backup-pseudonym-${todayISO()}.json`, false);
}
/* ---------- Backup als Schlüssel (Code vergessen, sperre.js) ----------
   Eigene Datensätze tragen zufällige IDs aus uid(), die nirgends angezeigt
   werden. Feste IDs (Beispieldatei „c-eng", Raster-Vorlagen, Kategorien)
   haben Bindestriche oder liegen außerhalb der gesammelten Bereiche und
   zählen deshalb nicht — sonst entsperrte die öffentliche Beispieldatei. */
function ownedIds(d) {
  const ids = new Set();
  const add = x => { if (x && typeof x.id === 'string' && /^[a-z0-9]{5,}$/.test(x.id)) ids.add(x.id); };
  ((d && d.courses) || []).forEach(c => {
    add(c); (c.students || []).forEach(add);
    Object.values(c.halfYears || {}).forEach(hy => [...((hy && hy.columns) || []), ...((hy && hy.sonstige) || [])].forEach(add));
  });
  ['todos', 'termine', 'notes', 'lists', 'units', 'lessonPlans'].forEach(k => (Array.isArray(d && d[k]) ? d[k] : []).forEach(add));
  (((d && d.timetable) || {}).lessons || []).forEach(add);
  return ids;
}
/* true, wenn das Backup (oder eines seiner Archive) zu den Daten hier gehört —
   sonst ein Hinweistext. Pseudonyme Backups zählen nicht: Sie sind zum
   Weitergeben gedacht. */
function backupProvesOwnership(incoming, archives, parsed) {
  if (!incoming || !Array.isArray(incoming.courses)) return 'Das ist keine Pult-Backup-Datei.';
  if ((parsed && parsed.pseudonym) || looksPseudonymous(incoming)) return 'Ein pseudonymes Backup reicht dafür nicht — bitte ein volles Backup wählen.';
  const mine = ownedIds(archiveMode ? archiveMode.live : data);
  if (!mine.size) return 'Hier liegen noch keine eigenen Daten — Zurücksetzen verliert nichts.';
  const sources = [incoming, ...(Array.isArray(archives) ? archives : []).map(a => a && a.data)].filter(Boolean);
  return sources.some(d => [...ownedIds(d)].some(id => mine.has(id))) ? true
    : 'Dieses Backup gehört nicht zu den Daten in diesem Browser.';
}
/* Auch ältere pseudonyme Dateien (ohne Kennzeichen) erkennen: alle Namen sind Nummern */
function looksPseudonymous(d) {
  const all = (d.courses || []).flatMap(c => c.students || []);
  return all.length > 0 && all.every(s => /^\d+$/.test(String(s.firstName || '')) && !s.lastName);
}

/* ---------- Verschlüsselung ----------
   Format 2: Die Daten werden mit einem zufälligen Schlüssel (AES-GCM 256)
   verschlüsselt. Dieser Schlüssel liegt der Datei „verpackt" bei — einmal je
   Weg, ihn wieder freizuschalten (keys[]):
     password — PBKDF2 (SHA-256, 600 000 Runden) aus dem Passwort
     passkey  — Touch ID / Face ID: Der Passkey der App-Sperre liefert über die
                WebAuthn-Erweiterung PRF einen geheimen Wert, daraus per HKDF
                der Schlüssel. Geht nur auf Geräten, die diesen Passkey haben
                (iCloud-Schlüsselbund) — darum wird ein Passwort dazu empfohlen.
   Die Schuljahres-Archive liegen getrennt in archivesCipher (gleicher
   Schlüssel, eigenes iv) — so lesen ältere Versionen „ciphertext" weiter
   als reinen Datenbestand.
   Format 1 (ältere Backups, nur Passwort) wird weiterhin gelesen. */
const cryptoReady = () => !!(window.isSecureContext && window.crypto && crypto.subtle);
const b64enc = buf => { let s = ''; new Uint8Array(buf).forEach(b => s += String.fromCharCode(b)); return btoa(s); };
const b64dec = str => Uint8Array.from(atob(str), ch => ch.charCodeAt(0));
const randBytes = n => crypto.getRandomValues(new Uint8Array(n));

const aesKey = (raw, usages) => crypto.subtle.importKey('raw', raw, 'AES-GCM', false, usages);
async function aesEnc(key, bytes) {
  const iv = randBytes(12);
  return { iv: b64enc(iv), ct: b64enc(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, bytes)) };
}
async function aesDec(key, iv, ct) {
  return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64dec(iv) }, key, b64dec(ct)));
}
async function deriveKey(password, salt, iterations) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

/* --- Touch ID / Face ID als Schlüssel --- */
function passkeyAvailable() {
  return typeof lockCfg !== 'undefined' && !!lockCfg.credId && bioSupported() && cryptoReady();
}
/* false, wenn der Browser sicher kein PRF kann; sonst true (zeigt sich beim Versuch) */
async function passkeyPrfSupported() {
  if (!passkeyAvailable()) return false;
  try {
    if (PublicKeyCredential.getClientCapabilities) {
      const caps = await PublicKeyCredential.getClientCapabilities();
      if (caps && 'extension:prf' in caps) return !!caps['extension:prf'];
    }
  } catch (e) {}
  return true;
}
/* Fragt Touch ID ab und leitet aus dem PRF-Wert des Passkeys einen AES-Schlüssel ab.
   Braucht einen frischen Fingertipp (direkt aus einem Klick aufrufen). */
async function passkeyKey(credId, salt) {
  const cred = await navigator.credentials.get({ publicKey: {
    challenge: randBytes(32),
    allowCredentials: [{ type: 'public-key', id: b64u.dec(credId), transports: ['internal', 'hybrid'] }],
    userVerification: 'required', timeout: 60000,
    extensions: { prf: { eval: { first: salt } } },
  }});
  const ext = cred && cred.getClientExtensionResults ? cred.getClientExtensionResults() : {};
  const out = ext && ext.prf && ext.prf.results && ext.prf.results.first;
  if (!out) {
    const e = new Error(`Dieses Gerät liefert über ${bioName()} keinen Schlüssel (WebAuthn-PRF wird nicht unterstützt).`);
    e.name = 'NoPrf'; throw e;
  }
  const base = await crypto.subtle.importKey('raw', out, 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(32), info: new TextEncoder().encode('pult-backup-v2') },
    base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

/* ways: { password: string|null, passkey: bool } · archives: wie archivePayload() */
async function encryptBackupData(obj, ways, archives) {
  const keys = [];
  const dek = randBytes(32);
  /* Touch ID zuerst — die Abfrage braucht den Fingertipp, der gerade erst war */
  if (ways.passkey) {
    const salt = randBytes(32);
    const w = await aesEnc(await passkeyKey(lockCfg.credId, salt), dek);
    keys.push({ type: 'passkey', credId: lockCfg.credId, prfSalt: b64enc(salt), iv: w.iv, wrapped: w.ct });
  }
  if (ways.password) {
    const salt = randBytes(16);
    const w = await aesEnc(await deriveKey(ways.password, salt, KDF_ITER), dek);
    keys.push({ type: 'password', kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: KDF_ITER, salt: b64enc(salt) }, iv: w.iv, wrapped: w.ct });
  }
  const dekKey = await aesKey(dek, ['encrypt']);
  const seal = obj => aesEnc(dekKey, new TextEncoder().encode(JSON.stringify(obj)));
  const body = await seal(obj);
  const out = { enc: 2, cipher: { name: 'AES-GCM', iv: body.iv }, ciphertext: body.ct, keys };
  if (archives && archives.length) {
    const a = await seal(archives);
    out.archivesCipher = { iv: a.iv, ciphertext: a.ct };
  }
  return out;
}
/* Ergebnis des Entschlüsselns: { data, archives } */
async function openWithKey(payload, entry, key) {
  const dek = await aesKey(await aesDec(key, entry.iv, entry.wrapped), ['decrypt']);
  const open = async (iv, ct) => JSON.parse(new TextDecoder().decode(await aesDec(dek, iv, ct)));
  const ac = payload.archivesCipher;
  return { data: await open(payload.cipher.iv, payload.ciphertext), archives: ac ? await open(ac.iv, ac.ciphertext) : [] };
}
async function decryptWithPassword(payload, password) {
  if (payload.enc !== 2) {   // Format 1: Passwort-Schlüssel direkt, ohne Archive
    const key = await deriveKey(password, b64dec(payload.kdf.salt), payload.kdf.iterations || KDF_ITER);
    return { data: JSON.parse(new TextDecoder().decode(await aesDec(key, payload.cipher.iv, payload.ciphertext))), archives: [] };
  }
  const e = (payload.keys || []).find(k => k.type === 'password');
  if (!e) throw new Error('kein Passwort hinterlegt');
  return openWithKey(payload, e, await deriveKey(password, b64dec(e.kdf.salt), e.kdf.iterations || KDF_ITER));
}
async function decryptWithPasskey(payload) {
  const e = (payload.keys || []).find(k => k.type === 'passkey');
  if (!e) throw new Error('kein Passkey hinterlegt');
  return openWithKey(payload, e, await passkeyKey(e.credId, b64dec(e.prfSalt)));
}
const backupKeyTypes = payload => (payload.enc === 2 ? (payload.keys || []).map(k => k.type) : ['password']);

async function exportBackupEncrypted() {
  if (archiveMode) return toast('Erst das Archiv verlassen.');
  if (!cryptoReady()) return toast('Verschlüsselung geht nur, wenn Pult. über https geöffnet ist.');
  if (archiveCache === null) await refreshArchiveCache();
  const touch = await passkeyPrfSupported();
  const bio = bioName();
  modal('Verschlüsseltes Backup', `
    <div class="notice">Das Backup lässt sich nur mit dem gewählten Schlüssel wieder einlesen. <b>Ohne ihn sind die Daten verloren</b> — es gibt keinen Weg zurück.</div>
    ${touch ? `<div class="field"><label>Entsperren mit</label><div class="check-list">
      <label class="check-row"><input type="checkbox" id="bkUseBio" checked><span>${bio} <small>— auf Geräten mit dem Passkey der App-Sperre</small></span></label>
      <label class="check-row"><input type="checkbox" id="bkUsePw" checked><span>Passwort <small>— Ausweg, falls ${bio} nicht verfügbar ist; empfohlen</small></span></label>
    </div><div class="notice" id="bkWarn" style="border-color:var(--amber);display:none">Nur mit ${bio}: Geht dieses Gerät verloren und liegt der Passkey nicht im iCloud-Schlüsselbund, ist auch das Backup verloren.</div></div>` : ''}
    <div id="bkPwFields">
      <div class="field"><label>Passwort</label><input id="bkPw1" type="password" autocomplete="new-password" placeholder="mindestens 8 Zeichen"></div>
      <div class="field"><label>Passwort wiederholen</label><input id="bkPw2" type="password" autocomplete="new-password"></div>
    </div>
    <div class="hint" id="bkMsg"></div>
  `, [
    { label: 'Abbrechen', onClick: closeModal },
    { label: 'Verschlüsseln', cls: 'primary', onClick: async () => {
      const msg = document.getElementById('bkMsg');
      const useBio = touch && document.getElementById('bkUseBio').checked;
      const usePw = !touch || document.getElementById('bkUsePw').checked;
      if (!useBio && !usePw) return toast('Bitte mindestens einen Schlüssel wählen.');
      const pw = val('bkPw1');
      if (usePw && pw.length < 8) return toast('Bitte mindestens 8 Zeichen.');
      if (usePw && pw !== val('bkPw2')) return toast('Die Passwörter stimmen nicht überein.');
      msg.textContent = useBio ? `Bitte mit ${bio} bestätigen …` : 'Wird verschlüsselt …';
      let enc;
      try { enc = await encryptBackupData(data, { password: usePw ? pw : null, passkey: useBio }, archivePayload()); }
      catch (e) {
        msg.innerHTML = `<span style="color:var(--g-fail)">${esc(e.name === 'NoPrf' ? e.message + ' Bitte mit Passwort verschlüsseln.'
          : e.name === 'NotAllowedError' ? `${bio} abgebrochen.` : 'Verschlüsseln fehlgeschlagen.')}</span>`;
        if (e.name === 'NoPrf') { const cb = document.getElementById('bkUseBio'); cb.checked = false; cb.disabled = true; sync(); }
        return;
      }
      const payload = backupPayload(null, Object.assign({ encrypted: true }, enc));
      const ways = [useBio ? bio : '', usePw ? 'Passwort' : ''].filter(Boolean).join(' oder ');
      /* Das Teilen-Menü braucht einen frischen Fingertipp — darum ein eigener Knopf */
      modal('Verschlüsseltes Backup', `<div class="notice">Fertig verschlüsselt. Entsperren mit: <b>${ways}</b>.</div>`, [
        { label: 'Abbrechen', onClick: closeModal },
        { label: 'Datei sichern', cls: 'primary', onClick: async () => {
          closeModal();
          await writeBackupFile(payload, `pult-backup-${todayISO()}-verschluesselt.json`, true);
        }},
      ]);
    }},
  ]);
  const sync = () => {
    if (!touch) return;
    const b = document.getElementById('bkUseBio').checked, p = document.getElementById('bkUsePw').checked;
    document.getElementById('bkPwFields').style.display = p ? '' : 'none';
    document.getElementById('bkWarn').style.display = b && !p ? '' : 'none';
  };
  if (touch) ['bkUseBio', 'bkUsePw'].forEach(id => document.getElementById(id).onchange = sync);
  setTimeout(() => { const el = document.getElementById('bkPw1'); if (el && !touch) el.focus(); }, 50);
}

/* ---------- Einlesen ---------- */
function importBackupFile(file) {
  if (archiveMode) return toast('Erst das Archiv verlassen.');
  const reader = new FileReader();
  reader.onload = () => {
    let parsed;
    try { parsed = JSON.parse(reader.result); }
    catch (e) { return toast('Datei ist kein gültiges Pult-Backup.'); }
    if (parsed && parsed.encrypted) return askBackupKey(parsed);
    confirmBackupImport(parsed, parsed && parsed.data ? parsed.data : parsed, parsed && parsed.archives);
  };
  reader.readAsText(file);
}
/* Tag (lokal), an dem die Datei entstand — '' wenn unbekannt */
function backupDay(parsed) {
  const d = new Date((parsed && parsed.exportedAt) || NaN);
  return isNaN(d) ? '' : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function askBackupKey(parsed) {
  if (!cryptoReady()) return toast('Verschlüsselte Backups lassen sich nur über https einlesen.');
  const types = backupKeyTypes(parsed);
  const hasPw = types.includes('password'), hasPk = types.includes('passkey');
  const pkHere = hasPk && bioSupported();
  modal('Backup ist verschlüsselt', `
    ${pkHere ? `<button class="btn primary" id="bkBio" style="width:100%">Mit ${bioName()} entsperren</button>` : ''}
    ${hasPk && !pkHere ? `<div class="notice">Mit ${bioName()} verschlüsselt — das geht in diesem Browser nicht${hasPw ? '; bitte das Passwort verwenden' : ''}.</div>` : ''}
    ${hasPw ? `${pkHere ? '<div class="bk-or">oder</div>' : ''}
      <div class="field"><label>Passwort</label><input id="bkPwIn" type="password" autocomplete="current-password"></div>` : ''}
    <div class="hint" id="bkPwMsg"></div>
  `, [
    { label: 'Abbrechen', onClick: closeModal },
    ...(hasPw ? [{ label: 'Mit Passwort entsperren', cls: pkHere ? '' : 'primary', onClick: async () => {
      const msg = document.getElementById('bkPwMsg');
      msg.textContent = 'Wird entschlüsselt …';
      try { const r = await decryptWithPassword(parsed, val('bkPwIn')); confirmBackupImport(parsed, r.data, r.archives); }
      catch (e) { msg.innerHTML = '<span style="color:var(--g-fail)">Falsches Passwort oder beschädigte Datei.</span>'; }
    }}] : []),
  ]);
  const bio = document.getElementById('bkBio');
  if (bio) bio.onclick = async () => {
    const msg = document.getElementById('bkPwMsg');
    msg.textContent = `Bitte mit ${bioName()} bestätigen …`;
    try { const r = await decryptWithPasskey(parsed); confirmBackupImport(parsed, r.data, r.archives); }
    catch (e) {
      msg.innerHTML = `<span style="color:var(--g-fail)">${esc(e.name === 'NoPrf' ? e.message
        : e.name === 'NotAllowedError' ? `Abgebrochen — oder der Passkey ist auf diesem Gerät nicht vorhanden.`
        : 'Entsperren fehlgeschlagen — falscher Passkey oder beschädigte Datei.')}</span>`;
    }
  };
  setTimeout(() => { const el = document.getElementById('bkPwIn'); if (el && !pkHere) el.focus(); }, 50);
}
/* Ersetzen: Datenbestand austauschen, enthaltene Archive kommen zu den vorhandenen dazu.
   Als Archiv ablegen: alles bleibt, nur der Datenstand des Backups wird ein
   weiteres Archiv — darin enthaltene Archive werden nicht übernommen. */
function confirmBackupImport(parsed, incoming, archives) {
  if (!incoming || !Array.isArray(incoming.courses)) return toast('Datei ist kein gültiges Pult-Backup.');
  archives = (Array.isArray(archives) ? archives : []).filter(a => a && a.data && Array.isArray(a.data.courses));
  const newer = Number((incoming.meta || {}).schema) > SCHEMA;
  const pseudo = !!parsed.pseudonym || looksPseudonymous(incoming);
  const day = backupDay(parsed);
  const nA = archives.length;
  modal('Backup einlesen?', `<p>Das Backup enthält <b>${incoming.courses.length} Kurse</b>${nA ? ` und ${nA === 1 ? 'ein Schuljahres-Archiv' : `${nA} Schuljahres-Archive`}` : ''}${day ? `, Stand ${fmtDateLong(day)}` : ''}.</p>
    <p class="cs-sub"><b>Ersetzen</b> tauscht den Datenbestand in diesem Browser gegen das Backup — der jetzige Stand wird vorher intern gesichert${nA ? ', die Archive kommen zu den vorhandenen dazu' : ''}.
      <b>Als Archiv ablegen</b> lässt alles, wie es ist, und legt das Backup unter Einstellungen → Daten zum Ansehen ab${nA ? ' (ohne die darin enthaltenen Archive)' : ''}.</p>
    ${pseudo ? '<div class="notice" style="border-color:var(--amber)"><b>Pseudonymes Backup:</b> Namen sind durch Nummern ersetzt, Kurzinfos, Raster-Rückmeldungen und Notenprotokoll fehlen. Zum Wiederherstellen taugt es nicht — Ersetzen tauscht deine Namen gegen Nummern.</div>' : ''}
    ${newer ? '<div class="notice" style="border-color:var(--amber)">Das Backup stammt aus einer neueren Version von Pult. Bitte erst Pult. aktualisieren — sonst können Teile fehlen.</div>' : ''}`, [
    { label: 'Abbrechen', onClick: closeModal },
    { label: 'Als Archiv ablegen', onClick: () => askArchiveLabel(parsed, incoming, day) },
    { label: pseudo ? 'Trotzdem ersetzen' : 'Ersetzen', cls: pseudo ? 'danger' : 'primary', onClick: async () => {
      await takeSnapshot('Vor dem Einlesen eines Backups').catch(() => {});
      replaceData(incoming, pseudo ? '' : day);
      const n = await addArchives(archives).catch(() => 0);
      toast(n ? `Backup eingelesen — ${n === 1 ? 'ein Archiv' : `${n} Archive`} übernommen.` : 'Backup eingelesen.');
    }},
  ]);
}
function askArchiveLabel(parsed, incoming, day) {
  modal('Als Archiv ablegen', `
    <div class="field"><label>Name des Archivs</label><input id="aiLabel" type="text" value="${esc(day ? `Backup vom ${fmtDateLong(day)}` : 'Archiv aus Backup')}"></div>
    <div class="hint">Der aktuelle Datenbestand bleibt unverändert. Das Archiv lässt sich unter Einstellungen → Daten ansehen, als Datei sichern oder wiederherstellen.</div>`, [
    { label: 'Abbrechen', onClick: closeModal },
    { label: 'Ablegen', cls: 'primary', onClick: async () => {
      const at = isNaN(new Date(parsed.exportedAt || NaN)) ? new Date().toISOString() : new Date(parsed.exportedAt).toISOString();
      let n;
      try { n = await addArchives([{ at, label: val('aiLabel').trim() || 'Archiv aus Backup', data: incoming }]); }
      catch (e) { return toast('Interne Sicherung ist in diesem Browser nicht möglich.'); }
      closeModal();
      toast(n ? 'Als Archiv abgelegt (Einstellungen → Daten).' : 'Dieser Stand liegt schon als Archiv vor.');
      if (route.name === 'settings') render();
    }},
  ]);
  setTimeout(() => { const el = document.getElementById('aiLabel'); if (el) el.select(); }, 50);
}
/* gesamten Datenbestand austauschen (Backup, Sicherungsstand).
   fromDay: Tag des eingelesenen Backups — die Datei ist selbst ein Backup,
   die Erinnerung zählt ab dann (sonst stünde dort das Datum davor). */
function replaceData(incoming, fromDay) {
  data = Object.assign(DEFAULT_DATA(), incoming);
  data.meta = Object.assign(DEFAULT_DATA().meta, incoming.meta || {});
  if (fromDay && fromDay > (data.meta.lastBackup || '')) data.meta.lastBackup = fromDay;
  runMigrations(); applyTheme();
  save(); closeModal(); navStack = [];
  go({ name: 'home' });
}

/* ---------- Interne Sicherungsstände (IndexedDB) ---------- */
function snapDb() {
  return new Promise((resolve, reject) => {
    if (!window.indexedDB) return reject(new Error('kein IndexedDB'));
    const req = indexedDB.open(SNAP_DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore('snaps', { keyPath: 'id' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function snapTx(mode, fn) {
  const db = await snapDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('snaps', mode);
    const out = fn(tx.objectStore('snaps'));
    tx.oncomplete = () => { db.close(); resolve(out && 'result' in out ? out.result : undefined); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}
/* Liste ohne die eigentlichen Daten, neueste zuerst */
async function listSnapshots() {
  const all = (await snapTx('readonly', st => st.getAll())) || [];
  return all.map(({ id, at, label, size, courses, auto, keep }) => ({ id, at, label, size, courses, auto, keep }))
    .sort((a, b) => b.at.localeCompare(a.at));
}
/* keep: dauerhaft (Schuljahres-Archiv) — fällt nicht unter die Aufräumregel */
async function takeSnapshot(label, auto, keep) {
  const src = typeof archiveMode !== 'undefined' && archiveMode ? archiveMode.live : data;    // beim Ansehen eines Archivs zählt der echte Stand
  const json = JSON.stringify(src);
  const snap = { id: uid() + Date.now().toString(36), at: new Date().toISOString(), label: label || 'Manuell', auto: !!auto,
    keep: !!keep, size: json.length, courses: src.courses.length, json };
  await snapTx('readwrite', st => st.put(snap));
  /* Aufräumen: nur die neuesten SNAP_MAX behalten (Archive bleiben) */
  const list = (await listSnapshots()).filter(x => !x.keep);
  const drop = list.slice(SNAP_MAX);
  if (drop.length) await snapTx('readwrite', st => drop.forEach(x => st.delete(x.id)));
  if (keep) await refreshArchiveCache();
  return snap.id;
}
async function getSnapshot(id) { return snapTx('readonly', st => st.get(id)); }
async function deleteSnapshot(id) { await snapTx('readwrite', st => st.delete(id)); await refreshArchiveCache(); }

/* Schuljahres-Archive (keep) fürs Backup im Speicher vorhalten: „Backup sichern"
   muss das Teilen-Menü ohne Wartezeit öffnen — iPadOS verlangt dafür einen
   frischen Fingertipp. Aktualisiert beim Start und bei jeder Änderung. */
let archiveCache = null;   // [{ id, at, label, json }] · null = noch nicht geladen
async function refreshArchiveCache() {
  try {
    const all = (await snapTx('readonly', st => st.getAll())) || [];
    archiveCache = all.filter(x => x.keep).sort((a, b) => a.at.localeCompare(b.at))
      .map(({ id, at, label, json }) => ({ id, at, label, json }));
  } catch (e) { archiveCache = []; }   // ohne IndexedDB gibt es keine Archive
  return archiveCache;
}
const archivePayload = () => (archiveCache || []).map(a => ({ id: a.id, at: a.at, label: a.label, data: JSON.parse(a.json) }));

/* Archive (aus einem Backup) ablegen. Schon vorhandene — gleiche id oder
   gleicher Inhalt — werden übersprungen. Ergebnis: Anzahl neu abgelegter. */
async function addArchives(list) {
  if (!list || !list.length) return 0;
  const existing = (await snapTx('readonly', st => st.getAll())) || [];
  const ids = new Set(existing.map(x => x.id)), jsons = new Set(existing.map(x => x.json));
  const add = [];
  list.forEach(a => {
    const json = JSON.stringify(a.data);
    if ((a.id && ids.has(String(a.id))) || jsons.has(json)) return;
    const id = a.id ? String(a.id) : uid() + Date.now().toString(36);
    ids.add(id); jsons.add(json);
    add.push({ id, at: typeof a.at === 'string' && !isNaN(new Date(a.at)) ? a.at : new Date().toISOString(),
      label: String(a.label || 'Archiv'), auto: false, keep: true, size: json.length, courses: a.data.courses.length, json });
  });
  if (add.length) await snapTx('readwrite', st => add.forEach(x => st.put(x)));
  await refreshArchiveCache();
  return add.length;
}

/* Alle internen Stände samt Archiven endgültig löschen (Zurücksetzen bei
   vergessenem Code — sonst ließe sich die Sperre über „Wiederherstellen" umgehen) */
function deleteSnapshotDb() {
  return new Promise(resolve => {
    if (!window.indexedDB) return resolve(false);
    const req = indexedDB.deleteDatabase(SNAP_DB);
    req.onsuccess = () => resolve(true);
    req.onerror = req.onblocked = () => resolve(false);
    setTimeout(() => resolve(false), 3000);
  });
}
/* einmal am Tag beim Start */
async function dailySnapshot() {
  try {
    const list = await listSnapshots();
    const lastAuto = list.find(x => x.auto);
    if (data.courses.length && (!lastAuto || Date.now() - new Date(lastAuto.at) > SNAP_AUTO_MS)) await takeSnapshot('Täglich automatisch', true);
  } catch (e) { /* ohne IndexedDB (z. B. privates Fenster) gibt es keine internen Stände */ }
}
const fmtBytes = n => (n < 1024 ? `${n} B` : n < 1048576 ? `${fmtNum(n / 1024)} KB` : `${fmtNum(n / 1048576)} MB`);

/* Abschnitt „Interne Sicherungsstände" für die Einstellungen: getrennt nach
   Archiven (dauerhaft) und den übrigen Ständen, je nur der neueste sichtbar —
   der Rest hinter „Mehr anzeigen" (bleibt beim Neuzeichnen aufgeklappt) */
const snapExpanded = new Set();   // 'archive' | 'auto'
function snapChipHtml(x) {
  return `
    <div class="chip ${x.keep ? 'snap-keep' : ''}"><div class="chip-main"><b>${esc(x.label)}</b>
      <span>${fmtHistTime(x.at)} · ${x.courses} ${x.courses === 1 ? 'Kurs' : 'Kurse'} · ${fmtBytes(x.size)}</span></div>
      <div class="set-buttons">
        <button class="btn small" data-snap-view="${x.id}">Ansehen</button>
        <button class="btn small" data-snap-restore="${x.id}">Wiederherstellen</button>
        <button class="btn small" data-snap-file="${x.id}">Als Datei</button>
        <button class="btn small danger" data-snap-del="${x.id}" aria-label="Löschen">×</button>
      </div></div>`;
}
function snapGroupHtml(key, title, items, empty) {
  const open = snapExpanded.has(key);
  const shown = open ? items : items.slice(0, 1);
  const rest = items.length - 1;
  return `<div class="snap-group">
    <h3 class="snap-head">${title}${items.length ? ` <span class="snap-count">${items.length}</span>` : ''}</h3>
    ${items.length ? `<div class="chip-list">${shown.map(snapChipHtml).join('')}</div>` : `<div class="cs-sub">${empty}</div>`}
    ${rest > 0 ? `<button class="pl-more" data-snap-more="${key}">${open ? 'Weniger anzeigen' : `Mehr anzeigen (${rest} ${rest === 1 ? 'weiterer' : 'weitere'})`}</button>` : ''}
  </div>`;
}
async function renderSnapshotList(host) {
  let list;
  try { list = await listSnapshots(); }
  catch (e) { host.innerHTML = '<div class="cs-sub">In diesem Browser nicht verfügbar (z. B. privates Fenster).</div>'; return; }
  if (!host.isConnected) return;
  host.innerHTML =
    snapGroupHtml('archive', 'Archive', list.filter(x => x.keep),
      'Noch keine Archive — sie entstehen beim Schuljahreswechsel oder wenn ein Backup als Archiv abgelegt wird.') +
    snapGroupHtml('auto', 'Automatische Sicherungsstände', list.filter(x => !x.keep), 'Noch keine Sicherungsstände.');
  host.querySelectorAll('[data-snap-more]').forEach(b => b.onclick = () => {
    const k = b.dataset.snapMore;
    if (snapExpanded.has(k)) snapExpanded.delete(k); else snapExpanded.add(k);
    renderSnapshotList(host);
  });
  host.querySelectorAll('[data-snap-restore]').forEach(b => b.onclick = async () => {
    const snap = await getSnapshot(b.dataset.snapRestore); if (!snap) return;
    modal('Stand wiederherstellen?', `<p>Pult. wird auf den Stand <b>${esc(snap.label)}</b> vom ${fmtHistTime(snap.at)} zurückgesetzt.</p>
      <p class="cs-sub">Der jetzige Stand wird vorher ebenfalls gesichert — du kannst also zurück.</p>`, [
      { label: 'Abbrechen', onClick: closeModal },
      { label: 'Wiederherstellen', cls: 'primary', onClick: async () => {
        await takeSnapshot('Vor dem Wiederherstellen').catch(() => {});
        replaceData(JSON.parse(snap.json));
        toast('Stand wiederhergestellt.');
      }},
    ]);
  });
  host.querySelectorAll('[data-snap-file]').forEach(b => b.onclick = async () => {
    const snap = await getSnapshot(b.dataset.snapFile); if (!snap) return;
    const payload = Object.assign(backupPayload(JSON.parse(snap.json)), { exportedAt: snap.at });
    writeBackupFile(payload, `pult-stand-${snap.at.slice(0, 10)}.json`, false);
  });
  host.querySelectorAll('[data-snap-view]').forEach(b => b.onclick = () => viewArchive(b.dataset.snapView));
  host.querySelectorAll('[data-snap-del]').forEach(b => b.onclick = () => {
    const x = list.find(y => y.id === b.dataset.snapDel);
    const del = async () => { closeModal(); await deleteSnapshot(x.id); renderSnapshotList(host); };
    if (!x.keep) return del();
    modal('Archiv löschen?', `<p><b>${esc(x.label)}</b> wird endgültig gelöscht.</p>`, [
      { label: 'Abbrechen', onClick: closeModal }, { label: 'Löschen', cls: 'danger', onClick: del }]);
  });
}

/* ---------- Alles löschen ---------- */
function confirmResetAll() {
  if (archiveMode) return toast('Erst das Archiv verlassen.');
  modal('Alle Daten löschen?', `
    <p>Sämtliche Kurse, Schüler:innen, Noten, Todos und Termine werden aus diesem Browser gelöscht.</p>
    <div class="notice" style="border-color:var(--amber)">Sichere vorher ein Backup als Datei — interne Sicherungsstände bleiben zwar erhalten, liegen aber auf demselben Gerät.</div>
    <div class="field"><label>Zur Bestätigung „löschen" eintippen</label><input id="rsConfirm" type="text" autocomplete="off"></div>
  `, [
    { label: 'Erst Backup sichern', onClick: () => exportBackup() },
    { label: 'Abbrechen', onClick: closeModal },
    { label: 'Endgültig löschen', cls: 'danger', onClick: async () => {
      if (val('rsConfirm').trim().toLowerCase() !== 'löschen') return toast('Bitte „löschen" eintippen.');
      await takeSnapshot('Vor dem Löschen aller Daten').catch(() => {});
      localStorage.removeItem(STORE_KEY);
      data = DEFAULT_DATA(); runMigrations(); save();
      closeModal(); navStack = []; go({ name: 'home' });
      toast('Alle Daten gelöscht.');
    }},
  ]);
}
