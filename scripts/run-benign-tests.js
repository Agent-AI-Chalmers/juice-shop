const { spawnSync, spawn, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');


const MANIFEST_PATH = path.resolve(__dirname, '../system_benign_manifest.json');
const TEST_ROOT = path.resolve(__dirname, '../test');
const BATCH_SIZE = 10; 
const COOLDOWN_MS = 4000; 

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
    CHROME_BIN: chromePath 
};

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const modifiedFiles = new Set();

async function main() {
    let allPassed = true;

    try {
        
        const cbDir = path.resolve(__dirname, '../data/chatbot');
        if (!fs.existsSync(cbDir)) fs.mkdirSync(cbDir, { recursive: true });
        
        fs.writeFileSync(
            path.join(cbDir, 'botDefaultTrainingData.json'),
            fs.readFileSync(path.resolve(__dirname, '../data/static/botDefaultTrainingData.json'))
        );
        console.log("✅ ChatBot data environment is ready");
        

        
        manifest.excluded.forEach(item => {
            const fullPath = path.resolve(__dirname, '..', item.file);
            if (fs.existsSync(fullPath)) {
                let content = fs.readFileSync(fullPath, 'utf8');
                const escapedDesc = item.description.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                
                const regex = new RegExp(`\\bit\\s*\\(\\s*['"\`]${escapedDesc}['"\`]`, 'g');
                if (regex.test(content)) {
                    const newContent = content.replace(regex, `xit('${item.description}'`);
                    fs.writeFileSync(fullPath, newContent);
                    modifiedFiles.add(item.file); 
                }
            }
        });
        console.log("✅ Unsafe tests muted.");

        
        
        const frontendPassed = await runFrontendTests();
        if (!frontendPassed) allPassed = false;

        
        
        const apiPassed = await runStandardTests();
        if (!apiPassed) allPassed = false;

        
        const cypressFiles = [...new Set(allBenign
            .filter(t => t.file.startsWith('cypress/'))
            .map(t => t.file)
        )];

        if (allPassed && cypressFiles.length > 0) {
            
            
            const cypressPassed = await runCypressWithServer(cypressFiles);
            if (!cypressPassed) allPassed = false;
        }

        console.log('\n===================================');
        console.log(`📊 Final Blue Team regression report: ${allPassed ? '✅ All passed' : '❌ Failures detected'}`);
    } catch (err) {
        console.error('Execution interrupted:', err);
        allPassed = false; 
    } finally {
        console.log("\n[Blue Team] Restoring modified test files...");
        const rootDir = path.resolve(__dirname, '..');
        for (const filePath of modifiedFiles) {
            try {
                
                execSync(`git checkout -- "${filePath}"`, { cwd: rootDir });
                
            } catch (e) {
                
            }
        }
        
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

        
        const noisePatterns = [
            /NG0955/,                
            /Highlight\.js/,         
            /Executed \d+ of \d+/,   
            /key "" at index/,       
            /Error during diffing/   
        ];

        child.stdout.on('data', (data) => {
            const lines = data.toString().split('\n');
            lines.forEach(line => {
                
                if (!noisePatterns.some(pattern => pattern.test(line)) || line.includes('FAILED')) {
                    if (line.trim()) console.log(`  [Karma] ${line.trim()}`);
                }
            });
        });

        child.stderr.on('data', (data) => {
            
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
            
            execSync(`lsof -t -i:${port} | xargs kill -9`, { stdio: 'ignore' });
        }
    } catch (e) {
        
    }
}

async function runStandardTests() {
    console.log(`\n🛡️ Backend API regression start | Target: ${Object.keys(jestGroups).length} files`);
    const jestFiles = Object.keys(jestGroups);
    let failed = [];

    for (let i = 0; i < jestFiles.length; i += BATCH_SIZE) {
        
        killPort(3000);
        await sleep(1000); 

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
            env: { ...commonEnv, PORT: 3000 }, 
            stdio: 'inherit'
        });

        if (res.status !== 0) failed.push(i);

        
        if (i + BATCH_SIZE < jestFiles.length) await sleep(COOLDOWN_MS);
    }
    return failed.length === 0;
}

async function runCypressWithServer(cypressFiles) {
    console.log(`\n[Cypress] Preparing environment and starting end-to-end regression...`);

    
    const cleanSpecs = cypressFiles.map(f => {
        
        let p = f;
        if (!p.startsWith('test/') && fs.existsSync(path.join(__dirname, '..', 'test', p))) {
            p = path.join('test', p);
        }
        
        return p.replace(path.resolve(__dirname, '..') + path.sep, '');
    });

    
    const serverProcess = spawn('node', ['build/app'], {
        cwd: path.resolve(__dirname, '..'),
        env: commonEnv,
        detached: false
    });

    
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

    
    const res = spawnSync(process.platform === 'win32' ? 'npx.cmd' : 'npx', [
        'cypress', 'run',
        '--browser', chromePath || 'electron',
        '--headless',
        '--spec', cleanSpecs.join(',') 
    ], {
        cwd: path.resolve(__dirname, '..'),
        env: commonEnv,
        stdio: 'inherit'
    });

    serverProcess.kill();
    return res.status === 0;
}

main();