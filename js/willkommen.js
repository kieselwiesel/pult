/* ============================================================
   Pult. — Willkommen
   ------------------------------------------------------------
   Beim ersten Öffnen (je Browser bzw. installierter Web-App einmal):
   Hinweis, dass Pult. als Web-App installiert werden muss, kurze Anleitung
   für iPadOS und Android, Verweis auf Datenschutz & Impressum und — solange
   noch die Beispieldaten aus seed() da sind — ein Knopf, um sie zu löschen.

   Erneut aufrufbar unter Einstellungen → Über Pult.

   Wird vor pult.js geladen: hier stehen nur Definitionen.
   ============================================================ */
'use strict';

const WELCOME_KEY = 'pult.welcome.v1';
const LEGAL_URL = 'datenschutz.html';

const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const isAppleTouch = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isAndroid = () => /Android/i.test(navigator.userAgent);

/* Chrome/Edge (Android, Desktop): Installation per Knopf anbieten */
let installPrompt = null;
window.addEventListener('beforeinstallprompt', e => { installPrompt = e; });
window.addEventListener('appinstalled', () => { installPrompt = null; });

/* Beim Start: nur bei einem frischen Datenbestand mit Beispieldaten */
function maybeShowWelcome() {
  let seen = false;
  try { seen = !!localStorage.getItem(WELCOME_KEY); } catch (e) {}
  if (seen || !data.meta.demo) return;
  try { localStorage.setItem(WELCOME_KEY, todayISO()); } catch (e) {}
  openWelcome();
}

function openWelcome() {
  const apple = isAppleTouch(), android = isAndroid();
  const install = isStandalone()
    ? `<div class="notice wl-ok"><b>Pult. läuft als Web-App.</b> Die Daten bleiben dauerhaft auf diesem Gerät, auch offline. Sichere trotzdem regelmäßig ein Backup (Einstellungen → Daten).</div>`
    : `<div class="notice wl-warn"><b>Pult. funktioniert nur als Web-App.</b> Im normalen Browser-Tab darf der Browser die Daten löschen, wenn die Seite einige Tage nicht geöffnet wurde. Als Web-App vom Home-Bildschirm bleiben sie dauerhaft auf dem Gerät, und Pult. läuft auch offline.
        <div class="wl-small">Browser-Tab und Web-App haben getrennte Daten — trage erst in der installierten Web-App etwas ein.</div></div>
      <details class="wl-steps" ${apple || !android ? 'open' : ''}><summary>iPad (iPadOS)</summary>
        <ol>
          <li>Diese Seite in <b>Safari</b> öffnen.</li>
          <li>Auf <b>Teilen</b> tippen (Quadrat mit Pfeil nach oben, je nach Version unter „…“).</li>
          <li><b>Zum Home-Bildschirm</b> wählen, „Als Web-App öffnen“ eingeschaltet lassen und <b>Hinzufügen</b>.</li>
          <li>Pult. ab jetzt über das Symbol auf dem Home-Bildschirm starten.</li>
        </ol></details>
      <details class="wl-steps" ${android ? 'open' : ''}><summary>Android</summary>
        <ol>
          <li>Diese Seite in <b>Chrome</b> öffnen.</li>
          <li>Oben rechts das Menü <b>⋮</b> antippen.</li>
          <li><b>App installieren</b> bzw. <b>Zum Startbildschirm hinzufügen</b> wählen und bestätigen.</li>
          <li>Pult. ab jetzt über das neue App-Symbol starten.</li>
        </ol>
        ${installPrompt ? '<button class="btn small" id="wlInstall">Jetzt installieren</button>' : ''}</details>
      <div class="wl-small">Am Computer: in Chrome oder Edge über das Installieren-Symbol in der Adressleiste, in Safari (Mac) über Ablage → Zum Dock hinzufügen.</div>`;

  const demo = data.meta.demo ? `
    <div class="wl-demo">
      <b>Gerade siehst du fiktive Beispieldaten</b> — zwei Kurse mit erfundenen Schüler:innen und Noten, einen Stundenplan, Todos und einen Termin. Sie sind zum Ausprobieren da. Wenn du mit deinen eigenen Kursen loslegen willst, lösche sie; die Bewertungsraster-Vorlagen bleiben erhalten.
    </div>` : '';

  modal('Willkommen bei Pult.', `
    ${install}
    ${demo}
    <div class="wl-legal">Alle Daten bleiben auf diesem Gerät. <a href="${LEGAL_URL}" target="_blank" rel="noopener">Datenschutz &amp; Impressum</a></div>
  `, data.meta.demo ? [
    { label: 'Erst mal umsehen', onClick: closeModal },
    { label: 'Beispieldaten jetzt löschen', cls: 'primary', onClick: clearDemoData },
  ] : [
    { label: 'Verstanden', cls: 'primary', onClick: closeModal },
  ]);

  const inst = document.getElementById('wlInstall');
  if (inst) inst.onclick = async () => {
    const p = installPrompt; installPrompt = null; inst.remove();
    try { await p.prompt(); } catch (e) {}
  };
}

/* Beispieldaten löschen. Einstellungen (Darstellung, Vorgaben, Druck …) und
   die Bewertungsraster-Vorlagen bleiben, alles Fiktive wird entfernt. */
async function clearDemoData() {
  if (archiveMode) return toast('Erst das Archiv verlassen.');
  await takeSnapshot('Vor dem Löschen der Beispieldaten').catch(() => {});
  const fresh = DEFAULT_DATA();
  const keep = Object.assign({}, data.meta);
  ['demo', 'ferienDatum', 'ferienLabel', 'zeugnisDatum', 'lastBackup'].forEach(k => delete keep[k]);
  Object.assign(fresh.meta, keep);
  fresh.rubrics = data.rubrics || [];
  data = fresh; runMigrations(); save();
  closeModal(); navStack = []; go({ name: 'home' });
  toast('Beispieldaten gelöscht.');
}

/* Aus den Einstellungen: dort kann schon Eigenes dazugekommen sein */
function confirmClearDemoData() {
  modal('Beispieldaten löschen?', `
    <p>Alle Kurse, Schüler:innen, Noten, der Stundenplan, Todos und Termine werden entfernt — auch was du selbst schon ergänzt hast. Einstellungen und Bewertungsraster-Vorlagen bleiben.</p>
  `, [
    { label: 'Abbrechen', onClick: closeModal },
    { label: 'Beispieldaten löschen', cls: 'danger', onClick: clearDemoData },
  ]);
}
