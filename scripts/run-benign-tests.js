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

// Result tracking
const report = {
    env: { status: 'Pending', msg: '' },
    frontend: { status: 'Skipped', msg: '' },
    backend: { status: 'Skipped', msg: '' },
    cypress: { status: 'Skipped', msg: '' }
};

const jestGroups = {};
allBenign.forEach(t => {
    if (t.file.includes('api/') || t.file.includes('server/')) {
        const key = t.file.startsWith('test/') ? t.file.replace('test/', '') : t.file;
        if (!jestGroups[key]) jestGroups[key] = [];
        jestGroups[key].push(t.description);
    }
});

let chromePath = '';
try {
    chromePath = require('puppeteer').executablePath();
} catch (e) {
    console.warn('⚠️ Puppeteer not detected');
}

const commonEnv = {
    ...process.env,
    NODE_ENV: 'test',
    JUICE_SHOP_CONFIG: JSON.stringify({
        server: { rateLimit: 0 },
        application: { chatBot: { name: "Juicy", trainingData: "botDefaultTrainingData.json" } }
    }),
    CHROME_BIN: chromePath
};

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// ================= Helper Functions =================

function applyTestExclusions(excludedTests, rootDir) {
    const modifiedFiles = new Set();
    if (!excludedTests || excludedTests.length === 0) return modifiedFiles;

    const fileMap = excludedTests.reduce((acc, item) => {
        if (!acc[item.file]) acc[item.file] = [];
        acc[item.file].push(item.description);
        return acc;
    }, {});

    console.log("🛡️ Applying physical patch (Enhanced Matching)...");

    for (let [relPath, descriptions] of Object.entries(fileMap)) {
        let fullPath = path.resolve(rootDir, relPath);
        if (!fs.existsSync(fullPath) && !relPath.startsWith('frontend/')) {
            fullPath = path.resolve(rootDir, 'frontend', relPath);
        }

        if (!fs.existsSync(fullPath)) continue;

        try {
            let content = fs.readFileSync(fullPath, 'utf8');
            let isModified = false;

            descriptions.forEach(fullDesc => {
                const words = fullDesc.split(' ').filter(w => w.length > 2);
                const lastWords = words.slice(-3);

                // transfer the words first, then join with wildcard
                const escapedWords = lastWords.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
                const pattern = escapedWords.join('.*?');

                const regex = new RegExp(`\\b(it|fit|test)\\s*\\(\\s*['"\`][^]*?${pattern}[^]*?['"\`]`, 'gi');

                if (regex.test(content)) {
                    content = content.replace(regex, (match) => match.startsWith('x') ? match : 'x' + match);
                    isModified = true;
                }
            });

            if (isModified) {
                fs.writeFileSync(fullPath, content);
                modifiedFiles.add(fullPath);
            }
        } catch (err) { }
    }
    return modifiedFiles;
}

function restoreTestFiles(modifiedFiles, rootDir) {
    if (modifiedFiles.size === 0) return;
    console.log(`\n🧹 Restoring ${modifiedFiles.size} files...`);
    for (const filePath of modifiedFiles) {
        try {
            execSync(`git checkout -- "${filePath}"`, { cwd: rootDir, stdio: 'ignore' });
        } catch (e) { }
    }
}

async function prepareChatBotEnvironment(projectRoot) {
    const staticPath = path.join(projectRoot, 'data/static/botDefaultTrainingData.json');
    const runtimeDir = path.join(projectRoot, 'data/chatbot');
    const runtimePath = path.join(runtimeDir, 'botDefaultTrainingData.json');

    if (!fs.existsSync(runtimeDir)) fs.mkdirSync(runtimeDir, { recursive: true });
    if (fs.existsSync(staticPath)) {
        fs.writeFileSync(runtimePath, fs.readFileSync(staticPath));
        const stats = fs.statSync(runtimePath);
        if (stats.size === 0) throw new Error("Empty ChatBot data");
        console.log("✅ ChatBot data verified.");
        await sleep(500);
    }
}

function killPort(port) {
    try {
        const cmd = process.platform === 'win32'
            ? `for /f "tokens=5" %a in ('netstat -aon ^| findstr :${port}') do taskkill /f /pid %a`
            : `lsof -t -i:${port} | xargs kill -9`;
        execSync(cmd, { stdio: 'ignore' });
    } catch (e) { }
}

// ================= Runners =================

