/* ============================================================
   Pult. — App-Sperre (ausgelagert aus pult.js)
   ------------------------------------------------------------
   Wird vor pult.js geladen. Beim Laden selbst wird nur die Sperr-
   Konfiguration gelesen und es werden Ereignisse registriert; alles
   andere (render, toast …) wird erst zur Laufzeit aufgerufen.
   ============================================================ */
'use strict';

/* ============================================================
   App-Sperre
   ------------------------------------------------------------
   Sichtschutz: 4-stelliger Code, optional zusätzlich Face ID / Touch ID
   (WebAuthn mit der Geräte-Entsperrung). Der Code bleibt immer als Rückweg.

   Die Einstellungen liegen bewusst NICHT in `data`: So wandern sie weder
   ins Backup, noch überschreibt das Einlesen eines Backups die Sperre.

   Grenze: Die Daten selbst bleiben unverschlüsselt im localStorage. Die
   Sperre hält neugierige Blicke am Pult fern — nicht jemanden, der mit den
   Entwicklerwerkzeugen des Browsers umgehen kann.
   ============================================================ */
const LOCK_KEY = 'pult.lock.v1';
const PIN_LEN = 4;
const LOCK_DEFAULT = () => ({
  enabled: false,
  pinHash: '', pinSalt: '',
  credId: '',          // WebAuthn-Credential (base64url) für Face ID / Touch ID
  onStart: true,       // beim Öffnen der App immer sperren
  autoLock: 5,         // -1 nie · 0 sofort beim Verlassen der App · sonst Minuten Inaktivität
  fails: 0, blockedUntil: 0,
  lastActive: 0,       // letzte Bedienung (ms) — damit auch ein Neustart die Inaktivität kennt
});
const AUTOLOCK_OPTIONS = [
  [-1, 'Nie — nur über den Sperrknopf'], [0, 'Sofort beim Verlassen der App'],
  [1, 'Nach 1 Minute ohne Bedienung'], [5, 'Nach 5 Minuten ohne Bedienung'],
  [10, 'Nach 10 Minuten ohne Bedienung'], [15, 'Nach 15 Minuten ohne Bedienung'],
  [30, 'Nach 30 Minuten ohne Bedienung'],
];
const LOCK_SVG = `<svg width="18" height="18" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><rect x="3" y="7" width="10" height="7.5"/><path d="M5.2 7V4.8a2.8 2.8 0 0 1 5.6 0V7"/></svg>`;
const BIO_SVG = `<svg width="30" height="30" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8V4.5A1.5 1.5 0 0 1 4.5 3H8M16 3h3.5A1.5 1.5 0 0 1 21 4.5V8M21 16v3.5a1.5 1.5 0 0 1-1.5 1.5H16M8 21H4.5A1.5 1.5 0 0 1 3 19.5V16"/><path d="M8.5 9v1.5M15.5 9v1.5M12 9v4h-1M9 16c1.8 1.3 4.2 1.3 6 0"/></svg>`;
const DEL_SVG = `<svg width="28" height="28" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><path d="M9 5h11v14H9l-6-7z"/><path d="M12.5 9.5l5 5M17.5 9.5l-5 5" stroke-linecap="round"/></svg>`;

let lockCfg = loadLock();
let lastActivity = Date.now();
let pinMode = null;      // offener Code-Bildschirm: 'lock' | 'verify' | 'setup' | null
let pinCleanup = null;
let pinBio = null;       // Face-ID-Versuch des offenen Sperrbildschirms

function loadLock() {
  try { return Object.assign(LOCK_DEFAULT(), JSON.parse(localStorage.getItem(LOCK_KEY) || '{}')); }
  catch (e) { return LOCK_DEFAULT(); }
}
function saveLock() { try { localStorage.setItem(LOCK_KEY, JSON.stringify(lockCfg)); } catch (e) {} }

const b64u = {
  enc: buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''),
  dec: s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), ch => ch.charCodeAt(0)),
};
/* SHA-256 nur, damit der Code nicht im Klartext herumliegt. crypto.subtle gibt es
   nur über https/localhost — sonst genügt ein einfacher Hash (bei 4 Ziffern
   ist beides ohnehin kein Schutz gegen gezieltes Durchprobieren). */
