// 主题页大事记的插口实现（packages/backend/src/modules.ts 的 ServerModule.topics.page）。
//
// 数据来自主题索引已经读好的成员（TopicPageAsk.members），本模块不再查库：
// 旧版这些字段长在 loadTopicPage 的返回上，4.0.0 改成由模块在 part 里给出，
// 所以同一份算法（./backend/chronicle.ts）原样可用。
import type { ServerModule, TopicPageAsk } from "@aihot/backend/modules";
import type { TopicMember } from "@aihot/backend/publication/topics";
import type { TopicKind, TopicMilestoneKind, TopicMonth } from "@aihot/contracts/site";
import {
  CHRONICLE_KINDS,
  chronicleReadReports,
  selectTopicChronicle,
  selectTopicHighlights,
  type ChronicleReport,
  type ChronicleTopic,
} from "./backend/chronicle.ts";
import { companyMilestones, curatedChronicle } from "./backend/curated.ts";

/** 本模块在 TopicPage.modules 下的名字。 */
const PART = "chronicle";

/** 一个索引成员就是一条报道；chronicle 的算法按这个形状读它。 */
function toReport(m: TopicMember): ChronicleReport {
  return {
    id: m.id,
    title: m.title,
    originalTitle: m.originalTitle,
    category: m.category,
    tags: m.tags,
    score: m.score,
    timelineAt: m.at,
    topicSlugs: m.topics,
    publishedAt: m.publishedAt,
    factPublishedAt: m.factPublishedAt,
    firstParty: m.firstParty,
    owner: null,
    factId: m.factId,
    factSubject: m.factSubject,
    factAction: m.factAction,
    factOccurredAt: m.factOccurredAt,
    storyPublicId: m.story,
    // 旧版的 sourceCount 来自主题索引里单独统计的来源数，索引不提供时按 1 计：
    // 它只在排序的并列项之间做次序，不影响哪些事件入选。
    sourceCount: 1,
    scope: m.scope,
  };
}

/** chronicle 需要的主题形状；方向/形态的词表在 industry/topics.json 的 chronicleTerms。 */
function toChronicleTopic(ask: TopicPageAsk): ChronicleTopic {
  const t = ask.topic as typeof ask.topic & { chronicleTerms?: string[]; orgNames?: string[] };
  const terms = t.chronicleTerms?.length
    ? new RegExp(`(${t.chronicleTerms.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`)
    : null;
  return { slug: t.slug, group: t.group, entityId: t.entityId, terms, orgNames: t.orgNames ?? [] };
}

export interface ChroniclePart {
  /** 每种里程碑怎么显示（kind -> 名称、轨道位置）。 */
  kinds: Record<TopicMilestoneKind, TopicKind>;
  /** 方向/形态：按月的时间线，最新在前。只有第一页有。 */
  chronicle: TopicMonth[];
  /** 公司：编年史带，最早在前。只有第一页有。 */
  milestones: ReturnType<typeof companyMilestones>;
  /** 最近 30 天最重要的事件。只有第一页有。 */
  highlights: ReturnType<typeof selectTopicHighlights>;
}

export const chronicleServerModule: ServerModule = {
  name: PART,
  topics: {
    page: {
      read(ask: TopicPageAsk) {
        const first = ask.page === 1;
        if (!first) return null;
        const topic = toChronicleTopic(ask);
        const reports = ask.members.map(toReport);
        // 公司看策展历史（modules/chronicle 读 industry/chronicles/{slug}.json）。
        const history = topic.group === "company" ? curatedChronicle(topic.slug) : undefined;
        const window = { now: ask.now, through: history?.through };
        const named = chronicleReadReports(reports, window);
        const picked = selectTopicChronicle(topic, named, window);
        const part: ChroniclePart = {
          kinds: CHRONICLE_KINDS,
          chronicle: topic.group !== "company" ? picked : [],
          milestones: topic.group === "company" ? companyMilestones(history, picked) : [],
          highlights: selectTopicHighlights(topic, named, window),
        };
        return { recheck: named.map((r) => r.id), part: () => part };
      },
    },
  },
};

