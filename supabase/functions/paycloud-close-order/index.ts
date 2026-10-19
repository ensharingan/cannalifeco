// paycloud-close-order — cancel a pushed order before the customer starts paying
// Input (POST JSON): { transaction_id: uuid, reason?: string }
// Calls wisehub.cloud.pay.close (POST /api/entry/ecrclose). Only valid for gateway
// trans_status=9 (created); once payment starts, cancel happens on the terminal itself.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  adminClient,
  API_CLOSE,
  callGateway,
  CORS_HEADERS,
  getCallerCompanyId,
  json,
} from "./paycloud.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const admin = adminClient();

  try {
    const companyId = await getCallerCompanyId(req, admin);
    if (!companyId) return json({ error: "Unauthorized" }, 401);

    const body = await req.json().catch(() => ({}));
    const { transaction_id, reason } = body as Record<string, unknown>;
    if (!transaction_id) return json({ error: "transaction_id required" }, 400);

    const { data: tx, error: txErr } = await admin
      .from("paycloud_transactions")
      .select("id, company_id, status, merchant_order_no, terminal_sn")
      .eq("id", transaction_id)
      .maybeSingle();

    if (txErr || !tx) return json({ error: "Transaction not found" }, 404);
    if (tx.company_id !== companyId) return json({ error: "Forbidden" }, 403);

    if (tx.status !== "pushed") {
      return json({ error: `Cannot close a transaction in status '${tx.status}'` }, 409);
    }

    const { data: terminal } = await admin
      .from("paycloud_terminals")
      .select("merchant_no, store_no")
      .eq("terminal_sn", tx.terminal_sn)
      .maybeSingle();
    if (!terminal?.merchant_no) {
      return json({ error: "Terminal record missing merchant_no — cannot close via gateway" }, 500);
    }

    const result = await callGateway(API_CLOSE, {
      merchant_no: terminal.merchant_no,
      store_no: terminal.store_no,
      terminal_sn: tx.terminal_sn,
      merchant_order_no: tx.merchant_order_no,
      message_receiving_application: "WISECASHIER",
      description: reason ? String(reason).slice(0, 128) : "Cancelled at POS",
    });

    if (!result.ok) {
      return json({
        error: result.msg ?? "Gateway refused to close the order (customer may already be paying)",
        code: result.code,
        psn: result.psn,
      }, 502);
    }

    await admin
      .from("paycloud_transactions")
      .update({ status: "closed", completed_at: new Date().toISOString(), gateway_response: result.raw })
      .eq("id", tx.id);

    return json({ success: true, transaction_id: tx.id, status: "closed" });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
