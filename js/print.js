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

  /* Verdichten und Aufteilen in Originalgröße messen — so, wie das PDF die
     Seiten später abfotografiert */
  el.style.setProperty('--pv-zoom', '1');
  if (opts.fit && opts.fit.length) fitSheets(el, landscape, opts.fit);
  splitSheets(el, landscape);
  const nPages = el.querySelectorAll('.pp-sheet').length;
  el.querySelector('.pv-title span').textContent = `${nPages} ${nPages === 1 ? 'Seite' : 'Seiten'} · A4 ${landscape ? 'quer' : 'hoch'}`;

  /* Vorschau auf Bildschirmbreite verkleinern (zoom statt transform, damit
     die Höhe mitschrumpft und nicht leerer Raum stehen bleibt) */
  const sheetPx = pageMm(landscape).w * 96 / 25.4;
  const fit = () => {
    const avail = el.querySelector('.pv-pages').clientWidth - 24;
    el.style.setProperty('--pv-zoom', String(Math.min(1, Math.max(0.3, avail / sheetPx))));
  };
  fit();
  window.addEventListener('resize', fit);

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
const sheetTooHigh = (sheet, landscape) => {
  const p = pageMm(landscape);
  sheet.style.minHeight = '0';
  const r = sheet.offsetHeight / sheet.offsetWidth;
  sheet.style.minHeight = '';
  return r > (p.h / p.w) * 0.985;              // kleiner Puffer für Abweichungen beim Druck
};
const sheetTooWide = sheet => sheet.scrollWidth > sheet.clientWidth + 2;

/* Seiten mit aufteilbarer Tabelle werden nur so weit verdichtet — danach
   lieber auf mehrere Blätter verteilen als winzige Schrift */
const SPLIT_FIT_STEPS = 2;
function fitSheets(root, landscape, classes) {
  /* zu hoch — oder zu breit (Tabellen mit vielen Spalten laufen seitlich hinaus) */
  const over = sheet => sheetTooHigh(sheet, landscape) || sheetTooWide(sheet);
  root.querySelectorAll('.pp-sheet').forEach(sheet => {
    const steps = sheet.querySelector('table[data-split]') ? Math.min(SPLIT_FIT_STEPS, classes.length) : classes.length;
    for (let i = 0; i < steps && over(sheet); i++) sheet.classList.add(classes[i]);
  });
}

/* ---------- Tabellen auf mehrere Blätter verteilen ----------
   Gilt für Seiten mit <table data-split="k">: k = Anzahl der Spalten links
   (z. B. Nr. und Name), die auf jedem Blatt wiederkehren.
   - zu breit: die übrigen Spalten werden auf Blätter verteilt
   - zu hoch: Umbruch zwischen zwei Zeilen; der Tabellenkopf wiederholt sich,
     die Fußzeile der Tabelle (tfoot) steht nur auf dem letzten Blatt
   Was auf dem Blatt vor der Tabelle steht, wiederholt sich; was danach
   kommt, nur auf dem letzten Blatt — außer es trägt data-pp-repeat.
   Ein <span data-pp-part> bekommt „· Seite 2/3". */
function splitSheets(root, landscape) {
  root.querySelectorAll('.pp-sheet').forEach(sheet => {
    if (!sheet.querySelector('table[data-split]')) return;
    if (!sheetTooHigh(sheet, landscape) && !sheetTooWide(sheet)) return;
    const parts = splitByCols(sheet).flatMap(s => splitByRows(s, landscape));
    if (parts.length > 1) parts.forEach((s, i) => s.querySelectorAll('[data-pp-part]').forEach(x =>
      x.textContent = ` · Seite ${i + 1}/${parts.length}`));
  });
}

