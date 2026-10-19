"""嵌入子进程 worker（change 2026-10-16-backend-mem-polling task-01 / D-001@v1）。

模型加载在独立子进程内完成（主进程零 fastembed/ONNX 常驻），主进程经
``vector_search.EmbeddingSubprocessProxy`` 与本进程按行协议通信：

- 请求（单行 JSON）：``{"id": int, "op": "embed", "texts": [str, ...]}``
- 响应（单行 JSON）：``{"id": int, "ok": true, "vectors": [[float, ...], ...]}``
  或失败 ``{"id": int, "ok": false, "error": str}``

三闸自灭（进程退出 = 内存确定性归还 OS）：

1. 闲置闸：``idle_exit_sec``（主进程注入，默认 900s）无请求主动退出；
2. 父进程闸：stdin EOF（父死亡/管道关闭）立即退出——父环境消失后靠本闸自灭，
   不依赖 spawn 侧环境变量；
3. 硬寿命帽：连续运行 ``WORKER_MAX_LIFETIME_SEC``（3600s）无条件退出。

启动即把自身 ``oom_score_adj`` 重置为 0（子进程会继承父进程的保护分，必须显式
重置；Windows/macOS 无 /proc → fail-soft 跳过）。stdin 等待用读线程 + 队列
（Windows 管道无 select，跨平台唯一解）。

命令行：``python -m app.modules.knowledge.embedding_worker <model_name> [idle_exit_sec]``
"""

from __future__ import annotations

import json
import queue
import sys
import threading
import time

WORKER_MAX_LIFETIME_SEC = 3600.0

_EOF = object()  # 读线程 stdin 结束哨兵


def _reader_thread(stdin: object, out: queue.Queue) -> None:
    """逐行读 stdin 入队；EOF/异常入哨兵（daemon 线程，进程退出不阻塞）。"""
    try:
        for line in stdin:
            out.put(line)
    except Exception:  # 管道断裂等一律按 EOF 处理
        pass
    finally:
        out.put(_EOF)


def _reset_oom_score() -> None:
    """把自身 oom_score_adj 重置为 0（容器 OOM 时优先牺牲本子进程而非主进程）。

    Windows/macOS 无 /proc——写入失败仅跳过（fail-soft，三平台兼容）。
    """
    try:
        with open("/proc/self/oom_score_adj", "w") as f:
            f.write("0")
    except OSError:
        pass


def _embed_once(model: object, texts: list[str]) -> list[list[float]]:
    """单次嵌入：texts → 向量列表（numpy 数组元素逐个转 float）。"""
    out: list[list[float]] = []
    for vec in model.embed(texts):
        out.append([float(x) for x in vec])
    return out


def main(argv: list[str] | None = None) -> int:
    args = list(sys.argv[1:] if argv is None else argv)
    if not args:
        print(json.dumps({"id": None, "ok": False, "error": "model_name required"}))
        return 2
    model_name = args[0]
    try:
        idle_exit_sec = float(args[1]) if len(args) > 1 else 900.0
    except ValueError:
        idle_exit_sec = 900.0

    _reset_oom_score()

    from fastembed import TextEmbedding  # lazy import：缺席时主进程 fail-soft 降级

    model = TextEmbedding(model_name=model_name)

    lines: queue.Queue = queue.Queue()
    threading.Thread(target=_reader_thread, args=(sys.stdin, lines), daemon=True).start()
    started = time.monotonic()
    last_active = started
    while True:
        now = time.monotonic()
        if now - last_active >= idle_exit_sec:  # 闸 1：闲置
            break
        if now - started >= WORKER_MAX_LIFETIME_SEC:  # 闸 3：硬寿命帽
            break
        timeout = max(0.05, min(1.0, idle_exit_sec - (now - last_active)))
        try:
            item = lines.get(timeout=timeout)
        except queue.Empty:
            continue
        if item is _EOF:  # 闸 2：父进程消失
            break
        last_active = time.monotonic()
        req_id = None
        try:
            req = json.loads(item)
            req_id = req.get("id") if isinstance(req, dict) else None
            if not isinstance(req, dict) or req.get("op") != "embed":
                raise ValueError(f"unknown op: {req.get('op') if isinstance(req, dict) else req!r}")
            texts = req["texts"]
            if not isinstance(texts, list) or not all(isinstance(t, str) for t in texts):
                raise ValueError("texts must be list[str]")
            resp = {"id": req_id, "ok": True, "vectors": _embed_once(model, texts)}
        except Exception as exc:  # 单请求失败不断进程（下一条照常）
            resp = {"id": req_id, "ok": False, "error": f"{type(exc).__name__}: {exc}"}
        sys.stdout.write(json.dumps(resp, ensure_ascii=False) + "\n")
        sys.stdout.flush()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
