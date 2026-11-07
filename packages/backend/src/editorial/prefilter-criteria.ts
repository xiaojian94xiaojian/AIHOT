/** The prefilter's three labels, in the words industry/prompts/prefilter.md uses. Shared by the chat
 * model's prompt and by Jev's criteria so both ask the same question. */
export const PREFILTER_CRITERIA = {
  PASS: "内容主体是 AI：模型、Agent、评测、开发工具、生成作品与用法、机器人、AI 业务经营或社会影响；或产品的核心功能本身就是 AI",
  BLOCK: "内容主体不是 AI，AI 只是顺带出现：普通消费电子、营收股价、专利标准、只谈商业的人物观点",
  UNKNOWN: "只有代词、表情、链接或无法识别的名称，提供的文字不足以判断相关性",
} as const;
