const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));

export function pcm16Envelope(buffer, sampleRate = 2000, envelopeRate = 50) {
    const bucketSize = Math.max(1, Math.round(sampleRate / envelopeRate));
    const bucketCount = Math.floor(buffer.length / 2 / bucketSize);
    const envelope = new Array(bucketCount);
    for (let bucket = 0; bucket < bucketCount; bucket += 1) {
        let total = 0;
        const start = bucket * bucketSize;
        for (let sample = 0; sample < bucketSize; sample += 1) {
            total += Math.abs(buffer.readInt16LE((start + sample) * 2));
        }
        envelope[bucket] = total / bucketSize;
    }
    const mean = envelope.reduce((sum, value) => sum + value, 0) / Math.max(1, envelope.length);
    const variance = envelope.reduce((sum, value) => sum + (value - mean) ** 2, 0) / Math.max(1, envelope.length);
    const deviation = Math.sqrt(variance) || 1;
    return envelope.map((value) => clamp((value - mean) / deviation, -4, 4));
}

function correlation(reference, candidate, candidateStart, stride = 2) {
    const start = Math.max(0, -candidateStart);
    const end = Math.min(reference.length, candidate.length - candidateStart);
    if (end - start < 250) return { score: -1, samples: 0, overlap: 0 };
    const sampleStride = Math.max(stride, Math.ceil((end - start) / 4000));
    let dot = 0;
    let leftPower = 0;
    let rightPower = 0;
    let samples = 0;
    for (let index = start; index < end; index += sampleStride) {
        const left = reference[index];
        const right = candidate[index + candidateStart];
        dot += left * right;
        leftPower += left * left;
        rightPower += right * right;
        samples += 1;
    }
    const denominator = Math.sqrt(leftPower * rightPower);
    return { score: denominator > 0 ? dot / denominator : -1, samples, overlap: end - start };
}

export function findAudioSyncOffset(reference, candidate, rawStartDifferenceSeconds, envelopeRate = 50, searchSeconds = 15) {
    const rawStart = Math.round(-rawStartDifferenceSeconds * envelopeRate);
    const search = Math.round(searchSeconds * envelopeRate);
    let best = { correction: 0, score: -1, samples: 0, overlap: 0 };
    const coarseCandidates = [];
    for (let correction = -search; correction <= search; correction += 2) {
        const result = correlation(reference, candidate, rawStart + correction);
        coarseCandidates.push({ correction, ...result });
        if (result.score > best.score || (result.score === best.score && result.samples > best.samples)) best = { correction, ...result };
    }
    for (const coarse of coarseCandidates.sort((left, right) => right.score - left.score).slice(0, 12)) {
        for (let correction = coarse.correction - 2; correction <= coarse.correction + 2; correction += 1) {
            const result = correlation(reference, candidate, rawStart + correction, 1);
            if (result.score > best.score || (result.score === best.score && result.samples > best.samples)) best = { correction, ...result };
        }
    }
    return {
        offsetSeconds: Math.round(best.correction / envelopeRate * 1000) / 1000,
        score: best.score,
        overlapSeconds: best.overlap / envelopeRate,
    };
}

export function compactWaveform(envelope, points = 180) {
    if (!envelope.length) return [];
    const bucketSize = Math.max(1, Math.ceil(envelope.length / points));
    const result = [];
    for (let index = 0; index < envelope.length; index += bucketSize) {
        const bucket = envelope.slice(index, index + bucketSize);
        result.push(Math.round(clamp(Math.max(...bucket.map(Math.abs)) / 4, 0, 1) * 1000) / 1000);
    }
    return result;
}

export function confidenceForScore(score, overlapSeconds) {
    if (overlapSeconds >= 8 && score >= .55) return 'high';
    if (overlapSeconds >= 5 && score >= .28) return 'medium';
    return 'low';
}
