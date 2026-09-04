// task-09 / FR-03 / D-002@v1 / D-004@v1：RunErrorItem 组件单测。
//
// 覆盖（对齐 task-09.md acceptance）：
//   - MODEL_ERROR_META 映射表：8 类 → label/Icon/color，unknown 兜底
//   - 各 type 渲染对应图标 / 颜色 / 文案
//   - message 与 hint 正确显示（hint 缺失走 defaultHint 兜底）
//   - code 徽标按有 / 无渲染
//   - actions 触发回调：重新发送（传入 onResend 即显示，ql-20260904-010 不再
//     按 retryable 门控）/ 切换供应商 / 查看详情
//   - 查看详情展开 raw（再次点击收起）
//   - 无 actions 时不渲染操作区

import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import {
  AlertOctagon,
  AlertTriangle,
  Gauge,
  Lock,
  PackageSearch,
  Timer,
  Wallet,
  WifiOff,
} from "lucide-react";

import {
  MODEL_ERROR_META,
  RunErrorItem,
  modelErrorMeta,
} from "@/components/agent-log/run-error-item";
import type { ErrorLogItem, ModelErrorType } from "@/components/agent-log/normalize";

// 默认 message 用与标题「运行失败」不同的文本，避免 getByText 在标题 + 正文间撞匹配。
function makeItem(over: Partial<ErrorLogItem> = {}): ErrorLogItem {
  return {
    type: "unknown",
    code: null,
    message: "模型调用失败。",
    retryable: false,
    hint: null,
    raw: null,
    ...over,
  };
}

function rootOf(container: HTMLElement): HTMLElement {
  const el = container.querySelector('[data-testid="run-error-item"]');
  if (!el) throw new Error("run-error-item 根节点未渲染");
  return el as HTMLElement;
}

/* ------------------------------------------------------------------ */
/*  映射表（8 类 + unknown 兜底）                                       */
/* ------------------------------------------------------------------ */

describe("task-09: MODEL_ERROR_META 映射表（8 类 + unknown 兜底）", () => {
  it("8 类各映射到对应 label / Icon", () => {
    expect(MODEL_ERROR_META.auth_failed).toEqual(
      expect.objectContaining({ label: "凭证失效", Icon: Lock }),
    );
    expect(MODEL_ERROR_META.quota_exceeded).toEqual(
      expect.objectContaining({ label: "额度耗尽", Icon: Wallet }),
    );
    expect(MODEL_ERROR_META.rate_limited).toEqual(
      expect.objectContaining({ label: "触发限流", Icon: Gauge }),
    );
    expect(MODEL_ERROR_META.timeout).toEqual(
      expect.objectContaining({ label: "响应超时", Icon: Timer }),
    );
    expect(MODEL_ERROR_META.model_not_found).toEqual(
      expect.objectContaining({ label: "模型不存在", Icon: PackageSearch }),
    );
    expect(MODEL_ERROR_META.network).toEqual(
      expect.objectContaining({ label: "网络异常", Icon: WifiOff }),
    );
    expect(MODEL_ERROR_META.provider_error).toEqual(
      expect.objectContaining({ label: "供应商异常", Icon: AlertOctagon }),
    );
    expect(MODEL_ERROR_META.unknown).toEqual(
      expect.objectContaining({ label: "运行失败", Icon: AlertTriangle }),
    );
  });

  it("每类 containerClass 含预期色族（颜色可识别）", () => {
    expect(MODEL_ERROR_META.auth_failed.containerClass).toContain("red");
    expect(MODEL_ERROR_META.quota_exceeded.containerClass).toContain("orange");
    expect(MODEL_ERROR_META.rate_limited.containerClass).toContain("amber");
    expect(MODEL_ERROR_META.timeout.containerClass).toContain("purple");
    expect(MODEL_ERROR_META.model_not_found.containerClass).toContain("rose");
    expect(MODEL_ERROR_META.network.containerClass).toContain("cyan");
    expect(MODEL_ERROR_META.provider_error.containerClass).toContain("red");
    expect(MODEL_ERROR_META.unknown.containerClass).toContain("zinc");
  });

  it("modelErrorMeta：非法 / 空 type → unknown 兜底", () => {
    expect(modelErrorMeta("nonsense").label).toBe("运行失败");
    expect(modelErrorMeta(null).Icon).toBe(AlertTriangle);
    expect(modelErrorMeta(undefined).label).toBe("运行失败");
  });
});

