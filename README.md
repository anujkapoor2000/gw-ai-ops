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

Do not place API keys, OAuth tokens, or customer secrets in `REACT_APP_*`
variables. Create React App embeds those values in the browser bundle. Use a
server-side API route or backend-for-frontend for all third-party integrations.

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

### Phase 2 -- Live Claude API

Replace `getResponse()` in `src/kb.js` with a call to your own authenticated
backend endpoint. The browser sends only the user's incident description; the
backend owns authentication, rate limiting, prompt construction, provider API
keys, and response validation.

```javascript
// Browser code: no provider keys or internal endpoints here.
export async function getResponse(userMessage, conversationHistory = []) {
  if (userMessage.length > 2000) throw new Error('Message too long');

  const response = await fetch('/api/triage', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ userMessage, conversationHistory }),
  });

  if (!response.ok) throw new Error('Triage request failed');
  return response.json();
}
```

Example server-side route shape:

```javascript
// Runs on a serverless function or backend service, never in the browser.
export async function POST(request) {
  const { userMessage } = await request.json();
  validateAuthenticatedUser(request);
  validateIncidentInput(userMessage);

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
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
               4. Suggest JIRA ticket summary and acceptance criteria
               Return response as JSON: { rootCause, immediateSteps[], permanentFix, gosuSnippet, jiraTemplate }`,
      messages: [{ role: 'user', content: userMessage }],
    }),
  });

  const data = await response.json();
  return Response.json(validateTriageResponse(data.content[0].text));
}
```

Store `ANTHROPIC_API_KEY` only in server-side environment variables. Schema
validate LLM output before returning it to the UI, and reject unexpected fields.

### Phase 3 -- Knowledge Graph Integration

Connect to the GW Knowledge Graph (Neo4j) to pull real resolved incidents:

```javascript
// Query Neo4j for similar past incidents
const similar = await fetch('/api/knowledge-graph/search?q=' + encodeURIComponent(query));
const context = await similar.json();
// Inject context into Claude prompt for grounded responses
```

### Phase 4 -- ServiceNow / Jira Integration

```javascript
// Server-side only: auto-create incident when AI Ops detects a new issue.
await fetch(process.env.SERVICENOW_INCIDENT_URL, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer ' + process.env.SERVICENOW_TOKEN,
  },
  body: JSON.stringify({
    short_description: detectedTitle,
    description: triageSteps.join('\n'),
    urgency: severityToUrgency(severity),
  }),
});
```

### Phase 5 -- Proactive Alerting

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

## Security checklist

- Keep secrets on the server; never expose credentials through `REACT_APP_*`.
- Require SSO/OIDC or SAML before serving production runbooks or customer data.
- Validate and length-limit incident descriptions before sending them to any AI
  or integration service.
- Treat LLM output as untrusted data and schema-validate it before rendering or
  using it to create tickets.
- Deploy with security headers (`vercel.json` and `public/_headers` are included
  for Vercel/Netlify-style hosts).
- Disable production source maps if runbooks or integration details are
  sensitive in your deployment environment.

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
