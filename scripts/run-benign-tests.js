const { spawnSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

// ================= 配置区 =================
const MANIFEST_PATH = path.resolve(__dirname, '../system_benign_manifest.json');
const TEST_ROOT = path.resolve(__dirname, '../test');
const BATCH_SIZE = 10; // 每组运行 10 个文件
const COOLDOWN_MS = 4000; // 每组之间休息 4 秒

const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
const allBenign = manifest.benign || [];

const jestGroups = {};
const mochaGroups = {};

allBenign.forEach(t => {
    if (t.file.startsWith('api/')) {
        if (!jestGroups[t.file]) jestGroups[t.file] = [];
        jestGroups[t.file].push(t.description);
    } else if (t.file.startsWith('server/')) {
        if (!mochaGroups[t.file]) mochaGroups[t.file] = [];
        mochaGroups[t.file].push(t.description);
    }
});

// 获取 Puppeteer 的 Chrome 路径用于无头测试
let chromePath = '';
try {
    chromePath = require('puppeteer').executablePath();
    console.log(`\n🔍 检测到 Chrome 路径: ${chromePath}`);
} catch (e) {
    console.warn('⚠️ 未检测到 puppeteer，将尝试使用系统默认浏览器');
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
    CHROME_BIN: chromePath // 关键：供 Karma (前端测试) 使用
};

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function main() {
    let allPassed = true;

    try {
        // --- 修复 ChatBot JSON 崩溃问题 ---
        const cbDir = path.resolve(__dirname, '../data/chatbot');
        if (!fs.existsSync(cbDir)) fs.mkdirSync(cbDir, { recursive: true });
        // 强制从 static 目录同步数据到运行目录
        fs.writeFileSync(
            path.join(cbDir, 'botDefaultTrainingData.json'),
            fs.readFileSync(path.resolve(__dirname, '../data/static/botDefaultTrainingData.json'))
        );
        console.log("✅ ChatBot 数据环境已就绪");
        // ------------------------------------------

        // 1. 前端单元测试 & Lint (Angular)
        // 蓝队修复如果改动了共享模型，这里会第一时间报错
        const frontendPassed = await runFrontendTests();
        if (!frontendPassed) allPassed = false;

        // 2. 运行核心 API/Server 批次 (Jest/Mocha)
        // 这些测试自带 Setup/Teardown 逻辑
        const apiPassed = await runStandardTests();
        if (!apiPassed) allPassed = false;

        // 3. 提取并运行 Cypress
        const cypressFiles = [...new Set(allBenign
            .filter(t => t.file.startsWith('cypress/'))
            .map(t => t.file)
        )];

        if (allPassed && cypressFiles.length > 0) {
            // 注意：Cypress 需要一个运行中的 Server。
            // 因为 Jest 跑完可能已经把 Server 关了，我们需要一个临时 Server 进程
            const cypressPassed = await runCypressWithServer(cypressFiles);
            if (!cypressPassed) allPassed = false;
        }

        console.log('\n===================================');
        console.log(`📊 最终蓝队回归报告: ${allPassed ? '✅ 全量通过' : '❌ 存在失败项'}`);
        process.exit(allPassed ? 0 : 1);
    } catch (err) {
        console.error('执行中断:', err);
        process.exit(1);
    }
}

async function runFrontendTests() {
    console.log(`\n[Frontend] 启动前端单元测试 (Karma)...`);
    // 执行 frontend 目录下的测试，跳过持续观察模式
    const res = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm',
        ['run', 'test', '--', '--no-progress', '--watch=false', '--browsers=ChromeHeadless'],
        // --- 隐藏 NG0955 等警告日志，只显示 ERROR ---
        { cwd: path.resolve(__dirname, '../frontend'), env: commonEnv, stdio: ['ignore', 'ignore', 'inherit'] }
    );
    return res.status === 0;
}

async function runStandardTests() {
    console.log(`\n🛡️ 后端 API 回归启动 | 目标: ${Object.keys(jestGroups).length} 文件`);
    const jestFiles = Object.keys(jestGroups);
    let failed = [];

    for (let i = 0; i < jestFiles.length; i += BATCH_SIZE) {
        const chunk = jestFiles.slice(i, i + BATCH_SIZE);
        const chunkPaths = chunk.map(f => path.join(TEST_ROOT, f));
        const chunkPatterns = chunk.flatMap(f => jestGroups[f])
            .map(d => d.replace(/\\'/g, "'").replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
            .join('|');

        console.log(`[Jest] 运行批次 ${Math.floor(i / BATCH_SIZE) + 1}...`);
        const res = spawnSync(process.platform === 'win32' ? 'npx.cmd' : 'npx', [
            'jest', '--silent', '--forceExit', '--runInBand', '--config', 'package.json',
            ...chunkPaths, '-t', chunkPatterns
        ], { cwd: path.resolve(__dirname, '..'), env: commonEnv, stdio: 'inherit' });

        if (res.status !== 0) failed.push(i);
        if (i + BATCH_SIZE < jestFiles.length) await sleep(COOLDOWN_MS);
    }
    return failed.length === 0;
}

async function runCypressWithServer(cypressFiles) {
    console.log(`\n[Cypress] 准备环境并启动端到端回归...`);

    // 补全路径中的 test/ 前缀，并确保格式统一
    const cleanSpecs = cypressFiles.map(f => {
        // 如果 manifest 里的路径没带 test/，但在 test/ 目录下能找到该文件，则自动补上
        let p = f;
        if (!p.startsWith('test/') && fs.existsSync(path.join(__dirname, '..', 'test', p))) {
            p = path.join('test', p);
        }
        // 确保去掉任何绝对路径前缀，仅保留从项目根目录开始的相对路径
        return p.replace(path.resolve(__dirname, '..') + path.sep, '');
    });

    // 启动背景服务器
    const serverProcess = spawn('node', ['build/app'], {
        cwd: path.resolve(__dirname, '..'),
        env: commonEnv,
        detached: false
    });

    // 动态检查服务器就绪状态
    let isReady = false;
    console.log('⏳ 正在等待后端服务器就绪 (http://localhost:3000)...');
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
        console.error('❌ 错误：服务器未响应，放弃 Cypress 测试。');
        serverProcess.kill();
        return false;
    }

    console.log('✅ 服务器已就绪，启动 Cypress...');

    // 运行 Cypress
    const res = spawnSync(process.platform === 'win32' ? 'npx.cmd' : 'npx', [
        'cypress', 'run',
        '--browser', chromePath || 'electron',
        '--headless',
        '--spec', cleanSpecs.join(',') // 这里的 cleanSpecs 已经是整齐的 test/cypress/... 格式
    ], {
        cwd: path.resolve(__dirname, '..'),
        env: commonEnv,
        stdio: 'inherit'
    });

    serverProcess.kill();
    return res.status === 0;
}

main();