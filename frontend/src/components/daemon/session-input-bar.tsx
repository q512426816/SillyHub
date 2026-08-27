"use client";

/**
 * task-13（2026-08-14-sessions-portal / FR-05 / D-002@v1）：会话输入区共享子组件。
 *
 * 从 interactive-session-panel.tsx 纯机械抽取（弹窗零回归，NG-04/D-002）：
 *   - 输入框（Enter 发送 / Shift+Enter 换行）
 *   - 发送按钮（creating 态转 spinner）
 *
 * 2026-08-20-session-multimodal-attachments task-12：附件流——📎 选文件即传
 * （FR-1/FR-3）、chips 预览可删（缩略图/文件名+大小）、发送守卫带附件豁免空
 * 文本（D-7）、attachmentsDisabled 门控（codex 引擎 D-6）、降级提示条（FR-10
 * D-9：当前供应商 multimodal 判不支持 → 图片将落盘供 agent 工具读）。
 *
 * ql-20260825-006：输入框支持 Ctrl+V 粘贴剪贴板图片/文件——textarea onPaste 读
 * clipboardData.files，非空则拦截默认插入并复用 handleFiles 上传管线（与 📎 完全
 * 等价，含 attachmentsDisabled 门控与 10 个上限）；纯文本粘贴走默认行为不受影响。
 *
 * task-03（2026-08-26-session-input-mention / FR-01..03 / FR-08 / D-002 / R-2 /
 * R-3）：联想接入——onChange 读 selectionStart 调 detectMention（task-01）驱动
 * 浮层（task-02 SessionMentionPopover），IME 组合保护，选中按 invoke_name ??
 * name / change_key / ql_id 回填并延迟复位光标，@ 选中经 onMentionsChange 回传
 * 结构化选中（change/quick 两槽位、同类型后选覆盖先选；父级发送组装归 task-05）。
 * placeholder prop 保持父级传入不动（文案更新归 task-05）。
 *
 * 本组件无弹窗上下文依赖，/runtimes 弹窗与 /sessions 新页面均可独立 import 组装。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AtSign,
  FileText,
  Image as ImageIcon,
  Paperclip,
  Plus,
  RefreshCw,
  Send,
  Sparkles,
  Users,
  X,
} from "lucide-react";
import { Button } from "antd";

import {
  removeSessionAttachment,
  uploadSessionAttachment,
  type AttachmentRead,
} from "@/lib/api/session-attachments";
import {
  SessionMentionPopover,
  buildAtMentionItems,
  buildSlashMentionItems,
  filterMentionItems,
  handleMentionKeyDown,
  type SessionMentionItem,
} from "./session-mention-popover";
import {
  applyMentionPick,
  detectMention,
  sanitizePpmInsertKey,
  type MentionDetection,
} from "@/lib/session-mention";
import { useMentionSources, type PpmMentionScope } from "@/lib/session-mention-sources";
import type { PpmItemKind } from "@/lib/daemon";

/* ── ql-20260826-010：输入框高度拖拽调节（全局持久化）────────────────────── */

/** localStorage key（先例 sillyhub.sessions.* 前缀；高度是全局偏好不分会话）。 */
const INPUT_HEIGHT_LS_KEY = "sillyhub.sessions.inputBarHeight";
/** 下限 = 默认单行高度 min-h-11（44px）；上限固定 480px 与视口 60% 取小。 */
const INPUT_HEIGHT_MIN = 44;
const INPUT_HEIGHT_MAX = 480;

/** 回读持久化高度（SSR / 无值 / 非法值 → null 走默认自适应）。 */
function readPersistedInputHeight(): number | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(INPUT_HEIGHT_LS_KEY);
    const n = raw == null ? Number.NaN : Number(raw);
    return Number.isFinite(n)
      ? Math.min(INPUT_HEIGHT_MAX, Math.max(INPUT_HEIGHT_MIN, Math.round(n)))
      : null;
  } catch {
    return null;
  }
}

/**
 * task-03：@ 联想结构化选中（onMentionsChange 载荷，design §3.3）。
 * change/quick 两槽位独立、同类型后选覆盖先选；父级（task-05）随发送组装
 * （预会话 change_id/quicklog_id、真会话 bind_change_key/bind_quick_id）并在
 * 发送成功后清空——本组件只回传不持有业务语义。
 * task-06（2026-08-28-session-ppm-task-binding / FR-02）：新增 ppmItem 槽位
 * （PPM 任务/问题同槽互斥、后选覆盖先选——createSession/inject 的 ppm 绑定
 * 参数是成对单值；title 供父级预会话 chip 展示「PPM 任务/问题 · 标题」）。
 */
