// 账号初标：模型给中文区账号标类型与主类目，写进 x_account_meta；列表和画像页优先用标注。
import "../../../tests/setup.ts";
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { closeDb, sql } from "@aihot/backend/db";
import { installModules } from "@aihot/backend/modules";
import { stub } from "../../../tests/setup.ts";
import { xProfileServerModule } from "../server.ts";
import { labelAccounts } from "../backend/label.ts";
import { listPeople, loadPerson } from "../backend/data.ts";

installModules([xProfileServerModule]);

let server: Awaited<ReturnType<typeof stub>> | null = null;
after(async () => {
  await server?.close();
  await closeDb();
});

const ANSWER = { kind: "builder", category: "product", confidence: 0.82, reason: "帖子以产品发布和工具测评为主" };

test("the model's labels override the code's kind table on the list and the profile", async () => {
  server = await stub(() => ({
    id: "chatcmpl-label",
    object: "chat.completion",
    choices: [{ index: 0, message: { role: "assistant", content: JSON.stringify(ANSWER) }, finish_reason: "stop" }],
    usage: { prompt_tokens: 60, completion_tokens: 20, total_tokens: 80 },
  }));
  process.env.LLM_BASE_URL = `${server.url}/v1`;
  process.env.LLM_API_KEY = "test-key";
  process.env.LLM_MODEL = "test-model";
  await sql`UPDATE budgets SET per_minute = 1000, per_hour = 10_000, per_day = 100_000 WHERE service = 'llm'`;

  await sql`TRUNCATE x_account_meta`;
  await sql`DELETE FROM articles WHERE source_id IN ('x-account-lab-a', 'x-account-lab-b')`;
  await sql`
    INSERT INTO sources (id, name, kind, config) VALUES
      ('x-account-lab-a', '@LabA', 'x_search', ${sql.json({ query: "from:LabA -filter:replies" })}),
      ('x-account-lab-b', '@LabB', 'x_search', ${sql.json({ query: "from:LabB -filter:replies" })})
    ON CONFLICT (id) DO NOTHING`;
  const now = Date.now();
  let id = 0;
  const post = (sourceId: string, handle: string, days: number, views: number) => {
    id += 1;
    const at = new Date(now - days * 86_400_000);
    return sql`
      INSERT INTO articles (id, source_id, identity_key, url, title, language, published_at, discovered_at, timeline_at, raw, x_post)
      VALUES (${`lab-${id}`}, ${sourceId}, ${`test:lab-${id}`}, ${`https://x.com/lab/${id}`}, ${`lab ${id}`}, 'zh', ${at}, ${at}, ${at},
              ${sql.json({ views })}, ${sql.json({ handle, lang: "zh", text: `关于产品 ${id} 的一条帖子` })})`;
  };
  for (const days of [2, 3, 4, 5, 6]) await post("x-account-lab-a", "LabA", days, 9000);
  for (const days of [2, 3, 4, 5, 6]) await post("x-account-lab-b", "LabB", days, 3000);

  const result = await labelAccounts({ limit: 2 });
  assert.equal(result.labeled, 2);
  assert.equal(result.skipped, 0);
  assert.equal(server.hits(), 2);

  const people = await listPeople();
  const labA = people.people.find((person) => person.handle === "LabA")!;
  assert.equal(labA.kind, "builder", "标注覆盖了代码里的类型");
  assert.equal(labA.category, "product");

  const person = await loadPerson("LabA");
  assert.equal(person?.person.kind, "builder");
  assert.equal(person?.person.category, "product");
});
