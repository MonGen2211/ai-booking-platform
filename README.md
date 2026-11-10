# Backend

NestJS and TypeScript API for AI Booking Platform.

## Local setup

Use Node.js 22 and npm. Create the `ai_booking` database locally with phpMyAdmin, copy `.env.example` to `.env`, then configure `DATABASE_URL`.

```sh
npm install
npm run start:dev
```

The development server listens on port 3000. The backend runs independently from `frontend/` and connects directly to MySQL through Prisma.

## Swagger / OpenAPI

With the backend running, open `http://localhost:3000/api/docs` for Swagger UI or `http://localhost:3000/api/openapi.json` for the OpenAPI document. Click **Authorize** and paste an Access JWT to try protected endpoints. The access token is returned in the `X-Access-Token` header after login or registration. Authentication requests that use cookies (`/auth/csrf`, `/auth/register`, `/auth/login`, `/auth/logout`) also require the configured `FRONTEND_ORIGIN`, a CSRF cookie and `X-CSRF-Token`; Swagger UI served from port 3000 cannot bypass this Origin check. Use the configured frontend origin for those requests, then use the access token in Swagger UI for the other endpoints.

## Appointment access

Apply migrations with `npx prisma migrate deploy`, then build the backend. Register the first administrator through the normal `/auth/register` endpoint and run `npm run bootstrap:admin -- admin@example.com` with that existing email. This one-time command refuses to elevate an account after an administrator exists. Administrators can then find an existing account by exact email with `GET /admin/users?email=...` and assign `PATIENT`, `DOCTOR` (with a unique `doctorId`), or `ADMIN` using `PATCH /admin/users/:id/access`. The server records each role change and prevents removal of the last administrator. `GET /me/capabilities` returns the current role and doctor link; permissions are checked against the database on every protected operation.

## Appointment schedule configuration

The backend interprets doctor working hours in `Asia/Ho_Chi_Minh` and stores slot instants in UTC. `PUT /doctors/:id/schedule` accepts `weekly` intervals (`weekday` 0-6, `startMinute`, `endMinute`, `durationMinutes`, `effectiveFrom`, optional `effectiveTo`) and date-specific `exceptions` (`date`, `isClosed`, `intervals`). Only the linked doctor or an administrator can change the schedule. `GET /doctors/:id/availability?from=YYYY-MM-DD&to=YYYY-MM-DD` returns up to 31 days of open slots. The server materializes slots for the next 60 days on schedule changes and refreshes the rolling window daily.

Optional policy environment variables are `BOOKING_SLOT_MINUTES` (default 30), `BOOKING_LEAD_HOURS` (2), `BOOKING_HORIZON_DAYS` (60), and `BOOKING_CHANGE_HOURS` (24). Invalid values prevent backend startup. The API reports the active policy in schedule and availability responses.

## Private appointment attachments

`POST /me/attachments` accepts one multipart field named `file` with a JPEG, PNG, or PDF up to 10 MiB. Uploads are stored under `APPOINTMENT_UPLOAD_DIR` (default `backend/uploads` when launched from the backend directory), outside the public web root. The database holds a random storage key, and downloads use protected API routes with `Content-Disposition: attachment`. Unattached files expire after 24 hours and are cleaned hourly. Back up the upload directory together with MySQL; deleting only the database or only the files would leave broken attachment records. Do not serve the upload directory statically.

## Creating an appointment

Send `POST /appointments` with an authenticated session, `Idempotency-Key: <unique-key>` and JSON body:

```json
{
  "slotId": "<slot-id>",
  "profileId": "<your-profile-id>",
  "reason": "Khám định kỳ",
  "symptoms": "",
  "attachmentIds": [],
  "acceptedDetails": { "consultationFee": "100000.00", "address": "Clinic address shown at review" }
}
```

Repeat the same key and body after a lost response to get the same appointment. A different body with the same key returns `409 IDEMPOTENCY_CONFLICT`. If another request took the slot, `409 SLOT_UNAVAILABLE` includes up to five `suggestions` from that doctor; suggestions are not reserved. A changed doctor fee or address returns `409 BOOKING_DETAILS_CHANGED`, so the client must present the current details again. The response includes the appointment code, PENDING status, slot time and policy deadlines.

## Appointment lifecycle

`GET /me/appointments?status=PENDING&page=1&pageSize=10` and `GET /me/appointments/:id` show only bookings owned by the authenticated account. `GET /operations/appointments` and `GET /operations/appointments/:id` are scoped to the linked doctor or administrator. Actions use `expectedVersion` from the latest detail response. Administrators or the linked doctor can `POST /operations/appointments/:id/confirm`, `/reject`, `/cancel`, or `/complete`; rejection and cancellation require `reason`. The owner can `POST /me/appointments/:id/cancel` with `reason` from `CHANGE_PLANS`, `HEALTH_CHANGED`, `BOOKED_WRONG`, `OTHER` (and `note` for OTHER), or `/reschedule` with `newSlotId`. A changed version returns `409 APPOINTMENT_CHANGED`; a successful reschedule returns to PENDING and keeps the code. `GET /me/appointments/:id/rebook` returns safe doctor and patient prefill data without creating a booking. Only CONFIRMED bookings can be exported through `GET /me/appointments/:id/calendar.ics` or `/calendar-link`; previously exported events need manual updates after a change.

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
