// 原来的「本周观察」页已并进涨粉周报（账号观察现在和周报的数据段在同一页）。
// 保留这个地址做 301，旧链接和收藏不会 404。
import { redirect } from "react-router";

export function loader() {
  return redirect("/x-people/weekly", 301);
}

export default function GrowthReportRedirect() {
  return null;
}
