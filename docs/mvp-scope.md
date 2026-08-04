# MVP-Umfang

## Ziel

Das erste verkaufbare MVP beweist einen stabilen lokalen Workflow für **einen einzelnen Golfclip** auf Windows: importieren, abspielen, zuschneiden, einen manuellen Shot-Tracer oder ein Text-Overlay setzen und als MP4 exportieren.

## Muss enthalten

- Windows-Desktop-Installer für eine definierte Testmatrix
- Import von mindestens H.264/AAC in MP4/MOV
- lokale, flüssige Wiedergabe mit framegenauer Navigation
- In-/Out-Schnitt für einen Clip
- manueller Shot-Tracer mit editierbaren Punkten und Timing
- einfaches Spieler-/Schlag-Overlay
- H.264-MP4-Export mit verständlichem Fortschritt und Fehlern
- lokales Projektformat mit Vorwärts-/Rückwärtskompatibilitätsregeln
- Crash- und Datenschutzverhalten, das vor Beta-Start dokumentiert ist

## Darf enthalten, ist aber nicht abnahmerelevant

- strukturierte komplette Runden und mehrere Spieler
- Multicam-Gruppen
- automatische Ballkandidaten
- Kamera-Lock
- verlustfreier Masterexport

Diese vorhandenen Prototypfunktionen dürfen bleiben, dürfen aber die Stabilisierung des Kernpfads nicht blockieren.

## Nicht im ersten MVP

- Cloud-Rendering oder Cloud-Medienspeicherung
- vollautomatische Schlag- oder Ballverfolgung
- kollaborative Projekte
- mobile Apps
- öffentlicher Marketplace oder Plugin-System
- automatische Veröffentlichung auf Social-Media-Plattformen
- verpflichtende Benutzerkonten oder Abonnements

## Definition of Done

Der Kernpfad läuft auf allen freigegebenen Testsystemen mit dokumentiertem Testclip durch. Import und Export verändern die Originaldatei nicht. Fehler sind verständlich, ein abgebrochener Export hinterlässt keinen fälschlich als fertig dargestellten Clip, und alle CI-Prüfungen sind grün.
