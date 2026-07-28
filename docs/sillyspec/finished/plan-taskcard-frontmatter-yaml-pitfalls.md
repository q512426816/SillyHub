# plan step4 TaskCard frontmatter YAML 三类坑（活跃）

> 记录于 2026-07-28，变更 `2026-07-28-llm-provider-presets-and-usage`（11 个 TaskCard）plan step4/5 实测。
> 性质：子代理生成 + 工具校验器的组合坑。工具侧（feasibility 校验不认流式 allowed_paths）待 sillyspec 修；子代理侧靠生成后批量校验兜底。

## 现象
plan step5 `sillyspec run plan`（CLI 自动 Wave 重排与可行性校验）报错阻断，信息误导：
- `blueprint consistency check failed: task-NN frontmatter 缺少 allowed_paths`
- `feasibility check failed: task-NN allowed_paths 为空`

实际根因往往不是 allowed_paths 没写，而是整个 frontmatter YAML 没解析出来 / 校验器只认特定风格。

## 三类根因 + 修法

### 1. 漏结尾 `---`（frontmatter 未闭合）
子代理只写开头 `---` 没写结尾 `---`。postcheck 提取不到 frontmatter，报「allowed_paths 缺失」。
- 诊断：`grep -c '^---$' tasks/task-NN.md` 应 == 2（开头+结尾）。
- 修：补 `printf '\n---\n' >> tasks/task-NN.md`。

### 2. 列表项值含 YAML 特殊字符
`implementation`/`acceptance`/`constraints`/`verify` 的列表项（`  - 文本`）是 plain scalar，含下列字符会 ScannerError：
- `: `（冒号+空格）→ 被当映射键，报 `mapping values are not allowed here`。典型：代码签名 `(provider_id: str)`、`queryUsage(id: string)`。
- `{ }`（流指示符）且内部含 `:` 或 `"` → 报 `expected <block end>, but found '}'`。典型：JS `{ method: "POST" }`、模板字面量 `${encodeURIComponent(id)}`。
- `" 未成对。
- 修：去掉冒号后空格（`provider_id:str`）或改成不含这些字符的中文描述。`goal: >` 折叠标量容忍 `{}`（因为它不是 plain scalar），所以 goal 里写 `{id}` 不炸。
- 注意：`{provider_id}`（大括号内无冒号）在 plain scalar 里**不炸**，只有含 `:`/`"` 的 `{...}` 才炸。

### 3. 流式 allowed_paths 不被 feasibility 校验识别
- `allowed_paths: [path]`（flow 风格）：blueprint 一致性校验**能过**（用 yaml 解析器），但 **feasibility 校验只认块式**，flow 风格读成空 → 报「allowed_paths 为空」。
- `allowed_paths:\n  - path`（block 风格）：两个校验都过。
- 修：allowed_paths 强制块式。`provides: []`/`provides: [{...}]`/`expects_from` 流式**不受影响**（blueprint 认），但仍建议块式统一。

## 兜底流程（生成后批量校验）
plan step4 子代理写完全部 task-NN.md 后，**先跑校验脚本再进 step5**（比让 postcheck 报错再来回高效）：

```bash
cd <项目根>
backend/.venv/Scripts/python.exe -c "
import yaml, glob, os
for f in sorted(glob.glob('.sillyspec/changes/<变更名>/tasks/task-*.md')):
    fm=open(f,encoding='utf-8').read().split('---',2)[1]
    try:
        d=yaml.safe_load(fm)
        ok = isinstance(d,dict) and d.get('allowed_paths')
        print(os.path.basename(f), 'OK' if ok else 'BAD')
    except Exception as e:
        ln=getattr(getattr(e,'problem_mark',None),'line',None)
        print(os.path.basename(f),'FAIL @line', (ln+1) if ln is not None else '?', str(getattr(e,'problem',e))[:50])
"
```

全 OK 后再 `sillyspec run plan --change <变更名>` 进 step5。若 step5 仍报「allowed_paths 为空」但脚本说 OK，多半是 #3 流式风格——把 allowed_paths 改块式即可。

## 待工具修复
- feasibility 校验（`plan-postcheck.js` 行 ~689）应像 blueprint 校验一样用 yaml 解析器读 allowed_paths，兼容 flow 风格，消除 #3 的不一致。
- step4 子代理 prompt 模板应提示：列表项值避免 `: `/`{}`/`"`，allowed_paths 用块式，frontmatter 必须结尾 `---`。
