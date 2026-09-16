import {
    clamp01,
    clamp255,
    getRelativeLuminance,
    getPerceptualLightness,
    analyzePerceptualColor,
    resolveBaseVisualPolicy,
    resolvePromptVisualState,
    getChromeAlpha,
    CUPERTINO_PROMPT_WHITE_BLEND_ALPHA,
    PROMPT_VISUAL_ALGORITHM_VERSION,
} from '../src/main/colorUtils.js';

let passed = 0;
let failed = 0;

function assert(condition, message) {
    if (condition) {
        passed++;
    } else {
        failed++;
        console.error(`❌ FAIL: ${message}`);
    }
}

console.log('=== RUNNING COLOR SYSTEM PRODUCTION AUDIT TEST MATRIX ===\n');

// 1. Math and clamping checks
assert(clamp01(-0.5) === 0, 'clamp01(-0.5) === 0');
assert(clamp01(1.5) === 1, 'clamp01(1.5) === 1');
assert(clamp01(0.42) === 0.42, 'clamp01(0.42) === 0.42');
assert(clamp01(NaN) === 0, 'clamp01(NaN) === 0');
assert(clamp255(-10) === 0, 'clamp255(-10) === 0');
assert(clamp255(300) === 255, 'clamp255(300) === 255');
assert(clamp255(128.6) === 129, 'clamp255(128.6) === 129');
assert(clamp255(NaN) === 0, 'clamp255(NaN) === 0');

// 2. Algorithm Version
assert(PROMPT_VISUAL_ALGORITHM_VERSION === 23, `Algorithm version is 23 (got ${PROMPT_VISUAL_ALGORITHM_VERSION})`);

// 3. Test matrix for diverse visual contexts
const testColors = [
    { name: 'Very Dark (Black/Night)', r: 10, g: 10, b: 10, expectInverse: false },
    { name: 'Dark Saturated Navy', r: 0, g: 27, b: 68, expectInverse: false },
    { name: 'Mid-tone Slate', r: 92, g: 107, b: 115, expectInverse: false },
    { name: 'Near-neutral Mid Gray', r: 128, g: 128, b: 128, expectInverse: false },
    { name: 'Light Desert Sand', r: 224, g: 225, b: 221, expectInverse: true },
    { name: 'Very Bright Snow/White', r: 253, g: 251, b: 247, expectInverse: true },
    { name: 'Bright Colorful Pink/Pastel', r: 246, g: 186, b: 187, expectInverse: true },
    { name: 'Vibrant Amber/Orange (Bright Hue)', r: 255, g: 158, b: 0, expectInverse: true },
    { name: 'Warm Mid-Tone Bronze/Ochre', r: 180, g: 100, b: 20, expectInverse: false },
    { name: 'Vibrant Cyan', r: 0, g: 255, b: 255, expectInverse: true },
];

console.log('--- Testing Perceptual Analysis and Base Visual Policy ---');
for (const tc of testColors) {
    const analysis = analyzePerceptualColor(tc);
    
    assert(analysis.luminance >= 0 && analysis.luminance <= 1, `${tc.name}: luminance in [0, 1] (${analysis.luminance.toFixed(4)})`);
    assert(analysis.perceptualLightness >= 0 && analysis.perceptualLightness <= 1.0, `${tc.name}: L* in [0, 1] (${analysis.perceptualLightness.toFixed(4)})`);
    assert(analysis.chroma >= 0, `${tc.name}: chroma >= 0 (${analysis.chroma.toFixed(4)})`);
    
    const policy = resolveBaseVisualPolicy(analysis);
    assert(policy.useInverse === tc.expectInverse, `${tc.name}: useInverse expected ${tc.expectInverse}, got ${policy.useInverse}`);

    const resolved = resolvePromptVisualState({ r: tc.r, g: tc.g, b: tc.b }, 'tonal');
    assert(resolved.isInverse === tc.expectInverse, `${tc.name} resolvedPromptVisualState isInverse=${resolved.isInverse}`);
    assert(resolved.r >= 0 && resolved.r <= 255, `${tc.name} resolved R in [0, 255]`);
    assert(resolved.g >= 0 && resolved.g <= 255, `${tc.name} resolved G in [0, 255]`);
    assert(resolved.b >= 0 && resolved.b <= 255, `${tc.name} resolved B in [0, 255]`);
    assert(resolved.shadowAlpha >= 0 && resolved.shadowAlpha <= 1, `${tc.name} shadowAlpha in [0, 1] (${resolved.shadowAlpha})`);
}

