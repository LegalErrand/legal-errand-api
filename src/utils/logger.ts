type LogLevel = "info" | "warn" | "error" | "debug";

export interface ErrorLogPayload {
  name?: string;
  message: string;
  stack?: string;
  cause?: unknown;
  [key: string]: unknown;
}

const timestamp = () => new Date().toISOString();

/** Normalize any thrown value for structured logs */
export const serializeError = (err: unknown): ErrorLogPayload => {
  if (err instanceof Error) {
    const payload: ErrorLogPayload = {
      name: err.name,
      message: err.message,
      stack: err.stack,
    };
    if ("cause" in err && err.cause !== undefined) {
      payload.cause = serializeError(err.cause);
    }
    return payload;
  }
  if (typeof err === "string") {
    return { message: err };
  }
  try {
    return { message: JSON.stringify(err) };
  } catch {
    return { message: String(err) };
  }
};

const formatMessage = (level: LogLevel, message: string, meta?: unknown): string => {
  const base = `[${timestamp()}] [${level.toUpperCase()}] ${message}`;
  if (meta !== undefined) return `${base} ${JSON.stringify(meta, null, 2)}`;
  return base;
};

export const logger = {
  info: (message: string, meta?: unknown) => {
    console.log(formatMessage("info", message, meta));
  },
  warn: (message: string, meta?: unknown) => {
    console.warn(formatMessage("warn", message, meta));
  },
  error: (message: string, meta?: unknown) => {
    console.error(formatMessage("error", message, meta));
  },
  debug: (message: string, meta?: unknown) => {
    if (process.env.NODE_ENV !== "production") {
      console.debug(formatMessage("debug", message, meta));
    }
  },
  /** Log an error with message, stack, and optional request/context fields */
  logError: (message: string, err?: unknown, meta?: Record<string, unknown>) => {
    console.error(
      formatMessage("error", message, {
        ...meta,
        error: err !== undefined ? serializeError(err) : undefined,
      })
    );
  },
};
