iimport { useState, useRef, useEffect } from "react";

const API_URL = "https://api.anthropic.com/v1/messages";
const SUPABASE_URL = "https://mfrqfbgtnmxmiajymsjt.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1mcnFmYmd0bm14bWlhanltc2p0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ0ODUwOTQsImV4cCI6MjA5MDA2MTA5NH0.Ub3jN--Ai__o3TfEOKg077C-ma_RspF38-1JUZnEzqw";

const TEMPLATE_TYPES = ["General Follow-Up", "Membership", "Sponsorship", "Council", "Education"];
const CONTACT_TYPES = ["", "Member", "Non-Member", "Prospect", "Distributor", "Buyer Group", "Channel Partner", "Thought Leader", "Sponsor", "Affiliate", "Affiliate Prospect"];
const STATUSES = ["New", "Contacted", "In Progress", "Closed"];
const GROUP = ["", "OE", "Aftermarket", "Both"];
const PRIORITIES = ["🔴 Hot", "🟠 Warm", "⚪ Cold"];

async function dbGetContacts() {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/contacts?order=created_at.desc`, {
    headers: { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${SUPABASE_KEY}` }
  });
  return res.json();
}

async function dbAddContact(contact) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/contacts`, {
    method: "POST",
    headers: { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${SUPABASE_KEY}`, "Content-Type": "application/json", "Prefer": "return=representation" },
    body: JSON.stringify(contact)
  });
  return res.json();
}

