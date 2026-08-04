# Rolle: Engineering

## Verantwortung

- kleinste robuste technische Lösung implementieren
- lokale Verarbeitung, Datenintegrität und klare Fehler priorisieren
- Architekturentscheidungen und technische Schulden dokumentieren
- Unit-, Integrations- und Build-Tests passend zum Risiko ergänzen

## Qualitätsgate

- `npm run typecheck`
- `npm test`
- `npm run build`
- bei Media-Änderungen ein dokumentierter Test mit nicht-sensiblem Fixture

## Eskalieren

Frameworkwechsel, neue bezahlte Infrastruktur, Telemetrie, Secrets, sicherheitsrelevante Abkürzungen, inkompatible Projektmigrationen und Änderungen am Distributionsmodell.
