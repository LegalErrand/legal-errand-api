# LegalErrand API

REST API for LegalErrand Academy — an AI-native study platform for Nigerian law students.

## Stack

- **Runtime:** Node.js + Express 5 + TypeScript
- **Database:** MongoDB (Mongoose)
- **Cache:** Redis
- **Storage:** AWS S3 (documents + avatars)
- **AI:** DeepSeek (OpenAI-compatible — swap `DEEPSEEK_BASE_URL` to migrate)
- **Email:** ZeptoMail SMTP (Zoho + Resend fallback)
- **Docs:** Swagger UI at `/api-docs`

## Getting Started

```bash
cp .env.example .env   # fill in your values
npm install
npm run dev            # nodemon on PORT 5000
```

**Required services:** MongoDB, Redis. S3, AI, and email can be left unconfigured locally.

## Scripts

| Command             | Description                   |
| ------------------- | ----------------------------- |
| `npm run dev`       | Dev server with hot reload    |
| `npm run build`     | Compile TypeScript to `dist/` |
| `npm start`         | Run compiled output           |
| `npm run typecheck` | Type-check without emitting   |
| `npm run lint`      | ESLint                        |
| `npm run format`    | Prettier                      |

## Project Structure

```
src/
├── app.ts              # Express app (middleware, routes, CORS)
├── server.ts           # Entry point (DB connect, listen)
├── config/             # Env validation, Swagger config
├── controllers/        # Route handlers (user + admin/)
├── middleware/         # Auth, error, rate-limit, logger, requestId
├── models/             # Mongoose schemas
├── routes/             # Express routers (user + admin/)
├── services/           # Redis, email, S3, AI
├── types/              # Shared TypeScript types
└── utils/              # Response helpers, API messages
```

## API Routes

| Prefix             | Description                             |
| ------------------ | --------------------------------------- |
| `/api/auth/*`      | Register, login, OTP, password reset    |
| `/api/user/*`      | User profile                            |
| `/api/library/*`   | Documents library                       |
| `/api/notes/*`     | Notes CRUD                              |
| `/api/ai/*`        | AI query endpoints                      |
| `/api/research/*`  | Case research                           |
| `/api/dashboard/*` | Dashboard data                          |
| `/api/waitlist`    | Waitlist signup                         |
| `/api/admin/*`     | Admin-only endpoints (JWT + role guard) |

## Environment Variables

See `.env.example` for all variables. Key ones:

```
MONGO_URI          MongoDB connection string
REDIS_URL          Redis connection string
JWT_SECRET         Min 32 characters
DEEPSEEK_API_KEY   AI provider key
AWS_S3_BUCKET      Document storage bucket
ZEPTO_SMTP_*       ZeptoMail SMTP (primary)
ZOHO_SMTP_*        Zoho fallback
RESEND_*           Resend API fallback
```

## Conventions

- No file over 200 lines
- All responses via `src/utils/response.ts` helpers
- Rate limits applied per-route via `rateLimit.middleware.ts`
- Errors centralized in `error.middleware.ts`
- Husky + lint-staged enforce formatting on commit
