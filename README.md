# GW AI Ops Assistant
### Guidewire AMS Accelerator

GenAI-powered incident triage assistant for Guidewire AMS. Describe a production incident in plain English and get immediate triage steps, root cause analysis, permanent Gosu code fix, and a JIRA ticket template -- all in under 10 seconds.

---

## Quick Start (3 minutes)

**Requires:** Node.js 18+ ([nodejs.org](https://nodejs.org))

```bash
npm install
npm start
# Open http://localhost:3000
```

---

## Deploy to Vercel (5 minutes, free)

### Option A -- GitHub + Vercel (recommended)

```bash
git init && git add . && git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/YOUR_ORG/gw-ai-ops.git
git push -u origin main
```

Then: vercel.com -> Add New Project -> import repo -> Deploy.
Live at `https://gw-ai-ops.vercel.app`. Auto-deploys on every push.

### Option B -- Vercel CLI (60 seconds)

```bash
npm install -g vercel && vercel
```

### Option C -- Netlify drag-and-drop

```bash
npm run build
# Drag /build folder to app.netlify.com/drop
```

---

## Project Structure

```
gw-ai-ops/
├── src/
│   ├── kb.js      <- Knowledge base articles + getResponse() stub -- EDIT THIS
│   ├── App.js     <- Main UI (chat, KB list, runbook panel)
│   └── index.js   <- Entry point
├── public/
│   └── index.html
└── package.json
```

---

## Production Roadmap

### Phase 1 -- PoC (now, on Vercel)
Static KB with 6 articles and keyword matching. Full chat UI with 3-panel layout.

### Phase 2 -- Live Claude API (Week 1-2)

> **SECURITY -- read first.** Never call the Anthropic API directly from the
> browser and never store the API key in a `REACT_APP_*` variable. Any value
> prefixed `REACT_APP_` is compiled into the **public** JavaScript bundle and is
> readable by every visitor (open DevTools -> Sources). API keys, tokens and
> other secrets MUST live only on a server. Route all model calls through your
> own backend / serverless function that holds the secret and forwards only the
> sanitized user message.

**Browser side** -- `getResponse()` in `src/kb.js` talks only to your own proxy:

```javascript
import { sanitizeQuery } from './kb';

export async function getResponse(userMessage) {
  const message = sanitizeQuery(userMessage); // bounded, control-char free
  if (!message) return null;
  const response = await fetch('/api/triage', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message }),
  });
  if (!response.ok) throw new Error('Triage request failed: ' + response.status);
  const data = await response.json();
  return data.result;
}
```

**Server side** -- serverless function at `/api/triage` (the key never leaves the server):

```javascript
// api/triage.js  (Vercel / Netlify function)
export default async function handler(req, res) {
  const key = process.env.ANTHROPIC_API_KEY; // NOT REACT_APP_* -- server-only secret
  const message = String(req.body?.message ?? '').slice(0, 2000);
  if (!key || !message) return res.status(400).json({ error: 'bad request' });

  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 2000,
      system: `You are the GW AMS AI Ops Assistant. Deep expertise in
               Guidewire PolicyCenter, BillingCenter, and ClaimCenter.
               When an engineer describes a production incident:
               1. Identify root cause (N+1 query, empty catch, workflow deadlock, etc.)
               2. Provide numbered immediate triage steps
               3. Recommend permanent Gosu code fix
               4. Suggest JIRA ticket summary and acceptance criteria`,
      messages: [{ role: 'user', content: message }],
    }),
  });
  const data = await r.json();
  return res.status(200).json({ result: data.content?.[0]?.text ?? '' });
}
```

Store the secret as `ANTHROPIC_API_KEY` (server-only, **not** `REACT_APP_*`) in
Vercel/Netlify dashboard -> Environment Variables.

### Phase 3 -- Knowledge Graph Integration (Week 3-4)

Connect to the GW Knowledge Graph (Neo4j) to pull real resolved incidents:

```javascript
// Query Neo4j for similar past incidents
const similar = await fetch('/api/knowledge-graph/search?q=' + encodeURIComponent(query));
const context = await similar.json();
// Inject context into Claude prompt for grounded responses
```

### Phase 4 -- ServiceNow / Jira Integration (Week 5-6)

> **SECURITY.** The ServiceNow token is a secret and must stay server-side. Do
> NOT use `REACT_APP_SNOW_TOKEN` (that ships the token to every browser). Create
> the incident from a backend / serverless function using a server-only env var.

```javascript
// api/servicenow-incident.js  (server side -- token never reaches the browser)
export default async function handler(req, res) {
  const token = process.env.SNOW_TOKEN; // server-only secret, NOT REACT_APP_*
  const { detectedTitle, triageSteps, severity } = req.body ?? {};
  const r = await fetch('https://YOUR_INSTANCE.service-now.com/api/now/table/incident', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + token,
    },
    body: JSON.stringify({
      short_description: String(detectedTitle ?? '').slice(0, 160),
      description: Array.isArray(triageSteps) ? triageSteps.join('\n') : '',
      urgency: severityToUrgency(severity),
    }),
  });
  return res.status(r.ok ? 201 : 502).json(await r.json());
}
```

### Phase 5 -- Proactive Alerting (Week 7-8)

Instead of waiting for engineers to ask, monitor GW logs in real time:

```javascript
// Lambda function triggered by CloudWatch log pattern
exports.handler = async (event) => {
  const logLine = event.logEvents[0].message;
  if (logLine.includes('PolicyValidationPlugin')) {
    const triage = await getResponse('PolicyCenter validation error: ' + logLine);
    await notify('slack', triage); // Post to ops channel instantly
  }
};
```

---

## Adding Knowledge Base Articles

Add to `KB_ARTICLES` in `src/kb.js`:

```javascript
{
  id: 'KB-007', module: 'PolicyCenter', category: 'Security', severity: 'CRITICAL',
  estimatedMTTR: '5 minutes',
  title: 'Your incident title',
  trigger: ['keyword1', 'keyword2', 'module-name'],
  rootCause: 'Description of root cause...',
  immediateSteps: ['Step 1...', 'Step 2...'],
  permanentFix: 'How to fix it permanently...',
  gosuSnippet: '// Code here',
  jiraTemplate: { type: 'Bug', priority: 'Critical', label: 'Security', ac: 'Acceptance criteria' },
  linkedPattern: 'Pattern name',
},
```

---

## Guidewire AMS Accelerators 2025
