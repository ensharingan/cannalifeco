// paycloud-create-order — push a sale amount to an AddPay terminal (Cloud Mode)
// Input (POST JSON): { terminal_id: uuid, amount?: number, order_id?: uuid, tip_amount?: number, description?: string }
// If order_id is provided, amount is taken from orders.total_amount (source of truth).
// Calls wisehub.cloud.pay.order (POST /api/entry/ecrorder).

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  adminClient,
  API_CREATE,
  callGateway,
  CORS_HEADERS,
  getCallerCompanyId,
  json,
  newMerchantOrderNo,
} from "./paycloud.ts";

const ORDER_EXPIRES_SECONDS = Number(Deno.env.get("PAYCLOUD_ORDER_EXPIRES") ?? "300");

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const admin = adminClient();

  try {
    const companyId = await getCallerCompanyId(req, admin);
    if (!companyId) return json({ error: "Unauthorized" }, 401);

    const body = await req.json().catch(() => ({}));
    const { terminal_id, order_id, tip_amount, description } = body as Record<string, unknown>;
    let amount = Number(body?.amount ?? 0);

    if (!terminal_id) return json({ error: "terminal_id is required" }, 400);

    const { data: terminal, error: termErr } = await admin
      .from("paycloud_terminals")
      .select("id, company_id, store_id, terminal_sn, merchant_no, store_no, is_active")
      .eq("id", terminal_id)
      .maybeSingle();
    if (termErr || !terminal) return json({ error: "Terminal not found" }, 404);
    if (terminal.company_id !== companyId) return json({ error: "Terminal belongs to another company" }, 403);
    if (!terminal.is_active) return json({ error: "Terminal is inactive" }, 400);

    let orderRef: string | null = null;
    if (order_id) {
      const { data: order } = await admin
        .from("orders")
        .select("id, company_id, total_amount")
        .eq("id", order_id)
        .maybeSingle();
      if (!order) return json({ error: "Order not found" }, 404);
      if (order.company_id !== companyId) return json({ error: "Order belongs to another company" }, 403);
      amount = Number(order.total_amount);
      orderRef = order.id;

      const { data: existing } = await admin
        .from("paycloud_transactions")
        .select("id, status, merchant_order_no")
        .eq("order_id", order_id)
        .in("status", ["pushed", "processing", "success"])
        .limit(1);
      if (existing && existing.length > 0) {
        return json({
          error: `Order already has an active card transaction (${existing[0].status})`,
          transaction: existing[0],
        }, 409);
      }
    }

    if (!amount || amount <= 0) return json({ error: "amount must be > 0" }, 400);
    amount = Math.round(amount * 100) / 100;

    const merchantOrderNo = newMerchantOrderNo();

    const { data: tx, error: insErr } = await admin
      .from("paycloud_transactions")
      .insert({
        company_id: companyId,
        store_id: terminal.store_id,
        order_id: orderRef,
        terminal_sn: terminal.terminal_sn,
        merchant_order_no: merchantOrderNo,
        trans_type: 1,
        amount,
        currency: "ZAR",
        status: "pushed",
      })
      .select("id")
      .single();
    if (insErr || !tx) return json({ error: `Failed to create transaction: ${insErr?.message}` }, 500);

    const notifyUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/paycloud-webhook`;

    const result = await callGateway(API_CREATE, {
      merchant_no: terminal.merchant_no,
      store_no: terminal.store_no,
      terminal_sn: terminal.terminal_sn,
      message_receiving_application: "WISECASHIER",
      pay_scenario: "SWIPE_CARD",
      price_currency: "ZAR",
      order_amount: amount,
      ...(tip_amount ? { tip_amount: Number(tip_amount) } : {}),
      trans_type: 1,
      merchant_order_no: merchantOrderNo,
      description: description ? String(description).slice(0, 128) : `Cannalife sale ${merchantOrderNo}`,
      notify_url: notifyUrl,
      expires: ORDER_EXPIRES_SECONDS,
      api_version: "2.0",
    });

    if (!result.ok) {
      await admin
        .from("paycloud_transactions")
        .update({
          status: "error",
          gateway_response: result.raw,
          error_message: result.msg ?? `Gateway code ${result.code}`,
        })
        .eq("id", tx.id);
      return json({ error: result.msg ?? "Gateway rejected the order", code: result.code, psn: result.psn }, 502);
    }

    await admin
      .from("paycloud_transactions")
      .update({ gateway_response: result.raw, psn: result.psn })
      .eq("id", tx.id);

    return json({
      success: true,
      transaction_id: tx.id,
      merchant_order_no: merchantOrderNo,
      psn: result.psn,
      status: "pushed",
    });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
