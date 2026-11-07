// 一次性脚本：给中文区 Top100 标类型与主类目（模型），写进 x_account_meta。
//   docker exec aihot-worker-1 node /app/modules/x-profile/scripts/label-accounts.ts 100
import { closeDb } from "@aihot/backend/db";
import { installModules } from "@aihot/backend/modules";
import { xProfileServerModule } from "../server.ts";
import { labelAccounts } from "../backend/label.ts";

installModules([xProfileServerModule]);

const limit = Number(process.argv[2] ?? 100);
const summary = await labelAccounts({ limit });
console.log(JSON.stringify(summary));
await closeDb();
