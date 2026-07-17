const nodemailer = require("nodemailer");

const createTransporter = () => {
  return nodemailer.createTransport({
    host: process.env.EMAIL_HOST || "smtp.gmail.com",
    port: process.env.EMAIL_PORT || 587,
    secure: false,
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,
    },
  });
};

/**
 * Gửi email OTP để reset password
 * @param {string} email - Email người nhận
 * @param {string} otp - Mã OTP
 * @param {string} fullName - Tên người dùng
 */
const sendResetPasswordEmail = async (email, otp, fullName) => {
  try {
    const transporter = createTransporter();

    const mailOptions = {
      from: process.env.EMAIL_FROM || "Task Management App <noreply@tma.com>",
      to: email,
      subject: "Reset Your Password - Task Management App",
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
        </head>
        <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; text-align: center; border-radius: 10px 10px 0 0;">
            <h1 style="color: white; margin: 0; font-size: 28px;">Password Reset</h1>
          </div>
          
          <div style="background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px;">
            <p style="font-size: 16px;">Hello <strong>${fullName}</strong>,</p>
            
            <p style="font-size: 16px;">We received a request to reset your password. Use the verification code below to proceed:</p>
            
            <div style="background: #ffffff; border: 2px dashed #667eea; padding: 20px; text-align: center; margin: 30px 0; border-radius: 10px;">
              <span style="font-size: 36px; font-weight: bold; letter-spacing: 8px; color: #667eea;">${otp}</span>
            </div>
            
            <p style="font-size: 14px; color: #666;">
              <strong>⏰ This code will expire in 10 minutes.</strong>
            </p>
            
            <p style="font-size: 14px; color: #666;">
              If you didn't request a password reset, please ignore this email or contact support if you have concerns.
            </p>
            
            <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;">
            
            <p style="font-size: 12px; color: #999; text-align: center;">
              This is an automated message from Task Management App.<br>
              Please do not reply to this email.
            </p>
          </div>
        </body>
        </html>
      `,
    };

    const info = await transporter.sendMail(mailOptions);
    console.log("Email sent:", info.messageId);
    return { success: true, messageId: info.messageId };
  } catch (error) {
    console.error("Error sending email:", error);
    throw error;
  }
};

module.exports = {
  sendResetPasswordEmail,
};
