const { Project, SyntaxKind } = require("ts-morph");
const path = require("path");

// 1. 初始化环境
const args = process.argv.slice(2);

if (args.length < 3) {
    console.error(JSON.stringify({
        error: "Usage: node analyzer2.js <projectRoot> <FileNameKeyword> <FunctionName> [MaxDepth]"
    }));
    process.exit(1);
}

const [projectRoot, fileKeyword, functionName, maxDepthStr = "3"] = args;
const MAX_DEPTH = parseInt(maxDepthStr);

// 2. 加载项目
const project = new Project({
    tsConfigFilePath: path.join(projectRoot, "tsconfig.json"),
});

const globalVisited = new Set(); // 全局记录访问过的节点 ID

/**
 * 递归追踪函数 (带去重和结构优化)
 */
function traceCallers(node, depth = 1) {
    if (depth > MAX_DEPTH) return null;
    // 安全检查：节点必须支持 findReferences
    if (typeof node.findReferences !== 'function') return null;
    // 唯一标识符：文件路径 + 节点起始位置
    const nodeId = `${node.getSourceFile().getFilePath()}:${node.getStart()}`;
    if (globalVisited.has(nodeId)) {
        return [{ name: "Circular/Repeated Reference", file: "N/A" }];
    }
    globalVisited.add(nodeId);

    const callersMap = new Map(); // 用于当前层的“函数@文件”去重
    const referencedSymbols = node.findReferences();

    for (const symbol of referencedSymbols) {
        for (const ref of symbol.getReferences()) {
            const refNode = ref.getNode();

            // 跳过 import 语句中的引用（import 不是真正的调用）
            if (refNode.getFirstAncestorByKind(SyntaxKind.ImportDeclaration)) continue;

            // 向上寻找父级环境 (函数、类方法、箭头函数、函数表达式、构造函数、变量声明)
            const callerFunc = refNode.getFirstAncestorByKind(SyntaxKind.FunctionDeclaration)
                || refNode.getFirstAncestorByKind(SyntaxKind.MethodDeclaration)
                || refNode.getFirstAncestorByKind(SyntaxKind.ArrowFunction)
                || refNode.getFirstAncestorByKind(SyntaxKind.FunctionExpression)
                || refNode.getFirstAncestorByKind(SyntaxKind.Constructor)
                || refNode.getFirstAncestorByKind(SyntaxKind.VariableDeclaration);

            // 如果找到了父级函数/声明
            if (callerFunc && callerFunc !== node) {
                // 确定名称和可追踪的节点（用于递归 findReferences）
                let name;
                let traceableNode = callerFunc; // 默认用 callerFunc 递归

                if (callerFunc.getKind() === SyntaxKind.ArrowFunction || callerFunc.getKind() === SyntaxKind.FunctionExpression) {
                    const parentVarDecl = callerFunc.getFirstAncestorByKind(SyntaxKind.VariableDeclaration);
                    name = parentVarDecl ? parentVarDecl.getName() : "anonymous";
                    // ArrowFunction/FunctionExpression 自身没有 findReferences，用父级 VariableDeclaration 递归
                    if (parentVarDecl) traceableNode = parentVarDecl;
                } else if (callerFunc.getKind() === SyntaxKind.Constructor) {
                    const parentClass = callerFunc.getFirstAncestorByKind(SyntaxKind.ClassDeclaration);
                    name = parentClass ? `${parentClass.getName()}.constructor` : "constructor";
                    // Constructor 自身没有 findReferences，用父级 ClassDeclaration 递归
                    if (parentClass) traceableNode = parentClass;
                } else {
                    name = (typeof callerFunc.getName === 'function') ? callerFunc.getName() : "anonymous";
                }
                const filePath = path.relative(projectRoot, callerFunc.getSourceFile().getFilePath());

                // 去重 Key：确保同一文件中的同一个函数不重复出现
                const uniqueKey = `${name}@${filePath}`;

                if (!callersMap.has(uniqueKey)) {
                    callersMap.set(uniqueKey, {
                        name: name || "anonymous",
                        file: filePath,
                        line: refNode.getStartLineNumber(),
                        // 递归进入下一层（使用可追踪的节点）
                        parentCallers: traceCallers(traceableNode, depth + 1)
                    });
                }
            }
            // Fallback: 模块顶层代码（没有任何函数/类包裹）
            else if (!callerFunc && refNode.getSourceFile() !== node.getSourceFile()) {
                const sourceFile = refNode.getSourceFile();
                const filePath = path.relative(projectRoot, sourceFile.getFilePath());
                const lineNumber = refNode.getStartLineNumber();
                const uniqueKey = `<top-level>@${filePath}`;

                if (!callersMap.has(uniqueKey)) {
                    callersMap.set(uniqueKey, {
                        name: "<top-level>",
                        file: filePath,
                        line: lineNumber,
                        parentCallers: null // 顶层代码无法继续向上追踪
                    });
                }
            }
        }
    }

    const results = Array.from(callersMap.values());
    return results.length > 0 ? results : null;
}

/**
 * 辅助：生成 Markdown 风格的树状预览（方便 LLM 阅读）
 */
function generateTreeText(callers, indent = "") {
    if (!callers) return "";
    return callers.map(c => {
        let line = `${indent}└── [${c.file}] ${c.name} (Line ${c.line})`;
        if (c.parentCallers) {
            line += "\n" + generateTreeText(c.parentCallers, indent + "    ");
        }
        return line;
    }).join("\n");
}

try {
    // 3. 智能寻找目标文件
    const sourceFile = project.getSourceFiles().find(f => f.getFilePath().includes(fileKeyword));
    if (!sourceFile) throw new Error(`找不到包含 "${fileKeyword}" 的文件`);

    // 4. 寻找起始节点
    const targetNode = sourceFile.getFunction(functionName)
        || sourceFile.getVariableDeclaration(functionName)
        || sourceFile.getDescendantsOfKind(SyntaxKind.MethodDeclaration).find(m => m.getName() === functionName);

    if (!targetNode) throw new Error(`在 ${sourceFile.getBaseName()} 中找不到 '${functionName}'`);

    // 5. 获取函数源码
    const startLine = targetNode.getStartLineNumber();
    const endLine = targetNode.getEndLineNumber();
    const functionSource = targetNode.getText();

    // 6. 执行追踪
    const callTree = traceCallers(targetNode);

    // 7. 输出结果
    const finalOutput = {
        status: "success",
        meta: {
            origin: functionName,
            file: path.relative(projectRoot, sourceFile.getFilePath()),
            lines: `${startLine}-${endLine}`,
            maxDepth: MAX_DEPTH
        },
        source: functionSource,
        data: callTree,
        preview: generateTreeText(callTree)
    };

    console.log(JSON.stringify(finalOutput, null, 2));

} catch (error) {
    console.log(JSON.stringify({ status: "error", message: error.message }));
}