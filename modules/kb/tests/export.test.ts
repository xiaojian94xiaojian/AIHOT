// 落盘：三类卡片都写出来、frontmatter 合契约、重复导出幂等（内容没变的文件一个字节都不动）、
// 导出过程中不出现半成品、inbox 结束为空、kb-index.json 与磁盘一致。
//
// 事件卡的内容完全由「库里公开的东西」决定，所以这里要造真数据：入库→分析→分组→发布→算热榜。
import "../../../tests/setup.ts";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";

// 知识库写在 AIHOT_DATA_DIR 下，所以先把这个目录指到临时目录，再导入会读配置的模块。
const DATA = await mkdtemp(path.join(os.tmpdir(), "kb-export-"));
process.env.AIHOT_DATA_DIR = DATA;

import type { Seeded } from "./seed.ts";
const { closeDb, sql } = await import("@aihot/backend/db");
const { stopBoss } = await import("@aihot/backend/jobs/queue");
const { exportKb } = await import("../backend/export.ts");
const { loadIndex, readNote, saveIndex, verifyIndex } = await import("../backend/read.ts");
const { inboxCount, kbRetention, withdrawStories } = await import("../backend/prune.ts");
const { archiveDir, notesDir, kbRoot, parseNote } = await import("../backend/layout.ts");
const { seedKb } = await import("./seed.ts");

const T = `kb-${Date.now().toString(36)}`;
let seeded: Seeded;

before(async () => {
  seeded = await seedKb(T);
});

after(async () => {
  await stopBoss();
  await closeDb();
  await rm(DATA, { recursive: true, force: true });
});

/** 目录下所有 .md 文件的相对路径。 */
async function noteFiles(dir = notesDir()): Promise<string[]> {
  const out: string[] = [];
  const walk = async (d: string) => {
    for (const entry of await readdir(d, { withFileTypes: true }).catch(() => [])) {
      const file = path.join(d, entry.name);
      if (entry.isDirectory()) await walk(file);
      else if (entry.name.endsWith(".md")) out.push(path.relative(kbRoot(), file).split(path.sep).join("/"));
    }
  };
  await walk(dir);
  return out.sort();
}

async function mtimes(): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  for (const rel of await noteFiles()) out.set(rel, (await stat(path.join(kbRoot(), rel))).mtimeMs);
  return out;
}

test("三类卡片都落盘：事件卡 / 报告卡 / 精选卡", async () => {
  const result = await exportKb();
  assert.ok(result.counts.event >= 1, `事件卡应该至少 1 张（实际 ${result.counts.event}）`);
  assert.ok(result.counts.report >= 1, `报告卡应该至少 1 张（实际 ${result.counts.report}）`);
  assert.ok(result.counts.item >= 1, `精选卡应该至少 1 张（实际 ${result.counts.item}）`);

  const files = await noteFiles();
  assert.ok(files.some((f) => f.startsWith("notes/events/")), `事件卡在 notes/events/ 下：${files.join(", ")}`);
  assert.ok(files.some((f) => f.startsWith("notes/reports/daily/")), "报告卡在 notes/reports/daily/ 下");
  assert.ok(files.some((f) => f.startsWith("notes/items/")), "精选卡在 notes/items/ 下");

  // 契约里的顶层目录都在（projects/ 是第二期的地方，先建出来）。
  for (const dir of ["inbox", "notes", "archive", "projects"]) {
    assert.ok((await stat(path.join(kbRoot(), dir))).isDirectory(), `${dir}/ 存在`);
  }
});

