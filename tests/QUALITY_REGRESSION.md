# Quality regression cases

Dùng các ca này sau mỗi lần đổi prompt/model để tránh chất lượng bị tụt. Mục tiêu là **precision trước**: không chỉ bắt lỗi thật mà còn phải tránh kết luận pháp lý sai do nhìn trích yếu thay vì toàn văn.

## Case 1 — không tạo false positive từ trích yếu văn bản

Input:

`Căn cứ Nghị định số 29/2025/NĐ-CP của Chính phủ quy định chức năng, nhiệm vụ, quyền hạn và cơ cấu tổ chức của Bộ Tài chính, được sửa đổi, bổ sung tại Nghị định số 109/2025/NĐ-CP và Nghị định số 166/2025/NĐ-CP;`

Expected:

- Đoạn này phải được đưa vào LEGAL review.
- **Không** tạo issue với lập luận “Nghị định 109/2025/NĐ-CP không sửa Nghị định 29/2025/NĐ-CP” chỉ vì trích yếu của Nghị định 109 nói về Thanh tra Chính phủ.
- Phải kiểm tra toàn văn Nghị định 109; Điều 4 khoản 3 có nội dung trực tiếp sửa/bãi bỏ một số quy định của Nghị định 29/2025/NĐ-CP.
- Phải kiểm tra độc lập Nghị định 166/2025/NĐ-CP; nguồn chính thức xác định đây là nghị định sửa đổi, bổ sung Nghị định 29/2025/NĐ-CP.
- Nếu không tìm được điều/khoản quyết định quan hệ, không kết luận lỗi.

## Case 2 — sai số hiệu/trích yếu pháp lý rõ ràng

Input:

`Căn cứ Nghị định số 109/2025/NĐ-CP của Chính phủ quy định chức năng, nhiệm vụ, quyền hạn và cơ cấu tổ chức của Bộ Tài chính;`

Expected:

- Có issue `legal_reference` vì số hiệu 109/2025/NĐ-CP không khớp với trích yếu Bộ Tài chính.
- Nguồn chính thức phải cho thấy Nghị định 109/2025/NĐ-CP quy định về Thanh tra Chính phủ và Nghị định 29/2025/NĐ-CP quy định về Bộ Tài chính.
- Nếu đủ bằng chứng, replacement phải tối thiểu và có thể dùng trực tiếp; không viết lại cả câu.

## Case 3 — typo rõ ràng

Input heading:

`Điều 6. Phối hợp thông tin, truyền thông chính sách, pháp luật về BHXH, BHYT, BHTYN`

Expected:

- Có issue `spelling` hoặc lỗi khách quan tương đương.
- Replacement phải đổi `BHTYN` thành `BHTN`.
- Không kèm hàng loạt đề xuất viết lại câu không cần thiết.

## Case 4 — không biến sở thích văn phong thành lỗi

Input là một câu hành chính đúng ngữ pháp, đúng nghĩa nhưng có thể viết theo nhiều cách.

Expected:

- Ở `administrative + conservative`, không tạo `wording/clarity` chỉ vì model thích một cách viết khác.
