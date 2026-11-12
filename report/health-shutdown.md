# Bước 2 — Health check và shutdown an toàn

Ngày triển khai: 11/11/2026.

## Endpoint

| Request | Trạng thái | Response |
| --- | --- | --- |
| GET /health/live | 200 khi HTTP process còn trả lời | `{"success":true,"data":{"status":"alive"}}` |
| GET /health/ready | 200 khi startup hoàn tất, MongoDB connected và ping thành công | `{"success":true,"data":{"status":"ready"}}` |
| GET /health/ready | 503 khi chưa sẵn sàng, DB mất kết nối/ping lỗi/timeout hoặc đang shutdown | `{"success":false,"error":"Service not ready"}` |

- Probe công khai, không cần JWT; đặt trước business rate limiter, CORS và middleware thay thế response 5xx. Không tiết lộ URI, credentials, host database hoặc stack trace.
- Tất cả response health có `Cache-Control: no-store`.
- Liveness không gọi MongoDB và không phụ thuộc email/Cloudinary/AI. Readiness kiểm tra trạng thái Mongoose rồi thực hiện lệnh ping thật qua kết nối hiện có.
- Probe có deadline ứng dụng và AbortSignal để hủy thao tác; dùng maxTimeMS giới hạn xử lý tại MongoDB. Không dùng timeoutMS của driver.
- Các request readiness đồng thời chia sẻ tối đa một ping đang chạy. Sau timeout, giữ kết quả không sẵn sàng cho tới khi thao tác underlying kết thúc, tránh tích lũy lệnh DB bị treo. Khi DB hồi phục, probe tiếp theo có thể trả 200 trở lại.
- Khi bắt đầu shutdown, probe đang chờ cũng trả không sẵn sàng; ping/startup hoàn tất muộn không thể đổi readiness về 200.

## Cấu hình

| Biến | Mặc định | Giới hạn |
| --- | --- | --- |
| HEALTHCHECK_TIMEOUT_MS | 1000 ms | số nguyên 1–5000 |
| SHUTDOWN_TIMEOUT_MS | 15000 ms | số nguyên 1–120000 |

Các giá trị được validate bởi runtime config trước startup. Không cần sửa `.env` local nếu dùng mặc định.

Kiểm tra khi backend đang chạy:

```powershell
curl.exe -i http://localhost:3000/health/live
curl.exe -i http://localhost:3000/health/ready
```

Production có thể cấu hình platform readiness path là `/health/ready`, timeout lớn hơn HEALTHCHECK_TIMEOUT_MS và startup grace period phù hợp. Liveness dùng `/health/live`. Cấu hình Docker/hosting cụ thể thuộc các bước tiếp theo.

## Trình tự shutdown

1. SIGINT hoặc SIGTERM chuyển trạng thái sang stopping ngay lập tức. Tín hiệu lặp lại dùng chung một Promise shutdown.
2. HTTP server ngừng nhận kết nối mới. Request mới trên kết nối còn tồn tại bị từ chối; request đã nhận được phép hoàn thành.
3. Dừng lịch chạy reminder và socket session/budget timers. Chờ tick reminder, authentication/socket event/revalidation đã nhận hoàn tất; không nhận thêm công việc mới.
4. Đóng Socket.IO/Engine.IO, gồm WebSocket và long polling. Thu hồi kết nối keep-alive khi response đang chạy hoàn tất để không chờ hết keep-alive timeout.
5. Sau HTTP và công việc nền, chờ audit writes đã xếp hàng rồi đóng MongoDB.
6. Hoàn tất bình thường: exit 0. Lỗi cleanup/startup/listen: exit 1. Hết deadline: hủy các TCP connection còn lại (kể cả upgraded socket), exit 1.

Ngay sau khi đóng listener, probe mới có thể nhận connection refused thay vì HTTP 503; đó là trạng thái listener đã dừng. Cam kết 503 áp dụng khi request vẫn được HTTP server xử lý. Liveness trả 200 tới lúc HTTP listener đóng, kể cả khi readiness đã xuống 503.

