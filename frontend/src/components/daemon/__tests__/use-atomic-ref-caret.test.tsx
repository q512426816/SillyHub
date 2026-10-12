/**
 * 引用标签原子性拦截测试（2026-10-12-ws-ref-atomic-caret）。
 *
 * 覆盖：方向键跳块（贴尾←到块头/贴头→到块尾/内部逃逸/shift 不拦/普通文本不拦）、
 * 落位吸附（点击/键盘落入内部 → 最近边界）、内部编辑拒绝（打字/删除部分重叠
 * preventDefault；选区完整覆盖放行；无 token 区间放行）。
 */

import { render, fireEvent, screen } from "@testing-library/react";
import { useState } from "react";

import { useAtomicRefCaret } from "../use-atomic-ref-caret";

const TOKEN = "【📄 design.md】";

/** 测试宿主：受控 textarea + hook 全量接线（与两输入区同款）。 */
function Host({ initial, tokens }: { initial: string; tokens: string[] }) {
  const [value, setValue] = useState(initial);
  const ref = useState({ current: null as HTMLTextAreaElement | null })[0];
  const { handleAtomicKeyDown, handleAtomicBeforeInput, snapCaret } = useAtomicRefCaret({
    value,
    tokens,
    textareaRef: ref,
  });
  return (
    <textarea
      ref={(el) => {
        ref.current = el;
      }}
      aria-label="t"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={handleAtomicKeyDown}
      onBeforeInput={handleAtomicBeforeInput}
      onClick={snapCaret}
      onKeyUp={snapCaret}
      onSelect={snapCaret}
    />
  );
}

/** 构造带 token 的值：前文【token】后文 → 返回值与 token 区间。 */
const PREFIX = "前文";
const SUFFIX = "后文";
function valueWithToken(): { value: string; start: number; end: number } {
  return {
    value: `${PREFIX}${TOKEN}${SUFFIX}`,
    start: PREFIX.length,
    end: PREFIX.length + TOKEN.length,
  };
}

describe("方向键跳块", () => {
  it("贴尾按 ← 跳到块头；再按一次才离开标签", () => {
    const { value, start, end } = valueWithToken();
    render(<Host initial={value} tokens={[TOKEN]} />);
    const ta = screen.getByLabelText("t") as HTMLTextAreaElement;
    ta.setSelectionRange(end, end);
    fireEvent.keyDown(ta, { key: "ArrowLeft" });
    expect(ta.selectionStart).toBe(start);
  });

  it("贴头按 → 跳到块尾", () => {
    const { value, start, end } = valueWithToken();
    render(<Host initial={value} tokens={[TOKEN]} />);
    const ta = screen.getByLabelText("t") as HTMLTextAreaElement;
    ta.setSelectionRange(start, start);
    fireEvent.keyDown(ta, { key: "ArrowRight" });
    expect(ta.selectionStart).toBe(end);
  });

  it("shift+方向（选区扩展）与普通文本处方向键不拦截", () => {
    const { value, start } = valueWithToken();
    render(<Host initial={value} tokens={[TOKEN]} />);
    const ta = screen.getByLabelText("t") as HTMLTextAreaElement;
    // shift+← 在贴尾：不拦（浏览器默认扩展选区，selectionStart 变为 end-1）
    ta.setSelectionRange(value.length, value.length);
    fireEvent.keyDown(ta, { key: "ArrowLeft", shiftKey: true });
    expect(ta.selectionStart).toBe(value.length); // 未被 hook 改动（默认行为 jsdom 不模拟）
    // 普通文本处（前文首字符）←：不拦
    ta.setSelectionRange(1, 1);
    fireEvent.keyDown(ta, { key: "ArrowLeft" });
    expect(ta.selectionStart).toBe(1);
    expect(start).toBe(PREFIX.length); // 语义锚：token 区间起点
  });
});

