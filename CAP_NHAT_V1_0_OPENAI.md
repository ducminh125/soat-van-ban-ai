# Cập nhật v1.0 — tăng chất lượng rà soát và xác minh pháp lý

## 1. Vì sao cần một lượt xác minh pháp lý riêng?

Bản cũ có hai hạn chế chính:

- global review chỉ nhận những fact có cùng `normalizedKey` xuất hiện ở ít nhất hai block;
- prompt global quy định không dùng kiến thức bên ngoài.

Vì vậy các mệnh đề quan hệ pháp lý xuất hiện một lần trong phần “Căn cứ” không có cơ chế kiểm chứng bằng nguồn chính thức. Tuy nhiên, lượt LEGAL mới cũng phải tránh lỗi ngược lại: **không được kết luận một quan hệ là sai chỉ vì tiêu đề/trích yếu của văn bản không nói rằng nó sửa văn bản khác**. Ví dụ Nghị định 109/2025/NĐ-CP có trích yếu về Thanh tra Chính phủ nhưng Điều 4 khoản 3 của chính nghị định này trực tiếp sửa/bãi bỏ một số nội dung của Nghị định 29/2025/NĐ-CP. Do đó prompt v1.0 yêu cầu kiểm tra toàn văn hoặc điều/khoản tác động trước khi kết luận.

## 2. Kiến trúc v1.0

### Local review — precision first

- Lỗi khách quan được ưu tiên: spelling, punctuation, grammar.
- Với wording/redundancy/clarity: nếu cả bản hiện tại và bản đề xuất đều chấp nhận được trong văn bản chuyên nghiệp thì issue bị loại.
- Văn bản `administrative`/`contract` mặc định `conservative`.
- Không cho local review tự đổi số/ký hiệu pháp lý hoặc số liệu trong văn bản hành chính/hợp đồng.

### Global review — nhất quán toàn văn

- Vẫn so sánh những fact lặp giữa các block.
- Giữ thêm date/number/abbreviation/claim có tín hiệu cao để không phụ thuộc hoàn toàn vào việc các batch tạo đúng cùng `normalizedKey`.
- Chỉ giữ global issue confidence từ 0.90 trở lên.

### Legal review — xác minh bằng nguồn chính thức

- Dùng OpenAI Responses API.
- Model mặc định `gpt-5.6-sol`, reasoning `high`.
- `tool_choice="required"` để bắt buộc web search chạy.
- `web_search.filters.allowed_domains` giới hạn nguồn chính thức.
- Structured output bằng JSON schema strict.
- Chỉ giữ issue confidence từ 0.92.
- URL do model ghi ra phải đồng thời có mặt trong `web_search_call.action.sources`; URL chỉ “trông giống nguồn chính thức” nhưng không có trong kết quả search sẽ bị loại.

## 3. Tự nhận diện thiết lập

Khi người dùng chọn file Word, browser đọc phần đầu và chấm dấu hiệu cấu trúc:

- Hợp đồng → `contract` + `conservative`.
- Văn bản có Quốc hiệu/Căn cứ/Chương/Điều/Nơi nhận/Quy chế/Quyết định/Thông tư/Nghị quyết → `administrative` + `conservative`.
- Học thuật → `academic` + `balanced`.
- Báo cáo → `report` + `balanced`.
- Email → `email` + `balanced`.
- Còn lại → `general` + `balanced`.

Người dùng vẫn có thể đổi thủ công.

## 4. Cấu hình cần thay trên Vercel

Bắt buộc có:

```env
OPENAI_API_KEY=sk-...
APP_ACCESS_CODE=...
```

Nên đặt:

```env
OPENAI_QUALITY_MODEL=gpt-5.6-sol
OPENAI_FAST_MODEL=gpt-5.6-terra
OPENAI_LEGAL_MODEL=gpt-5.6-sol
OPENAI_LEGAL_FALLBACK_MODEL=gpt-5.6-terra
AI_HIGH_RISK_PROFILES=administrative,contract,academic
LEGAL_SEARCH_DOMAINS=vanban.chinhphu.vn,datafiles.chinhphu.vn,congbao.chinhphu.vn,vbpl.vn,moj.gov.vn
```

`OPENAI_BASE_URL` cũ không còn được code sử dụng. Nếu Vercel còn `https://api.shopaikey.com/v1`, hãy xóa để tránh nhầm cấu hình.

## 5. Tiêu chí chất lượng mới

Mục tiêu của v1.0 không phải “bắt nhiều lỗi nhất” mà là:

- giảm lỗi giả;
- ưu tiên lỗi có thể chứng minh;
- replacement phải dùng được trực tiếp khi có cách sửa rõ ràng;
- cảnh báo không đủ căn cứ thì để `replacement=null` thay vì bịa cách sửa;
- lỗi pháp lý phải có nguồn chính thức để người dùng tự kiểm tra.

## 6. Các file thay đổi chính

- `lib/ai.ts`
- `lib/types.ts`
- `app/api/review/route.ts`
- `app/page.tsx`
- `app/globals.css`
- `README.md`
- `.env.example`
- `tests/QUALITY_REGRESSION.md`