/* ------------------------------------------------------------------ */
/*  各 type 渲染对应图标 / 颜色 / 文案                                   */
/* ------------------------------------------------------------------ */

describe("task-09: 各 type 渲染对应颜色 / 文案 / 图标", () => {
  const cases: Array<[ModelErrorType, string, string]> = [
    ["auth_failed", "凭证失效", "red"],
    ["quota_exceeded", "额度耗尽", "orange"],
    ["rate_limited", "触发限流", "amber"],
    ["timeout", "响应超时", "purple"],
    ["model_not_found", "模型不存在", "rose"],
    ["network", "网络异常", "cyan"],
    ["provider_error", "供应商异常", "red"],
    ["unknown", "运行失败", "zinc"],
  ];

  for (const [type, label, color] of cases) {
    it(`${type} → ${label} · ${color}`, () => {
      const { container } = render(<RunErrorItem item={makeItem({ type })} />);
      const root = rootOf(container);
      // 颜色：外框含对应色族
      expect(root.className).toContain(color);
      // 文案：type 徽标「中文 label · type key」
      expect(screen.getByText(`${label} · ${type}`)).toBeInTheDocument();
      // 图标：标题行渲染了一个 svg（无回调 + 无 raw → 仅标题图标）
      expect(root.querySelector("svg")).toBeTruthy();
      // data-error-type 透传，便于 task-10 / 集成测试定位
      expect(root.getAttribute("data-error-type")).toBe(type);
    });
  }
});

/* ------------------------------------------------------------------ */
/*  标题 / message / hint / code                                       */
/* ------------------------------------------------------------------ */

describe("task-09: 标题 / message / hint / code 渲染", () => {
  it("渲染「运行失败」标题 + message + type 徽标", () => {
    render(
      <RunErrorItem
        item={makeItem({
          type: "quota_exceeded",
          message: "模型调用失败，当前供应商额度已达上限。",
        })}
      />,
    );
    expect(screen.getByText("运行失败")).toBeInTheDocument();
    expect(
      screen.getByText("模型调用失败，当前供应商额度已达上限。"),
    ).toBeInTheDocument();
    expect(screen.getByText("额度耗尽 · quota_exceeded")).toBeInTheDocument();
  });

  it("显示后端 hint", () => {
    render(
      <RunErrorItem
        item={makeItem({ type: "auth_failed", hint: "前往设置更新凭证。" })}
      />,
    );
    expect(screen.getByText(/前往设置更新凭证。/)).toBeInTheDocument();
  });

  it("hint 缺失 → 用 type 兜底 defaultHint", () => {
    render(<RunErrorItem item={makeItem({ type: "timeout", hint: null })} />);
    expect(screen.getByText(MODEL_ERROR_META.timeout.defaultHint)).toBeInTheDocument();
  });

  it("code 有值 → 显示 code 徽标", () => {
    render(
      <RunErrorItem item={makeItem({ type: "quota_exceeded", code: "1310" })} />,
    );
    expect(screen.getByText("code: 1310")).toBeInTheDocument();
  });

  it("code 为 null → 不渲染 code 徽标", () => {
    render(<RunErrorItem item={makeItem({ type: "quota_exceeded", code: null })} />);
    expect(screen.queryByText(/code:/)).not.toBeInTheDocument();
  });
});

/* ------------------------------------------------------------------ */
/*  actions 回调                                                       */
/* ------------------------------------------------------------------ */

