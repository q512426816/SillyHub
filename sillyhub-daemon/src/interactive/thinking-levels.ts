// src/interactive/thinking-levels.ts
// 2026-09-14-session-thinking-level task-02（FR-02 / D-002@v1 / design「接口定义」）：
// 思考强度档位**共享单源**——七档词表 THINKING_LEVELS + 平台档位→引擎档位映射
// 矩阵 mapPlatformLevelToEngine + 平台词表校验 isValidPlatformLevel。消费方：
// task-03（daemon RPC 归一化/守卫）与 task-04（三 driver 启动/切换设置）统一
// import 本模块，档位串永远一处定义，各层不自拼。
//
// 单源镜像关系：本文件是七档词表与降级规则的唯一维护源（daemon 单源）；
// frontend 预会话态静态七档下拉镜像（design Grill P0-2 定案）与 backend 校验
// 词表为手工镜像——三端档位集合与顺序必须逐项一致（前端 mirror 归 task-06、
// backend 校验归 task-05，两侧注释均须回指本文件，不许各说各话）。
//
// ⚠️ off 语义差异（design Grill P2-11 口径，前端 off 档「默认」tooltip
// （task-06）与 onboarding 文档（task-07）同源引用此注释）：
//   - pi：off = **真关思考**（引擎停止思考，七档之一，rpc.md:281-295）；
//   - claude：off = **不设 effort**（本函数返回 undefined，调用方不携带
//     effort 字段）= 引擎默认——Claude 引擎默认思考通常开，**off 并非关闭**；
//   - codex：off = 不设 reasoningEffort（同返回 undefined，引擎默认，非关闭）。
//   同为「平台 off」但跨引擎语义不同：前端 off 显示「默认」时 tooltip 必须说明
//   此差异（claude/codex 的默认≠pi 的真关）。
//
// R-05 应对：词表与矩阵为**纯数据**——真机三引擎验证不符时只改矩阵一格 +
// 单测同步，机制不动；未知 provider 一律返回 undefined（不猜测直传）。
//
// 模块零依赖（不 import 任何其他源文件，含 driver/session-manager）：纯常量 +
// 纯函数零副作用，避免环依赖（消费方归 task-03/04）。

/**
 * 平台统一思考档位词表（七档，顺序锁定 off→max，design FR-02 接口定义原文）。
 *
 * 前端静态下拉镜像与 backend 校验词表必须与此处逐项一致（含顺序）；
 * 顺序由 tests/interactive/thinking-levels.test.ts 锁定（防三端词表漂移）。
 */
export const THINKING_LEVELS = [
  'off',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
] as const;

/** 平台档位便利类型（七档字面量联合；task-03/04 消费方入参收窄用）。 */
export type ThinkingLevel = (typeof THINKING_LEVELS)[number];

/**
 * 平台词表校验守卫（窄化 `level is ThinkingLevel`）。
 *
 * daemon RPC 归一化（task-03）与 backend 镜像校验共用语义：仅接受词表内
 * 精确匹配（大小写敏感，'HIGH'/'高' 等变体一律 false）。
 */
export function isValidPlatformLevel(level: string): level is ThinkingLevel {
  return (THINKING_LEVELS as readonly string[]).includes(level);
}

/**
 * 平台档位 → 引擎档位映射矩阵（纯数据单源，R-05：真机不符只改一格+单测同步）。
 *
 * 单元格 undefined 语义 = 调用方**不携带**档位字段（claude 不设 options.effort /
 * codex 不设 reasoningEffort），由引擎取默认——与 pi 的 'off' 直传（真关思考）
 * 语义不同，详见文件头「off 语义差异」。
 *
 * 逐引擎依据（调研锚点）：
 * - claude（SDK 0.3.247 EffortLevel 五档 low/medium/high/xhigh/max，
 *   sdk.d.ts:1735）：off→undefined（不设 effort=引擎默认思考通常开，P2-11）、
 *   minimal→low 降级（EffortLevel 无 minimal 档）、其余五档直传；
 * - pi（0.81.1 rpc set_thinking_level 七档，rpc.md:281-295）：七档全直传
 *   （off=真关思考）；
 * - codex（0.147.0 二进制枚举实证 minimal/low/medium/high/xhigh）：
 *   off→undefined（不设 reasoningEffort=引擎默认）、max→xhigh 降级（枚举无
 *   max 档）、其余五档直传；
 * - cursor（caps.thinking_level=false，CLI 无思考档位通道）：七档全
 *   undefined——已注册引擎显式声明无通道（与未知 provider 的 undefined 同形，
 *   但语义是「已注册无通道」而非「未注册」；未来 CLI 增通道只改本条目+单测）。
 */
const ENGINE_LEVEL_MATRIX: Record<string, Record<ThinkingLevel, string | undefined>> = {
  claude: {
    off: undefined, // 不设 effort = 引擎默认思考（通常开），非真关（P2-11）
    minimal: 'low', // 降级：EffortLevel 五档无 minimal（sdk.d.ts:1735）
    low: 'low',
    medium: 'medium',
    high: 'high',
    xhigh: 'xhigh',
    max: 'max',
  },
  pi: {
    off: 'off', // 真关思考（rpc.md:281-295 七档之一；与 claude 语义差异见文件头）
    minimal: 'minimal',
    low: 'low',
    medium: 'medium',
    high: 'high',
    xhigh: 'xhigh',
    max: 'max',
  },
  codex: {
    off: undefined, // 不设 reasoningEffort = 引擎默认，非真关（P2-11）
    minimal: 'minimal',
    low: 'low',
    medium: 'medium',
    high: 'high',
    xhigh: 'xhigh',
    max: 'xhigh', // 降级：0.147 二进制枚举五档无 max
  },
  cursor: {
    // caps.thinking_level=false——cursor CLI 无思考档位通道，七档全 undefined。
    off: undefined,
    minimal: undefined,
    low: undefined,
    medium: undefined,
    high: undefined,
    xhigh: undefined,
    max: undefined,
  },
};

/**
 * 平台档位映射到引擎档位（FR-02 矩阵入口）。
 *
 * 返回引擎侧档位串（直传/降级后）；undefined = 调用方不携带档位字段
 * （claude/codex 的 off、未知 provider、非法 level、无通道引擎）。
 * 未知 provider 一律 undefined，不猜测直传（R-05 约束）。
 */
export function mapPlatformLevelToEngine(
  provider: string,
  level: string,
): string | undefined {
  const row = ENGINE_LEVEL_MATRIX[provider];
  if (row === undefined) {
    return undefined;
  }
  // 非法 level（词表外任意串）矩阵落空 → undefined，与不携带同形。
  return row[level as ThinkingLevel];
}
