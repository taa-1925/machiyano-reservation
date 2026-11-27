import type { APIRoute } from "astro";
import nodemailer from "nodemailer";
import { verifyReservation } from "../../lib/reservation-token";

export const GET: APIRoute = async ({ url }) => {
  const token = url.searchParams.get("token");
  const secret = import.meta.env.APPROVAL_SECRET;
  const gmailUser = import.meta.env.GMAIL_USER;
  const gmailPass = import.meta.env.GMAIL_APP_PASSWORD;
  const storeEmail = import.meta.env.STORE_EMAIL || "machiya.no.omise@gmail.com";

  if (!token || !secret || !gmailUser || !gmailPass) {
    return new Response("無効なアクセスです。", { status: 400 });
  }

  const reservation = await verifyReservation(token, secret);
  if (!reservation) {
    return new Response("受諾リンクが無効、または破損しています。", { status: 400 });
  }

  try {
    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: gmailUser,
        pass: gmailPass,
      },
    });

    // 顧客へ「予約確定メール」を送信
    await transporter.sendMail({
      from: `"マチヤノオミセ" <${gmailUser}>`,
      to: reservation.email,
      replyTo: storeEmail,
      subject: "【マチヤノオミセ】ご予約が確定いたしました",
      html: `
        <div style="font-family: sans-serif; line-height: 1.8; color: #293d32; max-width: 600px;">
          <p>${reservation.name} 様</p>
          <p>お待たせいたしました。以下の内容でご予約が確定いたしました。<br>
          当日お会いできるのを楽しみにしております。</p>
          <div style="background: #f5f1e8; padding: 16px; border-radius: 8px; margin: 16px 0;">
            <p style="margin: 4px 0;"><strong>ご来店日時：</strong>${reservation.date} ${reservation.time}〜</p>
            <p style="margin: 4px 0;"><strong>ご利用人数：</strong>${reservation.party}名</p>
            <p style="margin: 4px 0;"><strong>お席：</strong>${reservation.seat}</p>
          </div>
          <p style="font-size: 12px; color: #777; margin-top: 24px;">
            ※ 変更やキャンセルがある場合は、本メールへの返信またはお電話にてご連絡ください。<br>
            マチヤノオミセ（${storeEmail}）
          </p>
        </div>
      `,
    });

    // 店側のブラウザに表示する完了画面
    const html = `<!doctype html>
    <html lang="ja">
    <head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>予約受諾完了</title></head>
    <body style="font-family: sans-serif; background: #f5f1e8; color: #293d32; display: grid; place-items: center; min-height: 100vh; margin: 0; padding: 16px;">
      <div style="background: #fffefa; border: 1px solid #e8e1d4; border-radius: 10px; padding: 32px; max-width: 480px; text-align: center;">
        <div style="width: 52px; height: 52px; border-radius: 50%; background: #e8eee5; color: #294637; display: grid; place-items: center; margin: 0 auto 16px; font-size: 26px;">✓</div>
        <h1 style="font-size: 20px; margin: 0 0 12px;">予約を受諾しました</h1>
        <p style="font-size: 14px; color: #666; line-height: 1.7;">
          <strong>${reservation.name} 様</strong>（${reservation.date} ${reservation.time} / ${reservation.party}名）の予約を確定し、お客様へ確定メールを送信しました。
        </p>
      </div>
    </body>
    </html>`;

    return new Response(html, {
      status: 200,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  } catch (err) {
    console.error("Approve mail error:", err);
    return new Response("お客様への確定メール送信に失敗しました。", { status: 500 });
  }
};