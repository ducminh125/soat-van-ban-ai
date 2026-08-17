# Tối ưu chi phí v0.9.9

## Mục tiêu

Giảm chi phí API nhưng không hạ model của lượt rà soát cục bộ — phần trực tiếp phát hiện chính tả, dấu câu, ngữ pháp, wording, redundancy và clarity. Tối ưu chính nằm ở giảm request/token lặp, giảm retry lãng phí và chỉ dùng model flagship cho nhóm tài liệu cần độ thận trọng cao.

## Cấu hình khuyến nghị

```env
OPENAI_LOCAL_MODEL=gpt-5.4-mini-2026-03-17
OPENAI_LOCAL_FALLBACK_MODEL=gpt-5.4-mini-2026-03-17

OPENAI_DEEP_MODEL=gpt-5.4-mini-2026-03-17
OPENAI_HIGH_RISK_MODEL=gpt-5.6-sol
AI_GLOBAL_HIGH_RISK_PROFILES=contract,academic
OPENAI_DEEP_FALLBACK_MODEL=gpt-5.4-mini-2026-03-17

NEXT_PUBLIC_AI_CONCURRENCY=2
AI_LOCAL_MAX_TOKENS=2600
AI_DEEP_MAX_TOKENS=3200
```

## Các thay đổi đã thực hiện

1. **Batch local 2.400 → 5.200 ký tự.** Với cùng lượng ký tự, số batch lý thuyết giảm khoảng 54%. Nội dung vẫn được rà đầy đủ; phần tiết kiệm đến từ việc lặp system prompt và tool schema ít lần hơn.
2. **Fragment dài 1.850 → 4.200 ký tự.** Giảm số fragment phát sinh ở các đoạn dài; vẫn giữ overlap 120 ký tự tại ranh giới để bảo toàn ngữ cảnh.
3. **Concurrency mặc định 4 → 2.** Hạn chế burst request, từ đó giảm khả năng 429/timeout và các lượt sinh dở phải retry. Nếu hệ thống ổn định có thể A/B ở mức 3.
4. **Local giữ GPT-5.4 mini.** Không bật nano mặc định, vì phần wording/clarity cần chất lượng cao hơn tác vụ extraction/classification đơn giản.
5. **Global dùng routing thích ứng.** Tài liệu thông thường, hành chính, báo cáo và email dùng GPT-5.4 mini. `contract` và `academic` mặc định dùng GPT-5.6 Sol để giữ biên an toàn cho đối chiếu mâu thuẫn quan trọng. Có thể đổi danh sách qua `AI_GLOBAL_HIGH_RISK_PROFILES`.
6. **Không phụ thuộc GPT-5.6 Terra.** Bản cuối chỉ dùng các model ID đã xác nhận rõ trên cấu hình hiện tại/nhà cung cấp. Terra có thể A/B sau nếu key thực tế route được model đó.
7. **Rút gọn structured output.** Local không còn yêu cầu `related_block_ids`, `context_before`, `context_after`; fact không còn yêu cầu `context`; global không yêu cầu `replacement` và context. Server tự dựng context từ quote gốc, nên không mất dữ liệu cần cho DOCX matching.
8. **Global không gửi `context` thừa lên model.** Model chỉ nhận `block_id`, `kind`, `quote`, `normalized_key`, `value`; context vẫn được giữ nội bộ để ánh xạ cảnh báo về vị trí trong tài liệu.
9. **Không split batch khi lỗi 429.** Split không xử lý rate limit mà còn tăng số request. Chỉ split khi lỗi 502/503/504/524 có khả năng liên quan timeout/kích thước batch.
10. **Hai lần đầu đều thử primary.** Tránh chuyển model chỉ vì một lỗi mạng tạm thời. Fallback chỉ xuất hiện từ lần thử thứ ba.
11. **Ghi token usage vào server log.** Khi upstream trả usage, log có dạng `[ai-usage] pass=... model=... prompt=... cached=... completion=... total=...`. Đây là số liệu nên dùng để đo chi phí thật sau deploy.

## Vì sao chưa dùng nano làm mặc định

GPT-5.4 nano phù hợp hơn với extraction/classification đơn giản. Ứng dụng này còn phải đánh giá diễn đạt, độ rõ nghĩa, dư thừa và phong cách theo loại văn bản. Vì vậy v0.9.9 ưu tiên giảm overhead trước, thay vì hạ model cho đường chạy chính.

## Cách benchmark sau deploy

Chạy cùng một bộ 10–20 tài liệu đại diện trên v0.9.8 và v0.9.9. So sánh tổng prompt/completion token, số retry/split, thời gian xử lý, số lỗi hữu ích, false positive và số mâu thuẫn toàn văn phát hiện được. Với hợp đồng/luận văn nên giữ riêng 3–5 tài liệu “khó” làm regression set.

Nếu cần tiết kiệm thêm, bước tiếp theo nên A/B `gpt-5.4-nano-2026-03-17` **chỉ cho chế độ “Chỉ lỗi rõ ràng”** hoặc chỉ cho fact extraction; không nên bật toàn hệ thống trước khi có benchmark chất lượng.
