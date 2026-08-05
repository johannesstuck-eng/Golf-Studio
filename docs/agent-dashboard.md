# Agent Dashboard

## Ziel

Mission Control gibt Johannes in der lokalen CUT18-App einen gemeinsamen Überblick über Produkt-, Engineering-, QA- und Business-Arbeit. GitHub Issues und Pull Requests sind die einzige operative Datenquelle; es gibt keine zweite manuell gepflegte Taskliste.

## Synchronisierung

- Die App liest das öffentliche Repository `johannesstuck-eng/Golf-Studio` über die GitHub-REST-API.
- Es wird kein Token in der App oder im Repository gespeichert.
- Synchronisiert wird beim Öffnen, manuell und alle fünf Minuten.
- Der letzte erfolgreiche Stand bleibt lokal gecacht, wenn GitHub vorübergehend nicht erreichbar ist.
- Das Dashboard schreibt selbst keine Daten nach GitHub.

## Task-Metadaten

Jedes steuerbare Issue kann am Ende des Bodys diesen unsichtbaren Block enthalten:

```markdown
<!-- cut18-dashboard
agent: engineering
status: in-progress
effort: 5
-->
```

Erlaubte Agenten:

- `orchestrator`
- `product`
- `engineering`
- `qa`
- `growth`
- `social-platforms`
- `content-studio`
- `beta-growth`

Erlaubte Statuswerte und ihr Rechenwert:

- `backlog`: 0 %
- `planned`: 15 %
- `blocked`: 30 %
- `in-progress`: 55 %
- `review`: 85 %
- `done` oder geschlossenes Issue: 100 %

Erlaubte Aufwände sind `1`, `2`, `3`, `5` und `8`. Ohne Angabe gilt `3`.

## Fortschrittsberechnung

Der Agentenfortschritt ist der nach Aufwand gewichtete Mittelwert seiner Issues. Der Gesamtfortschritt ist dieselbe Berechnung über alle Issues. Er beschreibt damit die Abarbeitung des aktuellen GitHub-Taskbestands, nicht Marktwert, Umsatzreife oder den Anteil einer theoretisch vollständigen Produktvision.

Ein Agent ohne GitHub-Issue wird ehrlich mit null Tasks und null Prozent dargestellt. Geschlossene Issues zählen unabhängig von veralteten Metadaten als erledigt.

## Pflege

Der ausführende Agent aktualisiert den Metadatenblock, wenn ein Task nachweislich in eine neue Phase wechselt. Der Orchestrator darf gemäß seiner bestehenden Sicherheitsgrenzen nur Änderungen empfehlen. Issues werden nicht allein wegen eines Prozentwerts geschlossen; Abschluss, Merge, Release und Veröffentlichung bleiben getrennte Entscheidungen.

## Freigaben

Issues mit `[Approval]`, einem Freigabehinweis im Text oder einem `approval`-Label erscheinen separat für Johannes. Mission Control erteilt selbst keine Freigabe und führt keine externe Aktion aus.
