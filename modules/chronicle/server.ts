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
import { orgNamesOf, termsOf } from "./backend/pack.ts";

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

/** chronicle 需要的主题形状；方向/形态的词表与公司的名字取自行业包（见 backend/pack.ts）。 */
function toChronicleTopic(ask: TopicPageAsk): ChronicleTopic {
  return { slug: ask.topic.slug, group: ask.topic.group, entityId: ask.topic.entityId, terms: termsOf(ask.topic.slug), orgNames: orgNamesOf(ask.topic.slug) };
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
        // 索引是一分钟前的；本模块点名的那些报道要按「现在」重读一遍（TopicPageAsk 的约定），
        // 所以分数、标签、事实主体改了、或者报道被撤回，都在这一页立刻生效，不用等索引过期。
        // 公司看策展历史（modules/chronicle 读 industry/chronicles/{slug}.json）。
        const history = topic.group === "company" ? curatedChronicle(topic.slug) : undefined;
        const named = chronicleReadReports(ask.members.map(toReport), { now: ask.now, through: history?.through });
        return {
          recheck: named.map((r) => r.id),
          part: (current: ReadonlyMap<string, TopicMember>) => {
            // 只留还是这个主题成员的：掉了的（撤回、换标签、改主体）就不进大事记。
            const shown = named.flatMap((r) => {
              const now = current.get(r.id);
              return now && now.topics.includes(topic.slug) ? [toReport(now)] : [];
            });
            const window = { now: ask.now, through: history?.through };
            const picked = selectTopicChronicle(topic, shown, window);
            const part: ChroniclePart = {
              kinds: CHRONICLE_KINDS,
              chronicle: topic.group !== "company" ? picked : [],
              milestones: topic.group === "company" ? companyMilestones(history, picked) : [],
              highlights: selectTopicHighlights(topic, shown, window),
            };
            return part;
          },
        };
      },
    },
  },
};

