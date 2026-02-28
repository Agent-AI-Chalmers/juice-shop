const { spawnSync, spawn, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// ================= Configuration =================
const MANIFEST_PATH = path.resolve(__dirname, '../system_benign_manifest.json');
const TEST_ROOT = path.resolve(__dirname, '../test');
const BATCH_SIZE = 10; // Run 10 files per batch
const COOLDOWN_MS = 4000; // Cool down 4 seconds between batches

const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
const allBenign = manifest.benign || [];

const jestGroups = {};
const mochaGroups = {};

allBenign.forEach(t => {
    if (t.file.includes('api/')) {
        const key = t.file.startsWith('test/') ? t.file.replace('test/', '') : t.file;
        if (!jestGroups[key]) jestGroups[key] = [];
        jestGroups[key].push(t.description);
    } else if (t.file.includes('server/')) {
        const key = t.file.startsWith('test/') ? t.file.replace('test/', '') : t.file;
        if (!mochaGroups[key]) mochaGroups[key] = [];
        mochaGroups[key].push(t.description);
    }
});

// Get Puppeteer's Chrome path for headless tests
let chromePath = '';
try {
    chromePath = require('puppeteer').executablePath();
    console.log(`\n🔍 Detected Chrome path: ${chromePath}`);
} catch (e) {
    console.warn('⚠️ Puppeteer not detected, will try the system default browser');
}

const overrideConfig = JSON.stringify({
    server: { rateLimit: 0 },
    application: {
        chatBot: {
            name: "Juicy",
            trainingData: "botDefaultTrainingData.json"
        }
    }
});
const commonEnv = {
    ...process.env,
    NODE_ENV: 'test',
    JUICE_SHOP_CONFIG: overrideConfig,
    CHROME_BIN: chromePath // Key: used by Karma (frontend tests)
};

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const modifiedFiles = new Set();

async function main() {
    let allPassed = true;

    try {
        // --- Fix ChatBot JSON crash ---
        const projectRoot = path.resolve(__dirname, '..');
        const staticPath = path.join(projectRoot, 'data/static/botDefaultTrainingData.json');
        const runtimeDir = path.join(projectRoot, 'data/chatbot');
        const runtimePath = path.join(runtimeDir, 'botDefaultTrainingData.json');

        if (!fs.existsSync(runtimeDir)) fs.mkdirSync(runtimeDir, { recursive: true });
        if (fs.existsSync(staticPath)) {
            // Use atomic copyFileSync to avoid partial reads causing "Unexpected end of JSON"
            fs.copyFileSync(staticPath, runtimePath);
            console.log("✅ ChatBot data environment ready (Verified)");
        } else {
            console.error("❌ Source data file not found:", staticPath);
            process.exit(1); // Without the source file, tests will fail; exit early
        }
        // ------------------------------------------

        // Physically mute excluded tests
        manifest.excluded.forEach(item => {
            const fullPath = path.resolve(__dirname, '..', item.file);
            if (fs.existsSync(fullPath)) {
                let content = fs.readFileSync(fullPath, 'utf8');
                const escapedDesc = item.description.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                // The \\bit with word boundary prevents duplicate replacement
                const regex = new RegExp(`\\bit\\s*\\(\\s*['"\`]${escapedDesc}['"\`]`, 'g');
                if (regex.test(content)) {
                    const newContent = content.replace(regex, `xit('${item.description}'`);
                    fs.writeFileSync(fullPath, newContent);
                    modifiedFiles.add(item.file); // Store relative path for git checkout
                }
            }
        });
        console.log("✅ Unsafe tests muted.");

        // 1. Frontend unit tests & lint (Angular)
        // If Blue Team fixes touched shared models, this fails first
        const frontendPassed = await runFrontendTests();
        if (!frontendPassed) allPassed = false;

        // 2. Run core API/Server batches (Jest/Mocha)
        // These tests include their own setup/teardown logic
        const apiPassed = await runStandardTests();
        if (!apiPassed) allPassed = false;

        // 3. Collect and run Cypress
        const cypressFiles = [...new Set(allBenign
            .filter(t => t.file.startsWith('cypress/'))
            .map(t => t.file)
        )];

        if (allPassed && cypressFiles.length > 0) {
            // Note: Cypress requires a running server.
            // Jest may have stopped it, so we start a temporary server process
            const cypressPassed = await runCypressWithServer(cypressFiles);
            if (!cypressPassed) allPassed = false;
        }

        console.log('\n===================================');
        console.log(`📊 Final Blue Team regression report: ${allPassed ? '✅ All passed' : '❌ Failures detected'}`);
    } catch (err) {
        console.error('Execution interrupted:', err);
        allPassed = false; // Mark failure to exit with non-zero status
    } finally {
        // console.log("\n[Blue Team] Restoring modified test files...");
        const rootDir = path.resolve(__dirname, '..');
        for (const filePath of modifiedFiles) {
            try {
                // Only restore files on the list
                execSync(`git checkout -- "${filePath}"`, { cwd: rootDir });
                // console.log(`  ✅ Restored: ${filePath}`);
            } catch (e) {
                // console.error(`  ❌ Restore failed: ${filePath}`, e.message);
            }
        }
        // console.log(`✅ Silently restored ${modifiedFiles.size} modified test files.`);
        process.exit(allPassed ? 0 : 1);
    }
}

async function runFrontendTests() {
    console.log(`\n[Frontend] Starting frontend unit tests (Karma)...`);

    return new Promise((resolve) => {
        const child = spawn(process.platform === 'win32' ? 'npm.cmd' : 'npm',
            ['run', 'test', '--', '--no-progress', '--watch=false', '--browsers=ChromeHeadlessNoSandbox'],
            { cwd: path.resolve(__dirname, '../frontend'), env: commonEnv }
        );

        // Noise patterns (matching lines are discarded)
        const noisePatterns = [
            /NG0955/,                // Angular track expression warning
            /Highlight\.js/,         // HLJS import error
            /Executed \d+ of \d+/,   // Progress output
            /key "" at index/,       // NG0955 follow-up details
            /Error during diffing/   // Common noise
        ];

        child.stdout.on('data', (data) => {
            const lines = data.toString().split('\n');
            lines.forEach(line => {
                // Print if not noise or if it contains a failure signal
                if (!noisePatterns.some(pattern => pattern.test(line)) || line.includes('FAILED')) {
                    if (line.trim()) console.log(`  [Karma] ${line.trim()}`);
                }
            });
        });

        child.stderr.on('data', (data) => {
            // Only real ERRORs are printed
            const line = data.toString();
            if (!noisePatterns.some(pattern => pattern.test(line))) {
                console.error(`  [Karma-Err] ${line.trim()}`);
            }
        });

        child.on('close', (code) => {
            resolve(code === 0);
        });
    });
}

function killPort(port) {
    try {
        console.log(`🧹 Cleaning port ${port}...`);
        if (process.platform === 'win32') {
            // On Windows, find and kill the process using the port
            const stdout = execSync(`netstat -ano | findstr :${port}`).toString();
            const lines = stdout.split('\n');
            lines.forEach(line => {
                const parts = line.trim().split(/\s+/);
                if (parts.length > 4 && parts[1].includes(`:${port}`)) {
                    const pid = parts[parts.length - 1];
                    if (pid > 0) execSync(`taskkill /F /PID ${pid}`, { stdio: 'ignore' });
                }
            });
        } else {
            // On Linux/Mac, use lsof or fuser
            execSync(`lsof -t -i:${port} | xargs kill -9`, { stdio: 'ignore' });
        }
    } catch (e) {
        // If the port is not in use, the command errors; ignore it
    }
}

async function runStandardTests() {
    console.log(`\n🛡️ Backend API regression start | Target: ${Object.keys(jestGroups).length} files`);
    const jestFiles = Object.keys(jestGroups);
    let failed = [];

    for (let i = 0; i < jestFiles.length; i += BATCH_SIZE) {
        // --- Kill port before each batch ---
        killPort(3000);
        await sleep(1000); // Give the system a moment to breathe

        const chunk = jestFiles.slice(i, i + BATCH_SIZE);
        const chunkPaths = chunk.map(f => path.join(TEST_ROOT, f));
        const chunkPatterns = chunk.flatMap(f => jestGroups[f])
            .map(d => d.replace(/\\'/g, "'").replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
            .join('|');

        console.log(`[Jest] Running batch ${Math.floor(i / BATCH_SIZE) + 1}...`);
        const res = spawnSync(process.platform === 'win32' ? 'npx.cmd' : 'npx', [
            'jest', '--silent', '--forceExit', '--runInBand', '--config', 'package.json',
            ...chunkPaths, '-t', chunkPatterns
        ], {
            cwd: path.resolve(__dirname, '..'),
            env: { ...commonEnv, PORT: 3000 }, // Explicit port
            stdio: 'inherit'
        });

        if (res.status !== 0) failed.push(i);

        // Cool down between batches
        if (i + BATCH_SIZE < jestFiles.length) await sleep(COOLDOWN_MS);
    }
    return failed.length === 0;
}

async function runCypressWithServer(cypressFiles) {
    console.log(`\n[Cypress] Preparing environment and starting end-to-end regression...`);

    // Add test/ prefix when missing, and normalize the format
    const cleanSpecs = cypressFiles.map(f => {
        // If the manifest path omits test/ but the file exists under test/, add it
        let p = f;
        if (!p.startsWith('test/') && fs.existsSync(path.join(__dirname, '..', 'test', p))) {
            p = path.join('test', p);
        }
        // Remove any absolute prefix, keep path relative to project root
        return p.replace(path.resolve(__dirname, '..') + path.sep, '');
    });

    // Start background server
    const serverProcess = spawn('node', ['build/app'], {
        cwd: path.resolve(__dirname, '..'),
        env: commonEnv,
        detached: false
    });

    // Poll for server readiness
    let isReady = false;
    console.log('⏳ Waiting for backend server readiness (http://localhost:3000)...');
    for (let i = 0; i < 15; i++) {
        try {
            const res = spawnSync('node', ['-e', "require('http').get('http://localhost:3000', (res) => process.exit(res.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"]);
            if (res.status === 0) {
                isReady = true;
                break;
            }
        } catch (e) { }
        await sleep(1000);
    }

    if (!isReady) {
        console.error('❌ Error: server not responding, skipping Cypress tests.');
        serverProcess.kill();
        return false;
    }

    console.log('✅ Server is ready, starting Cypress...');

    // Run Cypress
    const res = spawnSync(process.platform === 'win32' ? 'npx.cmd' : 'npx', [
        'cypress', 'run',
        '--browser', chromePath || 'electron',
        '--headless',
        '--spec', cleanSpecs.join(',') // cleanSpecs are normalized to test/cypress/... format
    ], {
        cwd: path.resolve(__dirname, '..'),
        env: commonEnv,
        stdio: 'inherit'
    });

    serverProcess.kill();
    return res.status === 0;
}

main();