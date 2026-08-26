"use client";

/**
 * FloatingMascot — 悬浮球宠物形象（2026-08-26 用户需求：小狗/小猫双选，
 * 本地记住选择，宠物式微交互）。
 *
 * 设计：chibi 头像风纯 SVG（零依赖、约 2KB），白身深紫五官粉腮——在品牌
 * 渐变球面上各主题皆清晰。动画三层（<style> 内命名空间 fm-，CSS 变量控速）：
 *   - 待机：尾巴慢摇（fm-wag 1.15s）+ 每 4.2s 眨眼（fm-blink）；
 *   - 悬停（宿主按钮 .group:hover）：蹦跳（fm-hop）+ 尾巴加速；
 *   - 会话进行（active）：快乐弯月眼（替换圆眼）+ 尾巴高频摇 + 轻快弹跳。
 *
 * 选择持久化：localStorage[sillyhub:floating-pet]（"dog" | "cat"，缺省 dog），
 * 由宿主读写（getFloatingPet/setFloatingPet），组件本身受控渲染。
 */
import { useId } from "react";

export type FloatingPet = "dog" | "cat";

const PET_STORAGE_KEY = "sillyhub:floating-pet";

export function getFloatingPet(): FloatingPet {
  if (typeof window === "undefined") return "dog";
  return window.localStorage.getItem(PET_STORAGE_KEY) === "cat" ? "cat" : "dog";
}

export function setFloatingPet(pet: FloatingPet): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(PET_STORAGE_KEY, pet);
}

/** 小狗（垂耳 + 鼻头 + 小舌 + 腮红）。 */
function DogFace({ active }: { active: boolean }) {
  return (
    <>
      {/* 尾巴（球右下探出，摇摆） */}
      <g className="fm-tail">
        <path
          d="M50 44 q9 3 8 -8 q-.5 -4 -3.5 -3 q-1.8 .8 -1 3 q.6 5 -4.5 4 z"
          fill="#fff"
          stroke="#e8e2f7"
          strokeWidth="1"
        />
      </g>
      {/* 垂耳 */}
      <path d="M15 26 q-7 2 -6 12 q.8 8 6 8 q4.5 0 4 -7 q-.4 -8 -4 -13 z" fill="#c9bdf0" />
      <path d="M49 26 q7 2 6 12 q-.8 8 -6 8 q-4.5 0 -4 -7 q.4 -8 4 -13 z" fill="#c9bdf0" />
      {/* 头 */}
      <circle cx="32" cy="33" r="17.5" fill="#fff" />
      {/* 顶部呆毛 */}
      <path d="M30 16 q1 -5 5 -5 q-2 1.5 -1.5 4 q2 -2 4.5 -1.5 q-4 1 -4 4.5 z" fill="#fff" />
      {/* 眼（active=快乐弯月，平时圆眼眨眼） */}
      {active ? (
        <g stroke="#3a2e52" strokeWidth="2.4" strokeLinecap="round" fill="none">
          <path d="M21.5 31 q3 -4 6 0" />
          <path d="M36.5 31 q3 -4 6 0" />
        </g>
      ) : (
        <g className="fm-eyes" fill="#3a2e52">
          <circle cx="24.5" cy="31" r="3" />
          <circle cx="39.5" cy="31" r="3" />
          <circle cx="25.6" cy="29.9" r="1" fill="#fff" />
          <circle cx="40.6" cy="29.9" r="1" fill="#fff" />
        </g>
      )}
      {/* 鼻嘴舌 */}
      <ellipse cx="32" cy="38.5" rx="3.2" ry="2.4" fill="#3a2e52" />
      <path d="M32 41 q0 3 -3.5 3 M32 41 q0 3 3.5 3" stroke="#3a2e52" strokeWidth="1.6" fill="none" strokeLinecap="round" />
      {active && <path d="M30 44 q2 3.4 4 0 q-.4 3 -2 3 q-1.6 0 -2 -3 z" fill="#ff9db4" />}
      {/* 腮红 */}
      <circle cx="18.5" cy="36.5" r="2.6" fill="#ffb3c7" opacity="0.75" />
      <circle cx="45.5" cy="36.5" r="2.6" fill="#ffb3c7" opacity="0.75" />
      {/* 爪（扒着球沿） */}
      <ellipse cx="24" cy="48.5" rx="4" ry="3" fill="#fff" />
      <ellipse cx="40" cy="48.5" rx="4" ry="3" fill="#fff" />
    </>
  );
}

