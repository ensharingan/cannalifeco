// paycloud-query-order — polling fallback for the POS waiting modal
// Input (POST JSON): { transaction_id: uuid } or { merchant_order_no: string }
// Calls order.query (POST /api/entry/orderquery). merchant_no is required by the gateway.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  adminClient,
  API_QUERY,
  callGateway,
  CORS_HEADERS,
  getCallerCompanyId,
  json,
  mapTransStatus,
} from "./paycloud.ts";

const TERMINAL_STATES = ["success", "failed", "closed", "error"];

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const admin = adminClient();

  try {
    const companyId = await getCallerCompanyId(req, admin);
    if (!companyId) return json({ error: "Unauthorized" }, 401);

    const body = await req.json().catch(() => ({}));
    const { transaction_id, merchant_order_no } = body as Record<string, unknown>;
    if (!transaction_id && !merchant_order_no) {
      return json({ error: "transaction_id or merchant_order_no required" }, 400);
    }

    let q = admin
      .from("paycloud_transactions")
      .select("id, company_id, status, merchant_order_no, terminal_sn, trans_no, amount, order_id");
    q = transaction_id ? q.eq("id", transaction_id) : q.eq("merchant_order_no", merchant_order_no);
    const { data: tx, error: txErr } = await q.maybeSingle();

    if (txErr || !tx) return json({ error: "Transaction not found" }, 404);
    if (tx.company_id !== companyId) return json({ error: "Forbidden" }, 403);

    if (TERMINAL_STATES.includes(tx.status)) {
      return json({ transaction_id: tx.id, status: tx.status, trans_no: tx.trans_no, order_id: tx.order_id });
    }

    const { data: terminal } = await admin
      .from("paycloud_terminals")
      .select("merchant_no")
      .eq("terminal_sn", tx.terminal_sn)
      .maybeSingle();
    if (!terminal?.merchant_no) {
      return json({ error: "Terminal record missing merchant_no — cannot query gateway" }, 500);
    }

    const result = await callGateway(API_QUERY, {
      merchant_no: terminal.merchant_no,
      ...(tx.trans_no ? { trans_no: tx.trans_no } : { merchant_order_no: tx.merchant_order_no }),
    });

    if (!result.ok) {
      return json({
        transaction_id: tx.id,
        status: tx.status,
        gateway_error: result.msg ?? result.code,
        psn: result.psn,
      });
    }

    const data = result.data ?? {};
    const newStatus = mapTransStatus(data["trans_status"]);
    const transNo = data["trans_no"] === undefined || data["trans_no"] === null ? null : String(data["trans_no"]);

    if (TERMINAL_STATES.includes(newStatus) && newStatus !== tx.status) {
      await admin
        .from("paycloud_transactions")
        .update({ status: newStatus, trans_no: transNo, completed_at: new Date().toISOString() })
        .eq("id", tx.id);
    } else if (newStatus === "processing" && tx.status === "pushed") {
      await admin
        .from("paycloud_transactions")
        .update({ status: "processing", trans_no: transNo })
        .eq("id", tx.id);
    }

    return json({ transaction_id: tx.id, status: newStatus, trans_no: transNo, order_id: tx.order_id });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
