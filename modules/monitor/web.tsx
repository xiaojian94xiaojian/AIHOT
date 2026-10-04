// What this module adds to the web pages (apps/web/app/modules.ts, WebModule): the ways into /codex-reset
// and the admin's Codex 重置 page. Its pages come from module.ts (routes.ts).
import { defineWebModule, type WebModule } from "@aihot/web/modules";
import { IconHistory } from "@aihot/web/components/icons";

export const monitorWebModule: WebModule = defineWebModule({
  name: "monitor",
  // The desktop sidebar entry, in the section the old site kept it in (nav.ts before 4.0.0):
  // { to: "/codex-reset", label: "Tibo重置监控", icon: IconHistory }
  sidebar: { section: "模型", items: [{ to: "/codex-reset", label: "Tibo重置监控", icon: IconHistory }] },
  // The phone reaches it from 我的, as the old site did (routes/more.tsx before 4.0.0):
  // { to: "/codex-reset", label: "Tibo 重置监控", icon: <IconHistory size={20} /> }
  tools: [{ to: "/codex-reset", label: "Tibo 重置监控", icon: <IconHistory size={20} /> }],
  // The admin entry, where the old layout.tsx put it: the 内容 group, after 信源 and before 反馈.
  admin: { content: [{ to: "/admin/monitor", label: "Codex 重置", count: "monitor", tone: "accent" }] },
});
