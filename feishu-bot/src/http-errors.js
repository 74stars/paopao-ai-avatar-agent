export function publicHttpFailure(error, correlationId) {
  const invalidRequest = error instanceof SyntaxError;
  return {
    status: invalidRequest ? 400 : 500,
    body: {
      error: {
        code: invalidRequest ? "INVALID_REQUEST" : "INTERNAL_ERROR",
        message: invalidRequest ? "请求内容格式有误。" : "请求未能完成。",
        correlationId,
      },
    },
  };
}

export function publicHttpFailureLog(failure) {
  return `[paopao-feishu-bot] ${failure.body.error.code} ${failure.body.error.correlationId}`;
}
