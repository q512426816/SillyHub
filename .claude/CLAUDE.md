# CLAUDE.md

本项目使用 **SillySpec**，采用文档驱动开发。
所有变更必须以稳定、可用、可维护为目标，按生产级项目标准处理。

## 核心规则

1. 禁止绕过本文件规则和 SillySpec 流程。
2. 修改代码前，必须先说明依据的文档路径或现有代码依据。
3. 新功能 / 大改动必须走完整 SillySpec 流程技能：`brainstorm → plan → execute → verify → archive`。
4. 小修复 / 小调整走 SillySpec quick 技能：`sillyspec run quick`。
5. 执行顺序：文档 → 读代码 → 写测试 → 写实现 → 跑测试 → 验收 → 更新文档。 
6. 中途停下用 `sillyspec status` / `sillyspec resume` 存进度，不直接 commit 半成品。
7. 禁止无依据改代码，禁止先随意实现再补文档。 
8. 实现完成后必须对照文档验收，并检查是否影响已有测试。 
9. 非测试逻辑本身有误时，禁止直接修改测试来“通过”。 
10. hook 拦截提交时，禁止跳过；必须修复问题后再提交。 
11. 本项目未正式上线，允许重置开发 / 测试数据，不要求历史兼容。 （PPM模块已上线，其余暂未上线）
12. UI 和文档默认使用中文，必要专业术语除外。 
13. 代码实现必须兼容 Windows、Linux 和 macOS。 
14. 不要奉承用户，禁止回复“你说得对”这类无意义话术；直接给结论、依据和方案。 
15. 发现 SillySpec 工具缺陷或改进点，记录到项目根目录 `docs/sillyspec/`（活跃坑，待工具修复）；已处理好的（工具已修复 / 确认绕过方案 / 确认不会再踩）再移到 `docs/sillyspec/finished/`。
16. 用户不太懂代码，尽量使用正常人员能看懂的描述。 
17. 本项目代码可能随时在修改
18. 注释和实现不一致是万恶之源，遇到不一致的要及时修正
19. SillySpec 任务记录是隔离的
    - **永不重置 / reset / 清零已存在的 change**。多个活跃 change 各自 `--change <名>` 隔离,不重叠。代码不重叠 = 新 `--change`,不是清旧 change。
    - quick:同一 QUICKLOG 文件按 ql-ID 条目追加,不是单槽位,不冲突。
20. 前端样式统一参考：
  * `.sillyspec/changes/archive/2026-06-21-2026-06-21-frontend-style-system/prototype-frontend-style-system.html`（设计系统总纲·原型）
  * `.sillyspec/changes/archive/2026-06-21-2026-06-21-frontend-style-system/design.md`（设计系统总纲·设计决策）
  * `.sillyspec/docs/SillyHub/scan/FRONTEND_PAGE_STYLE.md`（页面级实现规范，改其它页面照这个）
21. 前端接口类型（`frontend/src/lib/api-types.ts`）必须从后端 OpenAPI 生成（`pnpm gen:types`），禁止手写：
  * 后端 schema（DTO/请求/响应）有改动时，同一 quick/change 内必须跑 `pnpm gen:types` 并提交 `api-types.ts` + `backend/openapi.json`，不让类型落后后端形成债；
  * **gen:types 前先确认前端 node_modules 健康**（`pnpm exec tsc --version` 能跑、`.bin` 有 shim）：node_modules 半坏会报一堆**假的** `CSSProperties 不存在某属性` / `Cannot find module '@ant-design/icons'`（根因是缺间接依赖 csstype 等），误判成代码问题。修复 `pnpm install --force`（普通 install 可能命中缓存不修）；
  * 若 gen:types 暴露了与本次改动**无关**的旧测试债（如 mock 缺某字段），按惯例顺手补字段修好，而不是为躲报错改回手写。
22. **SillySpec CLI 一律在主仓库根目录跑,永不 `cd` 进 worktree**（`cd` 会让 sillyspec 把当前目录当成独立项目实例,写出与主仓库分裂的进度库 / artifact / QUICKLOG）；需要在 worktree 或子目录读代码时用绝对路径或 `git -C <path>`，不切换工作目录。


## 完成汇报格式 （子代理不必这样汇报，按主代理要求的格式即可）

每次执行完成后，最终回复必须以固定短语开头：

`爸爸~爸爸~[YYYY-MM-DD HH:mm:ss]：`

要求：使用本地时间，格式示例 2026-06-24 15:08:36，不得改写或省略。

随后按以下结构汇报：

* 改了什么；
* 依据是什么；
* 影响哪些模块；
* 跑了哪些测试；
* 是否需要同步文档；
* 是否还有风险或遗留问题。
* 如果有建议的下一步，把对应新session提示词写下。
* 如果本次操作使用到sillyspec工具，总结下工具使用效果，特别是驾驭能力，正面，负面都可以讲讲，我要持续改进
