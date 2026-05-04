import express from "express";
import cors from "cors";
import helmet from "helmet";
import { requestLogger } from "./middleware/logger.middleware";
import { env } from "./config/env";
import { setupSwagger } from "./config/swagger";
import routes from "./routes";
import { errorHandler, notFoundHandler } from "./middleware/error.middleware";

const app = express();

function originKey(origin: string): string {
  try {
    return new URL(origin).origin;
  } catch {
    return origin.trim().replace(/\/+$/, "");
  }
}

const ALLOWED_ORIGINS = [
  env.CLIENT_URL,
  "http://localhost:3000",
  "http://localhost:3001",
  "https://dev.legalerrand.com",
  "https://legalerrand.com",
];

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || env.NODE_ENV === "development" || ALLOWED_ORIGINS.some((o) => originKey(o) === originKey(origin))) {
        return callback(null, true);
      }
      callback(new Error(`Origin ${origin} not allowed`));
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "Accept", "Origin", "X-Requested-With"],
  })
);

app.use(
  helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" },
  })
);

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

setupSwagger(app);

if (env.NODE_ENV !== "test") {
  app.use(requestLogger);
}

app.use("/api/v1", routes);

app.use(notFoundHandler);
app.use(errorHandler);

export default app;
