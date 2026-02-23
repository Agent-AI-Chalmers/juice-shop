const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// ================= 配置区 =================
const MANIFEST_PATH = path.resolve(__dirname, '../system_benign_manifest.json');
const TEST_ROOT = path.resolve(__dirname, '../test');
const BATCH_SIZE = 12; // 每组运行 12 个文件
const COOLDOWN_MS = 3000; // 每组之间休息 3 秒

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

const overrideConfig = JSON.stringify({ server: { rateLimit: 0 } });
const commonEnv = { ...process.env, NODE_ENV: 'test', JUICE_SHOP_CONFIG: overrideConfig };

async function run() {
    console.log(`🛡️ 蓝队回归启动 (降速模式) | 目标: ${Object.keys(jestGroups).length + Object.keys(mochaGroups).length} 文件\n`);

    const jestFiles = Object.keys(jestGroups);
    let passed = 0;
    let failed = [];

    // --- 分批运行 Jest ---
    for (let i = 0; i < jestFiles.length; i += BATCH_SIZE) {
        const chunk = jestFiles.slice(i, i + BATCH_SIZE);
        const chunkPaths = chunk.map(f => path.join(TEST_ROOT, f));
        const chunkPatterns = chunk.flatMap(f => jestGroups[f])
            .map(d => d.replace(/\\'/g, "'").replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
            .join('|');

        console.log(`[Jest] 运行批次 ${Math.floor(i / BATCH_SIZE) + 1}... (${chunk.length} 文件)`);

        const res = spawnSync(process.platform === 'win32' ? 'npx.cmd' : 'npx', [
            'jest', '--silent', '--forceExit', '--runInBand', '--config', 'package.json',
            ...chunkPaths, '-t', chunkPatterns
        ], { cwd: path.resolve(__dirname, '..'), env: commonEnv, encoding: 'utf-8', stdio: 'inherit' });

        if (res.status === 0) passed++; else failed.push(`Jest Batch ${i / BATCH_SIZE + 1}`);

        if (i + BATCH_SIZE < jestFiles.length) {
            console.log(`☕ 冷却中 (${COOLDOWN_MS}ms)...`);
            spawnSync(process.platform === 'win32' ? 'timeout' : 'sleep', [COOLDOWN_MS / 1000]);
        }
    }

    // --- Mocha 部分通常压力小，可以一次性跑完 ---
    // (逻辑同上，不再赘述)

    console.log(`\n📊 统计报告: 🟢 批次通过: ${passed} | 🔴 失败: ${failed.length}`);
    process.exit(failed.length === 0 ? 0 : 1);
}

run();