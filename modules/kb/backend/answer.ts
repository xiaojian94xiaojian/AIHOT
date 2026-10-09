// 知识库给 AI agent 读的 Markdown（`/api/v1/agent/kb*` 与同名的 MCP 工具）。
//
// 用引擎的 answer() 拼版式，所以外部资料被围在「不可信外部资料」分隔区里；
// 提示语也一样：只根据给的内容回答，不要用训练记忆补。
import { answer, NO_INTERNALS, stamp } from "@aihot/backend/publication/agent";
import type { NoteRef } from "./read.ts";

const KIND_LABEL: Record<string, string> = { event: "事件", report: "报告", item: "精选" };

export function noteKindLabel(kind: string): string {
  return KIND_LABEL[kind] ?? kind;
}

/** 一行笔记：标题、类型/时间/标签、来源链接、正文首段。 */
function noteLines(note: NoteRef, detailed: boolean): string[] {
  const first = note.body
    .split(/\n{2,}/)
    .map((p) => p.replace(/^#+\s*/gm, "").replace(/\s+/g, " ").trim())
    .find((p) => p && !p.startsWith("（"));
  const refs = note.frontmatter.source_refs.slice(0, detailed ? 5 : 2);
  return [
    `- ${note.frontmatter.title}（知识库 ${note.id}）`,
    `  ${noteKindLabel(note.kind)} · 更新 ${stamp(note.frontmatter.updated_at)} · 标签 ${note.frontmatter.tags.join("、") || "无"}`,
    ...(first ? [`  摘要：${first.slice(0, detailed ? 300 : 160)}`] : []),
    ...refs.map((url, i) => `  ${i === 0 ? "原文" : "另见"}：${url}`),
    ...(note.frontmatter.source_refs.length > refs.length ? [`  另有 ${note.frontmatter.source_refs.length - refs.length} 个来源，见知识库卡片`] : []),
  ];
}

/** kb_recent / kb_search：列出的笔记 + 回答提示。 */
export function notesAnswer(title: string, intro: string, notes: readonly NoteRef[], hints: string[] = []): string {
  if (!notes.length) {
    return answer([`# ${title}`, "", `${intro}：没有符合条件的笔记。`], null, [
      "如实告诉用户知识库里暂时没有；可以换关键词、换类型再试一次。",
      "不要用训练记忆补成「知识库里的内容」。",
      ...hints,
      NO_INTERNALS,
    ]);
  }
  const data = notes.flatMap((note, i) => [`${i + 1}.`, ...noteLines(note, i < 5), ""]);
  return answer([`# ${title}`, "", `${intro}：共 ${notes.length} 条，新的在前；时间为北京时间。`], data, [
    "按下标顺序讲，每条说清是什么、什么时候、出自哪里；原文链接要给出来。",
    "只根据上面的内容回答；用户要更细的内容时让他打开对应的事件页或知识库。",
    ...hints,
    NO_INTERNALS,
  ]);
}

/** kb_topics：知识库里有哪些主题/分类，各有多少张卡。 */
export function tagsAnswer(tags: ReadonlyArray<{ tag: string; count: number }>): string {
  if (!tags.length) {
    return answer(["# 知识库主题", "", "知识库还没有内容（导出作业可能还没跑过）。"], null, [
      "如实告诉用户知识库还是空的。",
      NO_INTERNALS,
    ]);
  }
  const data = tags.map((t) => `- ${t.tag}：${t.count} 张卡片`);
  return answer(["# 知识库主题", "", `共 ${tags.length} 个标签，按卡片数排列。`], data, [
    "用户想了解某个主题时，用它的标签再查一次知识库。",
    "标签里的 radar/event/report/item 是类型标记，不是主题。",
    NO_INTERNALS,
  ]);
}
