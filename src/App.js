import React, { useState, useRef, useEffect } from 'react';
import { KB_ARTICLES, getResponse } from './kb';

var BLUE   = '#003087';
var LBLUE  = '#0067B1';
var RED    = '#E4002B';
var GREEN  = '#00875A';
var AMBER  = '#FF8B00';
var PURPLE = '#6554C0';
var TEAL   = '#00A896';
var WHITE  = '#FFFFFF';
var G100   = '#F0F2F5';
var G200   = '#E2E6EC';
var G400   = '#9AAABF';
var G600   = '#5A6A82';
var G800   = '#2C3A4F';

var SEV_THEME = {
  CRITICAL: { bg:'#FFF0EB', border:'#FF6B35', text:'#CC4400' },
  HIGH:     { bg:'#FFF8EC', border:AMBER,     text:'#CC6600' },
  MEDIUM:   { bg:'#E6F7F7', border:TEAL,      text:'#007A6E' },
};
var MOD_THEME = {
  PolicyCenter:  { bg:'#EBF2FF', border:LBLUE,  text:LBLUE  },
  BillingCenter: { bg:'#F0EBFF', border:PURPLE, text:PURPLE },
  ClaimCenter:   { bg:'#E6F7F7', border:TEAL,   text:TEAL   },
};
var CAT_COLORS = { Performance:BLUE, Integration:TEAL, Workflow:PURPLE, Data:AMBER };

var SUGGESTED = [
  'PolicyCenter validation timing out on HO-3',
  'ACH payment gateway failing with NPE',
  'FNOL auto-assignment stuck in queue',
  'Rating engine slow on complex risks',
  'Duplicate invoice charges on submit',
  'ISO ClaimSearch returning HTTP 400 on FNOL',
];

var WELCOME = 'Hello! I am the GW AMS AI Ops Assistant.\n\nDescribe your Guidewire incident and I will provide immediate triage steps, root cause analysis, and the permanent fix from the knowledge base.\n\nTry one of the suggested queries below or describe your incident in plain English.';
var MAX_QUERY_LENGTH = 2000;
var MAX_MESSAGES = 25;

function normalizeQuery(value) {
  return String(value || '').slice(0, MAX_QUERY_LENGTH).trim();
}

function appendBoundedMessages(current, additions) {
  return current.concat(additions).slice(-MAX_MESSAGES);
}

function getMttrMinutes(kb) {
  var match = String((kb && kb.estimatedMTTR) || '').match(/\d+/);
  return match ? parseInt(match[0], 10) : 0;
}

function AppLogo() {
  return (
    <div style={{ display:'flex', flexDirection:'column', lineHeight:1 }}>
      <div style={{ display:'flex', alignItems:'baseline', gap:3 }}>
        <span style={{ fontFamily:'Arial Black,Arial', fontWeight:900, fontSize:20, color:WHITE }}>GW</span>
        <span style={{ fontFamily:'Arial,sans-serif', fontWeight:700, fontSize:16, color:'#C8D8F0' }}>AMS</span>
      </div>
      <div style={{ height:2, background:RED, marginTop:2, borderRadius:1 }}/>
    </div>
  );
}

function KBCard(props) {
  var kb    = props.kb;
  var isAct = props.isActive;
  var st    = SEV_THEME[kb.severity]  || SEV_THEME.MEDIUM;
  var mt    = MOD_THEME[kb.module]    || {};
  var cc    = CAT_COLORS[kb.category] || G400;
  return (
    <div onClick={props.onClick}
      style={{ background:isAct?'#EBF2FF':WHITE, border:'1.5px solid '+(isAct?BLUE:G200), borderRadius:9, padding:'10px 11px', marginBottom:6, cursor:'pointer', boxShadow:isAct?'0 2px 8px rgba(0,48,135,0.08)':'0 1px 3px rgba(0,0,0,0.04)' }}>
      <div style={{ display:'flex', justifyContent:'space-between', marginBottom:4 }}>
        <span style={{ fontSize:9, color:G400, fontFamily:'monospace' }}>{kb.id}</span>
        <span style={{ fontSize:9, fontWeight:700, color:st.text, background:st.bg, border:'1px solid '+st.border, borderRadius:3, padding:'0 5px' }}>{kb.severity}</span>
      </div>
      <div style={{ fontSize:11, fontWeight:700, color:G800, lineHeight:1.4, marginBottom:5 }}>{kb.title}</div>
      <div style={{ display:'flex', gap:5, flexWrap:'wrap' }}>
        <span style={{ fontSize:9, color:mt.text, background:mt.bg, border:'1px solid '+mt.border, borderRadius:3, padding:'0 5px' }}>{kb.module}</span>
        <span style={{ fontSize:9, color:cc, border:'1px solid '+cc, borderRadius:3, padding:'0 5px' }}>{kb.category}</span>
      </div>
      <div style={{ marginTop:4, fontSize:9, color:GREEN, fontWeight:600 }}>MTTR: {kb.estimatedMTTR}</div>
    </div>
  );
}

