# Backend

NestJS and TypeScript API for AI Booking Platform.

## Local setup

Use Node.js 22 and npm. Create the `ai_booking` database locally with phpMyAdmin, copy `.env.example` to `.env`, then configure `DATABASE_URL`.

```sh
npm install
npm run start:dev
```

The development server listens on port 3000. The backend runs independently from `frontend/` and connects directly to MySQL through Prisma.

## Build and tests

```sh
npm run build
npm test
npm run test:e2e
```

## Kiểm thử tích hợp API bác sĩ với MySQL

Chuẩn bị `backend/.env`, khởi động MySQL local và áp dụng migration bằng `npx prisma migrate deploy`. Chạy từ thư mục `backend` trong PowerShell:

```powershell
$env:DOCTOR_DATABASE_TEST = 'true'
npx.cmd vitest run --config vitest.config.e2e.ts test/doctors.e2e-spec.ts
Remove-Item Env:DOCTOR_DATABASE_TEST
```

Kiểm thử khởi tạo ứng dụng NestJS và gọi HTTP tới `GET /doctors` và `GET /doctors/:id` với Prisma kết nối MySQL thật. Dữ liệu tạm được tạo với id riêng và được dọn sau khi chạy; các hồ sơ hiện có được giữ nguyên. Nếu không bật `DOCTOR_DATABASE_TEST`, bộ kiểm thử này được bỏ qua.
