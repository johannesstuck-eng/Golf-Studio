# MVP-Umfang

## Ziel

Das erste verkaufbare MVP beweist auf Windows einen stabilen lokalen **Schnitt-Playbook-Workflow für ein zusammenhängendes Golfvideo**: Rundenmaterial importieren, nach Löchern, Spielern und Schlägen strukturieren, einen geordneten Rohschnitt aufbauen, mit mindestens einer Golfgrafik veredeln und als MP4 exportieren. Der Testumfang darf auf eine kurze, repräsentative Runde oder mehrere ausgewählte Löcher begrenzt sein; ein isolierter Einzelclip reicht als Produktbeleg nicht aus.

## Muss enthalten

- Windows-Desktop-Installer für eine definierte Testmatrix
- Import von mindestens H.264/AAC in MP4/MOV
- lokale, flüssige Wiedergabe mit framegenauer Navigation
- Rundenprojekt mit mehreren Löchern, Spielern, Schlägen und Clips
- nachvollziehbare Sichtung und Zuordnung des Materials zur Golfstruktur
- automatische, korrigierbare Reihenfolge für einen zusammenhängenden Rohschnitt
- In-/Out-Schnitt für die verwendeten Sequenzen
- mindestens ein einfaches Loch-, Spieler-, Score- oder Schlag-Overlay
- H.264-MP4-Export des zusammenhängenden Videos mit verständlichem Fortschritt und Fehlern
- lokales Projektformat mit Vorwärts-/Rückwärtskompatibilitätsregeln
- Crash- und Datenschutzverhalten, das vor Beta-Start dokumentiert ist

## Darf enthalten, ist aber nicht abnahmerelevant

- Multicam-Gruppen
- manueller Shot-Tracer mit editierbaren Punkten und Timing
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

Der Kernpfad läuft auf allen freigegebenen Testsystemen mit dokumentiertem, nicht-sensitivem Rundenmaterial durch. Ein Nutzer erreicht aus mehreren Quelldateien einen zusammenhängenden, golfstrukturierten Rohschnitt und exportiert ein abspielbares Gesamtvideo. Import und Export verändern die Originaldateien nicht. Fehler sind verständlich, ein abgebrochener Export hinterlässt kein fälschlich als fertig dargestelltes Video, und alle CI-Prüfungen sind grün.
