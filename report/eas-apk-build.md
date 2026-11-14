# Bước 6 — EAS APK release

Frontend: `../project/eas.json`, `../project/src/config/runtime-api.config.js`. Hướng dẫn build: `../project/report/eas-apk-build.md`; chạy Expo/EAS từ repository **project**.

## Backend đã xác minh

- Railway project `task-management-be`, service `api`, environment `production`.
- Deployment `8596733c-5d46-47fb-ae22-9323886a7a1b`: SUCCESS; commit `c3881e9c4b3afb7d86f5e5ce6c358b315112eca0`.
- Origin: `https://api-production-360b0645.up.railway.app`.
- Live/ready 200, Cache-Control no-store; readiness kiểm tra MongoDB. Auth/me không token: 401. Engine.IO handshake: 200.
- Dockerfile builder, healthcheck `/health/ready`, 1 replica, không sleep. Metadata deployment ghi plan trial lúc kiểm tra.

## Cấu hình và APK

- Profile production-apk: developmentClient=false, distribution=internal, environment=production, android.buildType=apk.
- Runtime chuẩn hóa API /api, dùng URL origin cho socket/file. Sửa replace chuỗi /api có thể làm hỏng hostname api-production.
- Release từ chối endpoint thiếu, HTTP, localhost/LAN IP, credentials/query/fragment. Giữ nguyên module được bảo vệ src/config/api.config.js.
- Giữ owner yenle25404, projectId d3d53646-5766-4186-93bb-618d05d1c5a4, package com.anonymous.project. Firebase client package khớp.
- Người dùng yêu cầu “Chạy build EAS ngay”. Build 9c7d3243-9fd3-49d0-a4f4-6cf682fbf5b1 FINISHED, dùng remote keystore hiện có.
- APK: `../project/dist/production-apk/taskflow-production-1.0.0.apk`, 127.518.811 bytes.
- Version 1.0.0/code 1, minSdk 24, targetSdk 36; chữ ký APK v2 hợp lệ; không bật application-debuggable.
- Bundle JS chứa HTTPS production nằm trong APK, không cần Metro để tải bundle.
- SHA-256: `f1ca05ddb672d3ea196cc9a4ace50a7996ab6244a20e2e690d0a94d23829c6b4`.
- 41/41 test runtime/dashboard đạt; export Android production đạt.

## Thiết bị thật

Cài APK thành công qua USB trên model **23049RAD8C, Android 15** sau khi người dùng cho phép cài đặt. App mở được màn hình đăng nhập; không có ADB reverse, không ghi nhận lỗi AndroidRuntime/ReactNativeJS trong lần kiểm tra.

Lần đầu login trả Invalid credentials vì Atlas chưa có tài khoản. Theo yêu cầu người dùng, đã chuyển 1.015 document, gồm 31 tài khoản từ local lên Atlas. Railway ghi nhận login 200; người dùng xác nhận **“Đăng nhập thành công và thấy dữ liệu”**. Xem [biên bản chuyển Atlas](atlas-migration-verification.md).

Chưa nghiệm thu riêng upload/download, refresh token, GPS, chat hai thiết bị, push notification hoặc kết nối qua 4G/5G/Wi-Fi khác mạng máy phát triển. Có file đính kèm cũ còn URL local; chuyển MongoDB không đồng nghĩa đã chuyển file trên ổ đĩa.

[EAS build và APK](https://expo.dev/accounts/yenle25404/projects/project/builds/9c7d3243-9fd3-49d0-a4f4-6cf682fbf5b1).

Tài liệu: [Expo APK](https://docs.expo.dev/build-reference/apk/), [EAS environment](https://docs.expo.dev/eas/environment-variables/usage/).
