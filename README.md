# Pult.

Eine Webapp zur vertraulichen Verwaltung von Noten für Lehrkräfte. Ideal für Dienstgeräte. 
Eine Version kann über https://schule.schrickel.cc/pult verwendet werden. 

## Funktionen
Pult. läuft, nachdem die Webapp hinzugefügt wurde, komplett offline und alle Daten bleiben auf dem Gerät. Dabei nutzt es den internen Speicher des Browsers. Daher empfiehlt es sich, die Website als Webapp hinzuzufügen, damit ein Löschen des Chaches nicht die Daten der Anwendung löscht. 

Mit Pult kann man:
- Klassen und die Noten der Schüler verwalten. 
- Notenüberischten drucken.
- Bewertungsraster anlegen und ausfüllen (mit Selbsteinschätzung).
- Sitzpläne anlegen und direkt im Plan Noten, Hausaufgaben, etc. bearbeiten.
- Zufällige Gruppen bilden.
- Todos und Termine anlegen.

## Pult. einsetzen

Am besten auf einem eigenen Webspace hochladen. Es empfiehlt sich regelmäßig ein Datenbank-Backup anzulegen. Dies ist auch verschlüsselt möglich. Ein Import/Export sämtlicher Daten ist einfach möglich. 
In der Regel ist es erforderlich, eine PIN-Sperre hinzuzufügen. Diese ist mit Touch/Face-Id verknüpfbar, dies ist auf Dienstgeräten jedoch meist deaktiviert. 

Beim Hochladen auf den eigenen Server sollte die datenschutz.html ggf. angepasst werden. Diese ist nur als nicht rechtlich geprüfter Vorschlag zu verstehen. 


## Neue Version veröffentlichen

Pult. läuft komplett aus dem Cache und übernimmt eine neue Version nur, wenn sie in der App
unter **Einstellungen → Über Pult. → Nach Update suchen** angefordert wird.

1. `VERSION` in `sw.js` erhöhen (z. B. `1.0.0` → `1.1.0`).
2. Dieselbe Nummer in `version.json` eintragen und oben im `changelog` einen Eintrag mit den Änderungen ergänzen.
3. Neue Dateien unter `js/` auch in `ASSETS` in `sw.js` und als `<script>` in `index.html` aufnehmen.
4. Alles auf den Webspace laden.


## Disclaimer

Dies ist ein privates, nicht-kommerzielles Hobby-Projekt, das mit der interessierten Öffentlichkeit und für Kollegen geteilt wird. Ob der Einsatz von Pult. rechtlich im jeweiligen Bundesland möglich ist, muss selbstständig in den jeweiligen Verordnungen insbesondere bezüglich dem Einsatz auf oder außerhalb von Dienstgeräten recherchiert werden. Datenschutzmäßig ist die App soweit unkritisch, da keine Daten online verarbeitet oder geteilt werden.

Der Code ist maßgeblich mithilfe von LLMs (Claude OPUS 5 und 5.5) erstellt worden. 