async function runFrontendTests() {
    console.log(`\n[Frontend] Running Karma tests...`);
    return new Promise((resolve) => {
        const child = spawn(process.platform === 'win32' ? 'npm.cmd' : 'npm',
            ['run', 'test', '--', '--no-progress', '--watch=false', '--browsers=ChromeHeadlessNoSandbox'],
            { cwd: path.resolve(__dirname, '../frontend'), env: commonEnv }
        );

        const noise = [/NG0955/, /Highlight\.js/, /Executed \d+ of \d+/, /key "" at index/, /Error during diffing/];

        child.stdout.on('data', (data) => {
            data.toString().split('\n').forEach(line => {
                if (!noise.some(p => p.test(line)) || line.includes('FAILED')) {
                    if (line.trim()) console.log(`  [Karma] ${line.trim()}`);
                }
            });
        });

        child.on('close', (code) => resolve(code === 0));
    });
}

async function runStandardTests() {
    console.log(`\n🛡️ Backend API regression | Target: ${Object.keys(jestGroups).length} files`);
    const jestFiles = Object.keys(jestGroups);
    let allPassed = true;

    for (let i = 0; i < jestFiles.length; i += BATCH_SIZE) {
        killPort(3000);
        await sleep(1000);
        const chunk = jestFiles.slice(i, i + BATCH_SIZE);
        const chunkPaths = chunk.map(f => path.join(TEST_ROOT, f));
        const chunkPatterns = chunk.flatMap(f => jestGroups[f])
            .map(d => d.replace(/\\'/g, "'").replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
            .join('|');

        console.log(`[Jest] Batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(jestFiles.length / BATCH_SIZE)}...`);
        const res = spawnSync(process.platform === 'win32' ? 'npx.cmd' : 'npx', [
            'jest', '--silent', '--forceExit', '--runInBand', ...chunkPaths, '-t', chunkPatterns
        ], { cwd: path.resolve(__dirname, '..'), env: { ...commonEnv, PORT: 3000 }, stdio: 'inherit' });

        if (res.status !== 0) allPassed = false;
        if (i + BATCH_SIZE < jestFiles.length) await sleep(COOLDOWN_MS);
    }
    return allPassed;
}

// ================= Main Flow =================

async function main() {
    let allPassed = true;
    const projectRoot = path.resolve(__dirname, '..');

    try {
        // 1. Prepare environment (ChatBot data)
        try {
            await prepareChatBotEnvironment(projectRoot);
            report.env = { status: '✅ Passed', msg: 'ChatBot data ready' };
        } catch (e) {
            report.env = { status: '❌ Failed', msg: e.message };
            throw e;
        }

        // 2. Frontend tests
        let modifiedFiles = new Set();
        try {
            modifiedFiles = applyTestExclusions(manifest.excluded || [], projectRoot);
            const frontendPassed = await runFrontendTests();
            report.frontend = frontendPassed
                ? { status: '✅ Passed', msg: 'Karma suite success' }
                : { status: '❌ Failed', msg: 'Regression detected' };
            if (!frontendPassed) allPassed = false;
        } finally {
            restoreTestFiles(modifiedFiles, projectRoot);
        }

        // 3. Backend API tests
        const apiPassed = await runStandardTests();
        report.backend = apiPassed
            ? { status: '✅ Passed', msg: 'Jest batches success' }
            : { status: '❌ Failed', msg: 'API failures detected' };
        if (!apiPassed) allPassed = false;

        // 4. Cypress
        const cypressFiles = [...new Set(allBenign.filter(t => t.file.startsWith('cypress/')).map(t => t.file))];
        if (allPassed && cypressFiles.length > 0) {
            const cypressPassed = await runCypressWithServer(cypressFiles);
            report.cypress = cypressPassed ? {status:'✅ Passed'} : {status:'❌ Failed'};
        }

    } catch (err) {
        console.error('\n🚀 Critical Error during execution:', err.message);
        allPassed = false;
    } finally {
        console.log('\n' + '='.repeat(50));
        console.log('📊 BLUE TEAM REGRESSION REPORT');
        console.log('='.repeat(50));
        console.log(`1. Environment : ${report.env.status} (${report.env.msg})`);
        console.log(`2. Frontend    : ${report.frontend.status} ${report.frontend.msg}`);
        console.log(`3. Backend API : ${report.backend.status} ${report.backend.msg}`);
        console.log(`4. Cypress E2E : ${report.cypress.status} ${report.cypress.msg}`);
        console.log('='.repeat(50));
        console.log(`OVERALL RESULT: ${allPassed ? '✅ SUCCESS' : '❌ FAILURE'}`);
        console.log('='.repeat(50) + '\n');

        process.exit(allPassed ? 0 : 1);
    }
}

main();