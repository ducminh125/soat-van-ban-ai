# Hướng dẫn cập nhật GitHub phiên bản v0.9 (dành cho người không chuyên)

## 1. Sao lưu phiên bản cũ
- Vào thư mục dự án hiện tại.
- Sao chép cả thư mục ra một nơi khác để dự phòng.

## 2. Cập nhật mã nguồn
- Giải nén file v0.9.
- Sao chép toàn bộ file trong thư mục v0.9 vào thư mục dự án GitHub cũ.
- Không xóa các file cấu hình riêng như `.env.local` nếu đang sử dụng API key.

## 3. Kiểm tra trước khi đưa lên GitHub
Mở Terminal tại thư mục dự án và chạy:

```bash
npm install
npm run dev
```

Nếu website chạy bình thường thì tiếp tục.

## 4. Đưa lên GitHub bằng giao diện (khuyến nghị)
1. Mở GitHub Desktop.
2. Chọn Repository dự án.
3. Chọn tab Changes.
4. Kiểm tra danh sách file thay đổi.
5. Nhập nội dung ghi chú:

`Nang cap v0.9 - Luu lich su ra soat va xuat bao cao loi`

6. Bấm Commit.
7. Bấm Push origin.

## 5. Kiểm tra sau khi cập nhật
Trên GitHub cần thấy các phần mới:

- Lưu lịch sử rà soát
- Theo dõi trạng thái lỗi
- Xuất bảng tổng hợp lỗi
- Hỗ trợ font tiếng Việt

## 6. Phiên bản

Phiên bản mới:

v0.9.0

Nội dung nâng cấp:
- Review History
- Issue Status Tracking
- Error Report Export
- Vietnamese Font Support