/** 小猫（立耳粉内 + 胡须 + ω 嘴 + 卷尾）。 */
function CatFace({ active }: { active: boolean }) {
  return (
    <>
      {/* 卷尾（球左侧探出） */}
      <g className="fm-tail">
        <path
          d="M14 42 q-10 1 -9 -9 q.5 -5 4.5 -4.5 q3 .5 2 3.5 q-1.5 4.5 4 4 z"
          fill="#fff"
          stroke="#e8e2f7"
          strokeWidth="1"
        />
      </g>
      {/* 立耳（粉内耳） */}
      <path d="M17 25 l-2.5 -12 l11 6.5 z" fill="#fff" />
      <path d="M17.5 22.5 l-1.3 -6 l5.6 3.3 z" fill="#ffb3c7" />
      <path d="M47 25 l2.5 -12 l-11 6.5 z" fill="#fff" />
      <path d="M46.5 22.5 l1.3 -6 l-5.6 3.3 z" fill="#ffb3c7" />
      {/* 头 */}
      <circle cx="32" cy="34" r="17.5" fill="#fff" />
      {/* 眼 */}
      {active ? (
        <g stroke="#3a2e52" strokeWidth="2.4" strokeLinecap="round" fill="none">
          <path d="M21.5 32 q3 -4 6 0" />
          <path d="M36.5 32 q3 -4 6 0" />
        </g>
      ) : (
        <g className="fm-eyes" fill="#3a2e52">
          <circle cx="24.5" cy="32" r="3" />
          <circle cx="39.5" cy="32" r="3" />
          <circle cx="25.6" cy="30.9" r="1" fill="#fff" />
          <circle cx="40.6" cy="30.9" r="1" fill="#fff" />
        </g>
      )}
      {/* 鼻(倒三角) + ω 嘴 */}
      <path d="M30 39.5 l4 0 l-2 2.6 z" fill="#ff9db4" />
      <path d="M32 42.5 q0 2.5 -3 2.5 M32 42.5 q0 2.5 3 2.5" stroke="#3a2e52" strokeWidth="1.6" fill="none" strokeLinecap="round" />
      {/* 胡须 */}
      <g stroke="#c9bdf0" strokeWidth="1.3" strokeLinecap="round">
        <path d="M13 36 l-7 -1.5 M13.5 39.5 l-6.8 1" />
        <path d="M51 36 l7 -1.5 M50.5 39.5 l6.8 1" />
      </g>
      {/* 腮红 */}
      <circle cx="18.5" cy="38" r="2.6" fill="#ffb3c7" opacity="0.75" />
      <circle cx="45.5" cy="38" r="2.6" fill="#ffb3c7" opacity="0.75" />
      {/* 爪 */}
      <ellipse cx="24" cy="49.5" rx="4" ry="3" fill="#fff" />
      <ellipse cx="40" cy="49.5" rx="4" ry="3" fill="#fff" />
    </>
  );
}

/**
 * 宠物本体：容器 span 带 fm-body（active 弹跳；hover 由宿主 .group:hover 触发蹦跳）。
 * CSS 变量 --fm-wag-dur 控制 wag 速度（active 0.45s / 待机 1.15s）。
 */
export function FloatingMascot({
  pet,
  active = false,
  size = 34,
}: {
  pet: FloatingPet;
  active?: boolean;
  size?: number;
}) {
  const styleId = useId().replace(/[^a-zA-Z0-9]/g, "");
  return (
    <span
      aria-hidden
      data-testid="floating-mascot"
      data-pet={pet}
      data-active={active ? "true" : "false"}
      className="relative block"
      style={
        {
          width: size,
          height: size,
          "--fm-wag-dur": active ? "0.45s" : "1.15s",
        } as React.CSSProperties
      }
    >
      <style>{`
.fm-${styleId} .fm-eyes{animation:fm-blink-${styleId} 4.2s infinite;transform-origin:32px 32px;}
.fm-${styleId} .fm-tail{animation:fm-wag-${styleId} var(--fm-wag-dur,1.15s) ease-in-out infinite;transform-origin:32px 44px;}
.fm-${styleId} .fm-body{animation:fm-hop-${styleId} .9s ease-in-out infinite;animation-play-state:paused;}
.fm-${styleId}.fm-active .fm-body{animation-play-state:running;}
.group:hover .fm-${styleId} .fm-body{animation-play-state:running;}
@keyframes fm-blink-${styleId}{0%,91%,96%,100%{transform:scaleY(1)}93.5%{transform:scaleY(.12)}}
@keyframes fm-wag-${styleId}{0%,100%{transform:rotate(-9deg)}50%{transform:rotate(10deg)}}
@keyframes fm-hop-${styleId}{0%,100%{transform:translateY(0)}30%{transform:translateY(-2.4px)}55%{transform:translateY(.4px)}72%{transform:translateY(-1px)}}
`}</style>
      <svg
        viewBox="0 0 64 64"
        className={`fm-${styleId} block h-full w-full ${active ? "fm-active" : ""}`}
        role="presentation"
      >
        <g className="fm-body">{pet === "cat" ? <CatFace active={active} /> : <DogFace active={active} />}</g>
      </svg>
    </span>
  );
}
