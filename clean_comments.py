import os
import re


EXCLUDE_DIRS = {'node_modules', '.git', '.venv', 'dist', 'build'}
EXTENSIONS = {'.ts', '.js', '.css', '.html'}


def smart_decomment(text):
    # 1. 保护 URL：防止 https:// 被误删
    # 只要看到 :// 及其前后的非空字符，就先保护起来
    urls = []
    def save_url(m):
        urls.append(m.group(0))
        return f"___URL_{len(urls)-1}___"
    # 匹配 http://... 或 https://... 
    text = re.sub(r'https?://[^\s`\'"]+', save_url, text)

    # 2. 保护字符串（处理简单字符串和反引号）
    strings = []
    def save_str(m):
        strings.append(m.group(0))
        return f"___STR_{len(strings)-1}___"
    text = re.sub(r'(\".*?\"|\'.*?\'|`[\s\S]*?`)', save_str, text)

    # 3. 保护指令型注释和 Juice Shop 挑战标记
    protected = []
    def save_protected(match):
        protected.append(match.group(0))
        return f"___PROT_{len(protected)-1}___"
    
    # 增加对 vuln-code-snippet 的保护
    text = re.sub(r'//.*(?:@ts-|eslint-|vuln-code-snippet|snippet|#).*', save_protected, text)
    text = re.sub(r'/\*[\s\S]*?(?:eslint|vuln-code-snippet)[\s\S]*?\*/', save_protected, text)

    # 4. 清理真正无用的注释
    # 移除多行注释
    text = re.sub(r'/\*[\s\S]*?\*/', '', text)
    # 移除单行注释（注意：这里的 // 不再会伤到 URL，因为 URL 已经被占位了）
    text = re.sub(r'//.*', '', text)

    # 5. 还原内容（逆序还原，先还字符串和 URL）
    for i in range(len(strings)-1, -1, -1):
        text = text.replace(f"___STR_{i}___", strings[i])
    for i in range(len(protected)-1, -1, -1):
        text = text.replace(f"___PROT_{i}___", protected[i])
    for i in range(len(urls)-1, -1, -1):
        text = text.replace(f"___URL_{i}___", urls[i])
    
    return text

def run():
    processed_count = 0
    # 执行前建议先跑 git restore . 确保代码状态是完整的
    for root, dirs, files in os.walk('.'):
        dirs[:] = [d for d in dirs if d not in EXCLUDE_DIRS]
        for file in files:
            if any(file.endswith(ext) for ext in EXTENSIONS):
                path = os.path.join(root, file)
                try:
                    with open(path, 'r', encoding='utf-8') as f:
                        old_content = f.read()
                    new_content = smart_decomment(old_content)
                    if new_content != old_content:
                        with open(path, 'w', encoding='utf-8') as f:
                            f.write(new_content)
                        print(f"✅ 处理成功: {path}")
                        processed_count += 1
                except: pass
    print(f"\n🎉 最终清理完成！")


if __name__ == "__main__":
    run()