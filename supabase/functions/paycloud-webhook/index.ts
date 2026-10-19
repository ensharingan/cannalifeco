// paycloud-webhook — Transaction Result Notification receiver (PayCloud -> Budify)
// Payload is flat top-level (method: payment.result.notify), signed like every other message.
// PayCloud retries 15 times over 12h until it receives plain-text "success" — we ACK once the
// result is durably recorded, and handle duplicate notifications idempotently.
// NOTE: deliberately does NOT touch the orders table — the POS flow owns order finalization.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { adminClient, mapTransStatus, verifyGatewaySign } from "./paycloud.ts";

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const admin = adminClient();

  let payload: Record<string, unknown>;
  try {
    payload = await req.json();
  } catch (_e) {
    return new Response("Bad payload", { status: 400 });
  }

  // Signature verification (skip only if explicitly disabled for UAT bring-up)
  const skipVerify = Deno.env.get("PAYCLOUD_SKIP_VERIFY") === "true";
  if (!skipVerify) {
    let valid = false;
    try {
      valid = await verifyGatewaySign(payload);
    } catch (e) {
      console.error("paycloud-webhook: verification unavailable:", (e as Error).message);
      return new Response("Verification unavailable", { status: 503 });
    }
    if (!valid) {
      console.error("paycloud-webhook: INVALID SIGNATURE", JSON.stringify(payload).slice(0, 500));
      return new Response("Invalid signature", { status: 401 });
    }
  }

  const merchantOrderNo = String(payload["merchant_order_no"] ?? "");
  if (!merchantOrderNo) {
    console.error("paycloud-webhook: no merchant_order_no in payload");
    return new Response("success", { status: 200 }); // ACK; nothing we can match
  }

  const status = mapTransStatus(payload["trans_status"]);
  const transNo = payload["trans_no"] === undefined || payload["trans_no"] === null ? null : String(payload["trans_no"]);
  const payMethod = payload["pay_method_id"] === undefined || payload["pay_method_id"] === null ? null : String(payload["pay_method_id"]);

  const { data: tx, error: findErr } = await admin
    .from("paycloud_transactions")
    .select("id, status, amount")
    .eq("merchant_order_no", merchantOrderNo)
    .maybeSingle();

  if (findErr || !tx) {
    console.error(`paycloud-webhook: unknown merchant_order_no ${merchantOrderNo}`);
    return new Response("success", { status: 200 }); // ACK to stop retries; logged for investigation
  }

  // Idempotency: never regress a terminal state (duplicate notifications are expected)
  if (tx.status === "success" || tx.status === "failed" || tx.status === "closed") {
    return new Response("success", { status: 200 });
  }

  // Sanity: order_amount in the notification should match what we pushed
  const notifiedAmount = Number(payload["order_amount"] ?? NaN);
  if (!Number.isNaN(notifiedAmount) && Math.abs(notifiedAmount - Number(tx.amount)) > 0.005) {
    console.error(`paycloud-webhook: AMOUNT MISMATCH ${merchantOrderNo}: ours ${tx.amount}, notified ${notifiedAmount}`);
    // Record but flag — do not silently mark success
    await admin
      .from("paycloud_transactions")
      .update({ notify_payload: payload, error_message: `Amount mismatch: notified ${notifiedAmount}` })
      .eq("id", tx.id);
    return new Response("success", { status: 200 });
  }

  // Only act on meaningful statuses; 9/0 (created/processing) just update progress
  const update: Record<string, unknown> = {
    notify_payload: payload,
    trans_no: transNo,
    pay_method: payMethod,
  };
  if (status === "success" || status === "failed" || status === "closed") {
    update["status"] = status;
    update["completed_at"] = new Date().toISOString();
  } else if (status === "processing" && tx.status === "pushed") {
    update["status"] = "processing";
  }

  const { error: updErr } = await admin
    .from("paycloud_transactions")
    .update(update)
    .eq("id", tx.id);

  if (updErr) {
    console.error("paycloud-webhook: update failed:", updErr.message);
    return new Response("Retry", { status: 500 }); // let PayCloud retry
  }

  return new Response("success", { status: 200 });
});
