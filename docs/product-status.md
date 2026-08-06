# Produktstatus

Stand: 6. August 2026

## Einordnung

Der vorhandene Code ist deutlich weiter als ein leerer Baseline-Prototyp. Er enthält bereits UI und Logik für Projekte, Medienimport, Sichtung, Golfblöcke, Overlays, Shot-Tracer, Kamera-Lock und FFmpeg-Export. Diese Funktionen gelten dennoch nur als **technischer Prototyp**, weil reproduzierbare End-to-End-Tests mit realem Videomaterial, Installer-Validierung, Datenschutzentscheidung und Beta-Feedback fehlen.

## Vorhanden

- dunkle Electron-/React-Oberfläche für Windows
- lokaler Video- und Audioimport über Electron-IPC
- `.golfcut`-Projektmodell mit Schema-Migration
- kanonisches Moment-, Kamera-, Ton- und Effektmodell als Grundlage für identische Vorschau und Ausgabe
- deterministischer Renderplan mit strukturierten Warnungen und blockierenden Diagnosen
- renderplangesteuerte A→B→A-Filmvorschau mit unabhängigem Hauptton
- Camera-Plan-Bedienung mit unverbindlicher Kameravorschau, bewusster Übernahme ab Abspielposition oder für den ganzen Moment und sichtbarer finaler Schnittfolge
- FFmpeg-Ausgabe derselben Kamera-, Ton- und kameragebundenen Tracer-Entscheidungen
- Round Builder mit Zuordnung nach Loch, Spieler und Schlagblock
- lokale PDF-Scorecard-Erkennung mit Abschlagsauswahl und kontrollierter Übernahme von Par, Länge und Vorgabe
- automatische Spielerreihenfolge und strukturierter Rohschnitt
- framebasierte virtuelle Sequenzen, Golfblöcke und Multicam-Vorschläge
- fester Editorial-Look mit Loch-, Score-, Spieler- und Schlaginformationen
- manuelle Shot-Tracer-Geometrie und Kamera-Lock
- lokale FFprobe-/FFmpeg-Integration und Exportprofile
- Unit-Tests für Modell-, Tracer-, Export- und Erkennungslogik
- experimentelle macOS-Paketierung

## Noch nicht freigegeben

- reproduzierbare Windows-Installation auf frischem Gerät
- belastbarer End-to-End-Import und -Export für unterstützte Formate
- definierte Performance-Grenzen für 4K-/60-fps-Material
- Telemetrie- und Datenschutzkonzept
- signierte Builds und Update-Strategie
- getestete Barrierefreiheit und vollständige UX-Validierung
- Beta-Programm, Preis oder Vertriebsprozess
- automatische Erkennung fotografierter oder gescannter Scorecards

## Wichtigster aktueller Engpass

Die technische Breite ist größer als die validierte Produktqualität. Priorität hat daher ein schmaler, reproduzierbarer End-to-End-Beleg des eigentlichen Produktversprechens: vom importierten Rundenmaterial über die Golfstruktur und den zusammenhängenden Rohschnitt bis zum lokalen Export auf Windows.

## Offene Freigaben

- Welche zwei bis drei Windows-/Hardware-Konfigurationen bilden die Beta-Testmatrix?
- Darf eine vollständig optionale, datensparsame Telemetrie überhaupt angeboten werden?
- Welche Videoformate und maximale Auflösung gehören verbindlich zum ersten MVP?
