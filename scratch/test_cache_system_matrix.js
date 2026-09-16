import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {
    initCache,
    saveCache,
    clearCache,
    getCache,
    setCache,
    hasCache,
    CACHE_SCHEMA_VERSION,
    MAX_CACHE_ENTRIES,
} from '../src/main/alphaCache.js';
import { PROMPT_VISUAL_ALGORITHM_VERSION } from '../src/main/colorUtils.js';

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

async function sleep(ms) {
    return new Promise((resolve) => {
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
            resolve();
            return GLib.SOURCE_REMOVE;
        });
    });
}

const userName = GLib.get_user_name();
const CACHE_FILE = `/var/tmp/wack-wallpaper-alpha-cache-${userName}.json`;

console.log('=== RUNNING PRODUCTION CACHE SYSTEM AUDIT TEST MATRIX ===\n');

const loop = new GLib.MainLoop(null, false);

async function runTests() {
    try {
        // 1. Initial State & Cleanliness
        console.log('--- 1. Testing Initial State & Clearing ---');
        clearCache();
        assert(hasCache('test_key') === false, 'hasCache returns false on clean cache');
        assert(getCache('test_key') === undefined, 'getCache returns undefined on clean cache');

        // 2. Validation of Scalar Alpha values
        console.log('--- 2. Testing Entry Validation (Scalars) ---');
        assert(setCache('alpha_valid_1', 0.6) === true, 'setCache accepts 0.6');
        assert(setCache('alpha_valid_2', 0.85) === true, 'setCache accepts 0.85');
        assert(setCache('alpha_valid_3', 0.0) === true, 'setCache accepts 0.0');
        assert(setCache('alpha_valid_4', 1.0) === true, 'setCache accepts 1.0');
        assert(getCache('alpha_valid_1') === 0.6, 'getCache retrieves 0.6');

        assert(setCache('alpha_invalid_neg', -0.1) === false, 'setCache rejects negative numbers');
        assert(setCache('alpha_invalid_high', 1.5) === false, 'setCache rejects numbers > 1.0');
        assert(setCache('alpha_invalid_nan', NaN) === false, 'setCache rejects NaN');
        assert(setCache('alpha_invalid_inf', Infinity) === false, 'setCache rejects Infinity');
        assert(setCache('alpha_invalid_str', '0.6') === false, 'setCache rejects string scalar');
        assert(setCache('', 0.6) === false, 'setCache rejects empty key');
        assert(setCache(123, 0.6) === false, 'setCache rejects non-string key');

        // 3. Validation of Prompt Visual objects
        console.log('--- 3. Testing Entry Validation (Visual Objects) ---');
        const validVisualObj = {
            r: 120,
            g: 130,
            b: 140,
            start: { r: 100, g: 100, b: 100 },
            end: { r: 150, g: 150, b: 150 },
            cancelColor: { r: 120, g: 130, b: 140 },
            avatarColor: { r: 120, g: 130, b: 140 },
            a11yColor: { r: 120, g: 130, b: 140 },
            sessionColor: { r: 120, g: 130, b: 140 },
            useInverse: false,
            shadowAlpha: 0.15,
        };
        assert(setCache('visual_valid', validVisualObj) === true, 'setCache accepts valid visual object');
        assert(hasCache('visual_valid') === true, 'hasCache finds visual_valid');

        const invalidVisualMissingRgb = {
            start: { r: 100, g: 100, b: 100 },
            useInverse: false,
            shadowAlpha: 0.15,
        };
        assert(setCache('visual_no_rgb', invalidVisualMissingRgb) === false, 'setCache rejects missing base RGB');

        const invalidVisualRgbRange = {
            r: 256,
            g: 100,
            b: 100,
            useInverse: false,
            shadowAlpha: 0.15,
        };
        assert(setCache('visual_bad_range', invalidVisualRgbRange) === false, 'setCache rejects out-of-range RGB (>255)');

        const invalidVisualRgbFloat = {
            r: 120.5,
            g: 100,
            b: 100,
            useInverse: false,
            shadowAlpha: 0.15,
        };
        assert(setCache('visual_float_rgb', invalidVisualRgbFloat) === false, 'setCache rejects non-integer RGB');

        const invalidVisualBadSubColor = {
            r: 120,
            g: 100,
            b: 100,
            start: { r: -5, g: 100, b: 100 },
            useInverse: false,
            shadowAlpha: 0.15,
        };
        assert(setCache('visual_bad_sub', invalidVisualBadSubColor) === false, 'setCache rejects invalid sub-color');

        // 4. Boundedness & LRU Eviction
        console.log('--- 4. Testing Bounded Size & LRU Eviction ---');
        clearCache();
        for (let i = 0; i < MAX_CACHE_ENTRIES; i++) {
            setCache(`key_${i}`, 0.5);
        }
        assert(hasCache('key_0') === true, 'key_0 is present before capacity overflow');
        assert(hasCache(`key_${MAX_CACHE_ENTRIES - 1}`) === true, 'last key is present');

        // Access key_0 so it becomes most recently used
        getCache('key_0');

        // Insert one more key to trigger eviction
        setCache('key_overflow', 0.5);

        // key_1 was oldest (since key_0 was refreshed) and should have been evicted
        assert(hasCache('key_1') === false, 'key_1 was evicted as oldest entry');
        assert(hasCache('key_0') === true, 'key_0 was preserved due to LRU refresh');
        assert(hasCache('key_overflow') === true, 'key_overflow is present');

        // 5. Persistence, Write Coalescing and Atomic Replace
        console.log('--- 5. Testing Persistence & Coalescing ---');
        clearCache();
        setCache('persist_1', 0.75);
        setCache('persist_2', 0.80);
        setCache('persist_3', 0.85);

        // Wait for microtask & async disk write to complete
        await sleep(100);

        const file = Gio.File.new_for_path(CACHE_FILE);
        assert(file.query_exists(null) === true, 'Cache file exists on disk');

        const [loadSuccess, contents] = file.load_contents(null);
        assert(loadSuccess === true, 'Successfully loaded cache file from disk');
        const diskJson = JSON.parse(new TextDecoder().decode(contents));

        assert(diskJson.__schema__ === CACHE_SCHEMA_VERSION, `Disk schema version matches (${diskJson.__schema__})`);
        assert(diskJson.__visual_version__ === PROMPT_VISUAL_ALGORITHM_VERSION, `Disk visual version matches (${diskJson.__visual_version__})`);
        assert(diskJson.entries['persist_1'] === 0.75, 'persist_1 correctly stored on disk');
        assert(diskJson.entries['persist_2'] === 0.80, 'persist_2 correctly stored on disk');
        assert(diskJson.entries['persist_3'] === 0.85, 'persist_3 correctly stored on disk');

        // 6. Cold Start & In-Memory Authority
        console.log('--- 6. Testing Cold Start & In-Memory Authority ---');
        clearCache();
        assert(hasCache('persist_1') === false, 'Cache is empty before initCache');

        // Set an in-memory entry BEFORE initCache completes
        setCache('persist_1', 0.99);

        await initCache();

        // The in-memory entry (0.99) must NOT be overwritten by disk content (0.75)
        assert(getCache('persist_1') === 0.99, 'In-memory value 0.99 is authoritative over disk 0.75');
        // Other keys from disk should be loaded
        assert(getCache('persist_2') === 0.80, 'persist_2 loaded from disk');
        assert(getCache('persist_3') === 0.85, 'persist_3 loaded from disk');

        // 7. Stale Version & Corruption Recovery
        console.log('--- 7. Testing Corruption & Stale Version Recovery ---');
        // Manually write an obsolete version file
        const staleObj = {
            __schema__: 999, // Bad schema
            __visual_version__: 999,
            entries: { 'stale_key': 0.5 },
        };
        file.replace_contents(
            new TextEncoder().encode(JSON.stringify(staleObj)),
            null,
            false,
            Gio.FileCreateFlags.REPLACE_DESTINATION,
            null
        );

        clearCache();
        await initCache();
        assert(hasCache('stale_key') === false, 'Stale schema cache was discarded cleanly');

        // Manually write corrupt JSON
        file.replace_contents(
            new TextEncoder().encode('{ malformed json truncated...'),
            null,
            false,
            Gio.FileCreateFlags.REPLACE_DESTINATION,
            null
        );

        clearCache();
        await initCache();
        assert(hasCache('stale_key') === false, 'Corrupt JSON was recovered cleanly without throwing');

        // 8. Lifecycle & Generation Safety
        console.log('--- 8. Testing Lifecycle & Generation Safety ---');
        clearCache();
        initCache(); // In flight
        clearCache(); // Immediately cleared
        await sleep(50);
        assert(hasCache('persist_2') === false, 'Cleared generation does not repopulate from interrupted load');

        console.log('\n========================');
        console.log(`TEST RESULTS: ${passed} passed, ${failed} failed`);
        console.log('========================\n');
    } catch (err) {
        console.error(`💥 EXCEPTION IN TEST RUNNER: ${err}\n${err.stack}`);
        failed++;
    } finally {
        loop.quit();
    }
}

GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
    runTests();
    return GLib.SOURCE_REMOVE;
});

loop.run();
