/**
 * TextAdapter —— antigravity（agy CLI）纯文本 stdout 协议的 adapter 实现。
 *
 * 协议语义：
 *   antigravity 的 stdout 是逐行纯文本（无结构化事件 / 无 JSON）。
 *   每条非空（trim 后非空）行即一条 text 事件；空行被丢弃。
 *
 * Python 源对照：
 *   sillyhub_daemon/backends/text.py:85-102  parse_line —— 本文件 parse 的 1:1 迁移
 *   sillyhub_daemon/backends/text.py:41      provider = "antigravity"
 *
 * 方案B 拆分（design.md §5.1）：
 *   Python 版 TextBackend 同时承担「执行子进程」（execute）+「解析输出」（parse_line）
 *   +「累积 output」（_state.output）。Node 版拆开——
 *     - 子进程执行 → task-19 TaskRunner 单点；
 *     - output 累积 → task-19 TaskRunner 累积事件 content；
 *     - 本 adapter 只保留纯解析职责：parse(line) → AgentEvent[]。
 *   因此本类无实例状态（除了 readonly provider）。
 *
 * complete 事件判定（关键）：
 *   本 adapter 不主动产出 complete 事件。Python text.py 的 parse_line 同样只产 text，
 *   终态（completed/failed/timeout）由 execute() 内的 proc.wait() 获得，不经 parse_line。
 *   Node 版由 task-19 TaskRunner 在子进程退出回调中据 exit code 合成 complete/error 事件。
 *
 * @see design.md §5.1（方案B 拆分）/ §7.2（ProtocolAdapter 接口）/ §7.3（PROTOCOL_PROVIDERS）
 */

import type { AgentEvent } from '../types.js';
import type { ProtocolAdapter } from './protocol-adapter.js';

/**
 * antigravity 纯文本协议 adapter。
 *
 * 无状态：每次 parse 调用互不影响，相同输入永远相同输出。
 * 多个 lease 可共享同一个 TextAdapter 实例（task-11 工厂可缓存单例）。
 */
export class TextAdapter implements ProtocolAdapter {
  /**
   * provider 标识，必须与 PROTOCOL_PROVIDERS.text 数组中的值逐字一致。
   * 对照 Python text.py:41 `provider: str = "antigravity"`。
   */
  readonly provider = 'antigravity' as const;

  /**
   * antigravity (agy CLI) 启动参数占位（ql-20260617-008）。
   *
   * 当前本机无 agy 二进制可用，返回空数组——agent-detector 应已标 offline，
   * daemon 不会接到 antigravity lease。待 agy CLI 上线后此处补全启动参数。
   *
   * 常见 agy 启动模式（参考其他 text-protocol CLI）：
   *   - `--print` / `-p`：非交互模式
   *   - `--no-color`：纯文本输出
   *   - prompt 走 stdin（默认 buildInput `${prompt}\n`）
   */
  buildArgs(_opts?: {
    model?: string;
    sessionId?: string;
    resumeSessionId?: string;
    prompt?: string;
  }): string[] {
    return [];
  }

  /**
   * 解析一行 antigravity stdout。
   *
   * 行为（对齐 Python text.py:85-102 parse_line）：
   *   1. line.trim() 得到 stripped；
   *   2. stripped === '' → 返回 null（该行被主动丢弃，不产事件）；
   *   3. stripped !== '' → 返回 [{ type: 'text', content: stripped }]。
   *
   * content 用 trim 后的值（与 Python content=stripped 一致），前导/尾随空白被去除。
   * trim 同时吃掉残留的 \r / \n（B-03 双保险：readline 已去行尾，trim 兜底）。
   *
   * @returns 单元素数组（非空行）或 null（空/纯空白行）；永不返回 complete/error 类型事件
   */
  parse(line: string): AgentEvent[] | null {
    const stripped = line.trim();
    if (stripped === '') {
      return null; // B-01/B-02：空行 / 纯空白
    }
    return [{ type: 'text', content: stripped }];
  }
}