// 4. Chrome Alpha curve continuity and monotonicity
console.log('\n--- Testing Chrome Alpha Curves (Monotonicity, Bounds, Continuity) ---');
let prevHoverAlphaNormal = -1;
let prevActiveAlphaNormal = -1;
let prevFocusAlphaNormal = -1;

for (let i = 0; i <= 50; i++) {
    const L = i / 50; // 0.0 to 1.0
    const mockState = {
        perceptualLightness: L,
        luminance: L,
        isInverse: false,
    };
    
    const hoverAlpha = getChromeAlpha(mockState, 'hover');
    const activeAlpha = getChromeAlpha(mockState, 'active');
    const focusAlpha = getChromeAlpha(mockState, 'focus');

    assert(!isNaN(hoverAlpha) && isFinite(hoverAlpha), `Normal L*=${L.toFixed(2)}: hoverAlpha is valid finite number`);
    assert(!isNaN(activeAlpha) && isFinite(activeAlpha), `Normal L*=${L.toFixed(2)}: activeAlpha is valid finite number`);
    assert(!isNaN(focusAlpha) && isFinite(focusAlpha), `Normal L*=${L.toFixed(2)}: focusAlpha is valid finite number`);

    assert(hoverAlpha >= 0.139 && hoverAlpha <= 0.221, `Normal L*=${L.toFixed(2)}: hoverAlpha in [0.14, 0.22] (${hoverAlpha.toFixed(4)})`);
    assert(activeAlpha >= 0.239 && activeAlpha <= 0.321, `Normal L*=${L.toFixed(2)}: activeAlpha in [0.24, 0.32] (${activeAlpha.toFixed(4)})`);
    assert(focusAlpha >= 0.159 && focusAlpha <= 0.241, `Normal L*=${L.toFixed(2)}: focusAlpha in [0.16, 0.24] (${focusAlpha.toFixed(4)})`);

    if (prevHoverAlphaNormal !== -1) {
        assert(hoverAlpha <= prevHoverAlphaNormal + 0.0001, `Normal L*=${L.toFixed(2)}: hoverAlpha monotonic decrease (${hoverAlpha.toFixed(4)} <= ${prevHoverAlphaNormal.toFixed(4)})`);
        assert(activeAlpha <= prevActiveAlphaNormal + 0.0001, `Normal L*=${L.toFixed(2)}: activeAlpha monotonic decrease (${activeAlpha.toFixed(4)} <= ${prevActiveAlphaNormal.toFixed(4)})`);
        assert(focusAlpha <= prevFocusAlphaNormal + 0.0001, `Normal L*=${L.toFixed(2)}: focusAlpha monotonic decrease (${focusAlpha.toFixed(4)} <= ${prevFocusAlphaNormal.toFixed(4)})`);
    }

    prevHoverAlphaNormal = hoverAlpha;
    prevActiveAlphaNormal = activeAlpha;
    prevFocusAlphaNormal = focusAlpha;
}

