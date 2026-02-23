const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// ================= 配置区 =================
const MANIFEST_PATH = path.resolve(__dirname, '../system_benign_manifest.json');
const TEST_ROOT = path.resolve(__dirname, '../test');

const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
const allBenign = manifest.benign || [];

// 按目录/引擎分类
const jestGroups = {};  // 对应 test/api -> 用 Jest
const mochaGroups = {}; // 对应 test/server -> 用 Mocha

allBenign.forEach(t => {
    if (t.file.startsWith('api/')) {
        if (!jestGroups[t.file]) jestGroups[t.file] = [];
        jestGroups[t.file].push(t.description);
    } else if (t.file.startsWith('server/')) {
        if (!mochaGroups[t.file]) mochaGroups[t.file] = [];
        mochaGroups[t.file].push(t.description);
    }
});

let passedCount = 0;
let failedFiles = [];

const overrideConfig = JSON.stringify({ server: { rateLimit: 0 } });
const commonEnv = { ...process.env, NODE_ENV: 'test', JUICE_SHOP_CONFIG: overrideConfig };

console.log(`🛡️  蓝队双引擎回归启动 | 目标: ${Object.keys(jestGroups).length + Object.keys(mochaGroups).length} 个测试文件\n`);

// ================= 引擎 1: Jest (处理 API 测试) =================
Object.keys(jestGroups).forEach((file, index) => {
    const specPath = path.join(TEST_ROOT, file);
    const pattern = jestGroups[file]
        .map(d => d.replace(/\\'/g, "'").replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
        .join('|');

    process.stdout.write(`[Jest] 测试中: ${file.padEnd(35)} `);

    const result = spawnSync(process.platform === 'win32' ? 'npx.cmd' : 'npx', [
        'jest', '--silent', '--forceExit', '--config', 'package.json', specPath, '-t', pattern
    ], { cwd: path.resolve(__dirname, '..'), env: commonEnv, encoding: 'utf-8' });

    handleResult(result, file);
});

// ================= 引擎 2: Mocha (处理 Server 测试) =================
Object.keys(mochaGroups).forEach((file, index) => {
    const specPath = path.join(TEST_ROOT, file);
    // Mocha 的过滤参数是 -g (grep)
    const pattern = mochaGroups[file]
        .map(d => d.replace(/\\'/g, "'").replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
        .join('|');

    process.stdout.write(`[Mocha]测试中: ${file.padEnd(35)} `);

    // 参考 package.json 中的 test:server 命令
    const result = spawnSync(process.platform === 'win32' ? 'npx.cmd' : 'npx', [
        'mocha',
        '-r', 'ts-node/register',
        '-r', 'source-map-support/register',
        specPath,
        '-g', pattern
    ], { cwd: path.resolve(__dirname, '..'), env: commonEnv, encoding: 'utf-8' });

    handleResult(result, file);
});

// ================= 结果处理 =================
function handleResult(result, file) {
    if (result.status === 0) {
        passedCount++;
        process.stdout.write(`✅ OK\n`);
    } else {
        process.stdout.write(`❌ FAILED\n`);
        console.error(`\n--- ${file} 错误详情 ---`);
        console.error(result.stderr || result.stdout);
        console.error(`---------------------------\n`);
        failedFiles.push(file);
    }
}

console.log('\n===================================');
console.log(`📊 统计报告: 🟢 通过: ${passedCount} | 🔴 失败: ${failedFiles.length}`);
process.exit(failedFiles.length === 0 ? 0 : 1);