export interface SessionInputMentions {
  /** 变更槽位（@ 变更联想选中）。 */
  change?: { id: string; change_key: string };
  /** 快速修复槽位（@ 快速修复联想选中）。 */
  quick?: { ql_id: string };
  /** PPM 条目槽位（@ PPM 任务/问题联想选中，task-06）。 */
  ppmItem?: { kind: PpmItemKind; id: string; title?: string | null };
}

export interface SessionInputBarProps {
  /** 输入框当前值（受控）。 */
  value: string;
  /** 输入内容变化。 */
  onChange: (next: string) => void;
  /** 发送（Enter 或按钮）。守卫（turn 级串行 / 状态机 / 长度）由父级 handleSend 负责。 */
  onSend: () => void;
  /** 输入框 + 发送按钮禁用（父级 sendingDisabled）。 */
  disabled: boolean;
  /** 输入框占位文案（父级按会话状态推导）。 */
  placeholder: string;
  /** 会话创建中（view.status === "creating"）→ 发送按钮转 spinner。 */
  creating: boolean;
  /** task-12：附件入口禁用（codex 引擎 D-6 三层门控第一层）。默认 false 兼容。 */
  attachmentsDisabled?: boolean;
  /** ql-20260825-007：附件入口禁用时的悬停原因（缺省「当前引擎不支持附件」——
   *  dialog 首句门控等非引擎场景传自定义文案，避免误导）。 */
  attachmentsDisabledTitle?: string;
  /** task-12：降级提示（FR-10）：当前供应商判不支持多模态 → 图片转落盘模式。 */
  multimodalDowngraded?: boolean;
  /** task-12：待发送附件变化（回传完整对象——父级合成标记行/取 ids；发送成功后父级调 clearAttachments）。 */
  onAttachmentsChange?: (next: AttachmentRead[]) => void;
  /** task-12：父级发送成功后清空 chips（经 ref 暴露口，这里改用受控清理回调）。 */
  registerClearAttachments?: (fn: () => void) => void;
  /** task-03：@ 结构化选中回传——change/quick 两槽位、同类型后选覆盖先选；
   *  仅 @ 选中触发（/ 选中不触碰）；受控 value 归空时以 {} 回调（A-1 双向
   *  复位：父级 pendingMentions 同步归零）；父级接线与发送组装归 task-05。 */
  onMentionsChange?: (next: SessionInputMentions) => void;
  /** task-03：会话所属工作区（@ 变更/快速修复联想数据源，task-04
   *  useMentionSources）；空（""/null/undefined）= @ 数据源禁用，/ 技能源不受影响。 */
  workspaceId?: string | null;
  /** ql-20260827-020：＋ 功能菜单——派团队入口（父层开 TeamTriggerPopover）；
   *  缺省不渲染该项（宿主未接团队能力）。 */
  onTeamTrigger?: () => void;
  /** 派团队入口禁用（引擎/终态/离线等，父层合成；含原因文案由 title 承载）。 */
  teamTriggerDisabled?: boolean;
  /** 派团队入口 tooltip（启用态动作说明 / 禁用态原因，对齐原 TeamTriggerRow
   *  按钮的 tooltip 口径由父层合成）。 */
  teamTriggerTitle?: string;
}