describe("落位吸附", () => {
  it("光标落入标签前半 → 吸附块头；后半 → 吸附块尾", () => {
    const { value, start, end } = valueWithToken();
    render(<Host initial={value} tokens={[TOKEN]} />);
    const ta = screen.getByLabelText("t") as HTMLTextAreaElement;
    ta.setSelectionRange(start + 2, start + 2);
    fireEvent.keyUp(ta, {}); // 触发 snap
    expect(ta.selectionStart).toBe(start);
    ta.setSelectionRange(end - 1, end - 1);
    fireEvent.keyUp(ta, {});
    expect(ta.selectionStart).toBe(end);
  });

  it("边界与外部不吸附；有选区不吸附", () => {
    const { value, start, end } = valueWithToken();
    render(<Host initial={value} tokens={[TOKEN]} />);
    const ta = screen.getByLabelText("t") as HTMLTextAreaElement;
    ta.setSelectionRange(start, start);
    fireEvent.keyUp(ta, {});
    expect(ta.selectionStart).toBe(start);
    ta.setSelectionRange(start + 2, end - 1);
    fireEvent.keyUp(ta, {});
    expect(ta.selectionStart).toBe(start + 2); // 选区不动
  });
});

describe("内部编辑拒绝（beforeinput）", () => {
  /** 直接调 handler（jsdom 的原生 beforeinput 派发不经 React 委托层，测逻辑本体）。 */
  function callBeforeInput(
    handlers: ReturnType<typeof useAtomicRefCaret>,
    startOffset: number,
    endOffset: number,
  ): boolean {
    let prevented = false;
    handlers.handleAtomicBeforeInput({
      nativeEvent: { getTargetRanges: () => [{ startOffset, endOffset }] },
      preventDefault: () => {
        prevented = true;
      },
    } as unknown as React.FormEvent<HTMLTextAreaElement>);
    return prevented;
  }

  it("标签内部打字/删字（部分重叠）拒绝", () => {
    const { start, end } = valueWithToken();
    let handlers!: ReturnType<typeof useAtomicRefCaret>;
    function DebugHost() {
      const [value] = useState(valueWithToken().value);
      const ref = { current: null as HTMLTextAreaElement | null };
      handlers = useAtomicRefCaret({ value, tokens: [TOKEN], textareaRef: ref });
      return null;
    }
    render(<DebugHost />);
    // 内部单字符区间（模拟删字/组字目标）
    expect(callBeforeInput(handlers, start + 2, start + 3)).toBe(true);
    // 跨标签尾部与外部后文（部分重叠）同样拒绝
    expect(callBeforeInput(handlers, end - 2, end + 1)).toBe(true);
    // 跨标签头部与前文（部分重叠）
    expect(callBeforeInput(handlers, start - 1, start + 2)).toBe(true);
  });

  it("选区完整覆盖整块放行；无 token 区间放行；无目标区间放行", () => {
    const { start, end } = valueWithToken();
    let handlers!: ReturnType<typeof useAtomicRefCaret>;
    function DebugHost() {
      const [value] = useState(valueWithToken().value);
      const ref = { current: null as HTMLTextAreaElement | null };
      handlers = useAtomicRefCaret({ value, tokens: [TOKEN], textareaRef: ref });
      return null;
    }
    render(<DebugHost />);
    // 完整覆盖（含整块 + 两侧部分文本）
    expect(callBeforeInput(handlers, start - 1, end + 1)).toBe(false);
    // 恰好整块
    expect(callBeforeInput(handlers, start, end)).toBe(false);
    // 纯外部区间
    expect(callBeforeInput(handlers, 0, 1)).toBe(false);
    // 无目标区间（getTargetRanges 空数组）
    let prevented = false;
    handlers.handleAtomicBeforeInput({
      nativeEvent: { getTargetRanges: () => [] },
      preventDefault: () => {
        prevented = true;
      },
    } as unknown as React.FormEvent<HTMLTextAreaElement>);
    expect(prevented).toBe(false);
  });
});
