
## ql-20260919-001-25c7 | 2026-09-19 05:49:45 | update_entry 坏编码守卫——网页编辑非 UTF-8 文件不再静默毁坏 + probe docstring 勘误
状态：已完成
关联变更：（无）
文件：
- backend/app/modules/knowledge/writer.py（_decode_knowledge_strict 共享 helper + update_entry 坏编码守卫）
- backend/app/modules/knowledge/tests/test_writer.py（新增 TestUpdateEncodingGuard 2 用例（守卫先红后绿+对照组））
- backend/app/modules/workspace/router.py（probe_workspaces docstring 勘误）
- .sillyspec/docs/SillyHub/modules/knowledge.md（注意事项截断坏编码口径三合一 + ql-20260919-001 增量）
- .sillyspec/docs/multi-agent-platform/modules/backend.changelog.md（变更索引新条目）
需求：update_entry 坏编码守卫——网页编辑非 UTF-8 文件不再静默毁坏 + probe docstring 勘误
根因：ql-20260918-005 只把 merge 回写路径 _read_raw 收口为严格解码，网页编辑链 GET 基底仍来自 parser._read_file_safe 的 errors=replace，坏编码文件（Windows GBK 残留）保存整文件替换即毁坏原字节且 update 不进 spec-backups；probe docstring 则是 ql-20260918-012 加 repo_url 回填写副作用时漏改前段只读表述（24h 审查 M1 残余缺口 + L1）
方案：writer.py 新增模块级 _decode_knowledge_strict 共享 helper（_read_raw 内联严格解码收敛进来，错误形态单一来源），update_entry 大小守卫后对磁盘原文严格解码探测（≤1MB，结果弃用只探测），坏编码抛既有 KnowledgeFileEncodingInvalid 422（details 带 byte_offset，文件与 manifest 版本不动）；router.py docstring 改为不改生命周期状态（唯一写例外 repo_url 回填）
结果：test_writer 27 全绿（新增 2 例先红后绿——坏编码 422+GET 基底含 U+FFFD 前置自检+磁盘原字节与 manifest 版本未动、合法 UTF-8 中文对照组不误伤）+ 相邻面 test_router/test_parser/test_distill 72 绿；ruff check/format 3 文件净、mypy scoped 0；docs gate 405=基线 405 放行
审计：[gate] L1（跨 0 模块 · 5 文件：2 代码/1 测试）advisory；每文件注记已全覆盖；测试增量已含
