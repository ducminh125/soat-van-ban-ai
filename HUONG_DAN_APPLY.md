# Cập nhật GitHub - sửa lỗi AI retry vô hạn

Các file cần cập nhật:

1. `lib/ai.ts`
- Đổi model mặc định sang gpt-5.2.
- Giảm max token để giảm timeout.
- Giảm first byte timeout phù hợp API proxy.

2. `.env.example`
- Bổ sung cấu hình model và timeout ổn định.

Sau khi commit:
- cập nhật Environment Variables trên Vercel theo `.env.example`.
- redeploy ứng dụng.
