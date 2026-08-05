import { promises as fs } from 'node:fs';
import path from 'node:path';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

const scorecardExtensions = new Set(['.pdf', '.png', '.jpg', '.jpeg', '.webp']);
const teeColors = ['weiß', 'weiss', 'gelb', 'blau', 'rot', 'schwarz', 'grün', 'gruen', 'orange', 'silber', 'gold'];

function numberValue(value) {
    const normalized = String(value).trim().replace(',', '.').replace(/[^\d.-]/g, '');
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : null;
}

function uniqueTeeLabels(text, count) {
    const lowered = text.toLocaleLowerCase('de-DE');
    const matches = teeColors.flatMap((color) => {
        const index = lowered.indexOf(color);
        return index < 0 ? [] : [{ color, index }];
    }).sort((left, right) => left.index - right.index);
    const display = { weiß: 'Weiß', weiss: 'Weiß', gelb: 'Gelb', blau: 'Blau', rot: 'Rot', schwarz: 'Schwarz', grün: 'Grün', gruen: 'Grün', orange: 'Orange', silber: 'Silber', gold: 'Gold' };
    const labels = [...new Set(matches.map((item) => display[item.color]))];
    return Array.from({ length: count }, (_, index) => labels[index] ?? `Tee ${index + 1}`);
}

function rowCandidate(row) {
    const first = row[0]?.trim() ?? '';
    if (!/^[A-ZÄÖÜ]?[0-9]{1,2}$/i.test(first)) return null;
    const values = row.slice(1).map(numberValue).filter((value) => value !== null);
    if (values.length < 3) return null;
    const triples = [];
    for (let index = 0; index + 2 < values.length; index += 3) {
        const [lengthMeters, par, strokeIndex] = values.slice(index, index + 3);
        if (lengthMeters < 40 || lengthMeters > 800 || par < 2 || par > 6 || strokeIndex < 1 || strokeIndex > 36) return null;
        triples.push({ lengthMeters: Math.round(lengthMeters), par: Math.round(par), strokeIndex: Math.round(strokeIndex) });
    }
    return triples.length ? { sourceLabel: first, triples } : null;
}

export function parseScorecardRows(rows, holeCount) {
    const candidates = rows.map(rowCandidate).filter(Boolean).slice(0, holeCount);
    if (candidates.length !== holeCount) {
        return { status: 'manual', tees: [], warnings: [`Es wurden ${candidates.length} von ${holeCount} Lochzeilen sicher erkannt.`] };
    }
    const teeCount = Math.min(...candidates.map((candidate) => candidate.triples.length));
    if (!teeCount) return { status: 'manual', tees: [], warnings: ['Keine vollständige Abschlagsspalte erkannt.'] };
    const headerText = rows.slice(0, Math.max(0, rows.findIndex((row) => rowCandidate(row)))).flat().join(' ');
    const labels = uniqueTeeLabels(headerText, teeCount);
    const tees = Array.from({ length: teeCount }, (_, teeIndex) => ({
        id: `tee-${teeIndex + 1}`,
        label: labels[teeIndex],
        holes: candidates.map((candidate, holeIndex) => ({
            number: holeIndex + 1,
            sourceLabel: candidate.sourceLabel,
            ...candidate.triples[teeIndex],
        })),
    }));
    return { status: 'ready', tees, warnings: [] };
}

async function pdfRows(filePath) {
    const data = new Uint8Array(await fs.readFile(filePath));
    const document = await getDocument({ data, disableWorker: true, useSystemFonts: true }).promise;
    const rows = [];
    for (let pageNumber = 1; pageNumber <= Math.min(3, document.numPages); pageNumber += 1) {
        const page = await document.getPage(pageNumber);
        const content = await page.getTextContent();
        const items = content.items.filter((item) => typeof item.str === 'string' && item.str.trim()).map((item) => ({ text: item.str.trim(), x: item.transform[4], y: item.transform[5] }));
        items.sort((left, right) => Math.abs(right.y - left.y) > 2.5 ? right.y - left.y : left.x - right.x);
        const pageRows = [];
        for (const item of items) {
            const row = pageRows.find((candidate) => Math.abs(candidate.y - item.y) <= 2.5);
            if (row) row.items.push(item);
            else pageRows.push({ y: item.y, items: [item] });
        }
        rows.push(...pageRows.sort((left, right) => right.y - left.y).map((row) => row.items.sort((left, right) => left.x - right.x).map((item) => item.text)));
    }
    return rows;
}

export async function analyzeScorecard(filePath, holeCount) {
    if (!Number.isInteger(holeCount) || ![9, 18].includes(holeCount)) throw new TypeError('Lochanzahl muss 9 oder 18 sein.');
    const extension = path.extname(filePath).toLowerCase();
    if (!scorecardExtensions.has(extension)) throw new TypeError('Nicht unterstütztes Scorecard-Format.');
    const info = await fs.stat(filePath);
    if (!info.isFile() || info.size > 25 * 1024 * 1024) throw new TypeError('Scorecard ist ungültig oder größer als 25 MB.');
    if (extension !== '.pdf') {
        return { status: 'manual', tees: [], warnings: ['Fotos werden aktuell als lokale Referenz angezeigt. Die automatische Fotoerkennung folgt separat.'] };
    }
    const rows = await pdfRows(filePath);
    return parseScorecardRows(rows, holeCount);
}
