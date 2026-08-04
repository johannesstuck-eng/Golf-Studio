import { describe, expect, it } from 'vitest';
import { detectBallCandidates, localBallCandidates } from './ballDetection';

function frame(width: number, height: number, ballX: number, ballY: number, distractor = false): Uint8ClampedArray {
    const data = new Uint8ClampedArray(width * height * 4);
    for (let pixel = 0; pixel < width * height; pixel += 1) {
        data[pixel * 4] = 34; data[pixel * 4 + 1] = 62; data[pixel * 4 + 2] = 38; data[pixel * 4 + 3] = 255;
    }
    for (let y = ballY; y < ballY + 2; y += 1) for (let x = ballX; x < ballX + 2; x += 1) {
        const offset = (y * width + x) * 4;
        data[offset] = 250; data[offset + 1] = 250; data[offset + 2] = 245;
    }
    if (distractor) for (let y = 12; y < 35; y += 1) for (let x = 65; x < 90; x += 1) {
        const offset = (y * width + x) * 4;
        data[offset] = 180; data[offset + 1] = 170; data[offset + 2] = 160;
    }
    return data;
}

describe('ball candidate detection', () => {
    it('finds the departing position of a tiny bright moving ball', () => {
        const width = 120;
        const height = 80;
        const candidates = detectBallCandidates([
            frame(width, height, 24, 62),
            frame(width, height, 31, 55),
            frame(width, height, 40, 45),
            frame(width, height, 51, 35),
        ], width, height);
        expect(candidates.length).toBeGreaterThan(0);
        expect(candidates[0].x).toBeCloseTo(24.5 / width, 1);
        expect(candidates[0].y).toBeCloseTo(62.5 / height, 1);
        expect(candidates[0].confidence).toBeGreaterThan(.5);
    });

    it('ignores a large moving region and rejects invalid frame sets', () => {
        const width = 120;
        const height = 80;
        const candidates = detectBallCandidates([
            frame(width, height, 20, 65, true),
            frame(width, height, 28, 58, false),
            frame(width, height, 37, 48, true),
        ], width, height);
        expect(candidates.some((candidate) => candidate.x < .4 && candidate.y > .55)).toBe(true);
        expect(detectBallCandidates([], width, height)).toEqual([]);
    });

    it('limits assisted tracking to the area and direction of the last confirmed points', () => {
        const candidates = [
            { x: .42, y: .42, confidence: .72 },
            { x: .28, y: .62, confidence: .98 },
            { x: .9, y: .1, confidence: .99 },
        ];
        const local = localBallCandidates(candidates, { x: .35, y: .5 }, { x: .3, y: .56 });
        expect(local[0]).toEqual(candidates[0]);
        expect(local).not.toContain(candidates[2]);
    });
});
