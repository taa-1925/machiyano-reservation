export interface ReservationPayload {
  date: string;       // 例: "2026-11-20"
  time: string;       // 例: "10:30"
  party: string;      // 例: "2"
  seat: string;       // 例: "座敷希望"
  name: string;       // 顧客名
  email: string;      // 顧客メールアドレス
  phone: string;      // 顧客電話番号
  createdAt: number;  // 申込タイムスタンプ
}

const encoder = new TextEncoder();

async function getKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}

function toBase64Url(buffer: ArrayBuffer | Uint8Array): string {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(str: string): Uint8Array {
  const base64 = str.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** 予約データから署名付きトークンを生成 */
export async function signReservation(payload: ReservationPayload, secret: string): Promise<string> {
  const dataPart = toBase64Url(encoder.encode(JSON.stringify(payload)));
  const key = await getKey(secret);
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(dataPart));
  return `${dataPart}.${toBase64Url(sig)}`;
}

/** トークンを検証して予約データを復元（不正な場合は null） */
export async function verifyReservation(token: string, secret: string): Promise<ReservationPayload | null> {
  const [dataPart, sigPart] = token.split(".");
  if (!dataPart || !sigPart) return null;

  try {
    const key = await getKey(secret);
    const sigBytes = fromBase64Url(sigPart);
    const valid = await crypto.subtle.verify("HMAC", key, sigBytes.buffer as ArrayBuffer, encoder.encode(dataPart));
    if (!valid) return null;

    const json = new TextDecoder().decode(fromBase64Url(dataPart));
    return JSON.parse(json) as ReservationPayload;
  } catch {
    return null;
  }
}