function formatBytes(n: number): string {
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)}MB`;
  return `${Math.max(1, Math.round(n / 1024))}KB`;
}

/* ── task-03（2026-08-26-session-input-mention）：联想数据桥与快照回流 ────── */

/** 联想数据快照类型（task-04 useMentionSources 返回面）。 */
type MentionSourcesSnapshot = ReturnType<typeof useMentionSources>;

/**
 * 数据快照内容级比较（回流去重）：useMentionSources 每次渲染都返回新对象/新
 * 数组字面量（`?? []` / filter 产物），按引用比较会让「桥 effect → 父 setState
 * → 桥重渲」成环；按元素身份逐位比较数组内容，加载态的重复空数组与稳定缓存
 * 数据均判等收敛，setState bail-out 截断回流。PPM 两分组（task-06）同口径
 * 扩展；可选链防御旧 harness 的部分快照 mock（运行时缺字段不炸）。
 */
function isSameMentionSources(
  a: MentionSourcesSnapshot,
  b: MentionSourcesSnapshot,
): boolean {
  return (
    a.atEnabled === b.atEnabled &&
    a.skills.length === b.skills.length &&
    a.changes.length === b.changes.length &&
    a.quicklogs.length === b.quicklogs.length &&
    a.skills.every((s, i) => s === b.skills[i]) &&
    a.changes.every((c, i) => c === b.changes[i]) &&
    a.quicklogs.every((q, i) => q === b.quicklogs[i]) &&
    (a.ppmTasks ?? []).length === (b.ppmTasks ?? []).length &&
    (a.ppmProblems ?? []).length === (b.ppmProblems ?? []).length &&
    (a.ppmTasks ?? []).every((t, i) => t === (b.ppmTasks ?? [])[i]) &&
    (a.ppmProblems ?? []).every((p, i) => p === (b.ppmProblems ?? [])[i])
  );
}

/**
 * 联想数据桥子组件：本组件树唯一调用 useMentionSources（react-query 上下文）
 * 的位置。惰性挂载（textarea 首次聚焦）——无 QueryClientProvider 的裸渲染
 * harness（session-panel 系既有测试、高度/抽取回归）不挂载本桥即零依赖零
 * 副作用；真实浏览器打字必先聚焦，聚焦即预取对齐 design §5「挂载 prefetch +
 * staleTime，输入过程零网络请求」语义（staleTime 5 分钟由 task-04 内部设置）。
 * task-06：ppmScope 透传（PPM 分组状态口径，进缓存键换键重拉——开关状态由
 * 本组件持有，浮层经 onPpmScopeChange 回调翻转）。
 */
function MentionSourcesBridge({
  workspaceId,
  ppmScope,
  onData,
}: {
  workspaceId: string | null | undefined;
  ppmScope: PpmMentionScope;
  onData: (sources: MentionSourcesSnapshot) => void;
}) {
  const sources = useMentionSources(workspaceId, ppmScope);
  useEffect(() => {
    onData(sources);
  }, [onData, sources]);
  return null;
}

export function SessionInputBar({
  value,
  onChange,
  onSend,
  disabled,
  placeholder,
  creating,
  attachmentsDisabled = false,
  attachmentsDisabledTitle,
  multimodalDowngraded = false,
  onAttachmentsChange,
  registerClearAttachments,
  onMentionsChange,
  workspaceId,
  onTeamTrigger,
  teamTriggerDisabled = false,
  teamTriggerTitle,
}: SessionInputBarProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  /** 上传完成的附件（chips 数据源）。上传中/失败以 id=null 占位行内呈现。 */
  const [attachments, setAttachments] = useState<AttachmentRead[]>([]);
  const [uploading, setUploading] = useState(0);
  const [uploadError, setUploadError] = useState<string | null>(null);

  /* ── task-03：联想接入状态 ──────────────────────────────────────────── */

  /** 检测命中（task-01 detectMention 结果快照，query 随输入更新；null = 关层）。 */
  const [mention, setMention] = useState<MentionDetection | null>(null);
  /** 浮层高亮下标（指向过滤后扁平列表，↑↓ 经 nextMentionIndex 维护）。 */
  const [mentionActiveIndex, setMentionActiveIndex] = useState(0);
  /** IME 组合期标记（design §3.1 / R-3）：组合期跳过检测与 Enter/Tab 拦截。 */
  const composingRef = useRef(false);
  /** 回填后待复位光标——受控 value 的 DOM 更新会覆盖同步 setSelectionRange，
   *  故记此 ref 在 useEffect 内延迟执行（design §3.3 仓库首例模式）。 */
  const pendingCaretRef = useRef<number | null>(null);
  /** @ 选中累计（同类型后选覆盖先选；/ 选中不动槽位；受控 value 归空时随
   *  归空 effect 复位为 {} 并以 {} 回调 onMentionsChange（双向复位——父级
   *  pendingMentions 同步归零，防陈旧槽位跨消息/跨上下文泄漏，见下方归空
   *  effect 注释）。task-06：ppmItem 槽位（任务/问题同槽互斥）同语义。 */
  const mentionsRef = useRef<SessionInputMentions>({});
  /** 联想数据桥挂载门（textarea 首次聚焦，见 MentionSourcesBridge 注释）。 */
  const [mentionSourcesMounted, setMentionSourcesMounted] = useState(false);
  /** task-06（FR-02 / D-002@v1）：PPM 分组状态口径开关——ongoing（默认仅
   *  进行中）↔ all（全状态可关联）；经桥透传数据源进键重拉，经浮层分组头
   *  「切全部/仅进行中」回调翻转。 */
  const [ppmScope, setPpmScope] = useState<PpmMentionScope>("ongoing");
  /** 联想数据快照（桥回流；未聚焦前保持空快照——浮层此时至多显示空态引导）。 */
  const [mentionSources, setMentionSources] = useState<MentionSourcesSnapshot>(() => ({
    skills: [],
    changes: [],
    quicklogs: [],
    ppmTasks: [],
    ppmProblems: [],
    atEnabled: false,
  }));
  const handleMentionSources = useCallback((next: MentionSourcesSnapshot) => {
    setMentionSources((prev) => (isSameMentionSources(prev, next) ? prev : next));
  }, []);

  /** 关闭联想浮层（Esc / 失焦 / 检测归空 / 选中回填后）。 */
  const closeMention = () => {
    setMention(null);
    setMentionActiveIndex(0);
  };

  /* ── ql-20260827-020：＋ 功能菜单 ───────────────────────────────────── */

  /** 菜单开合（外点 / Esc / 选中任一项后关闭）。 */
  const [plusMenuOpen, setPlusMenuOpen] = useState(false);
  const plusMenuRef = useRef<HTMLDivElement | null>(null);

  // 外点 + Esc 关闭（外点判定含 ＋ 按钮自身——点击由按钮 onClick 翻转，不走此处）。
  useEffect(() => {
    if (!plusMenuOpen) return;
    const onPointerDown = (e: MouseEvent | TouchEvent) => {
      if (plusMenuRef.current && !plusMenuRef.current.contains(e.target as Node)) {
        setPlusMenuOpen(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPlusMenuOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("touchstart", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("touchstart", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [plusMenuOpen]);

  /**
   * 向光标处插入联想触发字符并开层（＋ 菜单「选择技能 / 关联变更·快速修复」）。
   * detectMention 词首规则（task-01）：光标前是正文字符时先补一个空格，保证
   * 触发字符落在词首（补空格只发生在光标前的正文字符与触发字符之间，不改写
   * 原文其余内容）。聚焦 textarea 同时挂载联想数据桥（首次预取），回填光标经
   * pendingCaretRef 延迟复位（受控 value DOM 更新不被覆盖）。
   */
  const insertMentionTrigger = (trigger: "/" | "@") => {
    const ta = textareaRef.current;
    ta?.focus();
    setMentionSourcesMounted(true);
    const caret = Math.min(ta?.selectionStart ?? value.length, value.length);
    const prevChar = caret > 0 ? value.charAt(caret - 1) : "";
    const prefix = prevChar && !/\s/.test(prevChar) ? " " : "";
    const triggerAt = caret + prefix.length;
    const next = value.slice(0, caret) + prefix + trigger + value.slice(caret);
    onChange(next);
    pendingCaretRef.current = triggerAt + 1;
    runMentionDetect(next, triggerAt + 1);
  };

  /**
   * 检测驱动（design §3.1）：onChange 读 e.target.selectionStart 调 detectMention
   * （task-01）——命中开层并随 query 过滤；未命中（查询串含空白 / 输入清空 /
   * 非词首触发字符）关层。IME 组合期跳过（compositionend 后重检）。
   */
  const runMentionDetect = (nextValue: string, caret: number | null) => {
    if (composingRef.current) return;
    const detection = detectMention(nextValue, caret ?? nextValue.length);
    if (!detection) {
      closeMention();
      return;
    }
    // 查询串变化（继续输入/删改）重置高亮到首项；同串重复检测
    //（compositionend 重检等）保留当前高亮。
    if (!mention || mention.query !== detection.query) setMentionActiveIndex(0);
    setMention(detection);
  };

  /**
   * 选中回填（design §3.3）：回填名计算收敛在本层——技能 invoke_name ?? name
   * （task-02 浮层只抛原始实体）、@ 用无空格自然键 change_key / ql_id，均后随
   * 空格（下一次检测因空白归 null 自动关层；/team 回填后整条前缀仍命中既有
   * parseTeamCommand 拦截）。
   */
  const selectMentionItem = (item: SessionMentionItem) => {
    if (!mention) return;
    // 选中瞬间按受控 value + 当前 DOM 光标重检一次（浮层 mousedown 不夺焦点，
    // 光标仍在触发位；重检同时兜底外部改值造成的过期检测快照）。
    const ta = textareaRef.current;
    const detection =
      (ta ? detectMention(value, ta.selectionStart ?? value.length) : null) ?? mention;
    let insertKey: string;
    let mentionsNext: SessionInputMentions | null = null;
    switch (item.kind) {
      case "command":
        insertKey = item.entity.name;
        break;
      case "skill":
        insertKey = item.entity.invoke_name ?? item.entity.name;
        break;
      case "change":
        insertKey = item.entity.change_key;
        mentionsNext = {
          ...mentionsRef.current,
          change: { id: item.entity.id, change_key: item.entity.change_key },
        };
        break;
      case "quick":
        insertKey = item.entity.ql_id;
        mentionsNext = { ...mentionsRef.current, quick: { ql_id: item.entity.ql_id } };
        break;
      case "ppmTask":
      case "ppmProblem":
        // task-06（FR-02）：回填键 = 清洗后的条目标题（压空白 + 截断，绑定走
        // 结构化槽位不依赖回填文本）；ppmItem 槽位任务/问题同槽互斥、后选覆盖
        // 先选（create/inject 的 ppm 绑定参数成对单值）。
        insertKey = sanitizePpmInsertKey(item.entity.title);
        mentionsNext = {
          ...mentionsRef.current,
          ppmItem: {
            kind: item.entity.kind,
            id: item.entity.id,
            title: item.entity.title,
          },
        };
        break;
    }
    const picked = applyMentionPick(value, detection, insertKey);
    onChange(picked.value);
    // 光标延迟复位：同步 setSelectionRange 会被受控 value 的 DOM 更新覆盖。
    pendingCaretRef.current = picked.caret;
    if (mentionsNext) {
      mentionsRef.current = mentionsNext;
      onMentionsChange?.(mentionsNext);
    }
    closeMention();
  };

  // 候选组装（task-02 纯函数）：/ = 内置 /team 置顶 + 技能；@ = 变更 + 快速
  // 修复 + PPM 任务/问题（task-06；?? [] 防御旧 harness 部分快照 mock）。
  const mentionItems = useMemo(
    () =>
      mention?.trigger === "/"
        ? buildSlashMentionItems(mentionSources.skills)
        : buildAtMentionItems(
            mentionSources.changes,
            mentionSources.quicklogs,
            mentionSources.ppmTasks ?? [],
            mentionSources.ppmProblems ?? [],
          ),
    [mention?.trigger, mentionSources],
  );
  // 过滤口径与浮层渲染共享同一纯函数（filterMentionItems 单一源），保证键盘
  // 数学的 count/选中项与浮层 activeIndex 指向同一条目。
  const filteredMentionItems = useMemo(
    () => filterMentionItems(mentionItems, mention?.query ?? ""),
    [mentionItems, mention?.query],
  );

  // 回填光标延迟复位（design §3.3 首例模式）：effect 依赖受控 value，DOM 已
  // 更新后 setSelectionRange 才不被覆盖；复位即清标记（只消费一次）。
  useEffect(() => {
    const pos = pendingCaretRef.current;
    if (pos == null) return;
    pendingCaretRef.current = null;
    textareaRef.current?.setSelectionRange(pos, pos);
  }, [value]);

  // onMentionsChange 的 latest-ref（A-1 双向复位回调通道）：父级每次渲染可能
  // 传新函数引用（内联箭头等），若直接进归空 effect 依赖会因回调身份不稳定
  // 引发额外触发；经 ref 转接取最新——本同步 effect 声明在归空 effect 之前，
  // 同一 commit 内先于其执行，保证归空回调永远指向最新回调。
  const onMentionsChangeRef = useRef(onMentionsChange);
  useEffect(() => {
    onMentionsChangeRef.current = onMentionsChange;
  }, [onMentionsChange]);

  // 外部清空（发送后清空 / team 拦截 setInput("") / 新建会话重置）不经过
  // onChange——按受控 value 归空直接关层（design §3.1 关闭条件「输入被清空、
  // 发送后」）；同刻双向复位 @ 选中累计：组件侧 mentionsRef 归 {} 的同时以 {}
  // 回调 onMentionsChange（缺陷修复收口 A-1：只复位组件 ref 时，父级
  // pendingMentions 在「新建会话 / 切会话换草稿」等自身不清空的路径残留，
  // 陈旧绑定随下一个上下文的消息静默错绑）。复位不受浮层开层门控（选中回填
  // 后浮层已关、mention 为 null，沿用早退则复位永不触达）；同一条消息内双选
  // 累积不受影响——双选过程 value 恒非空，归空复位只在清空时刻。仅在确有
  // 残留时回调（挂载即空态不广播，避免父级收到无意义归零噪声）。发送失败
  // 保留可重试语义天然无冲突：失败路径 value 不清空 → 本 effect 不触发 →
  // 组件侧/父级选中均原地保留随重试再携带。
  useEffect(() => {
    if (value !== "") return;
    if (
      mentionsRef.current.change !== undefined ||
      mentionsRef.current.quick !== undefined ||
      mentionsRef.current.ppmItem !== undefined
    ) {
      mentionsRef.current = {};
      onMentionsChangeRef.current?.({});
    }
    if (!mention) return;
    setMention(null);
    setMentionActiveIndex(0);
    // onMentionsChange 经上方 latest-ref 转接，不进依赖集。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, mention]);

  // ql-20260826-010：用户拖拽调节的输入框高度（null = 默认自适应）。拖拽中经
  // setInputHeight 实时生效；effect 落盘（拖完才有的稳定值也覆盖）；双击手柄
  // 恢复默认并清键。上限取 min(480, 视口 60%)，拖拽时按当次视口动态算。
  const [inputHeight, setInputHeight] = useState<number | null>(readPersistedInputHeight);
  useEffect(() => {
    if (inputHeight == null) return;
    try {
      window.localStorage.setItem(INPUT_HEIGHT_LS_KEY, String(inputHeight));
    } catch {
      /* 隐私模式等写入失败静默 */
    }
  }, [inputHeight]);

  const dragStateRef = useRef<{ startY: number; startHeight: number } | null>(null);

  const handleHeightDragStart = (e: React.MouseEvent) => {
    e.preventDefault();
    // 实测高度兜底：jsdom / 未布局时 offsetHeight 为 0，按默认下限起步。
    const measured = textareaRef.current?.offsetHeight ?? 0;
    const current = inputHeight ?? (measured > 0 ? measured : INPUT_HEIGHT_MIN);
    dragStateRef.current = { startY: e.clientY, startHeight: current };
    const onMove = (ev: MouseEvent) => {
      const d = dragStateRef.current;
      if (!d) return;
      const max = Math.min(INPUT_HEIGHT_MAX, Math.round(window.innerHeight * 0.6));
      const next = Math.min(
        Math.max(INPUT_HEIGHT_MIN, d.startHeight + (d.startY - ev.clientY)),
        max,
      );
      setInputHeight(next);
    };
    const onUp = () => {
      dragStateRef.current = null;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const handleHeightReset = () => {
    setInputHeight(null);
    try {
      window.localStorage.removeItem(INPUT_HEIGHT_LS_KEY);
    } catch {
      /* 静默容错 */
    }
  };

  /* task-14（2026-08-27-background-subagent-progress / FR-08）：空内容禁点提示——
   * 纯空文本（strip 后为空且无附件）时发送按钮 title/aria-label 提示「消息内容
   * 不能为空」，与后端 inject 空 prompt 422 文案一致（backend session/service.py
   * SessionEmptyPrompt）。仅在非父级禁用时提示：终态/离线等父级禁用原因由
   * placeholder 承载，此时不误报空内容。D-7 例外口径不变——有附件无文本仍可发
   * （看图说话），提示保持「发送」。 */
  const sendEmptyHinted =
    !disabled && !value.trim() && attachments.length === 0;

  const syncToParent = (next: AttachmentRead[]) => {
    onAttachmentsChange?.(next);
  };

  registerClearAttachments?.(() => {
    setAttachments([]);
    onAttachmentsChange?.([]);
  });

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploadError(null);
    for (const file of Array.from(files).slice(0, 10)) {
      const kind = file.type.startsWith("image/") ? "image" : "file";
      setUploading((n) => n + 1);
      try {
        const added = await uploadSessionAttachment(file, kind);
        setAttachments((prev) => {
          const next = [...prev, added];
          syncToParent(next);
          return next;
        });
      } catch (err) {
        setUploadError(err instanceof Error ? err.message : "上传失败");
      } finally {
        setUploading((n) => n - 1);
      }
    }
    if (fileRef.current) fileRef.current.value = "";
  };

  const handleRemove = async (att: AttachmentRead) => {
    setAttachments((prev) => {
      const next = prev.filter((a) => a.id !== att.id);
      syncToParent(next);
      return next;
    });
    try {
      await removeSessionAttachment(att.id);
    } catch {
      /* 行已在本地移除；服务端残留由 48h 草稿清理兜底 */
    }
  };

  return (
    <footer className="shrink-0 bg-card px-5 pb-4 pt-1">
      {/* 附件区：chips + 降级提示条（task-12）。 */}
      {(attachments.length > 0 || uploading > 0 || uploadError) && (
        <div className="mb-2 space-y-1.5">
          {multimodalDowngraded && attachments.some((a) => a.kind === "image") && (
            <div className="rounded border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-[11px] text-amber-700">
              当前供应商不支持图片直读：图片将以文件形式落盘，供智能体用工具读取（不能「看」图）。
              可在「我的供应商」开启该供应商的多模态能力。
            </div>
          )}
          <div className="flex flex-wrap gap-1.5">
            {attachments.map((att) => (
              <span
                key={att.id}
                className="flex max-w-[220px] items-center gap-1 rounded border border-input bg-muted/50 px-2 py-1 text-[11px]"
                title={`${att.name} · ${formatBytes(att.bytes)}`}
              >
                <span className="truncate inline-flex items-center gap-1">
                  {att.kind === "image" ? (
                    <ImageIcon aria-hidden className="h-3 w-3 shrink-0" />
                  ) : (
                    <FileText aria-hidden className="h-3 w-3 shrink-0" />
                  )}
                  {att.name} · {formatBytes(att.bytes)}
                </span>
                <button
                  type="button"
                  aria-label={`移除附件 ${att.name}`}
                  onClick={() => void handleRemove(att)}
                  className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
            {uploading > 0 && (
              <span className="flex items-center gap-1 rounded border border-input px-2 py-1 text-[11px] text-muted-foreground">
                <RefreshCw className="h-3 w-3 animate-spin" /> 上传中…（{uploading}）
              </span>
            )}
          </div>
          {uploadError && (
            <div className="text-[11px] text-destructive">{uploadError}</div>
          )}
        </div>
      )}
      {/* 高度拖拽手柄（ql-20260826-010）：输入胶囊上缘细条——按下沿竖向拖动
          增减高度（实时生效 + 落盘），双击恢复默认。 */}
      <div
        role="separator"
        aria-orientation="horizontal"
        aria-label="拖动调节输入框高度（双击恢复默认）"
        title="拖动调节输入框高度，双击恢复默认"
        onMouseDown={handleHeightDragStart}
        onDoubleClick={handleHeightReset}
        className="group -mb-0.5 flex h-3 cursor-ns-resize touch-none items-center justify-center"
      >
        <span className="h-[3px] w-10 rounded-full bg-muted-foreground/30 transition-colors group-hover:bg-brand-500" />
      </div>
      {/* 胶囊输入区（2026-08-23-sessions-page-style 原型 .input-row）：圆角容器
          聚焦光环 + 附件按钮内嵌 + 渐变圆形发送按钮；Enter/附件/disabled 交互
          契约原样（task-13 / D-7）。task-03 加 relative 作联想浮层锚区
          （absolute bottom-full，与 TeamTriggerPopover 同锚区同层族，R-5）。 */}
      <div className="relative flex items-end gap-2 rounded-2xl border border-border bg-muted/40 px-2.5 py-2 transition-all focus-within:border-primary focus-within:bg-card focus-within:ring-4 focus-within:ring-brand-100">
        {/* task-03：联想数据桥（首次聚焦挂载，见 MentionSourcesBridge 注释；
            task-06：ppmScope 状态口径透传——切开关换键重拉 PPM 两分组）。 */}
        {mentionSourcesMounted && (
          <MentionSourcesBridge
            workspaceId={workspaceId}
            ppmScope={ppmScope}
            onData={handleMentionSources}
          />
        )}
        {/* task-03：联想浮层（task-02）——检测命中渲染，随 query 过滤；键盘
            ↑↓/Enter/Tab/Esc 经下方 textarea onKeyDown 首位接管。task-06：
            ppmScope/onPpmScopeChange 透传（PPM 分组头「切全部/仅进行中」开关）。 */}
        {mention && (
          <SessionMentionPopover
            trigger={mention.trigger}
            query={mention.query}
            items={mentionItems}
            activeIndex={mentionActiveIndex}
            ppmScope={ppmScope}
            onPpmScopeChange={setPpmScope}
            onSelect={(entity) => {
              // 浮层抛原始实体（引用透传）——在候选里按身份找回条目取 kind
              //（回填名与槽位判定收敛在本层）。
              const item =
                filteredMentionItems.find((it) => it.entity === entity) ??
                mentionItems.find((it) => it.entity === entity);
              if (item) selectMentionItem(item);
            }}
            onClose={closeMention}
          />
        )}
        <input
          ref={fileRef}
          type="file"
          multiple
          hidden
          onChange={(e) => void handleFiles(e.target.files)}
        />
        {/* ql-20260827-020：＋ 功能按钮（原 📎 附件按钮位）——点击弹功能菜单
            （附件 / 派团队 / 选择技能 / 关联变更·快速修复）。菜单为 daemon
            组件族自定义浮层（absolute bottom-full + z-30，同联想浮层/团队弹层
            惯例，避用 antd 浮层）；＋ 按钮包含在外点判定 ref 内防开合双翻。
            ＋ 不随输入框 disabled（终态/离线仍可开菜单看各入口禁用原因 tooltip，
            各项自行门控——原 📎 的 attachmentsDisabled 下沉到菜单项）。 */}
        <div ref={plusMenuRef} className="relative shrink-0 self-center">
          <Button
            type="text"
            onClick={() => setPlusMenuOpen((v) => !v)}
            aria-haspopup="menu"
            aria-expanded={plusMenuOpen}
            aria-label="更多功能"
            className="h-10 w-10 rounded-full p-0 text-muted-foreground"
            title="附件 / 派团队 / 选择技能 / 关联变更·快速修复"
          >
            <Plus
              aria-hidden
              className={`h-5 w-5 transition-transform duration-150 ${plusMenuOpen ? "rotate-45" : ""}`}
            />
          </Button>
          {plusMenuOpen && (
            <div
              role="menu"
              aria-label="输入功能"
              className="absolute bottom-full left-0 z-30 mb-1.5 w-64 overflow-hidden rounded-xl border border-border bg-card py-1 shadow-lg"
            >
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setPlusMenuOpen(false);
                  fileRef.current?.click();
                }}
                disabled={attachmentsDisabled}
                title={
                  attachmentsDisabled
                    ? (attachmentsDisabledTitle ?? "当前引擎不支持附件")
                    : "添加图片/文件附件，支持 Ctrl+V 直接粘贴（图片直读需多模态模型）"
                }
                className="flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
              >
                <Paperclip aria-hidden className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0">
                  <span className="block text-[13px] leading-5">附件</span>
                  <span className="block text-[11px] leading-4 text-muted-foreground">
                    图片 / 文件，支持 Ctrl+V 粘贴
                  </span>
                </span>
              </button>
              {onTeamTrigger && (
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setPlusMenuOpen(false);
                    onTeamTrigger();
                  }}
                  disabled={teamTriggerDisabled}
                  title={teamTriggerTitle ?? "派团队执行任务"}
                  className="flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <Users aria-hidden className="h-4 w-4 shrink-0 text-violet-600" />
                  <span className="min-w-0">
                    <span className="block text-[13px] leading-5">派团队</span>
                    <span className="block text-[11px] leading-4 text-muted-foreground">
                      当前智能体升级主控，派发分身
                    </span>
                  </span>
                </button>
              )}
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setPlusMenuOpen(false);
                  insertMentionTrigger("/");
                }}
                title="插入 / 触发技能指令联想"
                className="flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors hover:bg-muted"
              >
                <Sparkles aria-hidden className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0">
                  <span className="block text-[13px] leading-5">选择技能</span>
                  <span className="block text-[11px] leading-4 text-muted-foreground">
                    / 技能指令
                  </span>
                </span>
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setPlusMenuOpen(false);
                  insertMentionTrigger("@");
                }}
                disabled={!workspaceId}
                title={workspaceId ? "插入 @ 关联变更 / 快速修复 / PPM 任务/问题" : "需在绑定工作区的会话中关联条目"}
                className="flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
              >
                <AtSign aria-hidden className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0">
                  <span className="block text-[13px] leading-5">关联变更 / 快速修复 / PPM</span>
                  <span className="block text-[11px] leading-4 text-muted-foreground">
                    @ 绑定任务上下文
                  </span>
                </span>
              </button>
            </div>
          )}
        </div>
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
            // task-03 检测驱动：读 e.target.selectionStart（光标左侧回看），
            // IME 组合期由 runMentionDetect 内部跳过。
            runMentionDetect(e.target.value, e.target.selectionStart);
          }}
          onFocus={() => {
            // task-03：首次聚焦挂载联想数据桥（预取，见 MentionSourcesBridge 注释）。
            setMentionSourcesMounted(true);
          }}
          onBlur={() => {
            // task-03 失焦关层（design §3.1）：浮层内 mousedown 已 preventDefault
            // 不触发 blur，到达此处的均为浮层外失焦。
            closeMention();
          }}
          onCompositionStart={() => {
            // task-03 IME 组合期标记（R-3）：组合期跳过检测与 Enter/Tab 拦截。
            composingRef.current = true;
          }}
          onCompositionEnd={(e) => {
            // task-03：组合结束对最终文本重检（中文拼音含 / @ 不误触）。
            composingRef.current = false;
            const ta = e.target as HTMLTextAreaElement;
            runMentionDetect(ta.value, ta.selectionStart);
          }}
          onPaste={(e) => {
            // ql-20260825-006：剪贴板带文件（截图/复制的文件）→ 与 📎 同上传管线；
            // 空文件列表（纯文本粘贴）直接放行默认插入。
            if (attachmentsDisabled) return;
            const files = e.clipboardData?.files;
            if (!files || files.length === 0) return;
            e.preventDefault();
            void handleFiles(files);
          }}
          onKeyDown={(e) => {
            // task-03 联想键盘首位（R-2 拦截规则集中于此）：浮层激活且非 IME
            // 组合期时，↑↓/Enter/Tab/Esc 由 handleMentionKeyDown（task-02）统一
            // 处置，命中拦截（preventDefault + 不外溢）即返回——Enter 不落入
            // 下方发送；未命中（空态、Shift 组合、其余按键）放行。
            if (mention && !composingRef.current) {
              const handled = handleMentionKeyDown(e, {
                count: filteredMentionItems.length,
                activeIndex: mentionActiveIndex,
                onMove: setMentionActiveIndex,
                onSelect: () => {
                  const item =
                    filteredMentionItems[
                      Math.min(mentionActiveIndex, filteredMentionItems.length - 1)
                    ];
                  if (item) selectMentionItem(item);
                },
                onClose: closeMention,
              });
              if (handled) return;
            }
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              onSend();
            }
          }}
          placeholder={placeholder}
          className="min-h-11 flex-1 resize-none bg-transparent px-1 py-2 text-sm leading-5 outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-60"
          rows={2}
          disabled={disabled}
          style={inputHeight != null ? { height: inputHeight } : undefined}
        />
        <Button
          type="primary"
          shape="circle"
          onClick={onSend}
          // D-7：带附件时空文本可发（看图说话）；纯文本仍要求非空。
          disabled={disabled || (!value.trim() && attachments.length === 0)}
          className="h-9 w-9 shrink-0 self-center border-none bg-gradient-to-br from-brand-600 to-info shadow-primary hover:from-brand-700 hover:to-info hover:shadow-primary"
          title={sendEmptyHinted ? "消息内容不能为空" : "发送"}
          aria-label={sendEmptyHinted ? "消息内容不能为空" : "发送"}
        >
          {creating ? (
            <RefreshCw className="h-4 w-4 animate-spin" />
          ) : (
            <Send className="h-4 w-4" />
          )}
        </Button>
      </div>
    </footer>
  );
}
