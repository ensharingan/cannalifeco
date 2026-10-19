-- ============================================================================
-- Cannalife Co — Row level security for the accounting module
-- ----------------------------------------------------------------------------
-- Every accounting table is company-scoped AND role-scoped: only owners,
-- managers and superadmins see the books at all. Cashiers get nothing, which
-- is why there is no read-only policy for them — a cashier has no business
-- reading the bank account balance from a till.
--
-- gl_transactions is deliberately insert-only from the client's point of view:
-- the posting functions run SECURITY INVOKER, so they insert under the caller's
-- rights, but there is no UPDATE or DELETE policy. Corrections are reversals.
-- ============================================================================

do $$
declare
  t text;
  tables text[] := array[
    'tax_types', 'gl_accounts', 'financial_years', 'accounting_periods',
    'accounting_settings', 'cash_books', 'cash_book_batches', 'cash_book_entries',
    'journal_batches', 'journal_entries', 'gl_transactions',
    'bank_reconciliations', 'bank_reconciliation_lines',
    'inventory_journal_batches', 'inventory_journal_entries',
    'tax_periods', 'cash_book_imports'
  ];
begin
  foreach t in array tables loop
    execute format('alter table public.%I enable row level security', t);

    -- Drop first so the migration can be re-run after a policy tweak.
    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    execute format('drop policy if exists %I on public.%I', t || '_insert', t);
    execute format('drop policy if exists %I on public.%I', t || '_update', t);
    execute format('drop policy if exists %I on public.%I', t || '_delete', t);

    execute format($f$
      create policy %I on public.%I
        for select to authenticated
        using (company_id = public.acc_company_id() and public.acc_can_post())
    $f$, t || '_select', t);

    execute format($f$
      create policy %I on public.%I
        for insert to authenticated
        with check (company_id = public.acc_company_id() and public.acc_can_post())
    $f$, t || '_insert', t);

    -- The posted ledger is never edited or deleted in place.
    if t <> 'gl_transactions' then
      execute format($f$
        create policy %I on public.%I
          for update to authenticated
          using (company_id = public.acc_company_id() and public.acc_can_post())
          with check (company_id = public.acc_company_id() and public.acc_can_post())
      $f$, t || '_update', t);

      execute format($f$
        create policy %I on public.%I
          for delete to authenticated
          using (company_id = public.acc_company_id() and public.acc_can_post())
      $f$, t || '_delete', t);
    end if;
  end loop;
end $$;

-- accounting_settings keys on company_id rather than carrying one, so the
-- generic policies above already work — but its primary key is the company,
-- which means an upsert needs both policies to agree. Nothing extra needed.

grant execute on function public.acc_company_id()                     to authenticated;
grant execute on function public.acc_role()                           to authenticated;
grant execute on function public.acc_can_post()                       to authenticated;
grant execute on function public.acc_period_for_date(uuid, date)      to authenticated;
grant execute on function public.acc_split_tax(numeric, numeric, boolean) to authenticated;
grant execute on function public.acc_assert_postable(uuid, date)      to authenticated;
grant execute on function public.acc_control_account(uuid, text)      to authenticated;
grant execute on function public.acc_post_cash_book_batch(uuid)       to authenticated;
grant execute on function public.acc_post_journal_batch(uuid)         to authenticated;
grant execute on function public.acc_post_inventory_journal(uuid)     to authenticated;
grant execute on function public.acc_account_balance(uuid, date)      to authenticated;
grant execute on function public.acc_cash_book_balance(uuid, date)    to authenticated;
grant execute on function public.acc_trial_balance(uuid, date, date)  to authenticated;
grant execute on function public.acc_tax_report(uuid, date, date)     to authenticated;
grant execute on function public.acc_close_tax_period(uuid)           to authenticated;
grant execute on function public.acc_update_reconciliation(uuid)      to authenticated;
