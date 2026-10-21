// 测试桩：真实运行时由 DSH 宿主提供 @deepseek-ai/dsh-llm
export function createUserMessage({ content, source } = {}) {
  return { role: "user", content, source };
}