Database helper không còn tự đăng ký SIGINT hoặc gọi process.exit. Initial server selection được giới hạn 10 giây; lỗi được chuyển tới lifecycle để cleanup các tài nguyên đã khởi tạo. HTTP có thể phục vụ liveness trong lúc kết nối DB, nhưng readiness chưa lên 200.

Nếu MongoDB hoàn tất kết nối sau khi đã nhận tín hiệu dừng, server không khởi động scheduler hoặc đánh dấu ready. Deadline shutdown cần nhỏ hơn thời gian nền tảng cho phép trước khi kill container. SIGKILL hoặc thao tác force-kill của hệ điều hành không thể được xử lý graceful.

## Kiểm chứng

- Test health: startup chưa xong; các trạng thái disconnected/connecting/disconnecting; ping thành công/lỗi/timeout; concurrent probes; hồi phục DB; shutdown hoặc disconnect giữa lúc ping.
- Test lifecycle: SIGINT/SIGTERM lặp lại; thứ tự drain trước DB; lỗi cleanup; deadline khi scheduler/audit/DB bị treo; server chưa listen.
- HTTP/WebSocket thực trên cổng ngẫu nhiên: request nghiệp vụ được hoàn tất, readiness đang chờ chuyển 503, socket được đóng và process có thể thoát sạch.
- Tiến trình riêng kiểm chứng signal handler và exit code. Windows dùng IPC gọi `process.emit(signal)` vì `child.kill(SIGTERM)` trên Windows là terminate cưỡng bức; Unix gửi tín hiệu hệ điều hành thật.
- Không sử dụng Atlas hoặc dữ liệu production trong test. Kết nối DB được mock, còn giao tiếp HTTP/WebSocket là thật.
- Logs: `report/logs/health-focused-tests.log`, `report/logs/health-lifecycle-tests.log`, `report/logs/health-full-tests.log`. Coverage vẫn nằm trong `coverage/`.

Kết quả cuối:

- Node 24.22.1: **54/54 suites, 818/818 tests passed**, exit code 0. Coverage toàn suite: statements 74.63%, branches 65.31%, functions 77.31%, lines 75.14%; đạt các threshold hiện có.
- Node 22.13.1 development: **4/4 suites, 97/97 tests passed** cho runtime/health/lifecycle/signals. Log: `report/logs/health-node22-tests.log`.
- Test thực phát hiện và đã khắc phục trường hợp request hoàn tất chuyển sang idle keep-alive làm shutdown chờ hết deadline. Test cuối xác nhận request hoàn tất, readiness 503 và WebSocket đóng trước exit 0.
- `git diff --check` đạt; chỉ có nhắc chuẩn hóa LF/CRLF trên Windows.
- Backend local cổng 3000 không chạy khi thử curl ngày 11/11/2026, nên chưa kiểm tra endpoint với database local thực. Các test HTTP/WebSocket dùng server thật trên cổng ngẫu nhiên và DB giả lập.
- Full suite vẫn có cảnh báo Jest thoát chậm và audit_write_failed của tác vụ bất đồng bộ sau test; tiến trình tự thoát code 0. Nhóm test health/lifecycle/signals chạy độc lập trên Node 22 không có cảnh báo này. Lifecycle production đã gọi audit.flush trước khi disconnect DB.

## Tham chiếu

- [Node HTTP close và quản lý connection](https://nodejs.org/api/http.html#serverclosecallback).
- [Socket.IO server.close](https://socket.io/docs/v4/server-api/#serverclosecallback): cũng đóng HTTP server chung, nên lifecycle giữ một close callback riêng để đợi request HTTP.
- [MongoDB timeout options](https://www.mongodb.com/docs/drivers/node/current/connect/connection-options/csot/).