/* Spaltenposition jeder Zelle (berücksichtigt colspan/rowspan) */
function tableGrid(table) {
  const pos = new Map(), occ = [];
  let width = 0;
  [...table.rows].forEach((tr, r) => {
    let col = 0;
    [...tr.cells].forEach(cell => {
      while (occ[r] && occ[r][col]) col++;
      const cs = cell.colSpan || 1, rs = cell.rowSpan || 1;
      pos.set(cell, { start: col, span: cs });
      for (let dr = 0; dr < rs; dr++) for (let dc = 0; dc < cs; dc++) (occ[r + dr] = occ[r + dr] || [])[col + dc] = true;
      col += cs;
      width = Math.max(width, col);
    });
  });
  return { pos, width };
}
/* Elemente nach der Tabelle, die nur aufs letzte Blatt gehören */
function sheetTrailing(sheet) {
  let top = sheet.querySelector('table[data-split]');
  while (top.parentElement !== sheet) top = top.parentElement;
  const out = [];
  for (let n = top.nextElementSibling; n; n = n.nextElementSibling) if (!n.hasAttribute('data-pp-repeat')) out.push(n);
  return out;
}

/* Blatt mit den Spalten [0, keep) ∪ [a, b) */
function sheetWithCols(sheet, keep, a, b) {
  const s = sheet.cloneNode(true);
  const table = s.querySelector('table[data-split]');
  const { pos } = tableGrid(table);
  pos.forEach(({ start, span }, cell) => {
    const end = start + span;
    const n = Math.max(0, Math.min(end, keep) - start) + Math.max(0, Math.min(end, b) - Math.max(start, a));
    if (n === 0) cell.remove(); else cell.colSpan = n;
  });
  return s;
}
function splitByCols(sheet) {
  if (!sheetTooWide(sheet)) return [sheet];
  const table = sheet.querySelector('table[data-split]');
  const keep = parseInt(table.dataset.split, 10) || 0;
  const total = tableGrid(table).width;
  if (total - keep < 2) return [sheet];
  /* probeweise neben dem Original einhängen, damit die Breite stimmt */
  const fits = (a, b) => {
    const probe = sheetWithCols(sheet, keep, a, b);
    sheet.after(probe);
    const ok = !sheetTooWide(probe);
    probe.remove();
    return ok;
  };
  const ranges = [];
  for (let a = keep; a < total;) {
    /* möglichst viele Spalten — mindestens eine */
    let lo = a + 1, hi = total;
    while (lo < hi) { const mid = Math.ceil((lo + hi) / 2); if (fits(a, mid)) lo = mid; else hi = mid - 1; }
    ranges.push([a, lo]); a = lo;
  }
  const parts = ranges.map(([a, b]) => sheetWithCols(sheet, keep, a, b));
  parts.slice(0, -1).forEach(s => sheetTrailing(s).forEach(n => n.remove()));
  sheet.replaceWith(...parts);
  return parts;
}

function splitByRows(sheet, landscape) {
  const parts = [];
  let cur = sheet;
  for (;;) {
    const n = cur.querySelector('table[data-split]').tBodies[0]?.rows.length || 0;
    if (n <= 1 || !sheetTooHigh(cur, landscape)) { parts.push(cur); break; }
    /* Blatt mit den ersten m Zeilen, ohne Tabellenfuß und Nachfolgendes */
    const head = m => {
      const s = cur.cloneNode(true);
      const table = s.querySelector('table[data-split]');
      [...table.tBodies[0].rows].slice(m).forEach(tr => tr.remove());
      if (table.tFoot) table.tFoot.remove();
      sheetTrailing(s).forEach(x => x.remove());
      return s;
    };
    const fits = m => { const probe = head(m); cur.after(probe); const ok = !sheetTooHigh(probe, landscape); probe.remove(); return ok; };
    let lo = 1, hi = n - 1;
    while (lo < hi) { const mid = Math.ceil((lo + hi) / 2); if (fits(mid)) lo = mid; else hi = mid - 1; }
    const first = head(lo);
    const rest = cur.cloneNode(true);
    [...rest.querySelector('table[data-split]').tBodies[0].rows].slice(0, lo).forEach(tr => tr.remove());
    cur.replaceWith(first, rest);
    parts.push(first);
    cur = rest;
  }
  return parts;
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
