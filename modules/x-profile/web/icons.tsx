// X 运营工具专属行内 SVG 图标（纯代码绘制，0 外部依赖，支持按需大小与主题色自适应）；
// 与公开站同义的图标统一从 apps/web/app/components/icons.tsx 转出，不再各画一套。
import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function Svg({ size = 16, children, ...rest }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      {children}
    </svg>
  );
}

/** 皇冠 / 冠军 */
export const IconCrown = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 19h16M4 19l1.5-11 4.5 4 2-6 2 6 4.5-4L20 19H4z" />
  </Svg>
);

/** 奖杯 */
export const IconTrophy = (p: IconProps) => (
  <Svg {...p}>
    <path d="M6 9H3a2 2 0 01-2-2V5a2 2 0 012-2h3M18 9h3a2 2 0 002-2V5a2 2 0 00-2-2h-3M6 3h12v7a6 6 0 01-12 0V3z" />
    <path d="M12 16v5M8 21h8" />
  </Svg>
);

/** 闪电 / 效率 */
export const IconZap = (p: IconProps) => (
  <Svg {...p}>
    <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
  </Svg>
);


/** 靶点 / 选题推荐 */
export const IconTarget = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="9" />
    <circle cx="12" cy="12" r="5" />
    <circle cx="12" cy="12" r="1.5" />
  </Svg>
);

/** 对话 / 回复 */
export const IconMessageCircle = (p: IconProps) => (
  <Svg {...p}>
    <path d="M21 11.5a8.5 8.5 0 01-13.8 6.6L3 19.5l1.6-4.1A8.5 8.5 0 1121 11.5z" />
  </Svg>
);

/** 回复动作箭头 */
export const IconReply = (p: IconProps) => (
  <Svg {...p}>
    <polyline points="9 17 4 12 9 7" />
    <path d="M20 18v-2a4 4 0 00-4-4H4" />
  </Svg>
);

/** 引用 */
export const IconQuote = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3 21c3 0 7-1 7-8V5c0-1.25-.75-2-2-2H4c-1.25 0-2 .75-2 2v6c0 1.25.75 2 2 2 1 0 1 0 1 1 0 2-1.5 5-2 7M15 21c3 0 7-1 7-8V5c0-1.25-.75-2-2-2h-4c-1.25 0-2 .75-2 2v6c0 1.25.75 2 2 2 1 0 1 0 1 1 0 2-1.5 5-2 7" />
  </Svg>
);

/** 发帖 / 发送 */
export const IconSend = (p: IconProps) => (
  <Svg {...p}>
    <line x1="22" y1="2" x2="11" y2="13" />
    <polygon points="22 2 15 22 11 13 2 9 22 2" />
  </Svg>
);

/** 链接 / 复制链接分享 */
export const IconLink = (p: IconProps) => (
  <Svg {...p}>
    <path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71" />
    <path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71" />
  </Svg>
);

/** 铃铛 / 提醒 */
export const IconBell = (p: IconProps) => (
  <Svg {...p}>
    <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9" />
    <path d="M13.73 21a2 2 0 01-3.46 0" />
  </Svg>
);

/** 警示 / 需核对 */
export const IconAlertTriangle = (p: IconProps) => (
  <Svg {...p}>
    <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
    <line x1="12" y1="9" x2="12" y2="13" />
    <line x1="12" y1="17" x2="12.01" y2="17" />
  </Svg>
);

/** 屏蔽 / 举报惩罚 */
export const IconShieldAlert = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    <line x1="12" y1="8" x2="12" y2="12" />
    <line x1="12" y1="16" x2="12.01" y2="16" />
  </Svg>
);




/** 转发 */
export const IconRepeat = (p: IconProps) => (
  <Svg {...p}>
    <polyline points="17 1 21 5 17 9" />
    <path d="M3 11V9a4 4 0 014-4h14M7 23l-4-4 4-4" />
    <path d="M21 13v2a4 4 0 01-4 4H3" />
  </Svg>
);





/** 标签 / 题材 */
export const IconTag = (p: IconProps) => (
  <Svg {...p}>
    <path d="M20.59 13.41l-7.17 7.17a2 2 0 01-2.83 0L2 12V2h10l8.59 8.59a2 2 0 010 2.82z" />
    <line x1="7" y1="7" x2="7.01" y2="7" />
  </Svg>
);

// 与公开站共用的图标：几何与描边由 apps/web/app/components/icons.tsx 统一维护，这里只转出。
export {
  IconCheck, IconClock, IconDoc, IconFilter, IconFlame, IconHeart, IconImage, IconSearch, IconUsers,
  IconTrendUp as IconTrendingUp, IconTrendDown as IconTrendingDown,
} from "@aihot/web/components/icons";