describe("task-09: actions 触发回调（重发 / 切换供应商 / 查看详情）", () => {
  it("retryable=true + onResend → 显示「重新发送」并触发回调", () => {
    const onResend = vi.fn();
    render(
      <RunErrorItem
        item={makeItem({ type: "timeout", retryable: true })}
        onResend={onResend}
      />,
    );
    const btn = screen.getByRole("button", { name: /重新发送/ });
    fireEvent.click(btn);
    expect(onResend).toHaveBeenCalledTimes(1);
  });

  it("retryable=true → 「重新发送」为 primary（首个修复动作）", () => {
    render(
      <RunErrorItem
        item={makeItem({ type: "timeout", retryable: true })}
        onResend={() => {}}
      />,
    );
    expect(screen.getByRole("button", { name: /重新发送/ }).className).toContain(
      "bg-primary",
    );
  });

  it("retryable=false + onResend → 也显示「重新发送」并触发回调（ql-20260904-010 所有失败卡可重试）", () => {
    const onResend = vi.fn();
    render(
      <RunErrorItem
        item={makeItem({ type: "quota_exceeded", retryable: false })}
        onResend={onResend}
      />,
    );
    const btn = screen.getByRole("button", { name: /重新发送/ });
    expect(btn.className).toContain("bg-primary");
    fireEvent.click(btn);
    expect(onResend).toHaveBeenCalledTimes(1);
  });

  it("传 onResend 即显示「重新发送」，与 retryable 无关", () => {
    render(
      <RunErrorItem
        item={makeItem({ type: "auth_failed", retryable: false })}
        onResend={() => {}}
      />,
    );
    expect(screen.getByRole("button", { name: /重新发送/ })).toBeInTheDocument();
  });

  it("传 onResend 但未传 onSwitchProvider → 不显示「切换供应商」", () => {
    render(
      <RunErrorItem
        item={makeItem({ type: "quota_exceeded", retryable: false })}
        onResend={() => {}}
      />,
    );
    expect(
      screen.queryByRole("button", { name: /切换供应商/ }),
    ).not.toBeInTheDocument();
  });

  it("未传 onResend → 不显示「重新发送」（无可重放内容，与 retryable 无关）", () => {
    render(<RunErrorItem item={makeItem({ type: "timeout", retryable: true })} />);
    expect(screen.queryByRole("button", { name: /重新发送/ })).not.toBeInTheDocument();
  });

  it("onSwitchProvider → 显示「切换供应商」并触发回调", () => {
    const onSwitch = vi.fn();
    render(
      <RunErrorItem
        item={makeItem({ type: "quota_exceeded" })}
        onSwitchProvider={onSwitch}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /切换供应商/ }));
    expect(onSwitch).toHaveBeenCalledTimes(1);
  });

  it("quota_exceeded(retryable=false) + onSwitchProvider 且未传 onResend → 切换供应商升为 primary", () => {
    render(
      <RunErrorItem
        item={makeItem({ type: "quota_exceeded", retryable: false })}
        onSwitchProvider={() => {}}
      />,
    );
    expect(
      screen.getByRole("button", { name: /切换供应商/ }).className,
    ).toContain("bg-primary");
  });

  it("未传 onSwitchProvider → 不显示「切换供应商」", () => {
    render(<RunErrorItem item={makeItem({ type: "quota_exceeded" })} />);
    expect(
      screen.queryByRole("button", { name: /切换供应商/ }),
    ).not.toBeInTheDocument();
  });
});

/* ------------------------------------------------------------------ */
/*  查看详情（折叠 raw + onViewDetail）                                */
/* ------------------------------------------------------------------ */

