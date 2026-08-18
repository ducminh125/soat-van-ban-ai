# v1.0.2 - Legal Fast / Best-effort

- Chỉ xác minh các căn cứ có rủi ro cao: quan hệ sửa đổi/bổ sung/thay thế/bãi bỏ hoặc mệnh đề khẳng định trích yếu/cơ quan/ngày.
- Giới hạn tối đa 4 đoạn pháp lý, batch 6.500 ký tự.
- Timeout pháp lý mặc định giảm từ 175 giây xuống 60 giây.
- Bỏ retry 3 lần ở trình duyệt. Một lỗi timeout/web-search không còn làm hỏng toàn bộ phiên rà soát.
- `search_context_size` giảm high -> medium; reasoning high -> medium; output tokens 5.000 -> 2.400.
- LEGAL mặc định dùng `gpt-5.6-terra-ultra`; LOCAL/GLOBAL vẫn có thể dùng Sol cho chất lượng cao.
- Thêm cache Upstash 7 ngày cho kết quả xác minh pháp lý giống nhau.
- Nếu xác minh pháp lý không khả dụng, giao diện hiển thị cảnh báo và vẫn trả kết quả chính tả/ngữ pháp/nhất quán đã hoàn tất.