async function hashPin(pin, salt) {
  const bytes = new TextEncoder().encode(salt + ':' + pin);
  if (window.crypto && crypto.subtle) return b64u.enc(await crypto.subtle.digest('SHA-256', bytes));
  let h = 2166136261;
  for (const b of bytes) { h ^= b; h = Math.imul(h, 16777619); }
  return 'f' + (h >>> 0).toString(36);
}
async function setPin(pin) {
  lockCfg.pinSalt = b64u.enc(crypto.getRandomValues(new Uint8Array(16)));
  lockCfg.pinHash = await hashPin(pin, lockCfg.pinSalt);
  lockCfg.fails = 0; lockCfg.blockedUntil = 0;
}
function blockedLeft() { return Math.max(0, Math.ceil((lockCfg.blockedUntil - Date.now()) / 1000)); }

/* ---------- Face ID / Touch ID (WebAuthn) ----------
   Braucht https (oder localhost). Es wird nur geprüft, dass die Geräte-Entsperrung
   gelingt — ein Server, der die Signatur prüfen könnte, gibt es ja nicht. */
function bioSupported() { return window.isSecureContext && !!window.PublicKeyCredential && !!navigator.credentials; }
async function bioAvailable() {
  if (!bioSupported()) return false;
  try { return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable(); } catch (e) { return false; }
}
function bioName() { return /iPhone|iPad|Macintosh/.test(navigator.userAgent) ? 'Face ID / Touch ID' : 'Geräte-Entsperrung'; }
async function bioRegister() {
  const cred = await navigator.credentials.create({ publicKey: {
    challenge: crypto.getRandomValues(new Uint8Array(32)),
    rp: { name: 'Pult.' },
    user: { id: crypto.getRandomValues(new Uint8Array(16)), name: 'Pult.', displayName: 'Pult. App-Sperre' },
    pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
    authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'discouraged' },
    timeout: 60000, attestation: 'none',
    extensions: { prf: {} },   // erlaubt, Backups mit Touch ID zu verschlüsseln (sicherung.js)
  }});
  lockCfg.credId = b64u.enc(cred.rawId);
  saveLock();
}
async function bioVerify() {
  const cred = await navigator.credentials.get({ publicKey: {
    challenge: crypto.getRandomValues(new Uint8Array(32)),
    allowCredentials: [{ type: 'public-key', id: b64u.dec(lockCfg.credId), transports: ['internal'] }],
    userVerification: 'required', timeout: 60000,
  }});
  if (!cred || b64u.enc(cred.rawId) !== lockCfg.credId) throw new Error('Falsches Credential');
}

/* ---------- Code-Bildschirm ----------
   Einer für alles: 'lock' (App gesperrt), 'verify' (Code bestätigen, z. B. vor
   dem Ausschalten der Sperre), 'setup' (neuen Code zweimal eingeben).
   Der Bildschirm liegt über der App, statt sie zu ersetzen — ein offenes
   Fenster samt halb getipptem Text ist nach dem Entsperren noch da. */
function setAppInert(on) {
  ['app', 'modalBackdrop', 'backFab', 'printView', 'stage'].forEach(id => { const n = document.getElementById(id); if (n) n.inert = on; });
  document.querySelector('.topbar').inert = on;
}
function closePinScreen() { if (pinCleanup) { pinCleanup(); pinCleanup = null; } }

