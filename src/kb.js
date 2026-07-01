// ─── GW AMS AI Ops -- Knowledge Base ─────────────────────────────────────────
// PHASE 1 (PoC): Static KB articles with keyword matching.
// PHASE 2 (Production): Replace getResponse() with an authenticated server-side
// API route. Do not call LLM, ServiceNow, Jira, or graph APIs directly from the
// browser because client bundles expose credentials and internal endpoints.
// See README.md for the secure integration guide.

var MAX_QUERY_LENGTH = 2000;
var MIN_MATCH_SCORE = 2;

export var KB_ARTICLES = [
  {
    id: 'KB-001', module: 'PolicyCenter', category: 'Performance', severity: 'HIGH',
    estimatedMTTR: '12 minutes',
    title: 'N+1 Query Pattern in Gosu Validation Plugin',
    trigger: ['n+1', 'query', 'slow', 'timeout', 'validation', 'loop', 'database', 'db'],
    rootCause: 'Query.make() called inside a for-loop in PolicyValidationPlugin. Each iteration fires a separate DB round-trip. Under load with 100+ line policies this causes validation timeouts.',
    immediateSteps: [
      'Check GW Admin > Server Activity > Active Threads for blocked validation threads',
      'Identify the policy ID from error log -- search for PolicyValidationPlugin in logs',
      'If timeout is live: restart the affected server node to clear blocked threads (GW is stateless -- safe)',
      'Apply workaround: temporarily increase DB connection pool maxConnections by 20 in gw-config',
    ],
    permanentFix: 'Extract Query.make() call outside the for-loop using a single batch fetch before iteration begins. Move to PolicyPeriod.Lines batch query to eliminate the N+1 pattern entirely.',
    gosuSnippet: '// BEFORE (broken -- N+1):\nfor (line in period.Lines) {\n  var q = Query.make(PolicyLine)  // fires per iteration!\n  ...\n}\n\n// AFTER (fixed -- batch):\nvar lines = Query.make(PolicyLine)\n              .compare("BranchID", Equals, period.ID)\n              .select()\nfor (line in lines) { ... }',
    jiraTemplate: { type: 'Bug', priority: 'High', label: 'Performance', ac: 'Single batch query executes before loop; no per-iteration DB calls; policy validation completes in under 2s' },
    linkedPattern: 'P1 -- Gosu Query.make Loop Anti-Pattern',
  },
  {
    id: 'KB-002', module: 'BillingCenter', category: 'Integration', severity: 'CRITICAL',
    estimatedMTTR: '8 minutes',
    title: 'ACH Payment Gateway Timeout and NPE',
    trigger: ['ach', 'payment', 'gateway', 'timeout', 'billing', 'invoice', 'failed', 'npe', 'null'],
    rootCause: 'BillingWorkflowHandler calls ACH gateway with 30s timeout. Gateway SLA is 28s under load. Empty catch block silently swallows failures causing NullPointerException downstream.',
    immediateSteps: [
      'Check the authenticated payment gateway status dashboard -- confirm if gateway is degraded',
      'In BillingCenter Admin: navigate to Failed Transactions, identify affected invoice IDs',
      'Trigger manual retry on failed invoices via BillingCenter > Payments > Retry Failed',
      'If gateway down: enable manual payment fallback in BillingCenter > Config > Payment Gateway',
      'Log all affected invoice IDs for batch retry job when gateway recovers',
    ],
    permanentFix: 'Reduce ACH client timeout to 25s. Add exponential backoff retry (3 attempts). Fix empty catch block -- add structured logging, re-throw, and create ServiceNow alert on payment failure.',
    gosuSnippet: '// BROKEN -- empty catch swallows failure:\ntry {\n  var result = AchGateway.charge(invoice)\n  invoice.Status = result.Status  // NPE if result null!\n} catch (e) { /* EMPTY */ }\n\n// FIXED:\ntry {\n  var result = RetryHandler.execute(\n    function(){ return AchGateway.charge(invoice) },\n    maxRetries: 3, backoffMs: 1000\n  )\n  if (result == null) throw new PaymentException("Null response")\n  invoice.Status = result.Status\n} catch (e) {\n  Logger.error("ACH failed: " + e.message)\n  AlertService.create("ACH_FAILURE", invoice.ID)\n  throw e\n}',
    jiraTemplate: { type: 'Bug', priority: 'Critical', label: 'Security', ac: 'Payment failures logged; alert fires within 60s; no silent exception swallowing; retry with backoff implemented' },
    linkedPattern: 'P3 -- Retry with Backoff + P4 -- Idempotency Key',
  },
  {
    id: 'KB-003', module: 'ClaimCenter', category: 'Workflow', severity: 'HIGH',
    estimatedMTTR: '6 minutes',
    title: 'FNOL Auto-Assignment Stuck in WorkflowEngine',
    trigger: ['fnol', 'stuck', 'workflow', 'assignment', 'frozen', 'claim', 'queue', 'assign', 'adjuster'],
    rootCause: 'ClaimAssignmentRule deadlocks when an orphaned DB transaction from a previous server restart leaves a workflow lock unreleased. The assignment job polls the locked claim indefinitely.',
    immediateSteps: [
      'In ClaimCenter Admin > Workflow Monitor: find claims with status Assigning for more than 5 minutes',
      'Note the claim IDs and affected adjuster queue',
      'Use the approved read-only workflow diagnostic report to identify stale workflow locks',
      'In ClaimCenter Admin: use Reset Workflow action on the stuck claim -- safe and audit-logged',
      'Verify claim moves to Assigned status within 60 seconds',
      'Monitor queue for 10 minutes to confirm no recurrence',
    ],
    permanentFix: 'Call workflow.reset() via GW API rather than direct DB manipulation. Add a scheduled health-check job that auto-detects and resets stuck workflow states after 5 minutes. Fix orphaned transaction by ensuring DB connections released in server shutdown hook.',
    gosuSnippet: '// Safe workflow reset via GW API:\nfunction resetStuckWorkflow(claimID: String): void {\n  var claim = Bundle.getCurrent()\n                    .loadByPublicId(Claim, claimID)\n  if (claim.Workflow.Status == WorkflowStatus.TC_INPROGRESS\n      && claim.Workflow.LastUpdated\n           < DateUtil.addMinutes(now(), -5)) {\n    claim.Workflow.reset()\n    ActivityPattern.WORKFLOW_RESET.createActivity(claim)\n    Logger.info("Workflow reset for: " + claimID)\n  }\n}',
    jiraTemplate: { type: 'Bug', priority: 'High', label: 'Workflow', ac: 'Stuck workflows auto-reset after 5 minutes; no manual intervention required; audit trail present' },
    linkedPattern: 'P2 -- Workflow Reset Pattern',
  },
  {
    id: 'KB-004', module: 'PolicyCenter', category: 'Performance', severity: 'MEDIUM',
    estimatedMTTR: '15 minutes',
    title: 'Rating Engine CPU Saturation on HO-3 Complex Risks',
    trigger: ['rating', 'slow', 'ho3', 'engine', 'thread', 'queue', 'premium', 'calculation', 'cpu'],
    rootCause: 'HO-3 rating for high-exposure properties triggers an expensive multi-factor algorithm. Default thread pool (10 threads) saturates under concurrent underwriting load during peak hours.',
    immediateSteps: [
      'Check GW Admin > Thread Pool Monitor > rating-worker pool -- confirm utilisation > 90%',
      'Temporarily increase thread pool: gwconfig/rating-worker/maxThreads from 10 to 20 (requires restart)',
      'Identify stuck rating jobs: PolicyCenter Admin > Rating Queue > In Progress > age > 2 minutes',
      'Cancel and requeue oldest stuck jobs to free threads',
      'Notify underwriting team to expect 3-5 minute delays on complex HO-3 during peak hours',
    ],
    permanentFix: 'Increase rating thread pool baseline to 20. Implement async rating with callback for complex risks. Add a rating complexity pre-check that routes high-exposure properties to a dedicated queue.',
    gosuSnippet: '// Rating complexity router:\nfunction routeRatingJob(policy: PolicyPeriod): RatingQueue {\n  var score = RatingComplexityCalc.score(policy)\n  if (score > COMPLEX_THRESHOLD) {\n    return RatingQueue.DEDICATED_COMPLEX\n  }\n  return RatingQueue.STANDARD\n}\n\n// gwconfig/rating.properties:\n// rating.threadpool.standard=20\n// rating.threadpool.complex=8\n// rating.timeout.complex=120000',
    jiraTemplate: { type: 'Tech Debt', priority: 'Medium', label: 'Performance', ac: 'Rating thread pool at 20; complex HO-3 routes to dedicated queue; no timeouts under normal load' },
    linkedPattern: 'Configuration Best Practice -- Thread Pool Sizing',
  },
  {
    id: 'KB-005', module: 'BillingCenter', category: 'Data', severity: 'CRITICAL',
    estimatedMTTR: '10 minutes',
    title: 'Duplicate Invoice Charges on Double-Click Submit',
    trigger: ['duplicate', 'charge', 'invoice', 'double', 'payment', 'idempotent', 'twice', 'charged'],
    rootCause: 'BillingWorkflowHandler.processInvoice() has no idempotency guard. Double-click sends two concurrent requests; both pass the invoice-not-paid check before either completes, resulting in two charges.',
    immediateSteps: [
      'Identify affected customers: query invoice records with two payments on same invoice within 60 seconds',
      'Issue refund for duplicate charge via BillingCenter > Payments > Issue Refund',
      'Suspend payment button on affected accounts via Admin > Account > Suspend Payments (temporary)',
      'Log all duplicate charge incidents with invoice ID and timestamp for finance reconciliation',
    ],
    permanentFix: 'Add idempotency key (UUID generated on page load, submitted with payment). Server rejects second request with same key within 60-second window. Also disable Pay button via UI after first click.',
    gosuSnippet: '// Idempotency guard:\nfunction processInvoice(invoice: Invoice,\n                        key: String): void {\n  if (IdempotencyCache.contains(key)) {\n    Logger.warn("Duplicate rejected: " + key)\n    return\n  }\n  IdempotencyCache.store(key, ttlSeconds: 60)\n  // proceed with payment...\n}',
    jiraTemplate: { type: 'Bug', priority: 'Critical', label: 'Financial', ac: 'Idempotency key prevents duplicate charges; second request with same key rejected within 60s' },
    linkedPattern: 'P4 -- Idempotency Key Pattern',
  },
  {
    id: 'KB-006', module: 'ClaimCenter', category: 'Integration', severity: 'HIGH',
    estimatedMTTR: '18 minutes',
    title: 'ISO ClaimSearch v14.2 Mandatory Field Missing on FNOL',
    trigger: ['iso', 'claimsearch', 'fnol', 'api', 'v14', 'contract', 'field', 'mandatory', 'missing', '400'],
    rootCause: 'GW Cloud Q2 upgrade changed ISO ClaimSearch API to v14.2. New version requires ClaimRefType as a mandatory FNOL field. Existing FNOL intake screens were not updated, causing all ISO lookups to fail with HTTP 400.',
    immediateSteps: [
      'Confirm: check ClaimCenter integration logs for HTTP 400 responses from ISO endpoint',
      'Temporary fix: add default ClaimRefType value in FNOLIntakePlugin.gs line 87',
      "Add: if (fnol.ClaimRefType == null) { fnol.ClaimRefType = ClaimRefType.TC_POLICYNUMBER }",
      'Restart ClaimCenter app server to pick up the plugin change',
      'Verify ISO lookups succeed in logs after restart',
    ],
    permanentFix: 'Update all FNOL intake screens to include ClaimRefType as visible or auto-populated field. Update integration contract tests to cover v14.2 mandatory fields. Add contract test to CI/CD to catch future API version changes.',
    gosuSnippet: '// Temporary workaround in FNOLIntakePlugin:\nfunction populateFNOLFields(fnol: FNOL): void {\n  // v14.2 mandatory -- default if not provided\n  if (fnol.ClaimRefType == null) {\n    fnol.ClaimRefType = ClaimRefType.TC_POLICYNUMBER\n  }\n}\n\n// Permanent -- FNOL screen PCF update:\n// <TypeKeyEntry id="ClaimRefType"\n//   type="ClaimRefType"\n//   editable="true"\n//   required="true"/>',
    jiraTemplate: { type: 'Bug', priority: 'High', label: 'Integration', ac: 'ClaimRefType populated on all FNOL submissions; ISO HTTP 400 errors resolved; contract test added to CI/CD' },
    linkedPattern: 'Integration Contract Testing Best Practice',
  },
  {
    id: 'KB-007', module: 'PolicyCenter', category: 'Security', severity: 'CRITICAL',
    estimatedMTTR: '20 minutes',
    title: 'OAuth Refresh Storm Locks Producer Portal Sessions',
    trigger: ['oauth', 'token', 'refresh', '401', 'sso', 'producer', 'portal', 'endorsement', 'auth', 'storm', 'session'],
    rootCause: 'Concurrent endorsement tabs share one expiring access token. Each tab attempts refresh after the first 401, causing token rotation races and invalidating valid sessions for the same producer user.',
    immediateSteps: [
      'Confirm the 401 spike is isolated to producer portal endorsement flows in the authenticated observability dashboard',
      'Temporarily reduce endorsement auto-save frequency to lower concurrent refresh pressure',
      'Ask support to avoid bulk session resets unless the identity provider reports compromise',
      'Enable the guarded retry flag so only one refresh attempt runs per browser session',
      'Monitor authentication error rate and producer login success until both stabilize',
    ],
    permanentFix: 'Implement a single-flight token refresh guard with a clock-skew buffer. Store refresh state server-side or in httpOnly secure cookies, and fail closed after repeated refresh errors instead of rotating tokens repeatedly.',
    gosuSnippet: '// Token refresh guard pattern:\nfunction refreshIfNeeded(session: UserSession): AuthToken {\n  if (!session.Token.expiresWithinSeconds(90)) return session.Token\n\n  return TokenRefreshLock.withLock(session.UserPublicId, function() {\n    var latest = AuthSessionStore.load(session.ID)\n    if (!latest.Token.expiresWithinSeconds(90)) return latest.Token\n    return OAuthClient.refresh(latest.RefreshToken)\n  })\n}',
    jiraTemplate: { type: 'Bug', priority: 'Critical', label: 'Security', ac: 'Only one refresh request per session; no refresh-token rotation race; 401 retry storm stops within 2 minutes' },
    linkedPattern: 'P7 -- Single-Flight Token Refresh + Secure Session Boundary',
  },
  {
    id: 'KB-008', module: 'BillingCenter', category: 'Data', severity: 'HIGH',
    estimatedMTTR: '25 minutes',
    title: 'Commission Batch Partially Posted After Failover Retry',
    trigger: ['commission', 'batch', 'partial', 'retry', 'producer', 'posting', 'failover', 'ledger', 'reconciliation', 'duplicate'],
    rootCause: 'The nightly commission batch commits producer ledger entries in chunks but records the job checkpoint only at the end. A node failover restarts the batch from the previous checkpoint and reposts the last committed chunk.',
    immediateSteps: [
      'Pause commission batch scheduling for the affected accounting period',
      'Run the approved reconciliation report for duplicate producer ledger postings',
      'Place impacted producer statements on hold before downstream disbursement',
      'Resume only the idempotent reconciliation job after finance confirms the reversal list',
      'Capture batch job ID, checkpoint, and failover timestamp for audit evidence',
    ],
    permanentFix: 'Move checkpoint persistence into the same transaction boundary as each commission chunk. Add an idempotency key based on accounting period, producer, policy, and commission event.',
    gosuSnippet: '// Commission posting idempotency key:\nfunction postCommission(event: CommissionEvent): void {\n  var key = event.Period + \":\" + event.ProducerID + \":\" + event.PolicyID\n  if (CommissionLedger.existsByIdempotencyKey(key)) return\n\n  gw.transaction.Transaction.runWithNewBundle(function(bundle) {\n    CommissionLedger.post(bundle, event, key)\n    BatchCheckpoint.save(bundle, event.JobID, event.Sequence)\n  })\n}',
    jiraTemplate: { type: 'Bug', priority: 'High', label: 'Financial', ac: 'Batch restart is idempotent; checkpoint commits with ledger chunk; duplicate commission postings rejected' },
    linkedPattern: 'P4 -- Idempotency Key Pattern + Transactional Checkpointing',
  },
  {
    id: 'KB-009', module: 'ClaimCenter', category: 'Performance', severity: 'HIGH',
    estimatedMTTR: '30 minutes',
    title: 'Bulk Litigation Notice PDF Generation Exhausts Heap',
    trigger: ['document', 'template', 'pdf', 'oom', 'memory', 'bulk', 'litigation', 'notice', 'generation', 'heap'],
    rootCause: 'Bulk litigation notices render large claim note histories into PDF documents in one in-memory batch. The template engine retains intermediate byte arrays until the full batch completes, exhausting heap during high-volume legal events.',
    immediateSteps: [
      'Stop the bulk document job and preserve the failed job parameters',
      'Restart only the document worker node if heap pressure remains elevated',
      'Split pending litigation notices into smaller batches by jurisdiction and claim segment',
      'Prioritize notices approaching regulatory deadlines before requeueing lower-risk batches',
      'Monitor heap usage, document queue age, and failed document count after restart',
    ],
    permanentFix: 'Stream PDF output per claim, release template context after each document, and enforce a bounded batch size. Add a preflight estimator that routes oversized notice sets to an async worker queue.',
    gosuSnippet: '// Stream each notice instead of retaining the full batch:\nfor (claim in noticeBatch.Claims) {\n  DocumentTemplate.withContext(claim, function(ctx) {\n    var stream = DocumentStore.openWriteStream(claim.PublicID)\n    PdfRenderer.renderToStream(ctx, stream)\n    stream.close()\n  })\n  MemoryPressureGuard.afterDocument()\n}',
    jiraTemplate: { type: 'Bug', priority: 'High', label: 'Performance', ac: 'PDF generation streams per document; batch size capped; heap remains below alert threshold during bulk notices' },
    linkedPattern: 'P8 -- Streaming Document Generation + Bounded Batch',
  },
  {
    id: 'KB-010', module: 'PolicyCenter', category: 'Workflow', severity: 'MEDIUM',
    estimatedMTTR: '22 minutes',
    title: 'Underwriting Referral Escalation Loop After Rule Deployment',
    trigger: ['referral', 'underwriting', 'escalation', 'loop', 'approval', 'rule', 'version', 'async', 'uw', 'stuck'],
    rootCause: 'A new underwriting rule version changes referral ownership while asynchronous approvals from the previous version are still in flight. The workflow sees mismatched authority and reopens the same referral repeatedly.',
    immediateSteps: [
      'Freeze additional underwriting rule deployments until the loop is contained',
      'Identify referrals with more than two reopen events in the current release window',
      'Route impacted submissions to a senior underwriter queue for manual disposition',
      'Disable only the new escalation rule version if loop volume continues to grow',
      'Notify underwriting operations with the affected submission IDs and workaround',
    ],
    permanentFix: 'Version referral decisions and bind each async approval callback to the rule version that created it. Ignore stale callbacks once a newer referral decision has superseded the old one.',
    gosuSnippet: '// Ignore stale async approval callbacks:\nfunction onApprovalCallback(referral: UWReferral,\n                            callbackVersion: String): void {\n  if (referral.RuleVersion != callbackVersion) {\n    Logger.info(\"Ignoring stale UW callback for \" + referral.PublicID)\n    return\n  }\n  referral.markApproved()\n}',
    jiraTemplate: { type: 'Bug', priority: 'Medium', label: 'Workflow', ac: 'Referral callback includes rule version; stale callbacks ignored; no repeated reopen loop after rule deployment' },
    linkedPattern: 'P9 -- Versioned Async Workflow Callback',
  },
  {
    id: 'KB-011', module: 'BillingCenter', category: 'Data', severity: 'CRITICAL',
    estimatedMTTR: '16 minutes',
    title: 'NSF Reversal Races Delinquency Payment Plan Recalculation',
    trigger: ['nsf', 'reversal', 'delinquency', 'payment plan', 'recalculate', 'race', 'schedule', 'installment', 'negative balance'],
    rootCause: 'An NSF reversal updates invoice balance while the delinquency batch recalculates payment plan installments from a stale account snapshot. The recalculation can produce a negative installment and incorrectly clear delinquency.',
    immediateSteps: [
      'Pause delinquency batch processing for accounts with active NSF reversal events',
      'Use the account reconciliation view to identify negative installment schedules',
      'Place affected accounts in manual review before notices or cancellations are generated',
      'Run payment plan recalculation for confirmed accounts after reversal events settle',
      'Track account IDs and reversal event IDs for finance and compliance review',
    ],
    permanentFix: 'Serialize NSF reversal and payment plan recalculation by account. Re-read account balance inside the recalculation transaction and reject negative installment schedules as an invariant violation.',
    gosuSnippet: '// Account-scoped recalculation lock:\nAccountLock.withLock(account.PublicID, function() {\n  gw.transaction.Transaction.runWithNewBundle(function(bundle) {\n    var fresh = bundle.loadByPublicId(Account, account.PublicID)\n    PaymentPlanRecalc.recalculate(fresh)\n    if (fresh.PaymentPlan.hasNegativeInstallment()) {\n      throw new IllegalStateException(\"Negative installment blocked\")\n    }\n  })\n})',
    jiraTemplate: { type: 'Bug', priority: 'Critical', label: 'Financial', ac: 'NSF reversal and recalculation serialize per account; stale snapshots rejected; no negative installments generated' },
    linkedPattern: 'P10 -- Account-Scoped Serialization + Financial Invariant',
  },
  {
    id: 'KB-012', module: 'ClaimCenter', category: 'Security', severity: 'CRITICAL',
    estimatedMTTR: '12 minutes',
    title: 'PII Redaction Missing From Claim Notes Export',
    trigger: ['pii', 'redaction', 'export', 'claim notes', 'privacy', 'gdpr', 'data leak', 'report', 'masking', 'sensitive'],
    rootCause: 'The claim notes export path uses a reporting DTO that bypasses the UI redaction service. Sensitive note fields are masked in the claim UI but exported without the same policy-based redaction filter.',
    immediateSteps: [
      'Disable the claim notes export action for non-privileged roles through feature configuration',
      'Identify exports generated since the last redaction service deployment',
      'Notify privacy and compliance owners with export IDs, roles, and distribution scope',
      'Rotate shared report links and revoke temporary export access where applicable',
      'Verify that privileged users still have an approved break-glass workflow for legal needs',
    ],
    permanentFix: 'Move redaction into a shared export-safe service and require every report DTO to call it before serialization. Add role-based tests for UI display, CSV export, and scheduled report delivery.',
    gosuSnippet: '// Shared redaction before export serialization:\nfunction toExportRow(note: ClaimNote,\n                     user: User): ClaimNoteExportRow {\n  var redacted = RedactionService.apply(note.Body, user, \"CLAIM_NOTE_EXPORT\")\n  return new ClaimNoteExportRow(note.PublicID, redacted, note.CreatedTime)\n}',
    jiraTemplate: { type: 'Bug', priority: 'Critical', label: 'Security', ac: 'Claim notes export uses shared redaction service; role tests cover UI and export paths; historical exports reviewed' },
    linkedPattern: 'P11 -- Centralized Redaction Boundary',
  },
];