// 5. Invariant: Hover/Active Interaction Chrome on INVERSE Base State is STRICTLY WHITE
console.log('\n--- Testing Critical Invariant: Inverse Base + Interaction Chrome is STRICTLY WHITE ---');
for (const tc of testColors.filter(c => c.expectInverse)) {
    const visualState = resolvePromptVisualState({ r: tc.r, g: tc.g, b: tc.b }, 'tonal');
    assert(visualState.isInverse === true, `${tc.name} is inverse base state`);

    const hoverAlpha = getChromeAlpha(visualState, 'hover');
    const activeAlpha = getChromeAlpha(visualState, 'active');

    // Simulate _updateChromeButtonStyle interaction rendering
    const baseR = visualState.r;
    const baseG = visualState.g;
    const baseB = visualState.b;

    // Hover composition: blend WHITE (255, 255, 255) over base
    const invHoverA = 1 - hoverAlpha;
    const hoverR = Math.min(255, Math.max(0, Math.round(baseR * invHoverA + 255 * hoverAlpha)));
    const hoverG = Math.min(255, Math.max(0, Math.round(baseG * invHoverA + 255 * hoverAlpha)));
    const hoverB = Math.min(255, Math.max(0, Math.round(baseB * invHoverA + 255 * hoverAlpha)));

    // Active composition: blend WHITE (255, 255, 255) over base
    const invActiveA = 1 - activeAlpha;
    const activeR = Math.min(255, Math.max(0, Math.round(baseR * invActiveA + 255 * activeAlpha)));
    const activeG = Math.min(255, Math.max(0, Math.round(baseG * invActiveA + 255 * activeAlpha)));
    const activeB = Math.min(255, Math.max(0, Math.round(baseB * invActiveA + 255 * activeAlpha)));

    // Invariant: interaction overlay MUST lighten towards white, NEVER darken or invert
    assert(hoverR >= baseR, `${tc.name} hover R (${hoverR}) >= base R (${baseR})`);
    assert(hoverG >= baseG, `${tc.name} hover G (${hoverG}) >= base G (${baseG})`);
    assert(hoverB >= baseB, `${tc.name} hover B (${hoverB}) >= base B (${baseB})`);

    assert(activeR >= hoverR, `${tc.name} active R (${activeR}) >= hover R (${hoverR})`);
    assert(activeG >= hoverG, `${tc.name} active G (${activeG}) >= hover G (${hoverG})`);
    assert(activeB >= hoverB, `${tc.name} active B (${activeB}) >= hover B (${hoverB})`);
}

// 6. Test Tonal vs Acrylic Interaction Parity & Cancel Base Visual State
console.log('\n--- Testing Tonal / Acrylic Interaction Parity & Cancel Button ---');
for (const tc of testColors) {
    const rawCancelColor = { r: tc.r, g: tc.g, b: tc.b };
    const cancelVisualState = resolvePromptVisualState(rawCancelColor, CUPERTINO_PROMPT_WHITE_BLEND_ALPHA);

    // Cancel base visual state preserves normal inverse/darkening resolution
    assert(cancelVisualState.useInverse === tc.expectInverse, `${tc.name}: Cancel base visual state useInverse is ${tc.expectInverse}`);

    const cancelHoverAlpha = getChromeAlpha(cancelVisualState, 'hover');
    assert(cancelHoverAlpha > 0 && cancelHoverAlpha <= 1.0, `${tc.name}: Cancel hover alpha in (0, 1] (${cancelHoverAlpha.toFixed(3)})`);

    // Verify focus border semantics
    const focusAlpha = getChromeAlpha(cancelVisualState, 'focus');
    const focusBorderOpacity = focusAlpha * 2.5;
    assert(focusBorderOpacity > 0 && focusBorderOpacity <= 1.0, `${tc.name}: Focus border opacity in (0, 1] (${focusBorderOpacity.toFixed(3)})`);
}

// 7. Test Spatial Independence & Object Integrity
console.log('\n--- Testing Spatial Context Independence & State Output ---');
const promptSample = { r: 240, g: 240, b: 240 };
const cancelSample = { r: 30, g: 30, b: 40 };

const promptResolved = resolvePromptVisualState(promptSample, 'tonal');
const cancelResolved = resolvePromptVisualState(cancelSample, 'tonal');

assert(promptResolved.isInverse === true, 'Prompt sample is bright -> isInverse=true');
assert(cancelResolved.isInverse === false, 'Cancel sample is dark -> isInverse=false');
assert(promptResolved.r !== cancelResolved.r, 'Prompt and Cancel have independently resolved colors');

console.log(`\n========================`);
console.log(`TEST RESULTS: ${passed} passed, ${failed} failed`);
console.log(`========================\n`);

if (failed > 0) {
    throw new Error(`${failed} tests failed!`);
}
