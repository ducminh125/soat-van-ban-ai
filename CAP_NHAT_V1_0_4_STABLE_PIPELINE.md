# Cap nhat v1.0.4 - Stable Pipeline

Muc tieu:
- Khong dung retry lap lai cung model khi output loi.
- Tach model nhanh va model suy luan.
- Khong dung mot doan loi lam dung toan bo tai lieu.

Routing:
- GPT-5.4-nano: parser, classifier, local review, format validation.
- GPT-5.6-terra: global consistency va legal relation.

Xu ly loi:
- API timeout/429/5xx: retry 1 lan.
- Loi schema JSON: fallback model, khong retry cung model.
- Van loi: bo qua segment, ghi log, tiep tuc tai lieu.

Chunking:
- Uu tien tach theo Chuong/Dieu/Khoan/Diem.
- Khong cat giua khoan hoac diem.