async function dbUpdateContact(id, updates) {
  await fetch(`${SUPABASE_URL}/rest/v1/contacts?id=eq.${id}`, {
    method: "PATCH",
    headers: { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${SUPABASE_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(updates)
  });
}

async function dbDeleteContact(id) {
  await fetch(`${SUPABASE_URL}/rest/v1/contacts?id=eq.${id}`, {
    method: "DELETE",
    headers: { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${SUPABASE_KEY}` }
  });
}

function isSimilar(a, b) {
  if (!a || !b) return false;
  const norm = s => s.toLowerCase().replace(/\s+/g, "");
  if (a.email && b.email && norm(a.email) === norm(b.email)) return true;
  if (a.name && b.name && norm(a.name) === norm(b.name) && a.company && b.company && norm(a.company) === norm(b.company)) return true;
  return false;
}
function isOverdue(d) { return d && new Date(d) < new Date(new Date().toISOString().split("T")[0]); }
function isDueSoon(d) {
  if (!d) return false;
  const diff = (new Date(d) - new Date(new Date().toISOString().split("T")[0])) / 86400000;
  return diff >= 0 && diff <= 3;
}
async function callClaude(apiKey, messages) {
  const res = await fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" },
    body: JSON.stringify({ model: "claude-sonnet-4-20250514", max_tokens: 1000, messages })
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  return data.content?.map(b => b.text || "").join("") || "";
}
function parseJSON(text) {
  try { return JSON.parse(text.replace(/```json|```/g, "").trim()); } catch { return {}; }
}

export default function Home() {
  const [apiKey, setApiKey] = useState("");
  const [apiKeySaved, setApiKeySaved] = useState(false);
  const [contacts, setContacts] = useState([]);
  const [tab, setTab] = useState("add");
  const [loading, setLoading] = useState(false);
  const [loadingContacts, setLoadingContacts] = useState(true);
  const [status, setStatus] = useState("");
  const [noteText, setNoteText] = useState("");
  const [eventName, setEventName] = useState("");
  const [myName, setMyName] = useState("");
  const [cardImage, setCardImage] = useState(null);
  const [cardBase64, setCardBase64] = useState(null);
  const [cardMime, setCardMime] = useState("image/jpeg");
  const [dupWarning, setDupWarning] = useState(null);
  const [selectedContact, setSelectedContact] = useState(null);
  const [generatingEmail, setGeneratingEmail] = useState(false);
  const [emailDraft, setEmailDraft] = useState("");
  const [emailTemplateType, setEmailTemplateType] = useState("General Follow-Up");
  const [search, setSearch] = useState("");
  const [filterEvent, setFilterEvent] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const fileRef = useRef();

  useEffect(() => {
    const savedKey = localStorage.getItem("eventmvp_apikey");
    const savedName = localStorage.getItem("eventmvp_name");
    if (savedKey) { setApiKey(savedKey); setApiKeySaved(true); }
    if (savedName) setMyName(savedName);
    dbGetContacts().then(data => {
      if (Array.isArray(data)) setContacts(data.map(c => ({ ...c, encounters: c.encounters || [] })));
      setLoadingContacts(false);
    }).catch(() => setLoadingContacts(false));
  }, []);

  const events = [...new Set(contacts.map(c => c.event_name).filter(Boolean))];

  const handleImageUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setCardMime(file.type || "image/jpeg");
    const reader = new FileReader();
    reader.onload = (ev) => { setCardImage(ev.target.result); setCardBase64(ev.target.result.split(",")[1]); };
    reader.readAsDataURL(file);
  };

  const handleAdd = async () => {
    if (!apiKeySaved) { setStatus("Please save your API key in Settings first."); return; }
    if (!cardImage && !noteText.trim()) { setStatus("Add a business card or notes."); return; }
    setLoading(true); setDupWarning(null); setStatus("Scanning with AI...");
    try {
      let cardData = {}, noteData = {};
      if (cardImage) {
        setStatus("Reading business card...");
        const text = await callClaude(apiKey, [{ role: "user", content: [
          { type: "image", source: { type: "base64", media_type: cardMime, data: cardBase64 } },
          { type: "text", text: `Extract contact info from this business card. Return ONLY JSON: {"name":"","title":"","company":"","email":"","phone":"","website":"","linkedin":""}. No markdown.` }
        ]}]);
        cardData = parseJSON(text);
      }
      if (noteText.trim()) {
        setStatus("Parsing notes...");
        const text = await callClaude(apiKey, [{ role: "user", content: `Parse this event note. Return ONLY JSON: {"name":"","title":"","company":"","email":"","phone":"","notes":"","followUpTask":"","followUpDate":""}. followUpDate in YYYY-MM-DD if mentioned. Note: "${noteText}"` }]);
        noteData = parseJSON(text);
      }
      const newContact = {
        name: cardData.name || noteData.name || "",
        title: cardData.title || noteData.title || "",
        company: cardData.company || noteData.company || "",
        email: cardData.email || noteData.email || "",
        phone: cardData.phone || noteData.phone || "",
        website: cardData.website || "",
        linkedin: cardData.linkedin || "",
        notes: noteText,
        follow_up_task: noteData.followUpTask || "",
        follow_up_date: noteData.followUpDate || "",
        event_name: eventName || "Unknown Event",
        met_by: myName || "Me",
        contact_type: "",
        status: "New", priority: "⚪ Cold",
        added_at: new Date().toLocaleDateString(),
        encounters: [{ event: eventName || "Unknown Event", metBy: myName || "Me", notes: noteText, date: new Date().toLocaleDateString() }]
      };
      const dup = contacts.find(c => isSimilar(c, newContact));
      if (dup) { setDupWarning({ existing: dup, incoming: newContact }); setLoading(false); setStatus(""); return; }
      const saved = await dbAddContact(newContact);
      if (Array.isArray(saved) && saved[0]) setContacts(prev => [saved[0], ...prev]);
      setStatus("✅ Contact added!");
      setNoteText(""); setCardImage(null); setCardBase64(null);
      setTimeout(() => { setStatus(""); setTab("list"); }, 1200);
    } catch (e) { setStatus("Error: " + e.message); }
    setLoading(false);
  };

  const handleMergeDup = async () => {
    const { existing, incoming } = dupWarning;
    const mergedNotes = [existing.notes, incoming.notes].filter(Boolean).join("\n---\n");
    const mergedEncounters = [...(existing.encounters || []), ...(incoming.encounters || [])];
    await dbUpdateContact(existing.id, { notes: mergedNotes, encounters: mergedEncounters });
    setContacts(prev => prev.map(c => c.id === existing.id ? { ...c, notes: mergedNotes, encounters: mergedEncounters } : c));
    setDupWarning(null); setNoteText(""); setCardImage(null); setCardBase64(null);
    setStatus("✅ Notes merged!"); setTimeout(() => { setStatus(""); setTab("list"); }, 1500);
  };

  const handleGenerateEmail = async (contact) => {
    if (!apiKeySaved) return;
    setGeneratingEmail(true); setEmailDraft("");
    try {
      const text = await callClaude(apiKey, [{ role: "user", content: `Write a professional, warm, personalized follow-up email.\nTemplate: ${emailTemplateType}\nName: ${contact.name}\nTitle: ${contact.title}\nCompany: ${contact.company}\nEvent: ${contact.event_name}\nMet by: ${contact.met_by}\nNotes: ${contact.notes}\nFollow-up task: ${contact.follow_up_task}\nWrite only the email body, no subject line. Sign off as ${contact.met_by || "the team"}.` }]);
      setEmailDraft(text);
    } catch (e) { setEmailDraft("Error: " + e.message); }
    setGeneratingEmail(false);
  };

  const handleUpdateField = async (id, field, value) => {
    await dbUpdateContact(id, { [field]: value });
    setContacts(prev => prev.map(c => c.id === id ? { ...c, [field]: value } : c));
  };

  const handleDelete = async (id) => {
    await dbDeleteContact(id);
    setContacts(prev => prev.filter(c => c.id !== id));
    setSelectedContact(null);
  };

  const handleExportCSV = () => {
    const headers = ["First Name","Last Name","Title","Account Name","Email","Phone","Website","Lead Source","Description","Follow-Up Task","Follow-Up Date","Event","Met By","Contact Type","Status","Priority"];
    const rows = contacts.map(c => {
      const parts = (c.name||"").trim().split(" ");
      return [parts.slice(0,-1).join(" "), parts[parts.length-1]||"", c.title, c.company, c.email, c.phone, c.website, "Event", c.notes, c.follow_up_task, c.follow_up_date, c.event_name, c.met_by, c.contact_type, c.status, c.priority].map(v => `"${(v||"").replace(/"/g,'""')}"`);
    });
    const csv = [headers,...rows].map(r=>r.join(",")).join("\n");
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([csv],{type:"text/csv"})); a.download = "salesforce-contacts.csv"; a.click();
  };

  const filtered = contacts.filter(c => {
    const q = search.toLowerCase();
    return (!q || [c.name,c.company,c.email,c.notes,c.event_name].some(f=>f?.toLowerCase().includes(q))) &&
           (!filterEvent || c.event_name===filterEvent) && (!filterStatus || c.status===filterStatus);
  });

  const overdueCount = contacts.filter(c=>isOverdue(c.follow_up_date)).length;
  const dueSoonCount = contacts.filter(c=>isDueSoon(c.follow_up_date)).length;

  return (
    <div style={{minHeight:"100vh",background:"#222222",fontFamily:"'Instrument Sans',sans-serif",color:"#1a1a1a"}}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Instrument+Sans:wght@400;500;600&family=Playfair+Display:wght@700;800&display=swap');
        *{box-sizing:border-box;margin:0;padding:0}
        .inp{width:100%;background:#fff;border:1.5px solid #e8e0d5;border-radius:10px;color:#1a1a1a;font-family:'Instrument Sans',sans-serif;font-size:0.9rem;padding:11px 14px;outline:none;transition:border 0.2s}
        .inp:focus{border-color:#c17f3e}
        .btn{border:none;border-radius:10px;font-family:'Instrument Sans',sans-serif;font-weight:600;cursor:pointer;transition:all 0.18s}
        .btn-p{background:#c17f3e;color:#fff;padding:12px 24px;font-size:0.95rem}
        .btn-p:hover:not(:disabled){background:#a86830;transform:translateY(-1px)}
        .btn-p:disabled{opacity:0.45;cursor:not-allowed}
        .btn-g{background:#f0ebe4;color:#5a4a38;padding:9px 18px;font-size:0.85rem}
        .btn-g:hover{background:#e8dfd3}
        .btn-d{background:#fee;color:#c0392b;padding:7px 14px;font-size:0.82rem;border:1px solid #fcc}
        .card{background:#fff;border:1.5px solid #ede8e0;border-radius:16px;padding:24px}
        .tab-btn{background:none;border:none;font-family:'Instrument Sans',sans-serif;font-size:0.9rem;font-weight:500;cursor:pointer;padding:10px 18px;border-radius:8px;color:#7a6a58;transition:all 0.18s}
        .tab-btn.active{background:#c17f3e;color:#fff;font-weight:600}
        .tab-btn:hover:not(.active){background:#f0ebe4;color:#1a1a1a}
        .badge{display:inline-block;padding:2px 9px;border-radius:20px;font-size:0.72rem;font-weight:600}
        .br{background:#fee;color:#c0392b}.ba{background:#fff3e0;color:#c17f3e}.bg{background:#e8f5e9;color:#2e7d32}.bb{background:#e3f2fd;color:#1565c0}
        .cc{background:#fff;border:1.5px solid #ede8e0;border-radius:14px;padding:20px;transition:all 0.2s;cursor:pointer}
        .cc:hover{border-color:#c17f3e88;box-shadow:0 4px 20px #c17f3e11;transform:translateY(-1px)}
        .cc.sel{border-color:#c17f3e;box-shadow:0 4px 24px #c17f3e22}
        .uz{border:2px dashed #d4c5b0;border-radius:12px;padding:28px;text-align:center;cursor:pointer;transition:all 0.2s;background:#faf8f5}
        .uz:hover{border-color:#c17f3e;background:#c17f3e08}
        select.inp{appearance:none;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%237a6a58' d='M6 8L1 3h10z'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right 12px center;padding-right:32px}
        .dv{height:1px;background:#ede8e0;margin:20px 0}
        .eb{background:#faf8f5;border:1.5px solid #ede8e0;border-radius:10px;padding:16px;font-size:0.88rem;line-height:1.7;white-space:pre-wrap;color:#3a2e22}
        .ep{background:#f0ebe4;border-radius:8px;padding:8px 12px;font-size:0.82rem;color:#5a4a38;border-left:3px solid #c17f3e}
        .pulse{animation:pulse 1.8s infinite}@keyframes pulse{0%,100%{opacity:1}50%{opacity:0.4}}
        textarea.inp{resize:vertical;min-height:100px}
        .g2{display:grid;grid-template-columns:1fr 1fr;gap:12px}
        @media(max-width:600px){.g2{grid-template-columns:1fr}}
      `}</style>

      <div style={{background:"#fff",borderBottom:"1.5px solid #ede8e0",padding:"0 24px",position:"sticky",top:0,zIndex:50}}>
        <div style={{maxWidth:900,margin:"0 auto",display:"flex",alignItems:"center",justifyContent:"space-between",padding:"14px 0 0"}}>
          <div>
            <div style={{fontFamily:"'Playfair Display',serif",fontSize:"1.6rem",fontWeight:800,letterSpacing:"-0.5px"}}>Event<span style={{color:"#c17f3e"}}>Desk</span></div>
            <div style={{fontSize:"0.72rem",color:"#9a8a78",marginTop:1,letterSpacing:"0.08em",textTransform:"uppercase"}}>Shared Team Contact Tracker</div>
          </div>
          <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap",justifyContent:"flex-end"}}>
            {overdueCount>0&&<span className="badge br">⚠ {overdueCount} overdue</span>}
            {dueSoonCount>0&&<span className="badge ba">🔔 {dueSoonCount} due soon</span>}
            <span style={{fontSize:"0.82rem",color:"#9a8a78"}}>{contacts.length} contacts</span>
          </div>
        </div>
        <div style={{maxWidth:900,margin:"0 auto",display:"flex",gap:4,paddingTop:8}}>
          {["add","list","settings"].map(t=>(
            <button key={t} className={`tab-btn ${tab===t?"active":""}`} onClick={()=>setTab(t)}>
              {t==="add"?"+ Add Contact":t==="list"?`📋 Contacts (${contacts.length})`:"⚙ Settings"}
            </button>
          ))}
        </div>
      </div>

      <div style={{maxWidth:900,margin:"0 auto",padding:"28px 20px"}}>

        {tab==="settings"&&(
          <div style={{display:"flex",flexDirection:"column",gap:20,maxWidth:520}}>
            <div className="card">
              <div style={{fontFamily:"'Playfair Display',serif",fontWeight:700,marginBottom:14}}>🔑 Anthropic API Key</div>
              <p style={{fontSize:"0.85rem",color:"#7a6a58",marginBottom:14,lineHeight:1.6}}>Get a free key at <strong>console.anthropic.com</strong>. Saved to your browser only.</p>
              <input className="inp" type="password" placeholder="sk-ant-..." value={apiKey} onChange={e=>setApiKey(e.target.value)}/>
              <div style={{display:"flex",gap:10,marginTop:12}}>
                <button className="btn btn-p" onClick={()=>{localStorage.setItem("eventmvp_apikey",apiKey);setApiKeySaved(true);setStatus("✅ API key saved!");setTimeout(()=>setStatus(""),2000)}}>Save Key</button>
                {apiKeySaved&&<span className="badge bg" style={{alignSelf:"center"}}>✓ Saved</span>}
              </div>
            </div>
            <div className="card">
              <div style={{fontFamily:"'Playfair Display',serif",fontWeight:700,marginBottom:12}}>👤 Your Name</div>
              <input className="inp" type="text" placeholder="e.g. Shannon" value={myName} onChange={e=>{setMyName(e.target.value);localStorage.setItem("eventmvp_name",e.target.value)}}/>
            </div>
            {status&&<div style={{background:"#e8f5e9",border:"1px solid #c8e6c9",borderRadius:10,padding:"12px 16px",color:"#2e7d32",fontSize:"0.88rem"}}>{status}</div>}
          </div>
        )}

        {tab==="add"&&(
          <div style={{display:"flex",flexDirection:"column",gap:18}}>
            {!apiKeySaved&&<div style={{background:"#fff3e0",border:"1.5px solid #ffe0b2",borderRadius:12,padding:"14px 18px",fontSize:"0.88rem",color:"#c17f3e"}}>⚠ Go to <strong>Settings</strong> to save your API key first.</div>}
            <div className="g2">
              <div>
                <label style={{fontSize:"0.8rem",fontWeight:600,color:"#7a6a58",display:"block",marginBottom:6,textTransform:"uppercase",letterSpacing:"0.05em"}}>Event Name</label>
                <input className="inp" type="text" placeholder="e.g. SaaStr 2026" value={eventName} onChange={e=>setEventName(e.target.value)}/>
              </div>
              <div>
                <label style={{fontSize:"0.8rem",fontWeight:600,color:"#7a6a58",display:"block",marginBottom:6,textTransform:"uppercase",letterSpacing:"0.05em"}}>Met By</label>
                <input className="inp" type="text" placeholder={myName||"Your name"} value={myName} onChange={e=>setMyName(e.target.value)}/>
              </div>
            </div>
            <div className="card">
              <div style={{fontFamily:"'Playfair Display',serif",fontWeight:700,marginBottom:14}}>📸 Business Card</div>
              {!cardImage?(
                <div className="uz" onClick={()=>fileRef.current.click()}>
                  <div style={{fontSize:"2.2rem",marginBottom:8}}>📇</div>
                  <div style={{color:"#7a6a58",fontSize:"0.88rem",fontWeight:500}}>Tap to upload business card photo</div>
                  <div style={{color:"#b0a090",fontSize:"0.78rem",marginTop:4}}>JPG or PNG • iPhone camera supported</div>
                </div>
              ):(
                <div style={{position:"relative"}}>
                  <img src={cardImage} alt="card" style={{width:"100%",maxHeight:180,objectFit:"contain",borderRadius:10,background:"#faf8f5"}}/>
                  <button className="btn btn-g" style={{position:"absolute",top:8,right:8,padding:"6px 12px",fontSize:"0.8rem"}} onClick={()=>{setCardImage(null);setCardBase64(null)}}>✕</button>
                </div>
              )}
              <input ref={fileRef} type="file" accept="image/*" capture="environment" style={{display:"none"}} onChange={handleImageUpload}/>
            </div>
            <div className="card">
              <div style={{fontFamily:"'Playfair Display',serif",fontWeight:700,marginBottom:8}}>🎤 Voice / Text Notes</div>
              <p style={{fontSize:"0.82rem",color:"#9a8a78",marginBottom:12}}>Paste voice-to-text or type freely. Include follow-up timing like "follow up next week".</p>
              <textarea className="inp" rows={5} placeholder='e.g. "Met David Chen, VP Sales at TechCorp. Interested in gold sponsorship. Follow up in 3 days."' value={noteText} onChange={e=>setNoteText(e.target.value)}/>
            </div>
            {dupWarning&&(
              <div style={{background:"#fff3e0",border:"1.5px solid #ffcc80",borderRadius:14,padding:20}}>
                <div style={{fontFamily:"'Playfair Display',serif",fontWeight:700,marginBottom:8,color:"#c17f3e"}}>⚠ Duplicate Detected</div>
                <p style={{fontSize:"0.88rem",color:"#5a4a38",marginBottom:6}}><strong>{dupWarning.existing.name}</strong> from <strong>{dupWarning.existing.company}</strong> is already in your contacts.</p>
                <p style={{fontSize:"0.85rem",color:"#7a6a58",marginBottom:14}}>Merge these notes into their existing record?</p>
                <div style={{display:"flex",gap:10}}>
                  <button className="btn btn-p" onClick={handleMergeDup}>Merge Notes</button>
                  <button className="btn btn-g" onClick={async()=>{setDupWarning(null);const saved=await dbAddContact(dupWarning.incoming);if(Array.isArray(saved)&&saved[0])setContacts(prev=>[saved[0],...prev]);setNoteText("");setCardImage(null);setCardBase64(null);setTimeout(()=>setTab("list"),800)}}>Add as New</button>
                  <button className="btn btn-g" onClick={()=>setDupWarning(null)}>Cancel</button>
                </div>
              </div>
            )}
            {status&&!dupWarning&&(
              <div style={{background:status.includes("✅")?"#e8f5e9":"#fff3e0",border:`1.5px solid ${status.includes("✅")?"#c8e6c9":"#ffcc80"}`,borderRadius:10,padding:"12px 16px",color:status.includes("✅")?"#2e7d32":"#c17f3e",fontSize:"0.88rem"}} className={loading?"pulse":""}>
                {status}
              </div>
            )}
            <button className="btn btn-p" onClick={handleAdd} disabled={loading} style={{alignSelf:"flex-start"}}>
              {loading?"Processing...":"✨ Extract & Save Contact"}
            </button>
          </div>
        )}

        {tab==="list"&&(
          <div style={{display:"flex",flexDirection:"column",gap:16}}>
            <div style={{display:"flex",gap:10,flexWrap:"wrap",alignItems:"center"}}>
              <input className="inp" type="text" placeholder="Search contacts..." value={search} onChange={e=>setSearch(e.target.value)} style={{flex:1,minWidth:180}}/>
              {events.length>0&&(
                <select className="inp" value={filterEvent} onChange={e=>setFilterEvent(e.target.value)} style={{width:"auto",flex:"0 0 auto"}}>
                  <option value="">All Events</option>
                  {events.map(ev=><option key={ev} value={ev}>{ev}</option>)}
                </select>
              )}
              <select className="inp" value={filterStatus} onChange={e=>setFilterStatus(e.target.value)} style={{width:"auto",flex:"0 0 auto"}}>
                <option value="">All Statuses</option>
                {STATUSES.map(s=><option key={s} value={s}>{s}</option>)}
              </select>
              {contacts.length>0&&<button className="btn btn-p" onClick={handleExportCSV}>⬇ Salesforce CSV</button>}
            </div>
            {loadingContacts&&<div style={{textAlign:"center",padding:"40px 0",color:"#9a8a78"}}>Loading contacts...</div>}
            {!loadingContacts&&filtered.length===0&&(
              <div style={{textAlign:"center",padding:"60px 0",color:"#9a8a78"}}>
                <div style={{fontSize:"3rem",marginBottom:12}}>📭</div>
                <div style={{fontFamily:"'Playfair Display',serif",fontSize:"1.1rem",marginBottom:6}}>No contacts yet</div>
                <div style={{fontSize:"0.85rem"}}>Add your first contact from an event</div>
              </div>
            )}
            {filtered.map(c=>(
              <div key={c.id} className={`cc ${selectedContact?.id===c.id?"sel":""}`} onClick={()=>setSelectedContact(selectedContact?.id===c.id?null:c)}>
                <div style={{display:"flex",justifyContent:"space-between",gap:10}}>
                  <div style={{flex:1}}>
                    <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
                      <span style={{fontFamily:"'Playfair Display',serif",fontSize:"1.05rem",fontWeight:700}}>{c.name||<span style={{color:"#9a8a78"}}>Unknown</span>}</span>
                      <span style={{fontSize:"0.82rem"}}>{c.priority}</span>
                      {isOverdue(c.follow_up_date)&&<span className="badge br">Overdue</span>}
                      {isDueSoon(c.follow_up_date)&&!isOverdue(c.follow_up_date)&&<span className="badge ba">Due Soon</span>}
                      {c.event_name&&<span className="badge bb">{c.event_name}</span>}
                    </div>
                    <div style={{color:"#7a6a58",fontSize:"0.84rem",marginTop:3}}>{[c.title,c.company].filter(Boolean).join(" · ")}</div>
                    <div style={{display:"flex",gap:14,flexWrap:"wrap",marginTop:8,fontSize:"0.82rem",color:"#5a4a38"}}>
                      {c.email&&<span>✉ {c.email}</span>}
                      {c.phone&&<span>📞 {c.phone}</span>}
                      {c.met_by&&<span>👤 {c.met_by}</span>}
                    </div>
                  </div>
                  <div style={{display:"flex",flexDirection:"column",gap:6,alignItems:"flex-end",flexShrink:0}}>
                    <select className="inp" style={{width:150,fontSize:"0.8rem",padding:"5px 28px 5px 10px"}} value={c.contact_type||""}
                      onChange={e=>{e.stopPropagation();handleUpdateField(c.id,"contact_type",e.target.value)}}>
                      <option value="">Type...</option>
                      {CONTACT_TYPES.filter(Boolean).map(t=><option key={t}>{t}</option>)}
                    </select>
                    <select className="inp" style={{width:150,fontSize:"0.8rem",padding:"5px 28px 5px 10px"}} value={c.status}
                      onChange={e=>{e.stopPropagation();handleUpdateField(c.id,"status",e.target.value)}}>
                      {STATUSES.map(s=><option key={s}>{s}</option>)}
                    </select>
                    <select className="inp" style={{width:150,fontSize:"0.8rem",padding:"5px 28px 5px 10px"}} value={c.priority}
                      onChange={e=>{e.stopPropagation();handleUpdateField(c.id,"priority",e.target.value)}}>
                      {PRIORITIES.map(p=><option key={p}>{p}</option>)}
                    </select>
                  </div>
                </div>
                {selectedContact?.id===c.id&&(
                  <div onClick={e=>e.stopPropagation()}>
                    <div className="dv"/>
                    {c.encounters?.length>1&&(
                      <div style={{marginBottom:16}}>
                        <div style={{fontSize:"0.78rem",fontWeight:600,color:"#9a8a78",textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:8}}>Past Encounters</div>
                        <div style={{display:"flex",flexDirection:"column",gap:6}}>
                          {c.encounters.map((enc,i)=>(
                            <div key={i} className="ep"><strong>{enc.event}</strong> · {enc.date} · Met by {enc.metBy}
                              {enc.notes&&<div style={{marginTop:4,color:"#7a6a58"}}>{enc.notes.slice(0,100)}{enc.notes.length>100?"…":""}</div>}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    {c.notes&&(
                      <div style={{marginBottom:16}}>
                        <div style={{fontSize:"0.78rem",fontWeight:600,color:"#9a8a78",textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:6}}>Notes</div>
                        <div style={{background:"#faf8f5",borderRadius:8,padding:"10px 14px",fontSize:"0.85rem",color:"#3a2e22",lineHeight:1.6}}>{c.notes}</div>
                      </div>
                    )}
                    {c.follow_up_task&&(
                      <div style={{marginBottom:16,background:isOverdue(c.follow_up_date)?"#fee":"#fff3e0",borderRadius:8,padding:"10px 14px",fontSize:"0.85rem",borderLeft:`3px solid ${isOverdue(c.follow_up_date)?"#c0392b":"#c17f3e"}`}}>
                        <strong style={{color:isOverdue(c.follow_up_date)?"#c0392b":"#c17f3e"}}>🔔 {c.follow_up_task}</strong>
                        {c.follow_up_date&&<span style={{color:"#7a6a58"}}> · {c.follow_up_date}</span>}
                      </div>
                    )}
                    <div className="dv"/>
                    <div style={{fontSize:"0.78rem",fontWeight:600,color:"#9a8a78",textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:10}}>✉ Generate Follow-Up Email</div>
                    <div style={{display:"flex",gap:10,marginBottom:12,flexWrap:"wrap"}}>
                      <select className="inp" style={{flex:1,minWidth:160}} value={emailTemplateType} onChange={e=>setEmailTemplateType(e.target.value)}>
                        {TEMPLATE_TYPES.map(t=><option key={t}>{t}</option>)}
                      </select>
                      <button className="btn btn-p" onClick={()=>handleGenerateEmail(c)} disabled={generatingEmail||!apiKeySaved} style={{whiteSpace:"nowrap"}}>
                        {generatingEmail?"Writing...":"✨ Generate"}
                      </button>
                    </div>
                    {emailDraft&&selectedContact?.id===c.id&&(
                      <div>
                        <div className="eb">{emailDraft}</div>
                        <button className="btn btn-g" style={{marginTop:10}} onClick={()=>navigator.clipboard?.writeText(emailDraft)}>📋 Copy</button>
                      </div>
                    )}
                    <div className="dv"/>
                    <button className="btn btn-d btn" onClick={()=>handleDelete(c.id)}>🗑 Delete Contact</button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
