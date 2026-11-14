# Chuyển dữ liệu MongoDB local sang Atlas

Đã thực hiện theo yêu cầu người dùng, từ database local `tma_demo` sang `taskflow_prod` đang được Railway production sử dụng.

## Kết quả

Đã chèn và đọc lại xác minh **1.015 document**, giữ `_id` và liên kết giữa các collection.

| Collection | Đã chuyển và xác minh |
| --- | ---: |
| users | 31 |
| teams | 7 |
| offices | 1 |
| tasks | 117 |
| leaves | 50 |
| attendances | 201 |
| conversations | 37 |
| messages | 118 |
| notifications | 343 |
| audit_logs | 110 |

Collection nghiệp vụ ở đích trống trước khi chuyển. Giữ lại 5 audit log production có sẵn; không xóa hoặc sửa dữ liệu nguồn. Giữ password hash để dùng tài khoản cũ. Không chuyển `refresh_sessions` và `task_write_locks`; xóa thông tin reset password và push token cũ trên bản sao tài khoản.

Railway ghi nhận `POST /api/auth/login` trả **200** lúc `2026-11-13T16:06:12.170373846Z`. Người dùng xác nhận **“Đăng nhập thành công và thấy dữ liệu”** trên APK ở điện thoại thật. Kiểm tra lại `/health/live` và `/health/ready` đều trả 200.

## Backup và script

- Script: `scripts/migrate-local-to-atlas.cjs`.
- Backup đã dùng: `.local-backups/atlas-2026-11-13T16-05-23-282Z/`.
- Backup gồm dữ liệu nguồn/đích canonical Extended JSON, metadata indexes, checksum và `applied.json` ghi số lượng đã xác minh.
- `.local-backups/` được Git ignore; chứa dữ liệu cá nhân/password hash, không đưa vào repository hoặc artifact công khai.
- Script nhận cấu hình Railway qua stdin, không in connection string; kiểm tra nguồn local, tên database, checksum và collection đích trước khi chèn. Đây là script chuyển một lần vào đích trống; **không chạy lại apply sau khi đã thành công**.
- Không thay indexes production hoặc tự rollback. Nếu cần khôi phục, phải dừng ghi và xác định phạm vi từ backup vì production đã phát sinh dữ liệu sau lần chuyển.

## Giới hạn

Chuyển MongoDB không chuyển file trên ổ đĩa. Snapshot chứa **3 URL local trong `messages.attachments[].url`** và **28 tham chiếu tương đối** (`/uploads` hoặc `/api/files`). Cần kiểm tra storage production cho file tương đối; cần chuyển file nguồn và cập nhật 3 URL local để mở từ bên ngoài mạng local. Chưa xác minh toàn bộ file cũ tải được.

Đăng nhập và hiển thị dữ liệu trên điện thoại đã được người dùng xác nhận. Chưa nghiệm thu riêng refresh token, upload/download, GPS, chat hai thiết bị, push notification hoặc kết nối qua 4G/5G/Wi-Fi khác mạng máy phát triển.
