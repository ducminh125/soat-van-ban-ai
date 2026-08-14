# Kiểm tra v0.8

Đã kiểm tra trong môi trường tạo bản nâng cấp:

- TypeScript parser/transpiler đọc thành công 9 file `.ts/.tsx`: **0 lỗi cú pháp**.
- Type-check nội bộ với declaration stubs cho React/Next/JSZip/@upstash/redis: **0 lỗi gán kiểu trong mã dự án**.
- Đã kiểm tra không còn `tsconfig.tsbuildinfo`, `.next`, `node_modules` trong gói nguồn.
- Đã quét sơ bộ và không thấy API key/token thật trong source.

## Chưa thể chạy trong môi trường hiện tại

`npm install --package-lock-only` thất bại vì môi trường không phân giải được `registry.npmjs.org` (`EAI_AGAIN`), do đó:

- chưa sinh `package-lock.json`;
- chưa chạy được `npm run build` với dependency thật.

Trước khi deploy production, chạy:

```bash
npm install
npm run typecheck
npm run build
```

Sau khi `npm install` thành công, commit `package-lock.json`.

## Kiểm tra thủ công nên làm trên Preview Deployment

1. Đặt tạm `DAILY_DOCUMENT_LIMIT=2`, chạy hai tài liệu và xác nhận lượt còn lại về 0.
2. Mở hai tab cùng lúc ở lượt cuối để xác nhận chỉ một tab giữ được slot.
3. Dừng một review giữa chừng và xác nhận slot được trả.
4. Hoàn tất review và kiểm tra counter ngày/tháng/năm/tổng cùng tăng đúng.
5. Chọn một cảnh báo `replacement=null`, nhập nội dung tự chỉnh, chấp nhận và xuất Word.
6. Test file có header/footer/footnote/endnote.
7. Kiểm tra thông báo export khi có thay đổi đi qua nhiều Word run.
