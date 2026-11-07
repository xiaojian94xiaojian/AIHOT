// Go 套餐额度的可见性：每 30 分钟问一次网关的 GET {LLM_BASE_URL}/usage（只读，不花额度），
// 把滚动/周/月三个窗口的百分比与样本存进 settings，并在快用尽时报给站主。
//
// 额度按 key 算，所以换 key 后百分比会重新算：状态里记密钥指纹，换没换一眼能看出来。
// 框架不 import 本模块（site/modules/server.ts 负责装），所以合并上游更新时不会冲突。
import type { ServerModule } from "@aihot/backend/modules";
import { quotaFindings, readQuota, refreshQuota } from "./backend/quota.ts";

export const goQuotaServerModule: ServerModule = {
  name: "go-quota",
  schedules: [
    {
      name: "go.quota",
      cron: "*/30 * * * *",
      missed: "skip",
      run: () => refreshQuota(),
      // 从没查过（新站、或状态被清掉）时启动就跑一次，不必等下一个半点。
      runOnStart: async () => (await readQuota()) === null,
    },
  ],
  alerts: async (now) => {
    const state = await readQuota();
    return state ? quotaFindings(state, now) : [];
  },
};
