// 本模块接到网页上的部分（apps/web/app/modules.ts 的 WebModule；清单在 site/modules/web.ts）。
// 只提供主题页的一个部件，没有自己的页面、导航项或后台页。
import type { WebModule } from "@aihot/web/modules";

export const chronicleWebModule: WebModule = {
  name: "chronicle",
  // 部件的加载函数随主题页的代码一起加载（docs/architecture.md 的「模块」）。
  // 网页代码都放 web/ 子目录：apps/web/tsconfig.json 只 include modules/*/web.tsx 与 modules/*/web/**/*。
  topicPage: () => import("./web/topic-part"),
};
