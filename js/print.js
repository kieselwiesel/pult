/* ============================================================
   Pult. — Druckansicht
   ------------------------------------------------------------
   Eine Ebene über der App zeigt fertige A4-Seiten als Vorschau.
   „PDF / Drucken" fotografiert die Seiten (html2canvas) und legt sie in ein
   PDF (jsPDF), das über das Teilen-Menü weitergeht — dort gibt es
   „Drucken" und „In Dateien sichern". Den Druckdialog des Browsers nutzen
   wir nicht: als Web-App auf dem Home-Bildschirm kennt iPadOS ihn nicht
   (window.print() tut dort nichts).

   Beide Bibliotheken liegen in js/vendor und werden erst beim ersten PDF
   geladen (der Service Worker hält sie offline bereit).

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
      <button class="btn small primary" data-pv="pdf" title="PDF erstellen und teilen (Drucken, Dateien, AirDrop …)">PDF / Drucken</button>
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

  /* PDF entsteht einmal pro Vorschau und wird dann wiederverwendet */
  const filename = (opts.filename || 'pult-druck') + '.pdf';
  let pdfBlob = null, busy = false;
  const pdfBtn = el.querySelector('[data-pv="pdf"]');
  const pdfFlow = async () => {
    if (busy) return;
    if (!pdfBlob) {
      busy = true; pdfBtn.disabled = true; pdfBtn.textContent = 'Erstelle PDF …';
      try {
        /* aus dem DOM, damit die Verdichtung (fit) mitkommt */
        pdfBlob = await buildPdf([...el.querySelectorAll('.pp-sheet')], landscape, opts.title);
      } catch (err) {
        console.error(err);
        toast('PDF konnte nicht erstellt werden.');
        return;
      } finally {
        busy = false; pdfBtn.disabled = false; pdfBtn.textContent = 'PDF / Drucken';
      }
      if (!el.isConnected) return;        // Vorschau inzwischen geschlossen
    }
    const res = await sharePdf(pdfBlob, filename);
    if (res === 'gesture') {
      /* Das Erstellen hat zu lange gedauert, iPadOS lässt das Teilen erst
         nach einem neuen Antippen zu. */
      pdfBtn.textContent = 'PDF teilen';
      toast('PDF ist fertig — zum Drucken oder Sichern auf „PDF teilen" tippen.');
    } else {
      pdfBtn.textContent = 'PDF / Drucken';
    }
  };

  el.addEventListener('click', e => {
    const b = e.target.closest('[data-pv]'); if (!b) return;
    if (b.dataset.pv === 'close') closePrintView();
    else if (b.dataset.pv === 'pdf') pdfFlow();
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

/* ---------- PDF ---------- */
const scriptLoads = {};
function loadScript(src) {
  if (!scriptLoads[src]) scriptLoads[src] = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src; s.onload = resolve;
    s.onerror = () => { delete scriptLoads[src]; s.remove(); reject(new Error('Laden fehlgeschlagen: ' + src)); };
    document.head.appendChild(s);
  });
  return scriptLoads[src];
}

/* Jede Seite wird ungezoomt in einen unsichtbaren Behälter kopiert,
   abfotografiert und als Bild auf ein A4-Blatt gelegt. Die Seite trägt ihren
   Papierrand selbst (Bildschirm-Styles), das Bild füllt also das ganze Blatt. */
const PDF_SCALE = 2;                      // ≈ 190 dpi — scharf genug für Text
async function buildPdf(sheets, landscape, title) {
  await Promise.all([loadScript('js/vendor/html2canvas.min.js'), loadScript('js/vendor/jspdf.umd.min.js')]);
  const p = pageMm(landscape);
  const pdf = new window.jspdf.jsPDF({ orientation: landscape ? 'landscape' : 'portrait', unit: 'mm', format: 'a4', compress: true });
  pdf.setProperties({ title: title || 'Pult.', creator: 'Pult.' });

  const host = document.createElement('div');
  host.className = 'pp-doc pdf-host';
  document.body.appendChild(host);
  try {
    let first = true;
    for (const sheet of sheets) {
      const clone = sheet.cloneNode(true);
      host.replaceChildren(clone);
      const canvas = await window.html2canvas(clone, {
        scale: PDF_SCALE, backgroundColor: '#ffffff', logging: false,
        scrollX: 0, scrollY: 0, windowWidth: clone.scrollWidth, windowHeight: clone.scrollHeight
      });
      /* Höhe eines Blatts in Pixeln des Bildes */
      const pagePx = canvas.width * p.h / p.w;
      const slices = canvas.height <= pagePx * 1.15
        ? [{ y: 0, h: canvas.height }]                     // passt (notfalls leicht verkleinert)
        : Array.from({ length: Math.ceil(canvas.height / pagePx) }, (_, i) =>
            ({ y: i * pagePx, h: Math.min(pagePx, canvas.height - i * pagePx) }));
      for (const sl of slices) {
        if (!first) pdf.addPage('a4', landscape ? 'landscape' : 'portrait');
        first = false;
        let img = canvas;
        if (slices.length > 1) {
          img = document.createElement('canvas');
          img.width = canvas.width; img.height = Math.round(sl.h);
          img.getContext('2d').drawImage(canvas, 0, -Math.round(sl.y));
        }
        const data = img.toDataURL('image/jpeg', 0.92);
        /* zu hohe Seite proportional verkleinern und mittig setzen */
        const k = Math.min(1, pagePx / img.height);
        const w = p.w * k, h = img.height * (p.w / img.width) * k;
        pdf.addImage(data, 'JPEG', (p.w - w) / 2, 0, w, h, undefined, 'FAST');
        if (img !== canvas) img.width = img.height = 0;
      }
      canvas.width = canvas.height = 0;   // Speicher sofort freigeben (iPad)
    }
  } finally {
    host.remove();
  }
  return pdf.output('blob');
}

/* PDF übers Teilen-Menü weitergeben, sonst herunterladen.
   'shared' | 'aborted' | 'gesture' (Antippen zu lange her) | 'downloaded' */
async function sharePdf(blob, filename) {
  const file = new File([blob], filename, { type: 'application/pdf' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: filename });
      return 'shared';
    } catch (e) {
      if (e && e.name === 'AbortError') return 'aborted';
      if (e && e.name === 'NotAllowedError') return 'gesture';
    }
  }
  await saveFile(blob, filename);
  return 'downloaded';
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
