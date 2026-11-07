// 主题页的大事记：一家公司的编年史带，或一个方向/形态的月份时间线，加最近 30 天的重点事件。
//
// 4.0.0 把主题大事记移出了框架（提交 1ca5d6d），这里是本站按模块机制把它接回来的实现。
// 框架只在 publication/topics.ts 里遍历 `topics.page` 插口，从不 import 本模块，
// 所以合并上游更新时不会冲突。
import type { ModuleDeclaration } from "@aihot/contracts/modules";

export const chronicleModule: ModuleDeclaration = {
  name: "chronicle",
  // 只提供主题页的一个部件，自己没有页面，也不需要 api 路径。
};