describe("task-09: 查看详情（展开 raw + onViewDetail 回调）", () => {
  const raw =
    "[ASSISTANT] API Error: Request rejected (429) · [1310][已达每周/每月上限]";

  it("默认折叠 raw；点击「查看详情」展开 raw 文本并切换为「收起详情」", () => {
    render(<RunErrorItem item={makeItem({ type: "quota_exceeded", raw })} />);
    expect(screen.queryByText(raw)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /查看详情/ }));
    expect(screen.getByText(raw)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /收起详情/ })).toBeInTheDocument();
  });

  it("再次点击 → 收起 raw", () => {
    render(<RunErrorItem item={makeItem({ type: "quota_exceeded", raw })} />);
    fireEvent.click(screen.getByRole("button", { name: /查看详情/ }));
    expect(screen.getByText(raw)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /收起详情/ }));
    expect(screen.queryByText(raw)).not.toBeInTheDocument();
  });

  it("raw=null 且无 onViewDetail → 不显示「查看详情」", () => {
    render(<RunErrorItem item={makeItem({ type: "unknown", raw: null })} />);
    expect(
      screen.queryByRole("button", { name: /查看详情/ }),
    ).not.toBeInTheDocument();
  });

  it("raw 为纯空白 → 不显示「查看详情」（无内容可展开）", () => {
    render(<RunErrorItem item={makeItem({ type: "unknown", raw: "   " })} />);
    expect(
      screen.queryByRole("button", { name: /查看详情/ }),
    ).not.toBeInTheDocument();
  });

  it("点击「查看详情」同时触发 onViewDetail 回调", () => {
    const onView = vi.fn();
    render(
      <RunErrorItem
        item={makeItem({ type: "timeout", raw })}
        onViewDetail={onView}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /查看详情/ }));
    expect(onView).toHaveBeenCalledTimes(1);
  });
});

/* ------------------------------------------------------------------ */
/*  无 actions 兜底                                                    */
/* ------------------------------------------------------------------ */

describe("task-09: 无 actions 时不渲染操作区", () => {
  it("unknown + 无回调 + 无 raw → 仅标题 / 原因 / hint，无任何按钮", () => {
    render(<RunErrorItem item={makeItem({ type: "unknown" })} />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    // 标题 + 兜底 hint 仍在
    expect(screen.getByText("运行失败")).toBeInTheDocument();
    expect(screen.getByText(MODEL_ERROR_META.unknown.defaultHint)).toBeInTheDocument();
  });
});

/* ------------------------------------------------------------------ */
/*  task-11 回归补强：多 actions 组合 / a11y / 无 raw 回调边界          */
/* ------------------------------------------------------------------ */

describe("task-11 回归补强：actions 组合 / a11y / 边界", () => {
  it("retryable=true + onResend + onSwitchProvider + raw → 三按钮同现，重发为 primary（其余 default）", () => {
    render(
      <RunErrorItem
        item={makeItem({ type: "rate_limited", retryable: true, raw: "限流原始文本" })}
        onResend={() => {}}
        onSwitchProvider={() => {}}
      />,
    );
    const resend = screen.getByRole("button", { name: /重新发送/ });
    const switchBtn = screen.getByRole("button", { name: /切换供应商/ });
    const detail = screen.getByRole("button", { name: /查看详情/ });
    // 重发为 primary（首个修复动作）；切换 / 详情为 default（非 primary）。
    expect(resend.className).toContain("bg-primary");
    expect(switchBtn.className).not.toContain("bg-primary");
    expect(detail.className).not.toContain("bg-primary");
  });

  it("查看详情 aria-expanded 随折叠状态切换（a11y 契约）", () => {
    render(<RunErrorItem item={makeItem({ type: "timeout", raw: "raw text" })} />);
    const btn = screen.getByRole("button", { name: /查看详情/ });
    expect(btn.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(btn);
    expect(btn.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(btn);
    expect(btn.getAttribute("aria-expanded")).toBe("false");
  });

  it("raw=null + onViewDetail → 仍显示「查看详情」，点击触发回调但不渲染 raw <pre>", () => {
    const onView = vi.fn();
    const { container } = render(
      <RunErrorItem
        item={makeItem({ type: "unknown", raw: null })}
        onViewDetail={onView}
      />,
    );
    // 无 raw 但传了 onViewDetail → 查看详情按钮仍渲染（showDetailBtn = hasRaw || onViewDetail）。
    fireEvent.click(screen.getByRole("button", { name: /查看详情/ }));
    expect(onView).toHaveBeenCalledTimes(1);
    // 无 raw 可展开，点击后不渲染 <pre> 原文区。
    expect(container.querySelector("pre")).not.toBeInTheDocument();
  });
});
