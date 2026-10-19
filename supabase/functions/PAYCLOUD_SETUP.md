# PayCloud (AddPay) Integration — Setup Guide

## What's deployed (already live)

**Database** (migration `paycloud_terminal_integration_init` applied):
- `paycloud_terminals` — one row per card machine: company_id, store_id, terminal_sn, merchant_no, store_no, label, is_active
- `paycloud_transactions` — every push to a terminal: merchant_order_no, psn, trans_no, amount, status (pushed → processing → success/failed/closed/error), gateway_response, notify_payload
- RLS enabled: authenticated users see only their own company's rows via get_my_company_id()

**Edge functions** (all deployed):
- `paycloud-create-order` — POS calls this with { terminal_id, order_id } (or raw amount). Inserts tx row, signs, pushes to terminal.
- `paycloud-webhook` — receives Transaction Result Notification, verifies RSA signature, updates tx. verify_jwt OFF (external caller, RSA-authenticated instead).
- `paycloud-query-order` — POS polls this with { transaction_id }. Syncs from gateway if still pending.
- `paycloud-close-order` — cancels a pushed-but-unpaid order.

Webhook URL to give AddPay / set as notify_url (already auto-sent on every create-order):
https://ngblyttszqhgkxmeacmp.supabase.co/functions/v1/paycloud-webhook

## Secrets to set (Supabase Dashboard → Edge Functions → Secrets)

| Secret | Value |
|---|---|
| PAYCLOUD_APP_ID | wzfa6f653b31600735 |
| PAYCLOUD_APP_PRIVATE_KEY | PKCS8 base64 one-liner (kept OUT of git — in Supabase secrets only) |
| PAYCLOUD_GATEWAY_PUBLIC_KEY | From merchant platform Key Management (one line, no BEGIN/END) |
| PAYCLOUD_GATEWAY_URL | UAT default baked in: https://open-uat.paycloud.africa — set prod URL when going live |

Optional: PAYCLOUD_ORDER_EXPIRES (seconds, default 300), PAYCLOUD_SKIP_VERIFY=true (UAT debug only).

## APIs authorized on app Budify POS (wzfa6f653b31600735)

wisehub.cloud.pay.order, wisehub.cloud.pay.close, order.query, order.refund.submit, order.refund.query, terminal.detail.query, probe.call

## Registering a terminal (per club)

```sql
insert into paycloud_terminals (company_id, store_id, terminal_sn, merchant_no, store_no, label)
values ('<company uuid>', '<store uuid or null>', '<SN from device>', '<from AddPay>', '<from AddPay>', 'Front counter');
```

## First UAT test (once secrets + merchant_no/store_no/terminal SN are in)

```
POST https://ngblyttszqhgkxmeacmp.supabase.co/functions/v1/paycloud-create-order
Authorization: Bearer <user jwt>
{ "terminal_id": "<uuid from paycloud_terminals>", "amount": 1.00 }
```

Terminal lights up with R1.00, then poll paycloud-query-order with { transaction_id }.

## Still to build (next phase)

- POS frontend: "Card machine" payment option + waiting modal (poll every 2–3s, Cancel → close-order)
- Order finalization on success (webhook deliberately does not touch orders — POS flow owns that)
- Club admin UI for managing terminals
- Refunds via order.refund.submit (wire into existing refund flow later)
