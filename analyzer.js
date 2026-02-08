// analyzer.js
// Node.js 分析脚本 - 使用 ts-morph 进行 TypeScript 语义分析
const { Project } = require("ts-morph");
const path = require("path");

// 1. 获取命令行参数
// usage: node analyzer.js <projectRoot> <targetFilePath> <functionName>
const args = process.argv.slice(2);
if (args.length < 3) {
    console.error(JSON.stringify({ error: "Missing arguments. Usage: node analyzer.js <projectRoot> <targetFilePath> <functionName>" }));
    process.exit(1);
}

const [projectRoot, targetFilePath, functionName] = args;

// 2. 初始化 Project (自动读取 tsconfig.json)
const project = new Project({
    tsConfigFilePath: path.join(projectRoot, "tsconfig.json"),
    skipAddingFilesFromTsConfig: false, // 确保加载所有文件
});

try {
    // 3. 找到目标文件
    // 注意：ts-morph 需要标准化的路径
    const sourceFile = project.getSourceFileOrThrow(targetFilePath);

    // 4. 找到目标函数 (支持 function 声明、const 箭头函数、以及类方法)
    // 核心：自动清洗函数名 (e.g. "res.cookie" -> "cookie", "AuthController.login" -> "login")
    let searchName = functionName;
    if (functionName.includes('.')) {
        searchName = functionName.split('.').pop();
    }

    // 尝试 1: Function Declaration (function foo() {})
    let targetNode = sourceFile.getFunction(searchName);

    if (!targetNode) {
        // 尝试 2: Variable Declaration (const foo = () => {})
        const variable = sourceFile.getVariableDeclaration(searchName);
        if (variable) {
            targetNode = variable;
        }
    }

    // 尝试 3: Class Method (class Foo { bar() {} })
    // 如果 LLM 传入了 "AuthController.login"，split 后变成 "login"，这里能找到它
    if (!targetNode) {
        const classes = sourceFile.getClasses();
        for (const cls of classes) {
            const method = cls.getMethod(searchName);
            if (method) {
                targetNode = method;
                break;
            }
            // 顺便支持静态方法
            const staticMethod = cls.getStaticMethod(searchName);
            if (staticMethod) {
                targetNode = staticMethod;
                break;
            }
        }
    }

    if (!targetNode) {
        throw new Error(`Function or symbol '${searchName}' (origin: '${functionName}') not found in ${targetFilePath}`);
    }

    // 5. 核心魔法：查找引用 (Find References)
    // 这就是 VS Code "Find All References" 的底层逻辑
    const references = targetNode.findReferencesAsNodes();

    const results = [];

    for (const ref of references) {
        const refSourceFile = ref.getSourceFile();
        const filePath = refSourceFile.getFilePath();

        // 排除定义本身（我们只关心谁调用了它）
        // 如果你想包含定义本身，把这个 if 去掉
        if (filePath === sourceFile.getFilePath() && ref.getStart() === targetNode.getNameNode().getStart()) {
            continue;
        }

        results.push({
            file: path.relative(projectRoot, filePath), // 转为相对路径方便阅读
            line: ref.getStartLineNumber(),
            column: ref.getStartLinePos(),
            // 获取引用所在的那一行代码文本，方便预览
            code: refSourceFile.getFullText().split('\n')[ref.getStartLineNumber() - 1].trim()
        });
    }

    // 6. 输出 JSON 给 Python
    console.log(JSON.stringify({
        status: "success",
        data: results,
        summary: {
            function: searchName, // 返回实际搜索的名称
            origin: functionName,
            file: path.relative(projectRoot, targetFilePath),
            totalReferences: results.length
        }
    }));

} catch (error) {
    // 捕获错误并以 JSON 格式输出，防止 Python 端解析失败
    console.log(JSON.stringify({
        status: "error",
        message: error.message,
        stack: error.stack
    }));
}