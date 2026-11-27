import type { APIRoute } from "astro";
import nodemailer from "nodemailer";
import { signReservation, type ReservationPayload } from "../../lib/reservation-token";

export const POST: APIRoute = async ({ request, url }) => {
  try {
    const body = await request.json();
    const { date, time, party, seat, name, email, phone } = body;

    if (!date || !time || !party || !name || !email || !phone) {
      return new Response(JSON.stringify({ error: "必須項目が入力されていません。" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const gmailUser = import.meta.env.GMAIL_USER;
    const gmailPass = import.meta.env.GMAIL_APP_PASSWORD;
    const storeEmail = import.meta.env.STORE_EMAIL || "machiya.no.omise@gmail.com";
    const secret = import.meta.env.APPROVAL_SECRET;

    console.log("DEBUG GMAIL_USER:", gmailUser);
    console.log("DEBUG GMAIL_PASS_LENGTH:", gmailPass?.length);

    if (!gmailUser || !gmailPass || !secret) {
      return new Response(JSON.stringify({ error: "サーバーのGmail設定が未完了です。" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }

    const payload: ReservationPayload = {
      date: String(date),
      time: String(time),
      party: String(party),
      seat: String(seat || "どちらでもよい"),
      name: String(name),
      email: String(email),
      phone: String(phone),
      createdAt: Date.now(),
    };

    // 受諾用URLの生成
    const token = await signReservation(payload, secret);
    const approveUrl = `${url.origin}/api/approve?token=${encodeURIComponent(token)}`;

    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: gmailUser,
        pass: gmailPass,
      },
    });

    // 1. 店側（machiya.no.omise@gmail.com）へ予約リクエスト通知＆受諾リンクを送信
    await transporter.sendMail({
      from: `"マチヤノオミセ 予約システム" <${gmailUser}>`,
      to: storeEmail,
      replyTo: payload.email,
      subject: `【新規予約リクエスト】${payload.date} ${payload.time}〜 ${payload.name}様（${payload.party}名）`,
      html: `
        <div style="font-family: sans-serif; line-height: 1.7; color: #293d32; max-width: 600px;">
          <h2 style="border-bottom: 2px solid #294637; padding-bottom: 8px;">新しい予約リクエストが届きました</h2>
          <p>内容をご確認の上、問題なければ下の「予約を受諾する」ボタンを押してください。<br>
          ボタンを押すと、お客様へ予約確定メールが自動送信されます。</p>

          <table style="width: 100%; border-collapse: collapse; margin: 20px 0; background: #f9f7f2;">
            <tr><th style="text-align: left; padding: 10px; border: 1px solid #ded8c9; width: 32%;">ご来店日</th><td style="padding: 10px; border: 1px solid #ded8c9;">${payload.date}</td></tr>
            <tr><th style="text-align: left; padding: 10px; border: 1px solid #ded8c9;">ご来店時間</th><td style="padding: 10px; border: 1px solid #ded8c9;">${payload.time}</td></tr>
            <tr><th style="text-align: left; padding: 10px; border: 1px solid #ded8c9;">人数</th><td style="padding: 10px; border: 1px solid #ded8c9;">${payload.party}名</td></tr>
            <tr><th style="text-align: left; padding: 10px; border: 1px solid #ded8c9;">お席のご希望</th><td style="padding: 10px; border: 1px solid #ded8c9;">${payload.seat}</td></tr>
            <tr><th style="text-align: left; padding: 10px; border: 1px solid #ded8c9;">お名前</th><td style="padding: 10px; border: 1px solid #ded8c9;">${payload.name} 様</td></tr>
            <tr><th style="text-align: left; padding: 10px; border: 1px solid #ded8c9;">メールアドレス</th><td style="padding: 10px; border: 1px solid #ded8c9;">${payload.email}</td></tr>
            <tr><th style="text-align: left; padding: 10px; border: 1px solid #ded8c9;">電話番号</th><td style="padding: 10px; border: 1px solid #ded8c9;">${payload.phone}</td></tr>
          </table>

          <div style="margin: 28px 0; text-align: center;">
            <a href="${approveUrl}" style="display: inline-block; background: #294637; color: #ffffff; text-decoration: none; padding: 14px 32px; border-radius: 6px; font-weight: bold; font-size: 16px;">
              この予約を受諾して確定メールを送る
            </a>
          </div>
          <p style="font-size: 12px; color: #777;">※ 満席などで受諾できない場合は、このメールにそのまま返信して直接お客様へご連絡ください。</p>
        </div>
      `,
    });

    // 2. 顧客側へ「仮受付（リクエスト受信）」の自動返信メールを送信
    await transporter.sendMail({
      from: `"マチヤノオミセ" <${gmailUser}>`,
      to: payload.email,
      replyTo: storeEmail,
      subject: "【マチヤノオミセ】ご予約リクエストを受け付けました",
      html: `
        <div style="font-family: sans-serif; line-height: 1.8; color: #293d32; max-width: 600px;">
          <p>${payload.name} 様</p>
          <p>マチヤノオミセへのご予約リクエストありがとうございます。<br>
          以下の内容で受け付けいたしました。店舗にて確認後、予約確定のメールをお送りいたします。</p>
          <ul>
            <li><strong>ご来店日：</strong>${payload.date}</li>
            <li><strong>ご来店時間：</strong>${payload.time}</li>
            <li><strong>ご利用人数：</strong>${payload.party}名</li>
            <li><strong>お席のご希望：</strong>${payload.seat}</li>
          </ul>
          <p style="font-size: 12px; color: #777; margin-top: 24px;">
            ※ この時点ではまだ予約は確定しておりません。確定メールをお待ちください。<br>
            マチヤノオミセ（${storeEmail}）
          </p>
        </div>
      `,
    });

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("Reserve API error:", err);
    return new Response(JSON.stringify({ error: "メール送信処理中にエラーが発生しました。" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};