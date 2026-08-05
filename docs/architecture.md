# Architektur

## Entscheidung

CUT18 bleibt für die nächste Produktphase bei **Electron + React + TypeScript**. Diese Entscheidung nutzt die vorhandene App, minimiert einen riskanten Rewrite und bietet einen gut automatisierbaren Entwicklungs- und Testpfad. Sie wird nach dem Windows-MVP anhand gemessener Startzeit, Speicherbedarf, Paketgröße und Video-Performance überprüft.

## Bewertete Alternativen

| Kriterium | Electron | Tauri | Native Alternative: .NET/WPF |
| --- | --- | --- | --- |
| bestehender Code | vollständig nutzbar | Renderer teilweise nutzbar, Desktop-Schicht neu | weitgehender Rewrite |
| FFmpeg | bewährte Node-Child-Processes und Binärpakete | gute Sidecar-Option, Rust-Integration nötig | gute Process-/NuGet-Integration |
| Windows-Paketierung | electron-builder, breit erprobt | kleine Pakete, zusätzlicher Toolchain-Aufwand | starke Windows-Integration |
| späteres macOS | gleiche Web-Oberfläche und Electron-Shell | ebenfalls gut möglich | WPF nicht portierbar; Avalonia wäre andere native Option |
| Video/UI-Wartbarkeit durch KI-Agenten | sehr hoch durch einheitliches TypeScript | mittel: TypeScript plus Rust | mittel: TypeScript entfällt, C#/XAML nötig |
| Laufzeit- und Paketgröße | größter Nachteil | klarer Vorteil | guter Windows-Fit |
| Projektrisiko jetzt | niedrig | mittel bis hoch | hoch |

Tauri bleibt eine sinnvolle spätere Optimierungsoption, wenn gemessene Electron-Kosten den Produktnutzen beeinträchtigen. Eine native Alternative auf .NET/WPF bietet den besten tiefen Windows-Fit, widerspricht aber dem macOS-Ziel; Avalonia reduziert dieses Problem, würde dennoch einen großen Rewrite bedeuten.

## Komponenten

1. **Renderer:** React/TypeScript in `src/`; UI, Projektlogik und Vorschau.
2. **Desktop-Shell:** Electron Main Process in `dist-electron/main.js`; Dateidialoge, lokale Medienanalyse, Speichern und Export.
3. **Sichere Brücke:** `dist-electron/preload.cjs`; schmale, typisierte IPC-Oberfläche für den Renderer.
4. **Media Engine:** lokal gebündelte FFmpeg-/FFprobe-Binärdateien; keine Cloud-Übertragung.
5. **Projektdatei:** JSON-basiertes `.golfcut`-Format; referenziert Originalmedien, verändert oder kopiert sie nicht.
6. **Orchestrator:** manuelles Node-CLI unter `tools/`; liest Markdown und öffentliche Issue-Metadaten, schreibt nur einen lokalen Bericht.

## Sicherheitsgrenzen

- Renderer erhält keinen direkten Node- oder Dateisystemzugriff.
- IPC-Kanäle werden explizit in Preload freigegeben.
- Medienpfade bleiben lokal und werden nicht telemetriert.
- FFmpeg-Argumente werden als Argumentlisten übergeben, nicht als Shell-Strings.
- Paketierte Builds verwenden ausschließlich die mitgelieferten FFmpeg-/FFprobe-Dateien unter `app.asar.unpacked`; Umgebungsvariablen und systemweite `PATH`-Treffer werden dort ignoriert.
- Projektdateien gelten als nicht vertrauenswürdige Eingabe und müssen normalisiert werden.
- Secrets und Zugangsdaten gehören weder in Projektdateien noch ins Repository.

## Technische Schulden

- Der Main-Process liegt derzeit als JavaScript in `dist-electron/` statt als klar getrennte TypeScript-Quelle vor.
- Renderer-Komponenten sind teilweise sehr groß und sollten entlang von Workflows zerlegt werden.
- Es fehlen echte Medien-Fixtures und End-to-End-Tests.
- FFmpeg-Binärversion, Lizenzhinweise und Distributionsmodell müssen vor Verkauf geprüft werden.

## Annahmen

- Ein größerer Installationsumfang ist für die erste Windows-Beta akzeptabel.
- Lokale Verarbeitung ist wichtiger als minimale Paketgröße.
- Das Team priorisiert Lieferfähigkeit und Testbarkeit vor einem Framework-Rewrite.
