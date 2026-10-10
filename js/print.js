/* ============================================================
   Pult. — Druckansicht
   ------------------------------------------------------------
   Eine Ebene über der App zeigt fertige A4-Seiten als Vorschau.
   „Drucken" öffnet den Druckdialog des Systems — auf dem iPad wird daraus
   über Teilen → „In Dateien sichern" ein PDF. „Als Datei" erzeugt eine
   eigenständige HTML-Datei mit denselben Seiten, die sich überall öffnen
   und drucken lässt.

   Damit beide Wege gleich aussehen, stehen die Seiten-Styles hier als Text
   und werden sowohl in die App als auch in die Datei geschrieben.

   Wird vor pult.js geladen: hier stehen nur Definitionen, aufgerufen wird
   erst zur Laufzeit (dann sind esc, toast usw. aus pult.js vorhanden).
   ============================================================ */
'use strict';

/* Grundlayout einer Seite. Maße in mm/pt, damit der Druck stimmt. */
const PRINT_BASE_CSS = `
.pp-doc { color: #111; font-family: -apple-system, "Helvetica Neue", Helvetica, Arial, sans-serif;
  -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.pp-sheet { background: #fff; box-sizing: border-box; font-size: 8pt; line-height: 1.25; }
.pp-sheet * { box-sizing: border-box; }
`;

/* Bildschirm: Seite mit Papierrand; Druck: Rand macht @page */
const pageMm = landscape => (landscape ? { w: 297, h: 210 } : { w: 210, h: 297 });
const PRINT_MARGIN_MM = 8;

function printSheetCss(landscape) {
  const p = pageMm(landscape);
  return `
@page { size: A4 ${landscape ? 'landscape' : 'portrait'}; margin: ${PRINT_MARGIN_MM}mm; }
@media screen {
  .pp-sheet { width: ${p.w}mm; min-height: ${p.h}mm; padding: ${PRINT_MARGIN_MM}mm; margin: 0 auto;
    box-shadow: 0 2px 12px rgba(0,0,0,.18); }
}
@media print {
  .pp-sheet { width: auto; min-height: 0; padding: 0; margin: 0; box-shadow: none; }
  .pp-sheet + .pp-sheet { break-before: page; page-break-before: always; }
}`;
}

let printCleanup = null;

/* Vorschau öffnen.
   opts: { title, pages: [html], landscape, css, filename, fit: [klassen] }
   fit: Klassen, die einer Seite nacheinander gegeben werden, solange sie
   nicht auf ein Blatt passt (z. B. kleinere Schrift, weniger Text). */
function openPrintView(opts) {
  closePrintView();
  const landscape = opts.landscape !== false;
  const style = document.createElement('style');
  style.id = 'printStyle';
  style.textContent = PRINT_BASE_CSS + printSheetCss(landscape) + (opts.css || '');
  document.head.appendChild(style);

  const el = document.createElement('div');
  el.id = 'printView';
  el.innerHTML = `
    <div class="pv-bar">
      <button class="btn small" data-pv="close">‹ Zurück</button>
      <div class="pv-title"><b>${esc(opts.title || 'Druckansicht')}</b>
        <span>${opts.pages.length} ${opts.pages.length === 1 ? 'Seite' : 'Seiten'} · A4 ${landscape ? 'quer' : 'hoch'}</span></div>
      <button class="btn small" data-pv="file" title="Eigenständige HTML-Datei — lässt sich überall öffnen und drucken">Als Datei</button>
      <button class="btn small primary" data-pv="print">Drucken / PDF</button>
    </div>
    <div class="pv-pages"><div class="pp-doc">${opts.pages.join('')}</div></div>`;
  document.body.appendChild(el);
  document.body.classList.add('printing');

  /* Vorschau auf Bildschirmbreite verkleinern (zoom statt transform, damit
     die Höhe mitschrumpft und nicht leerer Raum stehen bleibt) */
  const sheetPx = pageMm(landscape).w * 96 / 25.4;
  const fit = () => {
    const avail = el.querySelector('.pv-pages').clientWidth - 24;
    el.style.setProperty('--pv-zoom', String(Math.min(1, Math.max(0.3, avail / sheetPx))));
  };
  fit();
  window.addEventListener('resize', fit);
  if (opts.fit && opts.fit.length) fitSheets(el, landscape, opts.fit);

  el.addEventListener('click', e => {
    const b = e.target.closest('[data-pv]'); if (!b) return;
    if (b.dataset.pv === 'close') closePrintView();
    else if (b.dataset.pv === 'print') window.print();
    else if (b.dataset.pv === 'file') {
      /* aus dem DOM, damit die Verdichtung (fit) mitkommt */
      const pages = [...el.querySelectorAll('.pp-sheet')].map(x => x.outerHTML);
      const html = printDocumentHtml(opts.title, pages, landscape, opts.css);
      saveFile(new Blob([html], { type: 'text/html' }), (opts.filename || 'pult-druck') + '.html');
    }
  });
  const onKey = e => { if (e.key === 'Escape' && !document.querySelector('.lockscreen')) { e.stopPropagation(); closePrintView(); } };
  document.addEventListener('keydown', onKey, true);

  printCleanup = () => {
    window.removeEventListener('resize', fit);
    document.removeEventListener('keydown', onKey, true);
    el.remove(); style.remove();
    document.body.classList.remove('printing');
  };
}
/* Seiten, die über ein Blatt hinauslaufen, schrittweise verdichten. Gemessen
   wird das Verhältnis Höhe/Breite — das bleibt unter zoom gleich. */
function fitSheets(root, landscape, classes) {
  const p = pageMm(landscape);
  const limit = (p.h / p.w) * 0.985;           // kleiner Puffer für Abweichungen beim Druck
  /* zu hoch — oder zu breit (Tabellen mit vielen Spalten laufen seitlich hinaus) */
  const over = sheet => sheet.offsetHeight / sheet.offsetWidth > limit || sheet.scrollWidth > sheet.clientWidth + 2;
  root.querySelectorAll('.pp-sheet').forEach(sheet => {
    sheet.style.minHeight = '0';
    for (let i = 0; i < classes.length && over(sheet); i++) sheet.classList.add(classes[i]);
    sheet.style.minHeight = '';
  });
}
function closePrintView() { if (printCleanup) { printCleanup(); printCleanup = null; } }

/* Dieselben Seiten als eigenständiges Dokument */
function printDocumentHtml(title, pages, landscape, css) {
  return `<!DOCTYPE html>
<html lang="de"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title || 'Pult.')}</title>
<style>
body { margin: 0; background: #e9ebee; }
@media screen { .pp-doc { padding: 16px 0; } .pp-sheet + .pp-sheet { margin-top: 16px; } }
@media print { body { background: #fff; } }
${PRINT_BASE_CSS}${printSheetCss(landscape)}${css || ''}
</style></head>
<body><div class="pp-doc">${pages.join('\n')}</div></body></html>`;
}

/* Datei weitergeben: auf iPad/Android über das Teilen-Menü (Dateien, AirDrop,
   OneDrive …), sonst als Download. false = abgebrochen. */
async function saveFile(blob, filename) {
  try {
    const file = new File([blob], filename, { type: blob.type });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: filename });
      return true;
    }
  } catch (e) {
    if (e && e.name === 'AbortError') return false;   // Teilen abgebrochen
    /* sonst (z. B. Nutzergeste abgelaufen): auf Download ausweichen */
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return true;
}
