// ─── GW AMS AI Ops -- Knowledge Base ─────────────────────────────────────────
// PHASE 1 (PoC): Static KB articles with keyword matching.
// PHASE 2 (Production): Replace getResponse() with a real Claude API call.
// See README.md for the Claude prompt and integration guide.

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
      'Check ACH gateway status: status.achgateway.internal -- confirm if gateway is degraded',
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
      'Run diagnostic SQL (read-only): SELECT * FROM pc_workflow WHERE status=LOCKED AND updated < NOW()-INTERVAL 10 MINUTE',
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
];

// Upper bound on how much user-supplied text we will process. Prevents
// resource-exhaustion / abuse from pathologically large inputs and bounds the
// payload that a future real API integration (see getResponse) would forward.
export var MAX_QUERY_LENGTH = 2000;

// Normalise arbitrary user input into a safe, bounded, plain string.
// Rejects non-strings, strips control characters, collapses whitespace and
// truncates to MAX_QUERY_LENGTH.
export function sanitizeQuery(input) {
  if (typeof input !== 'string') return '';
  var cleaned = input
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (cleaned.length > MAX_QUERY_LENGTH) {
    cleaned = cleaned.slice(0, MAX_QUERY_LENGTH);
  }
  return cleaned;
}

// ── Keyword search ────────────────────────────────────────────────────────────
export function findMatch(query) {
  var q = sanitizeQuery(query).toLowerCase();
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
  return bestScore > 0 ? best : null;
}

// ── getResponse ───────────────────────────────────────────────────────────────
// PHASE 1 (PoC): Returns static KB match after simulated delay.
// PHASE 2 (Production): Replace with real Claude API call.
//
// SECURITY: NEVER call the Anthropic API directly from the browser and NEVER
// put the API key in a REACT_APP_* variable -- anything prefixed REACT_APP_ is
// compiled into the public JS bundle and is readable by every visitor. The key
// must live only on the server. Route requests through your own backend / a
// serverless function that holds the secret in a non-public env var
// (ANTHROPIC_API_KEY) and forwards the sanitized message.
//
// Example production implementation (browser side -- talks only to your proxy):
//
//   export async function getResponse(userMessage, conversationHistory) {
//     const message = sanitizeQuery(userMessage);
//     if (!message) return null;
//     const response = await fetch('/api/triage', {
//       method: 'POST',
//       headers: { 'Content-Type': 'application/json' },
//       body: JSON.stringify({ message, history: conversationHistory }),
//     });
//     if (!response.ok) throw new Error('Triage request failed: ' + response.status);
//     const data = await response.json();
//     return data.result;
//   }
//
// Example serverless proxy (server side -- e.g. /api/triage; key stays here):
//
//   export default async function handler(req, res) {
//     const key = process.env.ANTHROPIC_API_KEY; // NOT REACT_APP_*
//     const message = String(req.body?.message ?? '').slice(0, 2000);
//     if (!key || !message) return res.status(400).json({ error: 'bad request' });
//     const r = await fetch('https://api.anthropic.com/v1/messages', {
//       method: 'POST',
//       headers: {
//         'Content-Type': 'application/json',
//         'x-api-key': key,
//         'anthropic-version': '2023-06-01',
//       },
//       body: JSON.stringify({
//         model: 'claude-sonnet-4-6',
//         max_tokens: 2000,
//         system: 'You are the GW AMS AI Ops Assistant with deep Guidewire ' +
//                 'PolicyCenter/BillingCenter/ClaimCenter expertise. Identify root ' +
//                 'cause, list numbered triage steps, recommend the permanent Gosu ' +
//                 'fix, and suggest a JIRA template. Cite module, line, and MTTR.',
//         messages: [{ role: 'user', content: message }],
//       }),
//     });
//     const data = await r.json();
//     return res.status(200).json({ result: data.content?.[0]?.text ?? '' });
//   }

export function getResponse(userMessage) {
  return new Promise(function(resolve) {
    // Bound and sanitize before any processing. When this stub is replaced by
    // a real API call, forward `safeMessage` (never the raw input) so that
    // untrusted content is always length-limited and control-char free.
    var safeMessage = sanitizeQuery(userMessage);
    setTimeout(function() {
      var match = safeMessage ? findMatch(safeMessage) : null;
      resolve(match);
    }, 1200);
  });
}
