// 本模块接到网页上的部分（apps/web/app/modules.ts 的 WebModule；清单在 site/modules/web.ts）。
// 页面本身在 module.ts 里声明；这里加桌面侧栏、手机底栏的「工具」标签和「我的」页的入口。
import { defineWebModule, type WebModule } from "@aihot/web/modules";
import { IconChart, IconDoc, IconSparkles, IconTrendUp, IconUsers } from "@aihot/web/components/icons";

export const xProfileWebModule: WebModule = defineWebModule({
  name: "x-profile",
  sidebar: {
    section: "工具",
    items: [
      { to: "/x-people/growth", label: "涨粉榜", icon: IconTrendUp },
      { to: "/x-people", label: "博主画像", icon: IconUsers },
      { to: "/x-people/growth/report", label: "本周观察", icon: IconDoc },
      { to: "/x-people/today", label: "今天发什么", icon: IconSparkles },
      { to: "/x-people/algorithm", label: "算法视角", icon: IconChart },
    ],
  },
  // 手机底栏：排在「我的」左边，落地页是涨粉榜。
  tabs: [{ key: "x-tools", to: "/x-people/growth", label: "工具", icon: IconTrendUp }],
  tools: [
    { to: "/x-people/growth", label: "涨粉榜", icon: <IconTrendUp size={20} /> },
    { to: "/x-people", label: "博主画像", icon: <IconUsers size={20} /> },
    { to: "/x-people/growth/report", label: "本周观察", icon: <IconDoc size={20} /> },
    { to: "/x-people/today", label: "今天发什么", icon: <IconSparkles size={20} /> },
    { to: "/x-people/algorithm", label: "算法视角", icon: <IconChart size={20} /> },
  ],
  // 后台「内容」组里的入口：读者提交的收录申请，徽章是待审条数（server.ts 的 admin.counts）。
  admin: {
    content: [
      { to: "/admin/x-people", label: "账号收录", count: "x-requests", tone: "accent" },
      { to: "/admin/x-collect", label: "采集成本" },
    ],
  },
});
