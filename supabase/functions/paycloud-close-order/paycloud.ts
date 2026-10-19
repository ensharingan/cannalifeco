// paycloud.ts — Shared PayCloud (AddPay) gateway client for Budify edge functions
// Spec confirmed from developers.paycloud.africa (2026-09-04):
// - Sign: sorted key=value joined with '&', excluding `sign` and null/empty values,
//   SHA256withRSA, STANDARD base64 output (docs say base64url but their test vector is standard b64).
// - Every API adds a required `method` field. timestamp is a 13-digit number.
// - Webhook (payment.result.notify) is flat top-level, same signing; respond plain "success".

import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2";

export const GATEWAY_URL = (Deno.env.get("PAYCLOUD_GATEWAY_URL") ?? "https://open-uat.paycloud.africa").replace(/\/+$/, "");
export const APP_ID = Deno.env.get("PAYCLOUD_APP_ID") ?? "";
const APP_PRIVATE_KEY_B64 = Deno.env.get("PAYCLOUD_APP_PRIVATE_KEY") ?? "";
const GATEWAY_PUBLIC_KEY_B64 = Deno.env.get("PAYCLOUD_GATEWAY_PUBLIC_KEY") ?? "";

// Paths + methods per API (confirmed in docs)
export const API_CREATE = { path: "/api/entry/ecrorder", method: "wisehub.cloud.pay.order" };
export const API_QUERY = { path: "/api/entry/orderquery", method: "order.query" };
export const API_CLOSE = { path: "/api/entry/ecrclose", method: "wisehub.cloud.pay.close" };

export const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

export function adminClient(): SupabaseClient {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
}

/** Resolve the calling user's company_id from their JWT (service role read, no RLS recursion). */
export async function getCallerCompanyId(req: Request, admin: SupabaseClient): Promise<string | null> {
  const auth = req.headers.get("Authorization") ?? "";
  const token = auth.replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data?.user) return null;
  const { data: profile } = await admin
    .from("profiles")
    .select("company_id")
    .eq("id", data.user.id)
    .maybeSingle();
  return profile?.company_id ?? null;
}

// ---------- base64 helpers ----------

function b64ToBytes(b64: string): Uint8Array {
  const clean = b64.replace(/\s+/g, "");
  const bin = atob(clean);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function bytesToB64(bytes: ArrayBuffer): string {
  const arr = new Uint8Array(bytes);
  let bin = "";
  for (let i = 0; i < arr.length; i++) bin += String.fromCharCode(arr[i]);
  return btoa(bin); // STANDARD base64 — matches PayCloud's documented test vector
}

function b64AnyToBytes(b64any: string): Uint8Array {
  // Accept both standard base64 and base64url, with or without padding
  let b64 = b64any.replace(/-/g, "+").replace(/_/g, "/").replace(/\s+/g, "");
  while (b64.length % 4 !== 0) b64 += "=";
  return b64ToBytes(b64);
}

// ---------- keys ----------

let _privateKey: CryptoKey | null = null;
let _gatewayKey: CryptoKey | null = null;

async function getPrivateKey(): Promise<CryptoKey> {
  if (_privateKey) return _privateKey;
  if (!APP_PRIVATE_KEY_B64) throw new Error("PAYCLOUD_APP_PRIVATE_KEY not configured");
  _privateKey = await crypto.subtle.importKey(
    "pkcs8",
    b64ToBytes(APP_PRIVATE_KEY_B64).buffer as ArrayBuffer,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return _privateKey;
}

async function getGatewayKey(): Promise<CryptoKey> {
  if (_gatewayKey) return _gatewayKey;
  if (!GATEWAY_PUBLIC_KEY_B64) throw new Error("PAYCLOUD_GATEWAY_PUBLIC_KEY not configured");
  _gatewayKey = await crypto.subtle.importKey(
    "spki",
    b64ToBytes(GATEWAY_PUBLIC_KEY_B64).buffer as ArrayBuffer,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"],
  );
  return _gatewayKey;
}

// ---------- signing ----------

/**
 * Content to sign: all top-level params EXCEPT `sign` and any null/undefined/empty-string
 * values (per spec). Nested objects/arrays must be JSON-stringified. Keys sorted ASCII asc,
 * joined as key=value with '&'.
 */
export function buildContentToSign(params: Record<string, unknown>): string {
  const keys = Object.keys(params)
    .filter((k) => {
      if (k === "sign") return false;
      const v = params[k];
      return v !== null && v !== undefined && v !== "";
    })
    .sort();
  return keys
    .map((k) => {
      const v = params[k];
      const s = typeof v === "object" ? JSON.stringify(v) : String(v);
      return `${k}=${s}`;
    })
    .join("&");
}

export async function signParams(params: Record<string, unknown>): Promise<string> {
  const content = buildContentToSign(params);
  const key = await getPrivateKey();
  const sig = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(content),
  );
  return bytesToB64(sig);
}

export async function verifyGatewaySign(params: Record<string, unknown>): Promise<boolean> {
  const sign = params["sign"];
  if (typeof sign !== "string" || !sign) return false;
  const content = buildContentToSign(params);
  const key = await getGatewayKey();
  try {
    return await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      key,
      b64AnyToBytes(sign).buffer as ArrayBuffer,
      new TextEncoder().encode(content),
    );
  } catch (_e) {
    return false;
  }
}

