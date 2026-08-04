export interface BallCandidate {
    x: number;
    y: number;
    confidence: number;
}

interface MotionComponent {
    x: number;
    y: number;
    area: number;
    width: number;
    height: number;
    energy: number;
    brightnessDrop: number;
}

function luminance(frame: Uint8ClampedArray, pixel: number): number {
    const offset = pixel * 4;
    return frame[offset] * .299 + frame[offset + 1] * .587 + frame[offset + 2] * .114;
}

function motionComponents(before: Uint8ClampedArray, after: Uint8ClampedArray, width: number, height: number): MotionComponent[] {
    const pixels = width * height;
    const differences = new Float32Array(pixels);
    let sum = 0;
    let squared = 0;
    for (let pixel = 0; pixel < pixels; pixel += 1) {
        const difference = Math.abs(luminance(before, pixel) - luminance(after, pixel));
        differences[pixel] = difference;
        sum += difference;
        squared += difference * difference;
    }
    const mean = sum / pixels;
    const deviation = Math.sqrt(Math.max(0, squared / pixels - mean * mean));
    const threshold = Math.min(90, Math.max(24, mean + deviation * 2.4));
    const active = new Uint8Array(pixels);
    for (let pixel = 0; pixel < pixels; pixel += 1) active[pixel] = differences[pixel] >= threshold ? 1 : 0;
    const visited = new Uint8Array(pixels);
    const components: MotionComponent[] = [];
    const queue = new Int32Array(pixels);
    for (let start = 0; start < pixels; start += 1) {
        if (!active[start] || visited[start]) continue;
        let head = 0;
        let tail = 0;
        queue[tail++] = start;
        visited[start] = 1;
        let area = 0;
        let minX = width;
        let maxX = 0;
        let minY = height;
        let maxY = 0;
        let weightedX = 0;
        let weightedY = 0;
        let energy = 0;
        let brightnessDrop = 0;
        while (head < tail) {
            const pixel = queue[head++];
            const x = pixel % width;
            const y = Math.floor(pixel / width);
            const weight = differences[pixel];
            area += 1;
            minX = Math.min(minX, x); maxX = Math.max(maxX, x);
            minY = Math.min(minY, y); maxY = Math.max(maxY, y);
            weightedX += x * weight; weightedY += y * weight; energy += weight;
            brightnessDrop += luminance(before, pixel) - luminance(after, pixel);
            for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
                for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
                    if (!offsetX && !offsetY) continue;
                    const nextX = x + offsetX;
                    const nextY = y + offsetY;
                    if (nextX < 0 || nextX >= width || nextY < 0 || nextY >= height) continue;
                    const next = nextY * width + nextX;
                    if (active[next] && !visited[next]) { visited[next] = 1; queue[tail++] = next; }
                }
            }
        }
        const componentWidth = maxX - minX + 1;
        const componentHeight = maxY - minY + 1;
        const maximumSize = Math.max(5, Math.round(Math.min(width, height) * .045));
        const maximumArea = Math.max(30, Math.round(width * height * .0012));
        if (area < 1 || area > maximumArea || componentWidth > maximumSize || componentHeight > maximumSize || energy <= 0) continue;
        components.push({
            x: weightedX / energy,
            y: weightedY / energy,
            area,
            width: componentWidth,
            height: componentHeight,
            energy: energy / area,
            brightnessDrop: brightnessDrop / area,
        });
    }
    return components;
}

export function detectBallCandidates(frames: Uint8ClampedArray[], width: number, height: number, limit = 4, focus?: { x: number; y: number; radius: number }): BallCandidate[] {
    if (frames.length < 3 || width < 1 || height < 1 || frames.some((frame) => frame.length !== width * height * 4)) return [];
    const motion = frames.slice(0, -1).map((frame, index) => motionComponents(frame, frames[index + 1], width, height));
    const first = focus
        ? motion[0].filter((component) => Math.hypot(component.x / width - focus.x, component.y / height - focus.y) <= focus.radius)
        : motion[0];
    const diagonal = Math.hypot(width, height);
    const scored = first.map((component) => {
        let continuity = 0;
        let previous = component;
        for (let pair = 1; pair < motion.length; pair += 1) {
            const nearest = motion[pair]
                .map((candidate) => ({ candidate, distance: Math.hypot(candidate.x - previous.x, candidate.y - previous.y) }))
                .filter(({ distance }) => distance >= 1 && distance <= diagonal * .16)
                .sort((left, right) => left.distance - right.distance)[0];
            if (!nearest) break;
            continuity += Math.max(0, 1 - nearest.distance / (diagonal * .16));
            previous = nearest.candidate;
        }
        const compactness = 1 / Math.sqrt(component.area);
        const lowerFrameBias = .75 + component.y / height * .45;
        const departingBrightObject = Math.max(0, component.brightnessDrop) * 1.3;
        const score = (component.energy + departingBrightObject) * compactness * lowerFrameBias * (1 + continuity * .42);
        return { component, score };
    }).sort((left, right) => right.score - left.score);
    const selected: typeof scored = [];
    for (const item of scored) {
        if (selected.some((other) => Math.hypot(item.component.x - other.component.x, item.component.y - other.component.y) < Math.min(width, height) * .035)) continue;
        selected.push(item);
        if (selected.length >= limit) break;
    }
    const maximum = selected[0]?.score ?? 1;
    return selected.map(({ component, score }) => ({
        x: component.x / width,
        y: component.y / height,
        confidence: Math.min(.99, Math.max(.15, score / maximum * .92)),
    }));
}

export function localBallCandidates(candidates: BallCandidate[], focus: { x: number; y: number }, previous?: { x: number; y: number }, limit = 3): BallCandidate[] {
    const expectedX = previous ? focus.x + (focus.x - previous.x) : focus.x;
    const expectedY = previous ? focus.y + (focus.y - previous.y) : focus.y;
    const radius = previous ? .28 : .22;
    return candidates
        .map((candidate) => {
            const focusDistance = Math.hypot(candidate.x - focus.x, candidate.y - focus.y);
            const expectedDistance = Math.hypot(candidate.x - expectedX, candidate.y - expectedY);
            const forward = previous
                ? (candidate.x - focus.x) * (focus.x - previous.x) + (candidate.y - focus.y) * (focus.y - previous.y)
                : 0;
            const score = candidate.confidence * 1.4 - expectedDistance * 2.2 - focusDistance * .45 + (forward >= 0 ? .12 : -.25);
            return { candidate, focusDistance, score };
        })
        .filter((item) => item.focusDistance <= radius)
        .sort((left, right) => right.score - left.score)
        .slice(0, limit)
        .map((item) => item.candidate);
}
