const nodemailer = require("nodemailer");

const createTransporter = () => {
  const port = Number(process.env.EMAIL_PORT) || 587;
  return nodemailer.createTransport({
    host: process.env.EMAIL_HOST || "smtp.gmail.com",
    port,
    secure: port === 465,
    family: 4,
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 15000,
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,
    },
  });
};

const sendViaBrevo = async ({ to, subject, html }) => {
  const fromEmail = process.env.EMAIL_USER || "noreply@tma.com";
  const fromName = (process.env.EMAIL_FROM || "").replace(/<.*>/, "").trim() || "Task Management App";
  const res = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      "accept": "application/json",
      "content-type": "application/json",
      "api-key": process.env.BREVO_API_KEY,
    },
    body: JSON.stringify({
      sender: { name: fromName, email: fromEmail },
      to: [{ email: to }],
      subject,
      htmlContent: html,
    }),
    signal: AbortSignal.timeout(15000),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Brevo API error (${res.status}): ${body.message || JSON.stringify(body)}`);
  return { success: true, messageId: body.messageId };
};

const sendViaResend = async ({ to, subject, html }) => {
  const from = process.env.RESEND_FROM || process.env.EMAIL_FROM || "Task Management App <onboarding@resend.dev>";
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "authorization": `Bearer ${process.env.RESEND_API_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ from, to: [to], subject, html }),
    signal: AbortSignal.timeout(15000),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Resend API error (${res.status}): ${body.message || JSON.stringify(body)}`);
  return { success: true, messageId: body.id };
};

/**
 * Gửi email OTP để reset password
 * @param {string} email - Email người nhận
 * @param {string} otp - Mã OTP
 * @param {string} fullName - Tên người dùng
 */
const sendResetPasswordEmail = async (email, otp, fullName) => {
  try {
    const subject = "Reset Your Password - Task Management App";
    const html = `
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
      `;

    if (process.env.BREVO_API_KEY) {
      const info = await sendViaBrevo({ to: email, subject, html });
      console.log("Email sent via Brevo:", info.messageId);
      return info;
    }

    if (process.env.RESEND_API_KEY) {
      const info = await sendViaResend({ to: email, subject, html });
      console.log("Email sent via Resend:", info.messageId);
      return info;
    }

    const transporter = createTransporter();
    const info = await transporter.sendMail({
      from: process.env.EMAIL_FROM || "Task Management App <noreply@tma.com>",
      to: email,
      subject,
      html,
    });
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