// ── Keyword search ────────────────────────────────────────────────────────────
export function findMatch(query) {
  var q = String(query || '').toLowerCase().slice(0, MAX_QUERY_LENGTH).trim();
  if (!q) return null;
  var best = null;
  var bestScore = 0;
  KB_ARTICLES.forEach(function(kb) {
    var score = 0;
    kb.trigger.forEach(function(t) {
      if (q.indexOf(t) !== -1 || t.indexOf(q) !== -1) score++;
    });
    if (q.indexOf(kb.module.toLowerCase()) !== -1) score += 2;
    if (q.indexOf(kb.category.toLowerCase()) !== -1) score++;
    if (score > bestScore) { bestScore = score; best = kb; }
  });
  return bestScore >= MIN_MATCH_SCORE ? best : null;
}

// ── getResponse ───────────────────────────────────────────────────────────────
// PHASE 1 (PoC): Returns static KB match after simulated delay.
// PHASE 2 (Production): Replace with a call to your own authenticated backend.
// The backend must validate input, rate-limit callers, store API keys in server
// environment variables, and schema-validate any LLM output before returning it.
//
// Example browser-side implementation:
//
//   export async function getResponse(userMessage, conversationHistory) {
//     const response = await fetch('/api/triage', {
//       method: 'POST',
//       headers: { 'Content-Type': 'application/json' },
//       credentials: 'include',
//       body: JSON.stringify({ userMessage, conversationHistory }),
//     });
//     if (!response.ok) throw new Error('Triage request failed');
//     return response.json();
//   }

export function getResponse(userMessage) {
  return new Promise(function(resolve) {
    setTimeout(function() {
      var match = findMatch(userMessage);
      resolve(match);
    }, 1200);
  });
}
