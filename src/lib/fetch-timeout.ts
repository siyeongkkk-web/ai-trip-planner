export class ExternalRequestTimeoutError extends Error {
  constructor(serviceName: string, timeoutMs: number) {
    super(`${serviceName}响应超时（${Math.round(timeoutMs / 1000)}秒）。`);
    this.name = "ExternalRequestTimeoutError";
  }
}

/**
 * 所有外部服务请求都必须有截止时间。调用方取消和超时共用一个内部
 * AbortController，但会保留不同的错误语义，避免页面无限 loading。
 */
export async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs = 20_000,
  serviceName = "外部服务"
): Promise<Response> {
  const controller = new AbortController();
  let timedOut = false;
  const upstreamSignal = init.signal;
  const forwardAbort = () => controller.abort(upstreamSignal?.reason);
  if (upstreamSignal?.aborted) forwardAbort();
  else upstreamSignal?.addEventListener("abort", forwardAbort, { once: true });
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (error) {
    if (timedOut) throw new ExternalRequestTimeoutError(serviceName, timeoutMs);
    throw error;
  } finally {
    clearTimeout(timer);
    upstreamSignal?.removeEventListener("abort", forwardAbort);
  }
}
