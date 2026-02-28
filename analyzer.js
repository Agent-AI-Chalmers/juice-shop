const { Project, SyntaxKind } = require("ts-morph");
const path = require("path");


const args = process.argv.slice(2);

if (args.length < 3) {
    console.error(JSON.stringify({
        error: "Usage: node analyzer2.js <projectRoot> <FileNameKeyword> <FunctionName> [MaxDepth]"
    }));
    process.exit(1);
}

const [projectRoot, fileKeyword, functionName, maxDepthStr = "3"] = args;
const MAX_DEPTH = parseInt(maxDepthStr);


const project = new Project({
    tsConfigFilePath: path.join(projectRoot, "tsconfig.json"),
});

const globalVisited = new Set(); 


function traceCallers(node, depth = 1) {
    if (depth > MAX_DEPTH) return null;
    
    if (typeof node.findReferences !== 'function') return null;
    
    const nodeId = `${node.getSourceFile().getFilePath()}:${node.getStart()}`;
    if (globalVisited.has(nodeId)) {
        return [{ name: "Circular/Repeated Reference", file: "N/A" }];
    }
    globalVisited.add(nodeId);

    const callersMap = new Map(); 
    const referencedSymbols = node.findReferences();

    for (const symbol of referencedSymbols) {
        for (const ref of symbol.getReferences()) {
            const refNode = ref.getNode();

            
            if (refNode.getFirstAncestorByKind(SyntaxKind.ImportDeclaration)) continue;

            
            const callerFunc = refNode.getFirstAncestorByKind(SyntaxKind.FunctionDeclaration)
                || refNode.getFirstAncestorByKind(SyntaxKind.MethodDeclaration)
                || refNode.getFirstAncestorByKind(SyntaxKind.ArrowFunction)
                || refNode.getFirstAncestorByKind(SyntaxKind.FunctionExpression)
                || refNode.getFirstAncestorByKind(SyntaxKind.Constructor)
                || refNode.getFirstAncestorByKind(SyntaxKind.VariableDeclaration);

            
            if (callerFunc && callerFunc !== node) {
                
                let name;
                let traceableNode = callerFunc; 

                if (callerFunc.getKind() === SyntaxKind.ArrowFunction || callerFunc.getKind() === SyntaxKind.FunctionExpression) {
                    const parentVarDecl = callerFunc.getFirstAncestorByKind(SyntaxKind.VariableDeclaration);
                    name = parentVarDecl ? parentVarDecl.getName() : "anonymous";
                    
                    if (parentVarDecl) traceableNode = parentVarDecl;
                } else if (callerFunc.getKind() === SyntaxKind.Constructor) {
                    const parentClass = callerFunc.getFirstAncestorByKind(SyntaxKind.ClassDeclaration);
                    name = parentClass ? `${parentClass.getName()}.constructor` : "constructor";
                    
                    if (parentClass) traceableNode = parentClass;
                } else {
                    name = (typeof callerFunc.getName === 'function') ? callerFunc.getName() : "anonymous";
                }
                const filePath = path.relative(projectRoot, callerFunc.getSourceFile().getFilePath());

                
                const uniqueKey = `${name}@${filePath}`;

                if (!callersMap.has(uniqueKey)) {
                    callersMap.set(uniqueKey, {
                        name: name || "anonymous",
                        file: filePath,
                        line: refNode.getStartLineNumber(),
                        
                        parentCallers: traceCallers(traceableNode, depth + 1)
                    });
                }
            }
            
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
                        parentCallers: null 
                    });
                }
            }
        }
    }

    const results = Array.from(callersMap.values());
    return results.length > 0 ? results : null;
}


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
    
    const sourceFile = project.getSourceFiles().find(f => f.getFilePath().includes(fileKeyword));
    if (!sourceFile) throw new Error(`找不到包含 "${fileKeyword}" 的文件`);

    
    const targetNode = sourceFile.getFunction(functionName)
        || sourceFile.getVariableDeclaration(functionName)
        || sourceFile.getDescendantsOfKind(SyntaxKind.MethodDeclaration).find(m => m.getName() === functionName);

    if (!targetNode) throw new Error(`在 ${sourceFile.getBaseName()} 中找不到 '${functionName}'`);

    
    const startLine = targetNode.getStartLineNumber();
    const endLine = targetNode.getEndLineNumber();
    const functionSource = targetNode.getText();

    
    const callTree = traceCallers(targetNode);

    
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