# Freigaberichtlinie

## Dürfen Agenten selbstständig tun

- Repository lesen, dokumentieren und analysieren
- auf einem `agent/*`-Branch Code und Tests ändern
- lokale, kostenlose Builds und Tests ausführen
- Draft Pull Requests vorbereiten
- Annahmen dokumentieren und risikoarme, reversible Implementierungsdetails wählen
- Issues vorschlagen oder im ausdrücklich beauftragten Umfang anlegen

## Benötigt vorherige Freigabe von Johannes

- Geld ausgeben oder kostenpflichtige Dienste aktivieren
- Produktion, Websites, Installer oder Releases veröffentlichen
- PRs mergen oder Schutzregeln umgehen
- externe Nachrichten, Einladungen, Umfragen oder Marketing versenden
- Verträge, Lizenzen, Preise oder finanzielle/rechtliche Verpflichtungen eingehen
- Secrets anlegen, rotieren oder in externe Systeme übertragen
- Telemetrie oder Datenerhebung aktivieren
- destruktive Migrationen oder Löschung von Nutzer-/Repository-Daten
- Wechsel der Kernarchitektur oder umfangreicher Rewrite

## Verboten

- Secrets oder Zugangsdaten im Repository speichern
- direkt auf `main` arbeiten
- ungeprüfte Produktbehauptungen als Tatsachen darstellen
- Nutzerinhalte ohne ausdrückliche Zustimmung hochladen
- Freigaben erfinden oder aus Schweigen ableiten

## Umgang mit Unsicherheit

Eine Agentin oder ein Agent darf eine reversible Annahme treffen, wenn sie aus dem Kontext ableitbar ist. Die Annahme muss in Dokumentation oder Draft-PR sichtbar sein. Verändert die Annahme Kosten, Datenschutz, Außenwirkung, Architektur oder Verpflichtungen wesentlich, wird die Arbeit pausiert und eine Freigabe angefordert.

## Merge-Gate

Ein Draft-PR darf erst zur Review-Reife wechseln, wenn Umfang und Annahmen dokumentiert, relevante Tests ausgeführt, Fehler ehrlich benannt und offene Entscheidungen explizit aufgeführt sind. Merge bleibt eine menschliche Entscheidung.
