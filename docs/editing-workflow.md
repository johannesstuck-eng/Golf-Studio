# CUT18 Editing Workflow

Status: verbindliche Produkt- und Engineering-Richtung, abgestimmt am 6. August 2026.

## Produktprinzip

CUT18 ist das Regiepult für eine Golfrunde, kein klassisches Schnittprogramm. Die zentrale Einheit ist ein **Golf-Moment** – zum Beispiel „Joes Abschlag an Loch 7“ – und nicht eine einzelne Mediendatei oder Kameraspur.

**Round Desk organisiert den Film. Moment Studio trifft die Schnittentscheidungen. Film Review bestätigt das Ergebnis. Export rendert exakt dieses Ergebnis.**

## A–Z-Ablauf

1. **Runde anlegen:** Platz, Lochanzahl, Spieler und Scorecard festlegen.
2. **Material importieren:** Dateien lokal prüfen, analysieren und zu Kameragruppen zusammenfassen.
3. **Synchronisieren:** Kameras automatisch über Ton ausrichten; nur unsichere Ergebnisse manuell prüfen.
4. **Sichten:** In/Out, Loch, Spieler und Momenttyp in einer Entscheidungswarteschlange bestätigen.
5. **Round Desk:** Filmstatus, Hole Stories, offene Entscheidungen und nächste Aufgabe anzeigen.
6. **Moment Studio:** gemeinsamen Momentbereich, Camera Plan, Hauptton und Effekte bearbeiten.
7. **Hole Story prüfen:** Vollständigkeit, Reihenfolge und Konflikte eines Lochs kontrollieren.
8. **Film Review:** den kanonischen Renderstand der kompletten Runde prüfen.
9. **Export:** denselben validierten Renderplan lokal mit FFmpeg ausgeben.

## Verbindliches Domänenmodell

```text
Round
└── Hole
    └── Moment
        ├── semantischer Golfkontext
        ├── gemeinsame Moment-Zeitspanne
        ├── Angle Coverage[]
        ├── Camera Plan
        │   └── Video Cut[]
        ├── Audio Plan
        ├── Effect Placement[]
        └── Review Fingerprint
```

- Ein Moment existiert genau einmal, auch wenn mehrere Kameras ihn zeigen.
- Jeder verwendete Zeitpunkt besitzt genau eine finale Bildquelle.
- Kameraschnitte verändern eine feste Haupttonquelle nicht automatisch.
- Ein winkelabhängiger Effekt wird nur auf einer kalibrierten Kamera gerendert.
- Vorschau, Exportzusammenfassung und Export konsumieren denselben Renderplan.
- Automatik überschreibt keine manuell gesperrte Entscheidung.
- Es gibt keine stillen Kamera-Fallbacks und keine still übersprungenen Momente.

## Camera Plan

Der Camera Plan besteht aus lückenlosen, nicht überlappenden Abschnitten relativ zum Golf-Moment. Jeder Abschnitt verweist auf genau eine verfügbare Kamera.

- Ein Klick auf eine Kamera wechselt nur die lokale Vorschau.
- „Für ganzen Moment verwenden“ ersetzt den Camera Plan bewusst.
- „Ab hier Kamera verwenden“ setzt einen Schnitt am Abspielkopf.
- Kamerawechsel während der Wiedergabe können später über Tasten 1–4 aufgezeichnet werden.
- Die Automatik erzeugt einen gültigen ersten Vorschlag; manuelle Änderungen bleiben gesperrt.
- Herkunft (`automatic`, `manual`, `mixed`, `migrated`) und Review-Zustand sind getrennt.

## Shot-Tracer

Ein aktiver Tracer gehört zu einem Moment, einer Kamera, einem Zeitraum und gegebenenfalls einem konkreten Cut. Im MVP bleibt von Impact bis Tracer-Ende dieselbe Kamera aktiv.

Ein Kameraschnitt im Tracer-Zeitraum erzeugt einen blockierenden Konflikt. Mögliche Auflösungen sind:

- Tracer-Kamera beibehalten,
- Kameraschnitt hinter die Landung verschieben,
- Tracer entfernen,
- später einen weiteren Winkel separat kalibrieren.

Die ungeprüfte Übertragung derselben Tracer-Geometrie auf eine andere Perspektive ist nicht erlaubt.

## Rolle des Round Desk

Round Desk ist Home und Steuerung, kein zusätzlicher Editor. Er zeigt:

- Readiness der vollständigen Runde,
- Lochstatus und Hole Stories,
- technische und redaktionelle Engpässe,
- die wichtigste nächste Aufgabe,
- den aktuellen vollständigen Film.

Ein Deep Link öffnet das betroffene Werkzeug im Moment Studio. Nach dem Speichern kehrt der Nutzer exakt zum vorherigen Loch und Problem zurück. Der bisherige Round Builder geht langfristig im Round Desk auf.

## Readiness

Readiness wird aus Diagnosen berechnet und nicht als beliebige Prozentzahl gespeichert:

1. Material bereit
2. Synchronisierung bereit
3. Story bereit
4. Bildschnitt bereit
5. Effekte bereit
6. Film geprüft
7. Export bereit

Warnungen erlauben einen Testexport. Blockierende Diagnosen verhindern einen technisch unvollständigen oder irreführenden Export. Jede Diagnose nennt den betroffenen Moment und führt direkt dorthin.

## Umsetzungsreihenfolge

### P0 – Fundament

1. Kanonischen Renderplan und strukturierte Diagnosen implementieren.
2. Projektformat rückwärtskompatibel um Camera Cuts, Audio Plan und Effektbindung erweitern.
3. Bestehende Projekte zu einem Full-Length-Cut migrieren, ohne Kameras zu erraten.
4. Preview, Export Summary und FFmpeg-Export auf denselben Renderplan umstellen.
5. Shot-Tracer an Kamera und Cut binden.

### P1 – Workflow

1. Camera Plan und klare Trennung von Preview und Übernahme im Moment Studio.
2. Mehrere Kameraschnitte innerhalb eines Moments.
3. Round Builder in Round Desk integrieren.
4. Echte Readiness und offene Entscheidungen anzeigen.
5. WYSIWYG Film Review und Export-Preflight.

### Später

- automatische Regieentscheidung,
- kamerübergreifender Shot-Tracer,
- automatische Schlag- und Momenterkennung,
- Farb- und Audioangleichung,
- Proxy-Workflow und alternative Filmfassungen.

## Abnahme

- Unverbindliches Vorschauen verändert den Export nicht.
- Ein Moment kann A → B → A ohne Lücke oder Drift rendern.
- Der Hauptton bleibt bei Bildwechseln stabil.
- Ein Tracer erscheint nur auf seiner gebundenen Kamera.
- Änderungen an Sync, Schnitt, Ton oder Effekt machen ein Review veraltet.
- Fehlende Medien und ungültige Cuts blockieren den Export statt still zu verschwinden.
- Film Review und Export verwenden denselben Renderplan und dieselbe Gesamtdauer.
- Bestehende `.golfcut`-Projekte öffnen sich nach der Migration ohne Verlust des bisherigen Ergebnisses.