test("每一张卡片都合契约：9 个字段、正文首行是标题、来源都是原文链接", async () => {
  for (const rel of await noteFiles()) {
    const text = await readFile(path.join(kbRoot(), rel), "utf8");
    const note = parseNote(text);
    assert.ok(note, `${rel} 能被解析（恰好 9 个字段、正文非空）`);
    assert.deepEqual(Object.keys(note.frontmatter), ["id", "title", "created_at", "updated_at", "tags", "source_refs", "status", "ai_access"]);
    assert.ok(note.frontmatter.title.trim().length > 0, `${rel} 有标题`);
    assert.equal(note.frontmatter.id, path.basename(rel, ".md"), "文件名就是卡片 id");
    assert.equal(note.body.split("\n")[0], `# ${note.frontmatter.title}`, `${rel} 正文首行是 # 标题`);
    assert.deepEqual(note.frontmatter.tags.slice(0, 2), ["radar", note.frontmatter.tags[1]], `${rel} 前两个标签是 radar 与类型`);
    for (const ref of note.frontmatter.source_refs) assert.match(ref, /^https?:\/\//, `${rel} 的来源引用是 URL`);
    assert.equal(/\n\s*\n\s*$/.test(text), false, `${rel} 没有多余的尾部空行`);
  }
});

test("事件卡与报告卡的内容：摘要、热度、时间线、原文链接", async () => {
  const event = await readNote(`kb-event-${seeded.storyPublicId}`);
  assert.ok(event, "事件卡按公开 id 命名");
  assert.equal(event.frontmatter.title, `事件标题-${T}`);
  assert.deepEqual(event.frontmatter.source_refs, [seeded.urls.second, seeded.urls.first], "代表报道在前，其余按时间线顺序");
  assert.ok(event.body.includes("## 热度"));
  assert.ok(event.body.includes("## 时间线"));
  assert.ok(event.body.includes(`[后续报道-${T}](${seeded.urls.second})`), "时间线里的原文链接可点");

  const report = await readNote(`kb-report-daily-${seeded.dailyKey}`);
  assert.ok(report, "报告卡按 kind+key 命名");
  assert.deepEqual(report.frontmatter.source_refs, [seeded.urls.first]);
  assert.ok(report.body.includes(`今天的导语-${T}`));
});

test("幂等：同一份内容再导一次，文件一个字节都不动", async () => {
  const before = await mtimes();
  const again = await exportKb();
  const after = await mtimes();
  assert.ok(before.size > 0);
  assert.deepEqual([...after.keys()], [...before.keys()], "文件集合不变");
  for (const [file, at] of before) assert.equal(after.get(file), at, `${file} 没有被重写`);
  assert.deepEqual([...new Set(again.actions)], ["unchanged"], "第二次导出没有任何写盘或移动");
});

test("原子：导出结束 inbox 为空，磁盘上没有半成品", async () => {
  assert.equal(await inboxCount(), 0, "inbox/ 结束为空");
  // 留一个残留临时文件，下一次导出必须把它清掉。
  const inbox = path.join(kbRoot(), "inbox");
  await writeFile(path.join(inbox, "左一半.md.12345.tmp"), "---\nid: 半成品", "utf8");
  await exportKb();
  assert.equal(await inboxCount(), 0, "残留的临时文件会被清掉");
  assert.equal((await noteFiles()).some((f) => f.includes(".tmp")), false, "notes/ 下不会出现临时文件");
});

test("kb-index.json 与磁盘一致", async () => {
  const index = await loadIndex();
  assert.ok(index, "导出会写出清单");
  assert.equal(index.schemaVersion, 1);
  assert.deepEqual([...index.notes].map((n) => n.path).sort(), await noteFiles(), "清单里每一行都对得上一个文件");
  assert.deepEqual(index.counts, { event: index.notes.filter((n) => n.kind === "event").length, report: index.notes.filter((n) => n.kind === "report").length, item: index.notes.filter((n) => n.kind === "item").length });
  const check = await verifyIndex();
  assert.deepEqual([check.missing, check.changed], [[], []], "每一行的 sha256 与文件内容一致");

  // 有人手改了文件：清单与磁盘不一致这件事本身能被发现。
  const victim = index.notes[0]!;
  await writeFile(path.join(kbRoot(), victim.path), "被手改了", "utf8");
  const broken = await verifyIndex();
  assert.deepEqual(broken.changed, [victim.id]);
});

test("撤回：报道不再公开后，卡片离开 notes/ 并同步进 archive/ 与索引", async () => {
  // 钩子那条路径：按公开 id 移走（articleChanged 的 reduced 分支）。
  const moved = await withdrawStories(await storyIds());
  assert.deepEqual(moved.archived, [`kb-event-${seeded.storyPublicId}`]);
  assert.equal(await readNote(`kb-event-${seeded.storyPublicId}`), null, "索引里也没有它了");
  const archived = await readdir(path.join(archiveDir(), new Date().toISOString().slice(0, 7))).catch(() => []);
  assert.ok(archived.some((f) => f.endsWith(`kb-event-${seeded.storyPublicId}.md`)), "卡片进了 archive/");
  assert.equal((await noteFiles()).some((f) => f.includes(seeded.storyPublicId)), false, "notes/ 下已经没有它");

  // 内容其实还公开着：下一次导出把它写回来（撤回传播不是删除，事实源还是读取层）。
  await exportKb();
  assert.ok(await readNote(`kb-event-${seeded.storyPublicId}`), "还公开的事件会被重新导出");
  assert.equal((await verifyIndex()).missing.length, 0);

  // 真的撤回一条精选：公开内容变少 → 重新导出后卡片不再出现。
  await sql`UPDATE publications SET visibility = 'withdrawn' WHERE article_id = ${seeded.itemId}`;
  const after = await exportKb();
  assert.ok(after.counts.item >= 1, "同一事实的另一条报道仍然在");
  assert.equal(await readNote(`kb-item-${seeded.itemId}`), null, "撤回的精选不再有卡片");
  assert.equal((await noteFiles()).some((f) => f.includes(seeded.itemId)), false);
});

test("合并掉的事件：下一次导出后卡片不再出现（热榜与新卡都以当前事实为准）", async () => {
  const { upsertMaterial } = await import("@aihot/backend/content/materials");
  const { publishArticle } = await import("@aihot/backend/publication/publish");
  const { computeHotRanking } = await import("@aihot/backend/events/hot");
  const { randomUUID } = await import("node:crypto");
  const sources = await sql<{ id: string }[]>`SELECT id FROM sources WHERE id LIKE ${`kb-%-${T}`} ORDER BY id`;
  const [storyA] = await sql<{ id: number }[]>`INSERT INTO stories (public_id, title) VALUES (${randomUUID()}, ${`待合并事件-${T}`}) RETURNING id`;
  for (const source of sources) {
    const { articleId } = await upsertMaterial({ sourceId: source.id, url: `https://example.com/kb/${T}/merge-${source.id}`, title: `合并前报道-${T}`, bodyText: "正文", bodyHtml: "<p>正文</p>", bodyStatus: "ok", via: "fetch", publishedAt: new Date() });
    await sql`INSERT INTO analyses (article_id, input_revision, origin, relevance, category, title_zh, summary_zh, score, selected)
              VALUES (${articleId}, 1, 'rule', 'pass', 'industry', ${`合并前报道-${T}`}, ${`合并前摘要-${T}`}, 80, true)`;
    const [fact] = await sql<{ id: number }[]>`INSERT INTO facts (public_id, story_id, title) VALUES (${`merge-${T}-${source.id}`}, ${storyA!.id}, ${`待合并事实-${T}`}) RETURNING id`;
    await sql`INSERT INTO fact_articles (fact_id, article_id, role) VALUES (${fact!.id}, ${articleId}, 'report')`;
    await sql`UPDATE articles SET grouping_status = 'complete', grouped_at = now() WHERE id = ${articleId}`;
    // 证据信号：热榜按它数参与方，没有它这条事件不上榜。
    await sql`INSERT INTO story_signals (story_id, article_id, participant_key, source_id, kind, observed_at)
              VALUES (${storyA!.id}, ${articleId}, ${`source:${source.id}`}, ${source.id}, 'editorial', now())`;
    await publishArticle(articleId, { releasedAt: new Date(Date.now() - 60_000) });
  }
  await computeHotRanking();
  await exportKb();
  const publicId = (await sql<{ public_id: string }[]>`SELECT public_id::text FROM stories WHERE id = ${storyA!.id}`)[0]!.public_id;
  assert.ok(await readNote(`kb-event-${publicId}`), "合并前它是榜上的一条");

  // 合并到另一个事件：它不再是自己的公开事件。
  const [target] = await sql<{ id: number }[]>`INSERT INTO stories (public_id, title) VALUES (${randomUUID()}, ${`幸存事件-${T}`}) RETURNING id`;
  await sql`UPDATE stories SET merged_into = ${target!.id} WHERE id = ${storyA!.id}`;
  const after = await exportKb();
  assert.equal(await readNote(`kb-event-${publicId}`), null, "合并掉的事件不再有自己的卡片");
  assert.equal((await noteFiles()).some((f) => f.includes(publicId)), false, "文件也不留在 notes/");
  assert.ok(after.swept.some((f) => f.includes(publicId)), "它是被扫进 archive/ 的，不是被删掉");
  assert.equal((await verifyIndex()).missing.length, 0, "索引跟着收敛");
});

test("保留作业：过期精选卡与超期 archive 文件被清掉", async () => {
  // 这一条放在最后：它把索引里所有精选卡的内容时间改到保留窗口之外，属于破坏性的检查。
  const index = (await loadIndex())!;
  const items = index.notes.filter((n) => n.kind === "item");
  assert.ok(items.length >= 1);
  // 把精选卡的内容时间改到保留窗口之外（改 frontmatter 里的 created_at，清单也一起改：
  // 保留作业按索引里的时间判断）。
  const old = "2020-01-01T00:00:00.000Z";
  for (const item of items) {
    const text = await readFile(path.join(kbRoot(), item.path), "utf8");
    await writeFile(path.join(kbRoot(), item.path), text.replace(item.created_at, old), "utf8");
    item.created_at = old;
  }
  await saveIndex(index);

  // archive/ 里放一个 8 天前的老文件。
  const oldArchive = path.join(archiveDir(), "2019-01", "old.md");
  await mkdir(path.dirname(oldArchive), { recursive: true });
  await writeFile(oldArchive, "老卡片", "utf8");
  const eightDaysAgo = new Date(Date.now() - 8 * 86_400_000);
  await utimes(oldArchive, eightDaysAgo, eightDaysAgo);

  const result = await kbRetention();
  assert.equal(result.deletedItems, items.length, "过期的精选卡被删掉");
  assert.equal(result.deletedArchived, 1, "archive/ 里超过 7 天的文件被真删");
  assert.equal(result.clearedInbox, 0);
  const left = (await loadIndex())!;
  assert.deepEqual(left.notes.filter((n) => n.kind === "item"), [], "索引同步更新");
  assert.equal((await noteFiles()).length, left.notes.length, "磁盘与索引一致");
});

/** 我们这条事件的数据库 id。 */
async function storyIds(): Promise<number[]> {
  const rows = await sql<{ id: number }[]>`SELECT id FROM stories WHERE public_id = ${seeded.storyPublicId}`;
  return rows.map((r) => Number(r.id));
}
