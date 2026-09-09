
## ql-20260909-014-e462 | 2026-09-09 13:21:48 | change-write 回执等待改 Redis pubsub 即时唤醒+短会话兜底轮询
状态：已完成
关联变更：（无）
文件：
- backend/app/modules/change_writer/proxy.py（publish helper+waiter 重写）
- backend/app/modules/daemon/change_write_router.py（complete 后 publish）
- backend/tests/modules/change_writer/test_receipt_wait.py（三用例）
需求：change-write 回执等待改 Redis pubsub 即时唤醒+短会话兜底轮询
根因：原 0.5s×120 次请求 session refresh 长轮询占满请求级连接池槽 60s
方案：complete 端点 commit 后 publish；等待方 pubsub 唤醒+2s 短会话 DB 兜底；等待期请求 session 零语句
结果：test_receipt_wait 三用例全绿；change_writer+daemon 域 82 passed；ruff/mypy 0 错；已提交 c04ec8478

## ql-20260909-015-5caf | 2026-09-09 13:28:47 | 工作台待办分页有界化——三源 COUNT+合并偏移窗口切片+列投影，defect_count LIKE 对齐 data_scope 裸列形态
状态：进行中
关联变更：（无）
文件：（见实际改动）
