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

    // 4. 找到目标函数 (支持 function 声明和 const 箭头函数)
    let targetNode = sourceFile.getFunction(functionName);
    
    if (!targetNode) {
        // 如果不是 function 关键字定义的，尝试找变量 (const App = () => ...)
        const variable = sourceFile.getVariableDeclaration(functionName);
        if (variable) {
            targetNode = variable;
        }
    }

    if (!targetNode) {
        throw new Error(`Function '${functionName}' not found in ${targetFilePath}`);
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
            function: functionName,
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

