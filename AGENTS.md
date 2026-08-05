# CUT18 – Agent Instructions

Diese Regeln gelten im gesamten Repository. Spezifischere `AGENTS.md`-Dateien dürfen sie ergänzen, aber nicht die Sicherheits- und Freigaberegeln abschwächen.

## Auftrag

Entwickle CUT18 schrittweise zu einem verlässlichen, verkaufbaren Windows-Produkt. Optimiere zuerst den engsten validierten Nutzerpfad; neue Funktionsbreite ist nachrangig.

## Verbindlicher Workflow

1. Lies `docs/product-status.md`, `docs/roadmap.md` und relevante Issues.
2. Arbeite nie direkt auf `main`; verwende `agent/<kurze-beschreibung>`.
3. Begrenze jeden PR auf ein prüfbares Ziel.
4. Führe mindestens `npm run typecheck`, `npm test` und `npm run build` aus, sofern betroffen.
5. Dokumentiere Annahmen, Fehler und ausgelassene Tests im Draft-PR.
6. Merge, Release und Veröffentlichung bleiben menschliche Entscheidungen.

## Engineering-Regeln

- TypeScript strikt halten; `any` nur mit Begründung.
- Geschäfts- und Projektlogik als pure Funktionen testen.
- Renderer hat keinen direkten Node-Zugriff; neue native Fähigkeiten über eine schmale Preload-/IPC-API.
- Originalmedien niemals verändern.
- FFmpeg ohne Shell-Interpolation aufrufen und alle Nutzereingaben validieren.
- Keine Secrets, Tokens, absoluten privaten Pfade oder echte Nutzermedien committen.
- Rückwärtskompatibilität des `.golfcut`-Formats bei Schemaänderungen testen.
- Keine UI so formulieren, als sei eine unvollständige Funktion bereits verfügbar.

## Freigaben

`docs/approval-policy.md` ist verbindlich. Insbesondere keine Ausgaben, externen Nachrichten, Produktionseinsätze, rechtlichen oder finanziellen Verpflichtungen, Telemetrie-Aktivierung oder Architektur-Rewrites ohne ausdrückliche Freigabe.

## Rollen

Die Dateien unter `agents/` beschreiben Verantwortungen, keine autonomen Prozesse. Der Orchestrator empfiehlt Arbeit; er schließt keine Issues, merged keinen Code und veröffentlicht nichts.
