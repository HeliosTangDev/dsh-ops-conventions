// 把宿主提供的 @deepseek-ai/dsh-llm 重定向到测试桩
export async function resolve(specifier, context, next) {
  if (specifier === "@deepseek-ai/dsh-llm") {
    return { url: new URL("./dsh-llm-stub.mjs", import.meta.url).href, shortCircuit: true };
  }
  return next(specifier, context);
}