function pinScreen({ mode, title, autoBio, onDone, onCancel }) {
  closePinScreen();
  pinMode = mode;
  setAppInert(true);
  if (document.activeElement) document.activeElement.blur();

  const useBio = mode !== 'setup' && !!lockCfg.credId && bioSupported();
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', useBio ? 'bio' : '', '0', 'del'];
  const el = document.createElement('div');
  el.className = 'lockscreen';
  el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true');
  el.innerHTML = `
    <div class="ls-inner">
      <div class="ls-brand">Pult<span class="dot">.</span></div>
      <div class="ls-title"></div>
      <div class="ls-dots">${'<i></i>'.repeat(PIN_LEN)}</div>
      <div class="ls-msg" aria-live="polite"></div>
      <div class="ls-pad">${keys.map(k =>
        k === '' ? '<span></span>'
        : k === 'bio' ? `<button class="ls-key ls-fn" data-k="bio" aria-label="${bioName()}" title="${bioName()}">${BIO_SVG}</button>`
        : k === 'del' ? `<button class="ls-key ls-fn" data-k="del" aria-label="Löschen">${DEL_SVG}</button>`
        : `<button class="ls-key" data-k="${k}">${k}</button>`).join('')}
      </div>
      ${mode === 'lock'
        ? '<button class="ls-link" data-k="forgot">Code vergessen?</button>'
        : '<button class="ls-link" data-k="cancel">Abbrechen</button>'}
    </div>`;
  document.body.appendChild(el);

  const titleEl = el.querySelector('.ls-title'), msgEl = el.querySelector('.ls-msg');
  const dotsEl = el.querySelector('.ls-dots'), dots = dotsEl.querySelectorAll('i');
  let entry = '', first = null, busy = false, blockTimer = null;

  const baseTitle = title || (mode === 'setup' ? 'Neuen Code festlegen' : 'Code eingeben');
  titleEl.textContent = baseTitle;
  const paint = () => dots.forEach((d, i) => d.classList.toggle('on', i < entry.length));
  const fail = msg => {
    entry = ''; paint(); msgEl.textContent = msg;
    dotsEl.classList.remove('shake'); void dotsEl.offsetWidth; dotsEl.classList.add('shake');
  };
  const showBlock = () => {
    clearInterval(blockTimer);
    const tick = () => {
      const s = blockedLeft();
      el.querySelectorAll('.ls-key').forEach(b => b.disabled = s > 0);
      if (s > 0) msgEl.textContent = `Zu viele Versuche — bitte ${s} s warten.`;
      else { msgEl.textContent = ''; clearInterval(blockTimer); }
    };
    tick(); blockTimer = setInterval(tick, 1000);
  };
  const succeed = () => {
    lockCfg.fails = 0; lockCfg.blockedUntil = 0; saveLock();
    closePinScreen();
    if (onDone) onDone();
  };

  async function submit() {
    if (mode === 'setup') {
      if (first == null) { first = entry; entry = ''; paint(); msgEl.textContent = ''; titleEl.textContent = 'Code wiederholen'; return; }
      if (entry !== first) { first = null; titleEl.textContent = baseTitle; return fail('Die Codes stimmen nicht überein.'); }
      const pin = entry;
      closePinScreen();
      return onDone && onDone(pin);
    }
    busy = true;
    const ok = (await hashPin(entry, lockCfg.pinSalt)) === lockCfg.pinHash;
    busy = false;
    if (!el.isConnected) return;
    if (ok) return succeed();
    lockCfg.fails++;
    /* alle 5 Fehlversuche eine Wartezeit: 30 s, 1 min, 2 min … höchstens 15 min */
    if (lockCfg.fails % 5 === 0) lockCfg.blockedUntil = Date.now() + Math.min(30000 * 2 ** (lockCfg.fails / 5 - 1), 15 * 60000);
    saveLock();
    fail('Falscher Code.');
    if (blockedLeft()) showBlock();
  }
  async function tryBio(auto) {
    if (!useBio || busy || blockedLeft()) return;
    busy = true;
    try {
      await bioVerify();
      busy = false;
      if (el.isConnected) succeed();
    } catch (e) {
      busy = false;
      if (!auto && el.isConnected) msgEl.textContent = `${bioName()} hat nicht geklappt — bitte Code eingeben.`;
    }
  }
  function press(k) {
    if (k === 'cancel') { closePinScreen(); return onCancel && onCancel(); }
    if (k === 'forgot') return forgotPin();
    if (k === 'bio') return tryBio(false);
    if (busy || blockedLeft()) return;
    if (k === 'del') { entry = entry.slice(0, -1); return paint(); }
    if (entry.length >= PIN_LEN) return;
    entry += k; paint();
    if (entry.length === PIN_LEN) setTimeout(submit, 90);   // letzten Punkt noch kurz zeigen
  }

  el.addEventListener('click', e => { const b = e.target.closest('[data-k]'); if (b && !b.disabled) press(b.dataset.k); });
  /* Tastatur (Mac/Magic Keyboard); Capture, damit Escape nicht das Fenster darunter schließt */
  const onKey = e => {
    if (/^[0-9]$/.test(e.key)) press(e.key);
    else if (e.key === 'Backspace') press('del');
    else if (e.key === 'Escape' && mode !== 'lock') press('cancel');
    else return;
    e.preventDefault(); e.stopPropagation();
  };
  document.addEventListener('keydown', onKey, true);

  pinBio = mode === 'lock' ? tryBio : null;
  pinCleanup = () => {
    clearInterval(blockTimer);
    document.removeEventListener('keydown', onKey, true);
    el.remove();
    pinMode = null; pinBio = null;
    setAppInert(false);
    lastActivity = Date.now();
  };

  if (blockedLeft()) showBlock();
  else if (autoBio) tryBio(true);
}

