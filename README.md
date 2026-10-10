# Pult.

Ein Lehreralltagshelfer, vor allem für Noteneintragungen. Alle Daten bleiben dabei im Browser.
Es empfiehlt sich Pult. als Webapp zu installieren und für die Daten regelmäßig ein Backup zu erstellen. 

Deploy am besten auf den eigenen Webspace oder auf einen lokal erstellten Webserver. 


## Neue Version veröffentlichen

Pult. läuft komplett aus dem Cache und übernimmt eine neue Version nur, wenn sie in der App
unter **Einstellungen → Über Pult. → Nach Update suchen** angefordert wird.

1. `VERSION` in `sw.js` erhöhen (z. B. `1.0.0` → `1.1.0`).
2. Dieselbe Nummer in `version.json` eintragen und oben im `changelog` einen Eintrag mit den Änderungen ergänzen.
3. Neue Dateien unter `js/` auch in `ASSETS` in `sw.js` und als `<script>` in `index.html` aufnehmen.
4. Alles auf den Webspace laden.

Ohne Schritt 1 findet die App zwar die neue `version.json`, kann aber nichts installieren.

## Aufbau

Reines HTML/CSS/JS ohne Build-Schritt. Die Dateien in `js/` werden der Reihe nach geladen
(siehe `index.html`); alle außer `pult.js` enthalten nur Definitionen, `pult.js` startet die App.
