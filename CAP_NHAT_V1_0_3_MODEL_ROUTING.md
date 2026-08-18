# v1.0.3 - Model routing tối ưu

## Mục tiêu

Giảm thời gian chờ và chi phí mà không giảm chất lượng ở các bước cần suy luận. Không dùng model lớn cho mọi request.

## Routing mới

- LOCAL: `gpt-5.4-nano-2026-03-17` cho chính tả, dấu câu, ngữ pháp, lỗi diễn đạt rõ và trích xuất facts.
- GLOBAL thường: `gpt-5.4-nano-2026-03-17`.
- GLOBAL rủi ro cao (`administrative`, `contract`, `academic`): `gpt-5.6-terra-ultra`.
- LEGAL metadata (số hiệu, cơ quan, trích yếu, ngày): `gpt-5.4-nano-2026-03-17`, không bật reasoning.
- LEGAL relation (sửa đổi/bổ sung/thay thế/bãi bỏ/đình chỉ/quy định chi tiết/hướng dẫn thi hành): `gpt-5.6-terra-ultra`, reasoning `low`.
- Sol không còn nằm trong đường chạy tự động. Nếu cần thử chuyên gia sau này, có thể cấu hình thủ công một biến cụ thể sang Sol để A/B test.

## Retry

- LOCAL: tối đa 3 lần, lần đầu primary; các lần sau fallback nhanh.
- GLOBAL: tối đa 2 lần, primary rồi fallback nhanh.
- LEGAL: best-effort, không retry vòng lặp phía trình duyệt.

## Timeout mặc định khuyến nghị

- LOCAL: 55 giây.
- GLOBAL: 75 giây.
- LEGAL: 45 giây.

## Ghi log

Server log thêm `[ai-route]` để xem mỗi lượt thực tế đã dùng model nào.
