# Sửa upload và đồng bộ avatar — 14/11/2026

## Nguyên nhân

Màn hình Personal Data chỉ đặt URI local từ ImagePicker vào form; lời gọi upload đang bị comment. PUT profile gửi `file://...` thay vì URL ảnh đã lưu nên validator trả 400. Ảnh xem trước trên trang hồ sơ không phải ảnh đã được lưu trên backend.

Component avatar cũ không tải file có xác thực và các màn hình dùng bản sao profile trong task/comment/team. Do đó ảnh có thể thiếu hoặc cũ dù profile hiện tại đã thay đổi.

## Thay đổi

- Frontend upload multipart qua POST `/api/upload`, kiểm tra JPG/PNG và tối đa 5MB; chỉ đưa URL trả về vào form sau upload thành công. Chặn lưu khi upload đang chạy; hiển thị thông báo lỗi theo field.
- Khi lưu profile thành công, AuthContext nhận ngay user trả về; authService tiếp tục lưu user qua cơ chế khóa phiên hiện có. Không bật global auth loading khi sửa profile.
- Component Avatar tải file riêng tư bằng fileService có xác thực/refresh token và dọn preview khi đổi ảnh hoặc unmount. Ảnh lỗi có fallback; không ghi URL chứa token vào log.
- Avatar có ID trùng người đăng nhập luôn lấy ảnh mới từ AuthContext, thay vì bản sao cũ trong task/comment/team. Áp dụng ở hồ sơ, home, chấm công, nhóm, nghỉ phép, nhiệm vụ, bình luận và danh sách chat/người nhận.
- Backend cho đồng nghiệp đã đăng nhập đọc ảnh được profile đang active của chính chủ tham chiếu. Tên file phải có owner ID và đuôi ảnh hợp lệ. Quyền task/chat được xét trước; file chưa gắn avatar, tài liệu và truy cập ẩn danh vẫn giữ giới hạn cũ.

## Kiểm tra

- Backend: **54 suite, 820 test đạt**; coverage statements 74,66%, branches 65,34%, functions 77,31%, lines 75,16%.
- Riêng quyền file: 47 test đạt, có regression avatar đồng nghiệp/ẩn danh/file chưa tham chiếu/tài liệu.
- Frontend: **47 test đạt** gồm upload multipart, giới hạn ảnh, lỗi upload, lỗi validation và chọn avatar theo current user.
- ESLint các file frontend thay đổi: không có error. Export Android production thành công.
- Log: `report/logs/avatar-backend-regression.log`; frontend `../project/report/logs/avatar-frontend-tests.log`, `avatar-lint.log`, `avatar-android-export.log`.

## Phát hành và nghiệm thu

- Railway deployment sửa avatar: `e9b13c83-b541-45ee-8bfd-b2f4e314be6d`, SUCCESS. Live/ready trả 200, truy cập file chưa đăng nhập trả 401.
- EAS APK 1.0.1/versionCode 2: [build](https://expo.dev/accounts/yenle25404/projects/project/builds/20533040-dabd-439d-a884-f7331e6d1306), FINISHED. Giữ package `com.anonymous.project` và keystore hiện có.
- Artifact: `../project/dist/production-apk/taskflow-production-1.0.1.apk`, 127.520.975 bytes; SHA-256 `1ae0e399ddab827f07edf4b4aecf298540af6dc31de7fed048696a55bba78ada`. Chữ ký v2 hợp lệ, minSdk 24, targetSdk 36, không có application-debuggable.
- Cài đè qua USB lên thiết bị thật `557170dc` thành công; mở MainActivity trả Status ok. Xác minh versionName 1.0.1/versionCode 2; không có ADB reverse, không thấy lỗi AndroidRuntime/ReactNativeJS khi khởi động.
- Đang chờ người dùng nghiệm thu thao tác: chọn JPG/PNG dưới 5MB, Update Profile, kiểm tra Home/Profile/Comments và mở lại app. Test/export/cài đặt không thay thế xác nhận upload thực tế này.

## Khắc phục URL HTTP sau kiểm tra APK 1.0.1

Người dùng báo chọn ảnh xong chỉ thấy vòng xoay rồi avatar mặc định, không có alert lỗi. Log Railway xác nhận POST `/api/upload` trả 200 lúc `2026-11-14T05:37:32.718572144Z`. Service đang đặt `TRUST_PROXY=false`; `getFileUrl` cũ ghép URL từ `req.protocol` nên tạo HTTP dù client truy cập ingress bằng HTTPS. FileService chỉ gắn xác thực cho origin backend HTTPS, và Android release không cho tải ảnh HTTP; Avatar rơi về fallback.

Thêm `PUBLIC_BASE_URL` làm origin cố định cho URL file, độc lập cấu hình tin cậy proxy/IP. Runtime kiểm tra origin, chặn credentials/path/query/fragment và bắt buộc HTTPS nếu khai báo ở production. Railway dùng `https://api-production-360b0645.up.railway.app`. Không đổi TRUST_PROXY hoặc nới quyền tải HTTP trên APK.

Regression bổ sung: URL HTTPS không phụ thuộc Host/X-Forwarded-Proto từ request; upload multipart trả URL canonical và chủ file tải lại đúng bytes. APK 1.0.1 dùng được bản sửa backend này; cần chọn lại ảnh sau deploy để nhận URL HTTPS mới.

Kết quả: **54 suite / 828 test backend đạt** (log `report/logs/avatar-https-regression.log`). Deployment `4ed5db6d-8895-4d3f-a830-9c5b76c2b68a` SUCCESS; xác minh PUBLIC_BASE_URL đúng HTTPS, TRUST_PROXY vẫn false, live/ready 200 và file chưa xác thực 401.

**Nghiệm thu hoàn tất ngày 14/11/2026:** sau khi được yêu cầu chọn lại ảnh → Update Profile và kiểm tra Home/Comments trên APK 1.0.1, người dùng xác nhận **“Ảnh đã hiện và đồng bộ”**. Xác nhận này thay thế trạng thái chờ kiểm tra thiết bị thật ở các phần trước.

Tham khảo hành vi `req.protocol` sau proxy: [Express behind proxies](https://expressjs.com/en/guide/behind-proxies/).
