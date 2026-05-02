type LogLevel = "info" | "warn" | "error" | "debug";

const timestamp = () => new Date().toISOString();

const formatMessage = (level: LogLevel, message: string, meta?: unknown): string => {
  const base = `[${timestamp()}] [${level.toUpperCase()}] ${message}`;
  if (meta) return `${base} ${JSON.stringify(meta, null, 2)}`;
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
};
