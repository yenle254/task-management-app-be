/**
 * Tạo OTP 6 số ngẫu nhiên
 * @returns {string} OTP 6 số
 */
const generateOTP = () => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

/**
 * Kiểm tra OTP đã hết hạn chưa
 * @param {Date} expiresAt - Thời điểm hết hạn
 * @returns {boolean}
 */
const isOTPExpired = (expiresAt) => {
  return new Date() > new Date(expiresAt);
};

/**
 * Tạo thời gian hết hạn OTP (10 phút)
 * @returns {Date}
 */
const getOTPExpireTime = () => {
  return new Date(Date.now() + 10 * 60 * 1000); // 10 minutes
};

module.exports = {
  generateOTP,
  isOTPExpired,
  getOTPExpireTime,
};
