---
author: qinyi
created_at: 2026-09-07 09:06:17
change: 2026-09-07-arch-large-file-split
---

# 符号影响面报告（Symbol Impact）— 三端会话域大文件架构拆分

> 结论先行：本变更为纯代码组织重构，**全部 17 个 task 均无既有签名的增删改**（设计 §7「零新增对外接口」+ D-006「导出面/公共签名逐一保持」）。逐 task 结论如下。

| task | 签名级变更 | 说明 |
|---|---|---|
| task-01 | 无签名级变更 | 只读对账产出基线文档，零代码改动 |
| task-02 | 无签名级变更 | SessionManager 公共方法签名逐一保持（类壳一行委托）；新增子模块符号均为文件内部实现细节，不经 facade 对外导出新面 |
| task-03 | 无签名级变更 | TaskRunner 同上；facade `export` 符号集合与现状完全一致 |
| task-04 | 无签名级变更 | payload-utils/event-wire/dialogResult 收敛为新增内部共享符号；两 god 文件的既有导出符号（strOf/numOf/pickStr 族为模块私有或经原路径导出者）保持原导出形态，内部实现改为转发 |
| task-05 | 无签名级变更 | 验收门，零代码改动 |
| task-06 | 无签名级变更 | 只读对账产出基线文档 |
| task-07 | 无签名级变更 | router/ 包替代 router.py 模块，`from app.modules.daemon.router import router` 等导入语句与符号（router、get_daemon_latest_version 等）原样可用；83 端点装饰器与响应模型逐一保持 |
| task-08 | 无签名级变更 | session/service/ 包 `__init__` 导出符号 ⊇ 现有被引用集（含 6 个私有符号）；SessionService 公共方法签名保持；被 patch 符号经包命名空间延迟解析（D-007，属调用方式约定非签名变更） |
| task-09 | 无签名级变更 | GroupChatService 及模块级公共符号（group_chain_key/run_cross_mention_detection 等）签名与导出保持 |
| task-10 | 无签名级变更 | RunSyncService 及模块级公共符号（publish_session_event/publish_bash_chunk_event/resolve_group_member_identity 等）签名与导出保持 |
| task-11 | 无签名级变更 | _background_tasks/event_publish/attachment_pipeline 为新增内部共享模块；两个 Service 的 `_fire_background_task` 等改为 mixin 继承获得，签名不变 |
| task-12 | 无签名级变更 | 验收门，零代码改动 |
| task-13 | 无签名级变更 | 只读对账产出基线文档 |
| task-14 | 无签名级变更 | session-panel/index 再导出 7 符号（SessionPanel/SessionPanelProps/SessionPreContext/BashProgressState/applyBashStatusEvent/appendBashChunk/applyAgentTaskStatusEvent）与现状完全一致 |
| task-15 | 无签名级变更 | lib/daemon/index 全量再导出（187 条 export 原样），`@/lib/daemon` 导入面零变化 |
| task-16 | 无签名级变更 | 验收门，零代码改动 |
| task-17 | 无签名级变更 | 模块文档同步与汇总，源码零改动 |

受影响调用点核对结论：所有消费方（daemon 62+23 个引用、backend 74/42/24/27 条 import、frontend 140 条 import + 55 处 vi.mock + 157 处 patch 目标）的导入语句与拦截目标**零改动**（设计 §5/§7/§9，D-004/D-006/D-007），均在任务范围内以「兼容层」机制覆盖，无需修改任何调用点代码。
