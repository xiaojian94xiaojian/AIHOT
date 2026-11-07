// 一次性脚本：把站主自己的账号加进采集池（和审核通过走同一条 createSource）。
//   docker exec aihot-worker-1 node /app/modules/x-profile/scripts/add-account.ts 1xiaojian
import { closeDb } from "@aihot/backend/db";
import { installModules } from "@aihot/backend/modules";
import { xProfileServerModule } from "../server.ts";
import { lookupAccount, reviewRequest, submitRequest } from "../backend/requests.ts";

installModules([xProfileServerModule]);

const handle = process.argv[2];
if (!handle) throw new Error("用法：add-account.ts <handle>");

const existing = await lookupAccount(handle);
if (existing.tracked) {
  console.log(JSON.stringify({ handle, status: "already tracked" }));
} else {
  await submitRequest({ handle, note: "站主自己的账号（基线用）", contact: null, ip: "script" });
  const result = await reviewRequest(handle, "approve", "站主账号", "script");
  console.log(JSON.stringify({ handle, result }));
}
await closeDb();
