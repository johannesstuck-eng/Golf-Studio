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

function rawOverlapSeconds(left, right) {
    const leftStart = Date.parse(left.recordedAt) / 1000;
    const rightStart = Date.parse(right.recordedAt) / 1000;
    return Math.max(0, Math.min(leftStart + left.durationSeconds, rightStart + right.durationSeconds) - Math.max(leftStart, rightStart));
}

export function alignAudioTracks(tracks, envelopeRate = 50, searchSeconds = 15) {
    if (!tracks.length) return { referenceMediaId: null, offsetsSeconds: {}, confidenceByMediaId: {}, referenceByMediaId: {}, unmatchedIds: [] };
    const root = [...tracks].sort((left, right) => right.durationSeconds - left.durationSeconds)[0];
    const offsetsSeconds = { [root.id]: 0 };
    const confidenceByMediaId = { [root.id]: 'high' };
    const referenceByMediaId = { [root.id]: root.id };
    const unmatched = new Set(tracks.filter((track) => track.id !== root.id).map((track) => track.id));
    const attempted = new Set();
    while (unmatched.size) {
        let bestPair = null;
        for (const anchor of tracks.filter((track) => offsetsSeconds[track.id] !== undefined)) {
            for (const target of tracks.filter((track) => unmatched.has(track.id))) {
                const key = `${anchor.id}:${target.id}`;
                if (attempted.has(key)) continue;
                const overlap = rawOverlapSeconds(anchor, target);
                if (!bestPair || overlap > bestPair.overlap) bestPair = { anchor, target, overlap, key };
            }
        }
        if (!bestPair || bestPair.overlap < 5) break;
        attempted.add(bestPair.key);
        const rawDifference = (Date.parse(bestPair.target.recordedAt) - Date.parse(bestPair.anchor.recordedAt)) / 1000;
        const match = findAudioSyncOffset(bestPair.anchor.envelope, bestPair.target.envelope, rawDifference, envelopeRate, searchSeconds);
        const confidence = confidenceForScore(match.score, match.overlapSeconds);
        if (confidence === 'low') continue;
        offsetsSeconds[bestPair.target.id] = Math.round((offsetsSeconds[bestPair.anchor.id] + match.offsetSeconds) * 1000) / 1000;
        confidenceByMediaId[bestPair.target.id] = confidence;
        referenceByMediaId[bestPair.target.id] = bestPair.anchor.id;
        unmatched.delete(bestPair.target.id);
    }
    for (const id of unmatched) confidenceByMediaId[id] = 'low';
    return { referenceMediaId: root.id, offsetsSeconds, confidenceByMediaId, referenceByMediaId, unmatchedIds: [...unmatched] };
}