function RunbookPanel(props) {
  var kb   = props.kb;
  var tab  = props.tab;
  var setTab = props.setTab;
  if (!kb) {
    return (
      <div style={{ paddingTop:60, textAlign:'center', opacity:0.38 }}>
        <div style={{ fontSize:40, marginBottom:12 }}>&#128202;</div>
        <div style={{ fontSize:13, fontWeight:700, color:G800 }}>Select a KB article</div>
        <div style={{ fontSize:11, color:G600, marginTop:6, lineHeight:1.7 }}>
          Ask a question or click an article in the left panel to see the full triage runbook, permanent fix, and Gosu code snippet.
        </div>
      </div>
    );
  }
  var st = SEV_THEME[kb.severity] || SEV_THEME.MEDIUM;
  var mt = MOD_THEME[kb.module]   || {};
  return (
    <div>
      <div style={{ background:st.bg, border:'2px solid '+st.border, borderRadius:11, padding:'12px 14px', marginBottom:12 }}>
        <div style={{ display:'flex', gap:7, marginBottom:6, flexWrap:'wrap' }}>
          <span style={{ fontSize:9, fontFamily:'monospace', color:G400 }}>{kb.id}</span>
          <span style={{ fontSize:9, fontWeight:700, color:st.text, background:WHITE, border:'1px solid '+st.border, borderRadius:3, padding:'0 5px' }}>{kb.severity}</span>
          <span style={{ fontSize:9, color:mt.text, background:mt.bg, border:'1px solid '+mt.border, borderRadius:3, padding:'0 5px' }}>{kb.module}</span>
          <span style={{ fontSize:9, color:GREEN, fontWeight:600 }}>MTTR: {kb.estimatedMTTR}</span>
        </div>
        <div style={{ fontSize:13, fontWeight:700, color:G800, lineHeight:1.4 }}>{kb.title}</div>
      </div>

      <div style={{ display:'flex', marginBottom:12, borderBottom:'2px solid '+G200 }}>
        {[{k:'steps',l:'Triage Steps'},{k:'fix',l:'Permanent Fix'},{k:'code',l:'Gosu Code'}].map(function(t) {
          var a = tab === t.k;
          return (
            <button key={t.k} onClick={function() { setTab(t.k); }}
              style={{ background:'transparent', border:'none', borderBottom:'3px solid '+(a?BLUE:'transparent'), color:a?BLUE:G600, padding:'5px 10px', fontSize:11, fontWeight:a?700:400, cursor:'pointer', marginBottom:-2 }}>
              {t.l}
            </button>
          );
        })}
      </div>

      {tab === 'steps' && (
        <div>
          <div style={{ fontSize:10, fontWeight:700, color:G400, marginBottom:7, letterSpacing:1 }}>ROOT CAUSE</div>
          <div style={{ fontSize:11, color:G600, lineHeight:1.75, marginBottom:14, padding:'8px 10px', background:G100, borderRadius:7 }}>{kb.rootCause}</div>
          <div style={{ fontSize:10, fontWeight:700, color:G400, marginBottom:8, letterSpacing:1 }}>IMMEDIATE STEPS</div>
          {kb.immediateSteps.map(function(step, i) {
            return (
              <div key={i} style={{ display:'flex', gap:9, marginBottom:8 }}>
                <div style={{ width:22, height:22, borderRadius:'50%', background:BLUE, display:'flex', alignItems:'center', justifyContent:'center', fontSize:10, fontWeight:700, color:WHITE, flexShrink:0 }}>{i+1}</div>
                <div style={{ fontSize:11, color:G800, lineHeight:1.6, paddingTop:2 }}>{step}</div>
              </div>
            );
          })}
          <div style={{ marginTop:8, padding:'6px 10px', background:'#EBF2FF', borderRadius:6, fontSize:10, color:BLUE }}>
            Linked pattern: {kb.linkedPattern}
          </div>
        </div>
      )}

      {tab === 'fix' && (
        <div>
          <div style={{ fontSize:10, fontWeight:700, color:G400, marginBottom:7, letterSpacing:1 }}>PERMANENT FIX</div>
          <div style={{ fontSize:11, color:G800, lineHeight:1.75, padding:'10px 12px', background:G100, borderRadius:8 }}>{kb.permanentFix}</div>
          {kb.jiraTemplate && (
            <div style={{ marginTop:12, padding:'8px 10px', background:'#E3FCEF', border:'1px solid '+GREEN, borderRadius:7 }}>
              <div style={{ fontSize:10, fontWeight:700, color:GREEN, marginBottom:5 }}>JIRA TICKET TEMPLATE</div>
              <div style={{ fontSize:10, color:G800, lineHeight:1.7 }}>
                <strong>Type:</strong> {kb.jiraTemplate.type}<br/>
                <strong>Priority:</strong> {kb.jiraTemplate.priority}<br/>
                <strong>Label:</strong> {kb.jiraTemplate.label}<br/>
                <strong>AC:</strong> {kb.jiraTemplate.ac}
              </div>
            </div>
          )}
        </div>
      )}

      {tab === 'code' && (
        <div>
          <div style={{ fontSize:10, fontWeight:700, color:G400, marginBottom:7, letterSpacing:1 }}>GOSU CODE SNIPPET</div>
          <pre style={{ fontSize:10, color:'#8EE0A0', margin:0, overflowX:'auto', lineHeight:1.65, fontFamily:'monospace', whiteSpace:'pre', background:'#1E2A3A', padding:12, borderRadius:8 }}>
            {kb.gosuSnippet}
          </pre>
        </div>
      )}
    </div>
  );
}