function lockNow(autoBio) {
  if (!lockCfg.enabled || pinMode === 'lock') return;
  pinScreen({ mode: 'lock', autoBio });
}
/* Code vor Änderungen an der Sperre bestätigen */
function requirePin(title, onOk) {
  if (!lockCfg.enabled) return onOk();
  pinScreen({ mode: 'verify', title, onDone: onOk });
}
function forgotPin() {
  if (!confirm('Ohne Code lässt sich Pult. nicht entsperren.\n\nPult. zurücksetzen? Dabei werden ALLE Kurse, Noten und Einstellungen in diesem Browser gelöscht. Ein Backup kannst du danach wieder einlesen.')) return;
  try { localStorage.removeItem(STORE_KEY); localStorage.removeItem(LOCK_KEY); } catch (e) {}
  location.reload();
}

/* ---------- Auslöser: Inaktivität, App verlassen, Neustart ----------
   Gemessen wird mit Zeitstempeln statt mit Timern — iPadOS hält Timer im
   Hintergrund an, die Uhr läuft aber weiter. */
function idleExpired(since) {
  return lockCfg.autoLock > 0 && Date.now() - since >= lockCfg.autoLock * 60000;
}
function noteActivity() {
  if (pinMode === 'lock') return;
  lastActivity = Date.now();
  if (lockCfg.enabled && lastActivity - lockCfg.lastActive > 30000) { lockCfg.lastActive = lastActivity; saveLock(); }
}
['pointerdown', 'keydown', 'wheel'].forEach(ev => document.addEventListener(ev, noteActivity, { passive: true, capture: true }));
setInterval(() => {
  if (lockCfg.enabled && !document.hidden && idleExpired(lastActivity)) lockNow(false);
}, 10000);
document.addEventListener('visibilitychange', () => {
  if (!lockCfg.enabled) return;
  if (document.hidden) {
    lockCfg.lastActive = lastActivity; saveLock();
    /* noch vor dem Vorschaubild im App-Umschalter sperren */
    if (lockCfg.autoLock === 0) lockNow(false);
  } else if (pinMode === 'lock') {
    if (pinBio) pinBio(true);
  } else if (idleExpired(lastActivity)) {
    lockNow(true);
  }
});
function initLock() {
  if (!lockCfg.enabled) return;
  const stale = lockCfg.autoLock === 0 || idleExpired(lockCfg.lastActive || 0);
  if (lockCfg.onStart || stale) lockNow(true);
}

