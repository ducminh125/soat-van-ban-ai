# Soát Văn Bản AI v0.8 — Usage Dashboard & Editable Review

v0.8 nâng cấp từ v0.7 theo ba hướng chính: kiểm soát hạn mức sử dụng, tăng độ bền/bảo mật, và cho phép người dùng chủ động sửa mọi đề xuất trước khi chấp nhận.

## Tính năng mới v0.8

### 1. Hạn mức 30 văn bản/ngày

- Mặc định cho phép tối đa `30` văn bản/ngày (`DAILY_DOCUMENT_LIMIT=30`).
- Hạn mức được kiểm tra và giữ chỗ ở server trước khi AI bắt đầu xử lý.
- Nhiều tab chạy đồng thời không thể cùng vượt qua lượt cuối.
- Nếu người dùng dừng hoặc quá trình thất bại, lượt giữ chỗ được trả lại.
- Một lượt chỉ được ghi vào thống kê sau khi toàn bộ local review + global review hoàn tất.
- Phiên giữ chỗ tự hết hạn để tránh kẹt quota nếu trình duyệt bị đóng đột ngột.

Bộ đếm dùng Upstash Redis để tồn tại bền vững khi deploy serverless/Vercel.

### 2. Dashboard thống kê tại trang chủ

Trang chủ hiển thị:

- số văn bản đã rà soát trong ngày hiện tại;
- số văn bản đã rà soát trong tháng hiện tại;
- số văn bản đã rà soát trong năm hiện tại;
- tổng số văn bản đã rà soát;
- số lượt còn lại trong ngày;
- số phiên đang xử lý;
- đồng hồ đếm ngược tới lúc làm mới hạn mức.

Múi giờ mặc định: `Asia/Bangkok` (UTC+7), có thể đổi bằng `USAGE_TIME_ZONE`.

> Bộ đếm bắt đầu từ khi v0.8 được triển khai với Redis. Dữ liệu v0.7 trước đó không được hồi tố tự động.

### 3. Sửa đề xuất trước khi chấp nhận

- Mọi đề xuất AI đều có thể chỉnh sửa trực tiếp.
- Nếu AI chỉ đưa cảnh báo và trả `replacement=null`, người dùng vẫn có ô để tự nhập nội dung thay thế.
- Nếu nội dung đã chỉnh khác đề xuất AI, khi chấp nhận sẽ có trạng thái `edited`.
- Nếu người dùng sửa lại một mục đã chấp nhận, trạng thái quay về `pending` để buộc duyệt lại.
- Có nút khôi phục đề xuất AI hoặc xóa nội dung tự chỉnh.

### 4. Không retry vô hạn

- Local review tối đa 6 lần thử cho một phần nhỏ nhất.
- Global review tối đa 5 lần thử.
- Vẫn giữ fallback model, exponential backoff và tự chia batch.
- Khi vượt giới hạn retry, hệ thống dừng rõ ràng thay vì chạy mãi.

### 5. Global review ít token hơn

Facts được loại trùng và chỉ giữ các `normalizedKey` xuất hiện ở ít nhất hai block khác nhau trước khi gửi cho model deep-review.

### 6. Bảo mật API chặt hơn

- Production yêu cầu phải có `APP_ACCESS_CODE`; thiếu biến này API sẽ từ chối hoạt động.
- Mọi request AI phải đi kèm một `review session` hợp lệ đã giữ chỗ quota.
- Có rate limit theo IP cho API review/usage.
- API key AI vẫn chỉ nằm phía server.

### 7. Quyền riêng tư được mô tả rõ trên giao diện

File `.docx` gốc được đọc và tạo lại trong trình duyệt, nhưng phần văn bản cần AI xử lý sẽ được gửi tới server và nhà cung cấp AI.

### 8. DOCX được rà soát rộng hơn

Ngoài `word/document.xml`, v0.8 đọc và có thể áp dụng sửa đổi ở:

- header;
- footer;
- footnote;
- endnote.

Khi xuất Word, giao diện báo:

- số sửa đổi đã yêu cầu;
- số sửa đổi áp dụng thành công;
- số sửa đổi không tìm lại được vị trí;
- số sửa đổi đi qua nhiều Word run và nên kiểm tra lại định dạng.

## Environment Variables

