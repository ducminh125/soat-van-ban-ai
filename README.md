# Soát Văn Bản AI v1.0 — OpenAI + xác minh căn cứ pháp lý

Bản v1.0 ưu tiên **độ chính xác và khả năng dùng trực tiếp đề xuất sửa** thay vì cố phát hiện thật nhiều lỗi.

## Điểm thay đổi chính

1. **Dùng ShopAIKey theo chuẩn OpenAI-compatible** tại `https://api.shopaikey.com/v1` (có thể đổi bằng `OPENAI_BASE_URL`).
2. Mặc định dùng **GPT-5.6 Sol** cho các lượt chất lượng cao và văn bản rủi ro cao; **GPT-5.6 Terra** làm model cân bằng/fallback.
3. Thêm lượt **LEGAL review** bằng Responses API + `web_search` để kiểm chứng số/ký hiệu, trích yếu và quan hệ giữa văn bản pháp luật.
4. Web search pháp lý mặc định chỉ tra các miền chính thức:
   - `vanban.chinhphu.vn`
   - `datafiles.chinhphu.vn`
   - `congbao.chinhphu.vn`
   - `vbpl.vn`
   - `moj.gov.vn`
5. Với nguồn pháp lý, một cảnh báo chỉ được giữ lại nếu URL nguồn thực sự xuất hiện trong kết quả `web_search` của OpenAI.
6. Trang **Thiết lập rà soát** tự nhận diện loại văn bản và mức can thiệp. Văn bản hành chính/pháp lý và hợp đồng mặc định chọn **Chỉ lỗi rõ ràng**.
7. Local review dùng ngưỡng confidence cao và bỏ các đề xuất chỉ mang tính sở thích diễn đạt.
8. Global review giữ thêm các fact có tín hiệu cao (số liệu, ngày, chữ viết tắt, claim) để tăng khả năng phát hiện mâu thuẫn toàn văn.
9. Kết quả lỗi pháp lý có mục **Nguồn đối chiếu chính thức** và cột nguồn trong file Excel tổng hợp.

## Cấu hình Vercel bắt buộc

```env
OPENAI_API_KEY=sk-...
APP_ACCESS_CODE=...

UPSTASH_REDIS_REST_URL=...
UPSTASH_REDIS_REST_TOKEN=...
```

> Với key ShopAIKey, bắt buộc giữ `OPENAI_BASE_URL=https://api.shopaikey.com/v1`. Chỉ đổi sang `https://api.openai.com/v1` nếu bạn dùng API key chính chủ OpenAI.

## Cấu hình model khuyến nghị

Không bắt buộc khai báo vì code đã có default, nhưng nên cấu hình rõ trên Vercel:

```env
OPENAI_QUALITY_MODEL=gpt-5.6-sol-ultra
OPENAI_FAST_MODEL=gpt-5.6-terra-ultra

OPENAI_HIGH_RISK_LOCAL_MODEL=gpt-5.6-sol-ultra
OPENAI_LOCAL_MODEL=gpt-5.6-terra-ultra
OPENAI_LOCAL_FALLBACK_MODEL=gpt-5.6-terra-ultra

OPENAI_HIGH_RISK_MODEL=gpt-5.6-sol-ultra
OPENAI_DEEP_MODEL=gpt-5.6-sol-ultra
OPENAI_DEEP_FALLBACK_MODEL=gpt-5.6-terra-ultra

OPENAI_LEGAL_MODEL=gpt-5.6-terra-ultra
OPENAI_LEGAL_FALLBACK_MODEL=gpt-5.6-terra-ultra
AI_HIGH_RISK_PROFILES=administrative,contract,academic

LEGAL_SEARCH_DOMAINS=vanban.chinhphu.vn,datafiles.chinhphu.vn,congbao.chinhphu.vn,vbpl.vn,moj.gov.vn
```

## Các biến hệ thống khác

```env
DAILY_DOCUMENT_LIMIT=30
USAGE_TIME_ZONE=Asia/Bangkok
USAGE_KEY_PREFIX=soat-van-ban-ai:v1
REVIEW_RESERVATION_TTL_SECONDS=10800
REVIEW_REQUESTS_PER_MINUTE=120
NEXT_PUBLIC_AI_CONCURRENCY=2

AI_LOCAL_TIMEOUT_MS=95000
AI_DEEP_TIMEOUT_MS=120000
AI_LEGAL_TIMEOUT_MS=60000
AI_LOCAL_MAX_TOKENS=2800
AI_DEEP_MAX_TOKENS=3200
AI_LEGAL_MAX_TOKENS=2400
```

Lịch sử trên Supabase vẫn dùng các biến cũ nếu bạn đã cấu hình:

```env
SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...
```

## Luồng rà soát v1.0

1. Browser đọc `.docx` và tách thành các paragraph/block.
2. Hệ thống tự nhận diện profile: hành chính/pháp lý, hợp đồng, báo cáo, học thuật, email hoặc thông thường.
3. Local review xử lý chính tả, dấu câu, ngữ pháp và chỉ giữ đề xuất diễn đạt có confidence cao.
4. Global review đối chiếu facts giữa nhiều phần của văn bản.
5. Các block có số/ký hiệu văn bản pháp luật được gom riêng cho LEGAL review.
6. LEGAL review bắt buộc chạy OpenAI Responses API `web_search`, giới hạn nguồn chính thức và dùng structured output.
7. Lỗi pháp lý được ưu tiên hiển thị trước; người dùng có thể mở nguồn trước khi chấp nhận sửa.
8. Chỉ các issue đã chấp nhận/đã chỉnh mới được áp dụng vào Word tải xuống.

## Ca hồi quy quan trọng

Với câu:

> Căn cứ Nghị định số 29/2025/NĐ-CP ... được sửa đổi, bổ sung tại Nghị định số 109/2025/NĐ-CP và Nghị định số 166/2025/NĐ-CP;

LEGAL review phải kiểm tra **từng văn bản 109 và 166**, đặc biệt là toàn văn/điều khoản tác động chứ không suy đoán từ trích yếu. Với ca này, hệ thống **không được báo sai rằng Nghị định 109 không sửa Nghị định 29**: Điều 4 khoản 3 của Nghị định 109 có sửa/bãi bỏ một số nội dung của Nghị định 29. Đây là regression test chống false positive pháp lý.

Xem thêm `CAP_NHAT_V1_0_OPENAI.md` và `tests/QUALITY_REGRESSION.md`.

## Cài đặt và kiểm tra

```bash
npm install
npm run typecheck
npm run build
```

Sau đó commit/push lên GitHub để Vercel redeploy.

## Lưu ý chi phí

Văn bản hành chính/pháp lý vẫn ưu tiên model chất lượng cao cho LOCAL/GLOBAL, nhưng LEGAL review mặc định dùng `gpt-5.6-terra-ultra` để giảm độ trễ. LEGAL chỉ gửi tối đa 4 paragraph rủi ro cao (quan hệ sửa đổi/bổ sung/thay thế/bãi bỏ hoặc khẳng định trích yếu/cơ quan/ngày), dùng nguồn chính thức và ngưỡng confidence 92%. Nếu web search chậm/lỗi, lượt LEGAL được bỏ qua theo cơ chế best-effort và không làm hỏng toàn bộ phiên rà soát.
