# Backend local setup

Use Node.js 22 LTS and npm from this directory.

## Local MySQL

1. Start the local MySQL service on `localhost:3306`.
2. In phpMyAdmin, create a database named `ai_booking`.
3. Copy `.env.example` to `.env` and replace the password placeholder in `DATABASE_URL` with the local MySQL `root` password. Keep the real value only in `.env`; do not commit it.

Prisma CLI reads `DATABASE_URL` from `.env` through `prisma.config.ts`. Prisma connects directly to MySQL; phpMyAdmin is only used to create/manage the database.

To verify connectivity without changing the database schema, run this from `backend/`:

```powershell
"SELECT 1;" | npx prisma db execute --stdin
```

Prisma Migrate is configured for future development. This initialization does not create Prisma models, migration files, or database tables.