```env
OPENAI_API_KEY=...
OPENAI_BASE_URL=https://api.shopaikey.com/v1
APP_ACCESS_CODE=...

# Redis dùng cho quota + statistics
UPSTASH_REDIS_REST_URL=...
UPSTASH_REDIS_REST_TOKEN=...

# Nếu Vercel integration cung cấp các tên sau thì code cũng tự nhận:
# KV_REST_API_URL=...
# KV_REST_API_TOKEN=...

DAILY_DOCUMENT_LIMIT=30
USAGE_TIME_ZONE=Asia/Bangkok
USAGE_KEY_PREFIX=soat-van-ban-ai:v0.8
REVIEW_RESERVATION_TTL_SECONDS=10800
REVIEW_REQUESTS_PER_MINUTE=120

OPENAI_LOCAL_MODEL=gpt-5.4-mini-2026-03-17
OPENAI_LOCAL_FALLBACK_MODEL=gpt-5.1-2025-11-13
OPENAI_DEEP_MODEL=gpt-5.6-sol
OPENAI_DEEP_FALLBACK_MODEL=gpt-5.1-2025-11-13

NEXT_PUBLIC_AI_CONCURRENCY=4
AI_LOCAL_FIRST_BYTE_TIMEOUT_MS=80000
AI_DEEP_FIRST_BYTE_TIMEOUT_MS=115000
AI_STREAM_IDLE_TIMEOUT_MS=45000
AI_LOCAL_MAX_TOKENS=2600
AI_DEEP_MAX_TOKENS=3200
```

## Cài Redis trên Vercel

v0.8 cần một Redis bền vững để quota hoạt động đúng trên nhiều serverless instance.

Cách thông thường:

1. Tạo một Redis database trên Upstash hoặc cài Upstash integration cho project Vercel.
2. Thêm `UPSTASH_REDIS_REST_URL` và `UPSTASH_REDIS_REST_TOKEN` vào Environment Variables.
3. Giữ `DAILY_DOCUMENT_LIMIT=30`.
4. Redeploy project.

Code cũng chấp nhận `KV_REST_API_URL` và `KV_REST_API_TOKEN` nếu integration của bạn dùng hai tên đó.

## Luồng xử lý v0.8

1. Trang chủ đọc statistics từ `/api/usage`.
2. Người dùng chọn `.docx`; browser đọc các phần Word hỗ trợ.
3. Khi bấm bắt đầu, `/api/usage` atomically giữ một lượt trong quota ngày.
4. Browser chia tài liệu thành batch khoảng 2.400 ký tự.
5. Worker pool xử lý local batch song song.
6. Local review trả `issues` + `facts`.
7. Facts được loại trùng và lọc theo `normalizedKey` có mặt ở nhiều block.
8. Deep model kiểm tra nhất quán toàn văn.
9. Khi toàn bộ review thành công, server chuyển lượt giữ chỗ thành một lượt hoàn tất và tăng counter ngày/tháng/năm/tổng.
10. Người dùng sửa/chấp nhận/bỏ qua từng đề xuất.
11. Browser áp dụng các thay đổi đã duyệt vào DOCX và báo kết quả export.

Nếu review bị hủy hoặc lỗi trước khi hoàn tất, lượt giữ chỗ được release.

## Các API mới

### `GET /api/usage`

Trả statistics và số giây còn lại tới khi reset ngày.

### `POST /api/usage`

Các action:

- `start`: giữ chỗ quota và trả `sessionId`;
- `complete`: hoàn tất session và tăng counter;
- `release`: trả lại lượt đang giữ chỗ.

### `POST /api/review`

Ngoài `x-app-access-code`, v0.8 yêu cầu header:

```text
x-review-session-id: <sessionId>
```

## Kiểm tra trước khi deploy

```bash
npm install
npm run typecheck
npm run build
```

Sau lần `npm install` đầu tiên, nên commit `package-lock.json` để khóa dependency chính xác cho production.

## Ghi chú về định dạng Word

Việc thay một câu trải qua nhiều `w:t`/Word run có thể làm phần nội dung thay thế kế thừa chủ yếu định dạng của run đầu tiên. v0.8 phát hiện và báo số trường hợp này khi export để người dùng kiểm tra lại.

## Các file chính v0.8

- `app/page.tsx`
- `app/globals.css`
- `app/api/review/route.ts`
- `app/api/usage/route.ts`
- `lib/ai.ts`
- `lib/docx-client.ts`
- `lib/types.ts`
- `lib/usage.ts`
- `.env.example`
- `package.json`
