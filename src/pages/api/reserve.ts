import type { APIRoute } from "astro";
import nodemailer from "nodemailer";
import { signReservation, type ReservationPayload } from "../../lib/reservation-token";

// HTML特殊文字の無害化（メール本文へのタグ・リンク埋め込み防止）
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export const POST: APIRoute = async ({ request, url }) => {
  try {
    const body = await request.json();
    const { date, time, party, seat, name, email, phone, turnstileToken } = body;

    const cleanDate = String(date || "").trim();
    const cleanTime = String(time || "").trim();
    const cleanParty = String(party || "").trim();
    const cleanSeat = String(seat || "どちらでもよい").trim();
    const cleanName = String(name || "").trim();
    const cleanEmail = String(email || "").trim();
    const cleanPhone = String(phone || "").trim();
    const cleanToken = String(turnstileToken || "").trim();

    // 1. 必須項目チェック（電話番号は任意）
    if (!cleanDate || !cleanTime || !cleanParty || !cleanName || !cleanEmail) {
      return new Response(JSON.stringify({ error: "必須項目が入力されていません。" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    // 2. メールヘッダインジェクション対策（改行コード \r / \n を含む入力を遮断）
    if (
      /[\r\n]/.test(cleanEmail) ||
      /[\r\n]/.test(cleanName) ||
      /[\r\n]/.test(cleanPhone) ||
      /[\r\n]/.test(cleanDate) ||
      /[\r\n]/.test(cleanTime) ||
      /[\r\n]/.test(cleanSeat)
    ) {
      return new Response(JSON.stringify({ error: "不正な文字が含まれています。" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    // 3. 入力形式・文字数制限チェック
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (
      !emailRegex.test(cleanEmail) ||
      cleanEmail.length > 254 ||
      cleanName.length > 60 ||
      cleanPhone.length > 30 ||
      cleanDate.length > 20 ||
      cleanTime.length > 10 ||
      cleanParty.length > 5 ||
      cleanSeat.length > 30
    ) {
      return new Response(JSON.stringify({ error: "入力内容の形式または文字数が正しくありません。" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    // 4. Cloudflare Turnstile ボット判定検証
    const turnstileSecret = import.meta.env.TURNSTILE_SECRET_KEY;
    if (turnstileSecret) {
      if (!cleanToken) {
        return new Response(
          JSON.stringify({ error: "認証チェックが完了していません。少し待ってから再度お試しください。" }),
          {
            status: 400,
            headers: { "Content-Type": "application/json" },
          }
        );
      }

      const verifyRes = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          secret: turnstileSecret,
          response: cleanToken,
        }),
      });
      const verifyData = await verifyRes.json();

      if (!verifyData.success) {
        return new Response(
          JSON.stringify({ error: "自動送信ブロック（認証エラー）が発生しました。ページを再読み込みしてお試しください。" }),
          {
            status: 403,
            headers: { "Content-Type": "application/json" },
          }
        );
      }
    }

    const gmailUser = import.meta.env.GMAIL_USER;
    const gmailPass = import.meta.env.GMAIL_APP_PASSWORD;
    const storeEmail = import.meta.env.STORE_EMAIL || "machiya.no.omise@gmail.com";
    const secret = import.meta.env.APPROVAL_SECRET;

    if (!gmailUser || !gmailPass || !secret) {
      return new Response(JSON.stringify({ error: "サーバーのGmail設定が未完了です。" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }

    const payload: ReservationPayload = {
      date: cleanDate,
      time: cleanTime,
      party: cleanParty,
      seat: cleanSeat || "どちらでもよい",
      name: cleanName,
      email: cleanEmail,
      phone: cleanPhone || "未入力",
      createdAt: Date.now(),
    };

    // 受諾用URLの生成
    const token = await signReservation(payload, secret);
    const approveUrl = `${url.origin}/api/approve?token=${encodeURIComponent(token)}`;

    // HTML表示用にエスケープした値
    const safeDate = escapeHtml(payload.date);
    const safeTime = escapeHtml(payload.time);
    const safeParty = escapeHtml(payload.party);
    const safeSeat = escapeHtml(payload.seat);
    const safeName = escapeHtml(payload.name);
    const safeEmail = escapeHtml(payload.email);
    const safePhone = escapeHtml(payload.phone);

    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: gmailUser,
        pass: gmailPass,
      },
    });

    // 1. 店側へ予約リクエスト通知＆受諾リンクを送信
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
            <tr><th style="text-align: left; padding: 10px; border: 1px solid #ded8c9; width: 32%;">ご来店日</th><td style="padding: 10px; border: 1px solid #ded8c9;">${safeDate}</td></tr>
            <tr><th style="text-align: left; padding: 10px; border: 1px solid #ded8c9;">ご来店時間</th><td style="padding: 10px; border: 1px solid #ded8c9;">${safeTime}</td></tr>
            <tr><th style="text-align: left; padding: 10px; border: 1px solid #ded8c9;">人数</th><td style="padding: 10px; border: 1px solid #ded8c9;">${safeParty}名</td></tr>
            <tr><th style="text-align: left; padding: 10px; border: 1px solid #ded8c9;">お席のご希望</th><td style="padding: 10px; border: 1px solid #ded8c9;">${safeSeat}</td></tr>
            <tr><th style="text-align: left; padding: 10px; border: 1px solid #ded8c9;">お名前</th><td style="padding: 10px; border: 1px solid #ded8c9;">${safeName} 様</td></tr>
            <tr><th style="text-align: left; padding: 10px; border: 1px solid #ded8c9;">メールアドレス</th><td style="padding: 10px; border: 1px solid #ded8c9;">${safeEmail}</td></tr>
            <tr><th style="text-align: left; padding: 10px; border: 1px solid #ded8c9;">電話番号</th><td style="padding: 10px; border: 1px solid #ded8c9;">${safePhone}</td></tr>
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
          <p>${safeName} 様</p>
          <p>マチヤノオミセへのご予約リクエストありがとうございます。<br>
          以下の内容で受け付けいたしました。店舗にて確認後、予約確定のメールをお送りいたします。</p>
          <ul>
            <li><strong>ご来店日：</strong>${safeDate}</li>
            <li><strong>ご来店時間：</strong>${safeTime}</li>
            <li><strong>ご利用人数：</strong>${safeParty}名</li>
            <li><strong>お席のご希望：</strong>${safeSeat}</li>
          </ul>
          <p style="font-size: 12px; color: #777; margin-top: 24px;">
            ※ この時点ではまだ予約は確定しておりません。確定メールをお待ちください。<br>
            マチヤノオミセ（${escapeHtml(storeEmail)}）
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