/* Einstellungs-Karte „App-Sperre" */
function lockSettingsHtml() {
  if (!lockCfg.enabled) return `
      <section class="set-card">
        <h2>App-Sperre</h2>
        <div class="field">
          <button class="btn" id="lkSetup">Sperre einrichten</button>
          <div class="hint">Schützt Pult. mit einem ${PIN_LEN}-stelligen Code, auf Wunsch zusätzlich mit ${bioName()}. Gesperrt wird per Knopf oben rechts, beim Öffnen der App oder nach einer Weile ohne Bedienung.</div>
        </div>
      </section>`;
  return `
      <section class="set-card">
        <h2>App-Sperre</h2>
        <div class="field">
          <label>Automatisch sperren</label>
          <select id="lkAuto">${AUTOLOCK_OPTIONS.map(([v, l]) => `<option value="${v}" ${lockCfg.autoLock === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
          <div class="hint">Zeit im Hintergrund zählt mit — wer nach 10 Minuten in die App zurückkehrt, war 10 Minuten inaktiv.</div>
        </div>
        <div class="field">
          <label>Beim Öffnen der App</label>
          <select id="lkStart">
            <option value="1" ${lockCfg.onStart ? 'selected' : ''}>Immer sperren</option>
            <option value="0" ${lockCfg.onStart ? '' : 'selected'}>Nur sperren, wenn die Zeit oben abgelaufen ist</option>
          </select>
          <div class="hint">iPadOS beendet Web-Apps im Hintergrund oft von selbst — dann zählt das Zurückkehren als Öffnen.</div>
        </div>
        <div class="field">
          <label>${bioName()}</label>
          <select id="lkBio" disabled>
            <option value="0" ${lockCfg.credId ? '' : 'selected'}>Aus — nur Code</option>
            <option value="1" ${lockCfg.credId ? 'selected' : ''}>An — Code bleibt als Ausweichweg</option>
          </select>
          <div class="hint" id="lkBioHint">Wird geprüft …</div>
        </div>
        <div class="field">
          <div class="set-buttons">
            <button class="btn" id="lkNow">${LOCK_SVG} Jetzt sperren</button>
            <button class="btn" id="lkChange">Code ändern</button>
            <button class="btn danger" id="lkOff">Sperre ausschalten</button>
          </div>
          <div class="hint">Die Sperre ist ein Sichtschutz: Die Daten liegen weiterhin unverschlüsselt in diesem Browser. Wer den Code vergisst, kann Pult. nur zurücksetzen und ein Backup einlesen.</div>
        </div>
      </section>`;
}
function bindLockSettings() {
  const $ = id => document.getElementById(id);
  if (!lockCfg.enabled) {
    $('lkSetup').onclick = () => pinScreen({ mode: 'setup', onDone: async pin => {
      await setPin(pin);
      lockCfg.enabled = true; lockCfg.lastActive = Date.now(); saveLock();
      render(); toast('App-Sperre eingerichtet.');
    }});
    return;
  }
  $('lkAuto').onchange = e => { lockCfg.autoLock = Number(e.target.value); saveLock(); toast('Gespeichert.'); };
  $('lkStart').onchange = e => { lockCfg.onStart = e.target.value === '1'; saveLock(); toast('Gespeichert.'); };
  $('lkNow').onclick = () => lockNow(false);
  $('lkChange').onclick = () => requirePin('Aktuellen Code eingeben', () =>
    pinScreen({ mode: 'setup', onDone: async pin => { await setPin(pin); saveLock(); toast('Code geändert.'); } }));
  $('lkOff').onclick = () => requirePin('Code eingeben, um die Sperre auszuschalten', () => {
    lockCfg = LOCK_DEFAULT(); saveLock();
    render(); toast('App-Sperre ausgeschaltet.');
  });

  const bioSel = $('lkBio'), bioHint = $('lkBioHint');
  bioAvailable().then(ok => {
    if (!bioSel.isConnected) return;
    if (!bioSupported()) {
      bioHint.textContent = window.isSecureContext
        ? 'Dieser Browser unterstützt keine Passkeys (WebAuthn).'
        : `Nur verfügbar, wenn Pult. über https geöffnet wird (oder über localhost) — gerade: ${location.protocol}//${location.host}`;
      return;
    }
    /* Auch wenn das Gerät „nicht verfügbar" meldet, darf man es versuchen:
       Verwaltete Geräte melden das teils, obwohl Touch ID eingerichtet ist —
       der Fehler beim Einrichten sagt dann mehr. */
    bioSel.disabled = false;
    bioHint.textContent = ok
      ? 'Beim Entsperren erscheint die Abfrage automatisch; das Symbol links neben der 0 startet sie erneut.'
      : `Das Gerät meldet keine Entsperrung für Websites. Häufige Ursachen: kein Gerätecode, iCloud-Schlüsselbund aus oder auf verwalteten Geräten per Profil gesperrt. Einrichten kann trotzdem versucht werden.`;
  });
  bioSel.onchange = async () => {
    if (bioSel.value === '0') { lockCfg.credId = ''; saveLock(); toast('Gespeichert.'); return; }
    try { await bioRegister(); toast(`${bioName()} eingerichtet.`); }
    catch (e) {
      bioSel.value = '0';
      toast(`${bioName()} konnte nicht eingerichtet werden.`);
      bioHint.textContent = `Einrichten fehlgeschlagen: ${e.name || 'Fehler'}${e.message ? ' — ' + e.message : ''}`;
    }
  };
}
