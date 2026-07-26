---
author: qinyi
created_at: 2026-07-27 01:45:01
type: sillyspec-tool-gotcha
status: active
---

# scan Step5 frontmatter 模板缺 author/created_at(与 Step11 检查项9 / CLAUDE.md 铁律冲突)

## 现象
`scan` 阶段 **Step5(深度扫描 7 份文档)** 的 prompt 给出的 frontmatter 模板只要求三个字段:
```yaml
---
source_commit: <git-head-short>
updated_at: <now-iso-datetime>
generator: sillyspec-scan
---
```
子代理严格按此模板写,产出的 scan 文档 frontmatter **不含 author 与 created_at**。

但同一阶段 **Step11(自检和提交)** 检查项9 明确要求:
> 检查 7 份文档 header 是否包含 author 和 created_at

且 `.claude/CLAUDE.md` 铁律也要求:
> 文档类型文件(.md/.yaml/.json 等)头部必须包含 author(git 用户名)和 created_at(精确到秒)

三处规范互相打架,子代理无所适从。

## 附带现象:scan 文档有两种 frontmatter 位置
子代理对 Step5 "每份 scan 文档第一行用 # 中文名" 与 "frontmatter 必须包含..." 两条指令有两种解读,产生两种格式:
- 格式 A(多数,约 24/28):frontmatter 在最前(第 1 行 `---`),标题在 frontmatter 之后。
- 格式 B(少数,4/28,见到的都是 CONVENTIONS/个别 ARCHITECTURE):标题在第 1 行(`# 中文名`),空行,frontmatter 在第 3 行 `---`。

两种都算"头部",补 author/created_at 时都要处理。

## 影响
每次全量 scan 都要在 Step11 事后用脚本批量给 4×7=28 份 scan 文档补 author/created_at,否则 Step11 自检不达标(最终状态不能写"全部通过")。

## 绕过方案(已验证 2026-07-27)
scan 写完后用脚本批量补,不要靠子代理自己加。脚本要兼容两种 frontmatter 位置——用 `s.find('---\n')` 定位 frontmatter 起始(而非 `s.startswith('---\n')`,否则漏掉格式 B):

```python
import os
projects = ['SillyHub','backend','frontend','sillyhub-daemon']
docs = ['ARCHITECTURE','CONVENTIONS','STRUCTURE','INTEGRATIONS','TESTING','CONCERNS','PROJECT']
author='qinyi'; created='2026-07-27 00:35:31'  # 本次 scan 时间
for p in projects:
    for d in docs:
        f=f'.sillyspec/docs/{p}/scan/{d}.md'
        if not os.path.exists(f): continue
        s=open(f,encoding='utf-8').read()
        idx=s.find('---\n')
        if idx<0: continue
        end=s.find('\n---', idx+4)
        block=s[idx:end] if end>0 else s[idx:idx+300]
        if 'author:' in block: continue  # 已有跳过
        s=s[:idx+4]+f'author: {author}\ncreated_at: {created}\n'+s[idx+4:]
        open(f,'w',encoding='utf-8').write(s)
```

## 建议工具修复
- Step5 的 frontmatter 模板补上 `author` 与 `created_at` 两字段(与 CLAUDE.md 铁律一致);或
- Step11 检查项9 改为只校验 source_commit/updated_at/generator(与 Step5 模板对齐)。
- 顺带:Step5 统一"标题第一行"与"frontmatter 位置"的指令,消除格式 A/B 分叉。
