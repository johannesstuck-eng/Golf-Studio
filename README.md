# CUT18

CUT18 ist das lokale Schnitt-Playbook für komplette Golfvideos. Die Windows-Desktop-App führt Golfer und Golf-Content-Creator vom Rohmaterial über die Struktur nach Löchern, Spielern und Schlägen zum zusammenhängenden Rohschnitt und ergänzt Multicam, Golf-Overlays und Shot-Tracer innerhalb desselben Workflows. Aus einem Projekt sollen sich vollständige Rundenvideos, einzelne Löcher und Social Clips exportieren lassen. Windows ist die erste Zielplattform; macOS folgt später.

**Marke:** CUT18 · **Claim:** Deine Runde. Dein Film. · **vorgesehene URL:** `cut18.app` · **vorgesehener Social-Handle:** `@cut18golf`. Domain und Accounts sind noch nicht registriert.

> Status: technischer Prototyp. Die vorhandenen Funktionen sind eine gute Ausgangsbasis, aber noch kein freigegebenes oder verkaufsfertiges Produkt. Siehe [Produktstatus](docs/product-status.md) und [MVP-Umfang](docs/mvp-scope.md).

## Technische Basis

- Electron 43 als Desktop-Shell
- React 19, TypeScript und Vite für die Oberfläche
- lokale Medienanalyse mit FFprobe
- lokale Videoausgabe mit FFmpeg
- Vitest und Node Test Runner für automatisierte Tests

Die Architekturentscheidung einschließlich Electron-/Tauri-/Native-Vergleich steht in [docs/architecture.md](docs/architecture.md).

## Lokale Entwicklung

Voraussetzungen: Node.js 22 LTS und npm.

```powershell
npm ci
npm run typecheck
npm test
npm run build
npm run dev
```

Die gebaute Desktop-App kann anschließend mit Electron gestartet werden:

```powershell
npm start
```

## Manueller Orchestrator

Der Orchestrator liest Produktstatus, Roadmap und offene GitHub-Issues und erzeugt einen priorisierten Markdown-Bericht. Er nimmt keine Änderungen an GitHub vor.

```powershell
npm run orchestrate -- --repo johannesstuck-eng/Golf-Studio
```

Der Bericht landet unter `reports/orchestrator-report.md`. Mit `--issues <datei.json>` kann stattdessen ein lokaler Issues-Snapshot verwendet werden.

## Arbeitsweise und Sicherheit

- keine direkte Arbeit auf `main`
- Änderungen ausschließlich über Draft Pull Requests
- keine Secrets im Repository
- keine Ausgaben, Veröffentlichungen oder externen Nachrichten ohne Freigabe
- Annahmen und offene Entscheidungen werden dokumentiert

Die verbindlichen Regeln stehen in [AGENTS.md](AGENTS.md) und [docs/approval-policy.md](docs/approval-policy.md).

## Projektdokumentation

- [Produktvision](docs/product-vision.md)
- [Produktstatus](docs/product-status.md)
- [MVP-Umfang](docs/mvp-scope.md)
- [Roadmap](docs/roadmap.md)
- [Architektur](docs/architecture.md)
- [Business-Hypothesen](docs/business-hypotheses.md)
- [Landingpage-Textentwurf](docs/landing-page-copy.md)
- [Markengrundlage](docs/brand.md)
- [Freigaberichtlinie](docs/approval-policy.md)
