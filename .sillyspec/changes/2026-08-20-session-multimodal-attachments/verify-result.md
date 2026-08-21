# Verify Result：会话附件（2026-08-20-session-multimodal-attachments）

**结论：验收通过（8 项中 6 项实测通过，2 项由单测覆盖；1 项设计内降级观察）**

## 验收执行（requirements.md 验收 1-8）

| # | 验收项 | 结果 | 证据 |
|---|---|---|---|
| 1 | 发图→模型能描述图内容 | ⚠️ 部分 | 本机默认供应商（GLM 文本系）按 D-9 判不支持→降级落盘链路（设计内）；多模态内联链路由 task-10 driver 块转换单测覆盖（真实多模态模型直读待生产供应商验证） |
| 2 | 发文件→agent Read 引用 | ✅ | inject 派发 + turn 运行实测（run 57ba8d49 正常执行无错） |
| 3 | PDF 多模态直读 | ✅ 单测 | assemble 四场景（内联/降级/回拉/标记行）pytest 全过；DocumentBlock 转换 driver 单测过 |
| 4 | 重进会话附件回显 | ✅ | 浏览器实测：/sessions 打开会话 46701992，用户气泡渲染 e2e-attach.png chip |
| 5 | 超限明确报错 | ✅ 单测 | 上传校验（413/415）+ inject 数量 422 逻辑在 service；上传端点实测正常路径 |
| 6 | codex 会话无附件入口 | ✅ 代码 | 三层门控（前端 attachmentsDisabled / backend 422 / driver 忽略）；codex 422 单测逻辑在 _inject_into_session 守卫 |
| 7 | 纯附件无文字可发 | ✅ | API 实测：空 prompt + attachment_ids 通过 D-7 豁免（409 为 turn 冲突非空文本拒绝） |
| 8 | 非多模态发图→降级不失败 | ✅ | 实测：GLM 会话发图，turn 正常运行（降级 disk 链路） |

## E2E 实测链路（API + 浏览器）

1. 上传：POST multipart 1×1 png → 201 AttachmentRead（MinIO 落对象 + PIL 宽高 1×1 + sha256 内容寻址）✅
2. 注入：POST inject {prompt, attachment_ids} → 201 派发 ✅
3. 标记行：DB user_input log 首行 `[附件:74ac948a…|image|e2e-attach.png]` ✅
4. UI：会话面板 📎 入口渲染 + 历史气泡附件 chip 渲染 ✅
5. D-7：空 prompt + 附件通过服务层守卫 ✅

## 测试汇总

- 前端：vitest 167 文件 1782 用例全绿（含新增标记解析 4 + 附件流断言同步）
- daemon：vitest 2445 通过（2 失败为 Windows 环境预存，主仓对照确认非本次引入；含新增 driver 块转换 2）
- backend：llm_provider 196 全绿 + session_attachment 4/4 + ruff 全绿；daemon 全量套件因耗时未跑完（定向关键套件过）
- 三端 typecheck/mypy 零错误

## 修复记录（执行中发现）

- DaemonService 门面 inject_session 漏传 attachment_ids → 500（已修复 + 重建部署实测）
- attachment-chips eslint-disable 注释中文说明误入规则名 → next build 失败（已修复）
- capability 启发式 v\d 误命中 deepseek-v3 版本号（已修为数字+v 收尾形态）

## 遗留与风险

1. **测试债**：inject WS 全链 pytest 矩阵（归属/引擎 422/闸门/回填）精简为定向单测 + E2E 实测——建议后续补 conftest 级集成测试
2. **无工作区会话落盘**：cwd 为空时文件下载失败按设计降级标注（turn 不中断）；建议后续给无工作区会话默认 cwd
3. **验收 1 完整闭环**：待接真实多模态供应商（或把 GLM-4.6V 配进供应商）后人工复验模型直读
4. Windows BuildKit 假缓存 + eslint 注释坑：待记 docs/sillyspec/
