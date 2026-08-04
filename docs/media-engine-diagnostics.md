# Media-Engine-Diagnose

Golf Studio bringt FFmpeg und FFprobe als lokale Programmkomponenten mit. Die App sucht nicht nach einer systemweiten Installation und lädt zur Laufzeit keine Binärdateien herunter.

## Erkennungsreihenfolge

- In einer paketierten App werden ausschließlich die mitgelieferten Dateien unter `resources/app.asar.unpacked/node_modules/` verwendet. Umgebungsvariablen werden dort bewusst ignoriert.
- In der lokalen Entwicklung dürfen `FFMPEG_PATH` und `FFPROBE_PATH` einen absoluten lokalen Testpfad vorgeben. Ohne diese Variablen werden die Pfade der installierten npm-Pakete verwendet.
- Es gibt keinen Rückfall auf `PATH` oder eine Shell-Suche.

Vor dem ersten Import prüft die App FFprobe, noch bevor sich der Dateiauswahldialog öffnet. Vor dem ersten Export prüft sie FFmpeg. Zusätzlich zeigt die Oberfläche den beim Start ermittelten Zustand und die erkannten Versionen an. Die Prüfung wird pro App-Lauf zwischengespeichert. Nach einem Fehler kann die Prüfung über **Erneut prüfen** bewusst ohne den bisherigen Cache wiederholt werden.

## Sicherheits- und Fehlerverhalten

Die Binärdateien werden mit festen Argumentlisten und ohne Shell gestartet. Die Diagnose begrenzt Laufzeit und Ausgabemenge. Sie unterscheidet fehlende, nicht ausführbare, falsche, inkompatible und nicht antwortende Komponenten. Interne absolute Pfade werden nicht an den Renderer übertragen.

FFmpeg gilt für den MVP nur dann als kompatibel, wenn seine Versionsausgabe die richtige Programmidentität besitzt und der für den H.264-Export benötigte `libx264`-Encoder vorhanden ist.

## Reproduzierbare Prüfung

Die automatisierten Node-Tests prüfen sowohl alle Fehlerklassen mit kontrollierten Test-Doubles als auch die tatsächlich durch npm installierten FFmpeg-/FFprobe-Dateien:

```powershell
npm test
```

Für einen manuellen Windows-Pakettest wird ein nicht-sensitives, synthetisches Ein-Sekunden-Video erzeugt. Es enthält nur ein schwarzes Testbild und einen Sinuston:

```powershell
ffmpeg -f lavfi -i "color=c=black:s=1280x720:r=30:d=1" -f lavfi -i "sine=frequency=1000:duration=1" -c:v libx264 -c:a aac -shortest media-engine-smoke.mp4
ffprobe -v error -show_format -show_streams media-engine-smoke.mp4
```

Der abschließende Installer-Test muss bestätigen, dass beide `.exe`-Dateien im entpackten Paket vorhanden und aus der App heraus ausführbar sind. Dieser Installer-Test ist nicht Teil der plattformunabhängigen CI und bleibt vor der Windows-Beta verpflichtend.