export default function App() {
  var [query,    setQuery]    = useState('');
  var [messages, setMessages] = useState([{ role:'assistant', text:WELCOME, kb:null }]);
  var [loading,  setLoading]  = useState(false);
  var [activeKB, setActiveKB] = useState(null);
  var [kbTab,    setKbTab]    = useState('steps');
  var [stats,    setStats]    = useState({ resolved:0, avgMTTR:0, total:0 });
  var bottomRef = useRef(null);
  var loadingRef = useRef(false);

  useEffect(function() {
    if (bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior:'smooth' });
    }
  }, [messages, loading]);

  function sendQuery(q) {
    var text = normalizeQuery(q || query);
    if (!text || loadingRef.current) return;
    setQuery('');
    loadingRef.current = true;
    setLoading(true);
    var newMessages = appendBoundedMessages(messages, [{ role:'user', text:text, kb:null }]);
    setMessages(newMessages);

    getResponse(text).then(function(match) {
      var responseText;
      if (match) {
        responseText = 'I found a match in the GW knowledge base.\n\n' + match.title + '\n\nModule: ' + match.module + ' | Severity: ' + match.severity + ' | Est. MTTR: ' + match.estimatedMTTR + '\n\nRoot cause: ' + match.rootCause + '\n\nI have loaded the full runbook in the right panel with immediate steps, permanent fix, and Gosu code. Follow the steps in order.';
        setActiveKB(match);
        setKbTab('steps');
        setStats(function(prev) {
          var resolved = prev.resolved + 1;
          var avg = Math.round((prev.avgMTTR * prev.resolved + getMttrMinutes(match)) / resolved);
          return { resolved:resolved, avgMTTR:avg, total:prev.total + 1 };
        });
      } else {
        responseText = 'I could not find an exact match in the knowledge base. Please be more specific -- mention the GW module (PolicyCenter, BillingCenter, ClaimCenter), the symptom (timeout, stuck, duplicate, NPE), or the integration (ACH, ISO, rating).\n\nIn production, Claude would analyse this against the full GW pattern library and generate a novel triage approach even for new incident types.';
        setStats(function(prev) { return Object.assign({}, prev, { total:prev.total + 1 }); });
      }
      setMessages(appendBoundedMessages(newMessages, [{ role:'assistant', text:responseText, kb:match }]));
      loadingRef.current = false;
      setLoading(false);
    }).catch(function() {
      var responseText = 'The knowledge base lookup failed. Please retry, and avoid entering secrets, credentials, or customer data in incident descriptions.';
      setStats(function(prev) { return Object.assign({}, prev, { total:prev.total + 1 }); });
      setMessages(appendBoundedMessages(newMessages, [{ role:'assistant', text:responseText, kb:null }]));
      loadingRef.current = false;
      setLoading(false);
    });
  }

  return (
    <div style={{ fontFamily:"'Segoe UI',Arial,sans-serif", background:G100, minHeight:'100vh', display:'flex', flexDirection:'column' }}>

      <header style={{ background:BLUE, borderBottom:'3px solid '+RED, padding:'10px 24px', display:'flex', alignItems:'center', justifyContent:'space-between', boxShadow:'0 3px 10px rgba(0,0,0,0.18)', flexShrink:0 }}>
        <div style={{ display:'flex', alignItems:'center', gap:18 }}>
          <AppLogo/>
          <div style={{ width:1, height:30, background:'rgba(255,255,255,0.2)' }}/>
          <div>
            <div style={{ fontSize:14, fontWeight:700, color:WHITE }}>GW AI Ops Assistant</div>
            <div style={{ fontSize:10, color:'#C8D8F0' }}>GenAI-Powered Incident Triage -- Guidewire AMS Accelerator</div>
          </div>
          <div style={{ display:'flex', alignItems:'center', gap:5, marginLeft:8 }}>
            <div style={{ width:8, height:8, borderRadius:'50%', background:GREEN }}/>
            <span style={{ fontSize:10, color:'#6EE7A0', fontWeight:700 }}>KB Active</span>
          </div>
        </div>
        <div style={{ display:'flex', gap:22 }}>
          {[
            { v:KB_ARTICLES.length, l:'KB Articles', c:WHITE        },
            { v:stats.total,        l:'Queries',     c:'#C8D8F0'    },
            { v:stats.resolved,     l:'Resolved',    c:'#6EE7A0'    },
            { v:stats.avgMTTR ? stats.avgMTTR+'m' : '--', l:'Avg MTTR', c:AMBER },
          ].map(function(s) {
            return (
              <div key={s.l} style={{ textAlign:'center' }}>
                <div style={{ fontSize:20, fontWeight:800, color:s.c, lineHeight:1 }}>{s.v}</div>
                <div style={{ fontSize:9, color:'rgba(255,255,255,0.55)', textTransform:'uppercase', letterSpacing:1 }}>{s.l}</div>
              </div>
            );
          })}
        </div>
      </header>

      <div style={{ display:'flex', flex:1, overflow:'hidden', minHeight:0 }}>

        {/* KB list */}
        <aside style={{ width:258, background:WHITE, borderRight:'1px solid '+G200, overflowY:'auto', padding:'14px 10px', flexShrink:0 }}>
          <div style={{ fontSize:10, fontWeight:700, color:G400, letterSpacing:2, marginBottom:10 }}>KNOWLEDGE BASE</div>
          {KB_ARTICLES.map(function(kb) {
            return (
              <KBCard key={kb.id} kb={kb} isActive={activeKB && activeKB.id === kb.id}
                onClick={function() { setActiveKB(kb); setKbTab('steps'); }}/>
            );
          })}
        </aside>

        {/* Chat */}
        <div style={{ flex:1, display:'flex', flexDirection:'column', minWidth:0, overflow:'hidden' }}>

          <div style={{ flex:1, overflowY:'auto', padding:'18px 20px', display:'flex', flexDirection:'column', gap:12 }}>
            {messages.map(function(msg, i) {
              var isUser = msg.role === 'user';
              return (
                <div key={i} style={{ display:'flex', justifyContent:isUser?'flex-end':'flex-start' }}>
                  <div style={{
                    maxWidth:'76%', background:isUser?BLUE:WHITE,
                    color:isUser?WHITE:G800,
                    border:isUser?'none':'1px solid '+G200,
                    borderRadius:isUser?'16px 16px 4px 16px':'4px 16px 16px 16px',
                    padding:'12px 14px', fontSize:12, lineHeight:1.7,
                    boxShadow:'0 1px 4px rgba(0,0,0,0.07)', whiteSpace:'pre-wrap',
                  }}>
                    {!isUser && (
                      <div style={{ fontSize:10, fontWeight:700, color:BLUE, marginBottom:5, letterSpacing:0.5 }}>GW AI Ops Assistant</div>
                    )}
                    {msg.text}
                    {msg.kb && (
                      <div style={{ marginTop:8, padding:'5px 9px', background:'#EBF2FF', borderRadius:6, fontSize:10, color:BLUE, fontWeight:600, cursor:'pointer' }}
                        onClick={function() { setActiveKB(msg.kb); setKbTab('steps'); }}>
                        View runbook: {msg.kb.id} &gt;
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
            {loading && (
              <div style={{ display:'flex' }}>
                <div style={{ background:WHITE, border:'1px solid '+G200, borderRadius:'4px 16px 16px 16px', padding:'12px 14px' }}>
                  <div style={{ fontSize:10, fontWeight:700, color:BLUE, marginBottom:5, letterSpacing:0.5 }}>GW AI Ops Assistant</div>
                  <div style={{ display:'flex', gap:5, alignItems:'center' }}>
                    {[0,1,2].map(function(d) {
                      return <div key={d} style={{ width:8, height:8, borderRadius:'50%', background:BLUE, opacity:0.5 }}/>;
                    })}
                    <span style={{ fontSize:11, color:G400, marginLeft:4 }}>Searching knowledge base...</span>
                  </div>
                </div>
              </div>
            )}
            <div ref={bottomRef}/>
          </div>

          <div style={{ padding:'8px 20px', borderTop:'1px solid '+G200, background:G100, display:'flex', flexWrap:'wrap', gap:6 }}>
            <span style={{ fontSize:10, color:G400, alignSelf:'center', marginRight:4 }}>Try:</span>
            {SUGGESTED.map(function(s) {
              return (
                <button key={s} onClick={function() { sendQuery(s); }} disabled={loading}
                  style={{ fontSize:10, padding:'4px 10px', background:WHITE, border:'1px solid '+G200, borderRadius:12, color:loading?G400:BLUE, cursor:loading?'not-allowed':'pointer', fontWeight:500 }}>
                  {s}
                </button>
              );
            })}
          </div>

          <div style={{ padding:'14px 20px', background:WHITE, borderTop:'1px solid '+G200, display:'flex', gap:10 }}>
            <input value={query} maxLength={MAX_QUERY_LENGTH} onChange={function(e) { setQuery(e.target.value.slice(0, MAX_QUERY_LENGTH)); }}
              onKeyDown={function(e) { if (e.key === 'Enter') { e.preventDefault(); sendQuery(); } }}
              placeholder="Describe the incident: 'PolicyCenter validation timing out on HO-3 renewals'..."
              style={{ flex:1, padding:'10px 14px', borderRadius:10, border:'1.5px solid '+(query?BLUE:G200), fontSize:12, color:G800, outline:'none' }}/>
            <button onClick={function() { sendQuery(); }} disabled={loading || !query.trim()}
              style={{ padding:'10px 22px', background:loading||!query.trim()?G200:BLUE, border:'none', borderRadius:10, color:loading||!query.trim()?G400:WHITE, fontWeight:700, fontSize:12, cursor:loading||!query.trim()?'not-allowed':'pointer' }}>
              Ask
            </button>
          </div>
        </div>

        {/* Runbook panel */}
        <aside style={{ width:336, background:WHITE, borderLeft:'1px solid '+G200, overflowY:'auto', padding:'16px 14px', flexShrink:0 }}>
          <RunbookPanel kb={activeKB} tab={kbTab} setTab={setKbTab}/>
        </aside>
      </div>

      <footer style={{ background:WHITE, borderTop:'1px solid '+G200, padding:'6px 24px', display:'flex', alignItems:'center', gap:10, flexWrap:'wrap', flexShrink:0 }}>
        <div style={{ display:'flex', alignItems:'center', gap:5 }}>
          <div style={{ width:8, height:8, borderRadius:'50%', background:GREEN }}/>
          <span style={{ fontSize:10, color:GREEN, fontWeight:700 }}>Live</span>
        </div>
        {['PolicyCenter','BillingCenter','ClaimCenter','Knowledge Graph (Prod)','Claude Sonnet (Prod)','ServiceNow (Prod)'].map(function(t) {
          return <span key={t} style={{ fontSize:9, color:G600, border:'1px solid '+G200, padding:'2px 7px', borderRadius:3, background:G100 }}>{t}</span>;
        })}
        <span style={{ marginLeft:'auto', fontSize:10, color:G400 }}>GW AI Ops Assistant 2025</span>
      </footer>
    </div>
  );
}