// ---------- gateway call ----------

export interface GatewayResult {
  ok: boolean;          // HTTP + gateway-level success (code === "0")
  raw: unknown;         // full parsed response body
  code: string | null;
  msg: string | null;
  psn: string | null;   // PayCloud trace number (top-level in every response)
  data: Record<string, unknown> | null;
}

/** Sign and POST params to the gateway. Never throws for gateway errors — inspect result. */
export async function callGateway(
  api: { path: string; method: string },
  bizParams: Record<string, unknown>,
): Promise<GatewayResult> {
  if (!APP_ID) throw new Error("PAYCLOUD_APP_ID not configured");
  const params: Record<string, unknown> = {
    app_id: APP_ID,
    format: "JSON",
    charset: "UTF-8",
    sign_type: "RSA2",
    version: "1.0",
    timestamp: Date.now(),
    method: api.method,
    ...bizParams,
  };
  params["sign"] = await signParams(params);

  const res = await fetch(`${GATEWAY_URL}${api.path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });

  let raw: unknown = null;
  const text = await res.text();
  try {
    raw = JSON.parse(text);
  } catch (_e) {
    raw = { _unparsed: text };
  }

  const r = raw as Record<string, unknown>;
  const code = r?.["code"] === undefined || r?.["code"] === null ? null : String(r["code"]);
  const msg = r?.["msg"] === undefined || r?.["msg"] === null ? null : String(r["msg"]);
  const psn = r?.["psn"] === undefined || r?.["psn"] === null ? null : String(r["psn"]);
  const data = (r?.["data"] && typeof r["data"] === "object") ? r["data"] as Record<string, unknown> : null;
  const ok = res.ok && code === "0";

  return { ok, raw, code, msg, psn, data };
}

/**
 * Map PayCloud trans_status to our transaction status.
 * Dictionary: 9=Created, 0=Processing, 1=Closed, 2=Completed, 3=Cancelled
 */
export function mapTransStatus(transStatus: unknown): "success" | "failed" | "processing" | "closed" | "pushed" {
  const s = String(transStatus ?? "");
  if (s === "2") return "success";
  if (s === "3") return "failed";   // cancelled by customer/cashier
  if (s === "1") return "closed";
  if (s === "9") return "pushed";   // created, waiting on terminal
  return "processing";               // 0 or unknown
}

/** Generate a merchant_order_no: <=32 chars, allowed charset, prefixed BD. */
export function newMerchantOrderNo(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const ts = `${String(d.getFullYear()).slice(2)}${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  const rand = Array.from(crypto.getRandomValues(new Uint8Array(4)))
    .map((b) => "ABCDEFGHJKMNPQRSTUVWXYZ23456789"[b % 31])
    .join("");
  return `BD${ts}${rand}`; // 18 chars
}
