/* THROWAWAY UI MOCK: three artifact-workspace layouts, selected by ?variant=A|B|C.
   Question: is finding an agent's output best served by a document workspace, library, or activity feed?
   Sample objects: 8 deliverables, 3 root sessions, 2 child sessions, 3 immutable brief versions.
   Scope: local session + optional children; no live history, external calls, or persistence.
   Jobs: read a deliverable, follow its origin, compare captured revisions, prepare a request.
   Identity: repository Geist + neutral canvas frame; the signature is the artifact's revision spine.
   The dealt retail signature is not used: revision provenance is specific to this product.
   Images: one existing repository screenshot, explicitly labeled as a reference.
   Counts derive from the dataset. File ownership and agent actions are simulated, never implied live. */
const icons = {
    layers:'<path d="m3 7 9-4 9 4-9 4-9-4Zm0 5 9 4 9-4M3 17l9 4 9-4"/>',
    file:'<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9Z"/><path d="M14 3v6h6M8 13h8M8 17h5"/>',
    image:'<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8" cy="8" r="1.5"/><path d="m21 15-5-5L5 21"/>',
    diagram:'<rect x="8" y="2" width="8" height="5" rx="1"/><rect x="2" y="17" width="7" height="5" rx="1"/><rect x="15" y="17" width="7" height="5" rx="1"/><path d="M12 7v5H5.5v5M12 12h6.5v5"/>',
    table:'<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 3v18M3 15h18"/>',
    search:'<circle cx="10" cy="10" r="6"/><path d="m15 15 5 5"/>',
    chevron:'<path d="m9 5 7 7-7 7"/>',
    back:'<path d="m14 5-7 7 7 7"/>',
    down:'<path d="m6 9 6 6 6-6"/>',
    plus:'<path d="M12 5v14M5 12h14"/>',
    pin:'<path d="m16 3 5 5-3 1-4 5v4l-3-3-6 6M4 10h4l5-4 1-3"/>',
    clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    chat:'<path d="M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8v.5Z"/>',
    download:'<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
    menu:'<path d="M4 6h16M4 12h16M4 18h16"/>',
    close:'<path d="m6 6 12 12M18 6 6 18"/>',
    check:'<path d="m5 12 4 4L19 6"/>',
    folder:'<path d="M3 7V5a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/>',
    link:'<path d="m10 13 4-4M8 16l-1 1a4 4 0 0 1-6-6l5-5a4 4 0 0 1 6 0m0 12a4 4 0 0 0 6 0l5-5a4 4 0 0 0-6-6l-1 1" transform="translate(1 -1) scale(.92)"/>',
};
const icon = name => `<svg class="icon" aria-hidden="true" viewBox="0 0 24 24">${icons[name] || icons.file}</svg>`;
const escapeHtml = value => String(value).replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const sessions = [
    {id:"workspace",name:"Session artifact workspace",parent:null},
    {id:"research",name:"Research sources",parent:"workspace"},
    {id:"design",name:"Interface exploration",parent:"workspace"},
    {id:"screenshots",name:"Screenshots improvements",parent:null},
    {id:"empty",name:"Next canvas idea",parent:null},
];
const artifacts = [
    {id:"brief",title:"Product brief",file:"product-brief.md",kind:"document",session:"workspace",time:"09:42",description:"A home for the work your agent produces.",version:3,pinned:true,size:"4.2 KB",origin:"Agent publication",revisions:[{v:3,time:"09:42",label:"Clarified scope & provenance"},{v:2,time:"09:28",label:"Added the capture strategy"},{v:1,time:"09:14",label:"First draft from your request"}]},
    {id:"architecture",title:"Artifact capture flow",file:"capture-flow.svg",kind:"diagram",session:"workspace",time:"09:37",description:"How discovery and explicit publication meet.",version:2,size:"2.1 KB",origin:"Agent publication"},
    {id:"checklist",title:"Implementation checklist",file:"implementation.md",kind:"document",session:"workspace",time:"09:35",description:"The smallest useful first release.",version:1,size:"1.8 KB",origin:"Agent publication"},
    {id:"research-notes",title:"Canvas API research",file:"canvas-research.md",kind:"document",session:"research",time:"09:31",description:"Confirmed capabilities, with open integration questions.",version:1,size:"3.6 KB",origin:"Child session"},
    {id:"decisions",title:"Scope decisions",file:"scope-decisions.md",kind:"document",session:"workspace",time:"09:28",description:"Local-first. Originals stay untouched.",version:2,size:"1.2 KB",origin:"Agent publication"},
    {id:"reference",title:"Screenshots app reference",file:"screenshots-reference.png",kind:"image",session:"design",time:"09:24",description:"Existing repository UI, used as a visual reference.",version:1,size:"Reference image",origin:"Repository reference"},
    {id:"inventory",title:"Artifact type inventory",file:"artifact-types.csv",kind:"table",session:"workspace",time:"09:20",description:"Preview coverage for the first release.",version:1,size:"0.4 KB",origin:"Agent publication"},
    {id:"missing",title:"Early concept notes",file:"early-concept.pdf",kind:"file",session:"workspace",time:"09:16",description:"The original file is no longer available.",version:1,size:"Unavailable",origin:"Discovered reference",missing:true},
    {id:"gallery",title:"Gallery reference",file:"gallery-reference.png",kind:"image",session:"screenshots",time:"08:52",description:"The existing Screenshots canvas.",version:1,size:"Reference image",origin:"Repository reference"},
    {id:"gallery-notes",title:"Gallery review notes",file:"gallery-notes.md",kind:"document",session:"screenshots",time:"08:45",description:"Preserve navigation, filters, and preview state.",version:1,size:"0.8 KB",origin:"Agent publication"},
];
const variantNames = {A:"Workspace",B:"Library",C:"Activity"};
const state = {
    variant: new URLSearchParams(location.search).get("variant") || "A",
    session:"workspace",children:true,search:"",kind:"all",selected:"brief",
    tab:"preview",revision:null,pinned:false,mobileDetail:false,mobileMenu:false,
    checks:[true,true,false,false],selection:"",
};
if (!variantNames[state.variant]) state.variant="A";
const app = document.querySelector("#app"), dialog = document.querySelector("#dialog");
const sessionName = id => sessions.find(session => session.id === id)?.name || id;
const typeIcon = artifact => ({document:"file",image:"image",diagram:"diagram",table:"table",file:"file"}[artifact.kind]);
const selected = () => artifacts.find(artifact => artifact.id === state.selected);
const scoped = () => artifacts.filter(artifact => artifact.session === state.session || (state.children && sessions.find(session => session.id === artifact.session)?.parent === state.session));
const filtered = () => scoped().filter(artifact => (!state.pinned || artifact.pinned) && (state.kind === "all" || artifact.kind === state.kind) && `${artifact.title} ${artifact.file}`.toLowerCase().includes(state.search.toLowerCase()));
const action = (name,label,cls="ghost",data="",content="") => `<button type="button" class="${cls}" data-action="${name}" ${data}>${content}${label}</button>`;
const iconButton = (name,label,ico,data="") => `<button type="button" class="icon-button ghost" data-action="${name}" aria-label="${label}" title="${label}" ${data}>${icon(ico)}</button>`;
const types = [["all","All types"],["document","Documents"],["diagram","Diagrams"],["image","Images"],["table","Tables"],["file","Other files"]];
function searchField(){return `<label class="search">${icon("search")}<input id="search" type="search" aria-label="Search artifacts" placeholder="Find an artifact..." value="${escapeHtml(state.search)}"></label>`;}
function typeSelect(){return `<select id="type" aria-label="Artifact type">${types.map(([id,label])=>`<option value="${id}" ${state.kind===id?"selected":""}>${label}</option>`).join("")}</select>`;}
function topbar(){return `<header class="topbar">${iconButton("menu","Toggle sessions","menu","") .replace('class="icon-button ghost"','class="icon-button ghost mobile-menu"')}<div class="breadcrumb row">${icon("layers")}<span>Canvas <span class="muted">/</span> <strong>Artifacts</strong></span></div><span class="grow"></span><span class="demo-note">Interactive mock <span class="top-extra">/ Sample data only</span></span></header>`;}
function sidebar(){return `<aside class="sidebar ${state.mobileMenu?"mobile-open":""}">
    <div><div class="brand"><span class="mark">${icon("layers")}</span>Artifacts</div><div class="workspace-name">ghcp-canvas-apps</div></div>
    <nav class="nav-group" aria-label="Artifact views">${action("all",`${icon("folder")} All artifacts`, `nav-item ${!state.pinned?"active":""}`)}${action("pinned",`${icon("pin")} Pinned`, `nav-item ${state.pinned?"active":""}`)}</nav>
    <nav class="nav-group" aria-label="Sessions"><div class="nav-label"><span>Sessions</span>${icon("clock")}</div>
    ${sessions.map(session=>`<button class="nav-item ${session.parent?"child":""} ${state.session===session.id?"active":""}" data-action="session" data-id="${session.id}">${icon(session.parent?"chevron":"chat")}<span class="truncate">${escapeHtml(session.name)}</span></button>`).join("")}</nav>
    <div class="nav-group"><div class="nav-label">Collection</div>${action("documents",`${icon("folder")} Planning & decisions`,"nav-item")}</div>
    <div class="sidebar-foot"><div class="row">${icon("check")} Local preview</div><p>No live session data.<br>Changes reset on reload.</p></div></aside>`;}
function scopeHeader(){return `<div class="sheet-head">${icon("chat")}<h1 class="scope-title truncate">${escapeHtml(sessionName(state.session))}</h1><span class="tag">${scoped().length} artifacts</span><span class="grow"></span>${action("new","New note","primary","",icon("plus"))}</div>`;}
function artifactRow(artifact){return `<button class="artifact-row ${state.selected===artifact.id?"selected":""}" data-action="select" data-id="${artifact.id}">${icon(typeIcon(artifact))}<span class="grow"><span class="name">${escapeHtml(artifact.title)}</span><span class="meta">${artifact.missing?"File unavailable":`${escapeHtml(artifact.file.split(".").pop().toUpperCase())} &middot; v${artifact.version} &middot; ${artifact.time}`}</span></span>${artifact.pinned?icon("pin"):""}</button>`;}
function empty(message="Try a different search or file type."){return `<div class="empty">${icon("folder")}<h2>No artifacts here</h2><p>${message}</p>${action("reset","Reset filters")}</div>`;}
function artifactNav(){const list=filtered();return `<aside class="artifact-nav"><h2 class="mobile-list-title">Artifacts</h2>${searchField()}<div class="filter-row">${typeSelect()}</div><div class="collection-label">${state.pinned?"Pinned artifacts":"Session outputs"} <span class="num">${list.length}</span></div>${list.length?list.map(artifactRow).join(""):empty()}<div class="child-note"><label><input id="children" type="checkbox" ${state.children?"checked":""}> Include child sessions</label></div></aside>`;}
function toolbar(){const artifact=selected();return `<div class="reader-toolbar"><div class="row">${iconButton("back","Back to artifacts","back").replace('class="icon-button ghost"','class="icon-button ghost mobile-back"')}<nav class="tabs" aria-label="Artifact information">${["preview","activity","details"].map(tab=>action("tab",tab[0].toUpperCase()+tab.slice(1),state.tab===tab?"active":"",`data-tab="${tab}"`)).join("")}</nav></div><div class="tools">${artifact?iconButton("pin",artifact.pinned?"Unpin artifact":"Pin artifact","pin"):""}${artifact&&!artifact.missing?iconButton("download","Download sample artifact","download"):""}${artifact&&!artifact.missing?action("ask","Ask agent","ghost","",icon("chat")):""}</div></div>`;}
function diagram(){return `<div class="diagram"><div class="diagram-sources"><div class="diagram-node"><strong>Session outputs</strong><span>Known files & tool results</span></div><div class="diagram-node"><strong>Agent publication</strong><span>Explicit artifact registration</span></div></div><div class="diagram-arrow" aria-hidden="true">&#8595;</div><div class="diagram-node"><strong>Artifact catalog</strong><span>Identity &middot; source &middot; captured revisions</span></div><div class="diagram-arrow" aria-hidden="true">&#8595;</div><div class="diagram-node"><strong>Your canvas workspace</strong><span>Find, read, organize, and revisit</span></div></div>`;}
function related(id){const artifact=artifacts.find(item=>item.id===id);return `<button class="related-link" data-action="related" data-id="${id}">${icon(typeIcon(artifact))}${artifact.title}<span class="arrow">${icon("chevron")}</span></button>`;}
function briefContent(version){
    const intro=version===1?"Keep the documents and files an agent creates in one place, alongside the conversation.":version===2?"Give every session a shared space for its deliverables, with a record of where each output came from.":"An organized home for an agent's deliverables, with the context behind every artifact.";
    return `<p>${intro}</p><h2>Start with the work, not the chat</h2><p>A plan, a diagram, a decision. These are the things you come back for. They should be easy to find without retracing an entire conversation.</p><div class="callout"><strong>The question this workspace answers</strong><br>What did this session produce, and how did we get here?</div><h2>The first useful version</h2><ul><li><strong>A session-scoped library.</strong> Documents, images, diagrams, and linked files, organized together.</li><li><strong>Readable context.</strong> Keep the source session and relevant interaction beside the output.</li>${version>=2?"<li><strong>Reliable capture.</strong> Combine supported file discovery with explicit agent publication.</li>":""}${version>=3?"<li><strong>Honest history.</strong> Show captured revisions. Never imply that an overwritten draft can be recovered.</li>":""}</ul><h2>Related work</h2><div class="related-links">${related("architecture")}${related("checklist")}</div>${version>=3?'<h2>A clear boundary</h2><p>Start local. Leave original files untouched. A missing source should be visible, not silently replaced with an empty document.</p>':""}`;
}
function checklist(){const labels=["Map the existing canvas patterns","Define artifact identity and provenance","Build the session-scoped catalog","Connect an authorized agent handoff"];return `<p>Prove the smallest complete workflow before adding a rich document editor.</p><div class="checklist">${labels.map((label,index)=>`<label class="${state.checks[index]?"done":""}"><input type="checkbox" data-check="${index}" ${state.checks[index]?"checked":""}>${label}</label>`).join("")}</div><div class="callout">${state.checks.filter(Boolean).length} of ${labels.length} steps complete in this mock.</div><h2>Acceptance check</h2><p>Create a document, publish a second revision, and find both versions from the right session. Then remove the original and verify that its availability is clearly explained.</p>`;}
function content(artifact){
    if(artifact.id==="brief")return briefContent(state.revision||artifact.version);
    if(artifact.id==="architecture")return `<p>Two capture paths, one artifact identity. Discovery finds what is already available; publication gives new work a reliable history.</p>${diagram()}<h2>Keep the boundaries clear</h2><p>The catalog owns its metadata and snapshots. It reads the host's session metadata without changing it.</p><div class="related-links">${related("brief")}</div>`;
    if(artifact.id==="checklist")return checklist();
    if(artifact.kind==="image")return `<img class="preview-image" src="/reference.png" alt="Existing Screenshots canvas showing its session navigator and image gallery"><p class="image-caption">Reference: the existing Screenshots app in this repository. This is not a screenshot generated by the sample session.</p><h2>Patterns to carry forward</h2><p>Session hierarchy, clear source labels, and a preview that stays connected to the selected artifact.</p>`;
    if(artifact.id==="research-notes")return `<h2>Confirmed in the repository</h2><ul><li>Personal canvas registration with agent-callable actions.</li><li>Session-aware discovery of local image references.</li><li>Persistent records and optimistic edit checks.</li></ul><h2>Still an integration question</h2><p>A contextual action that sends selected text from a custom canvas into an existing agent session needs a supported host contract.</p><div class="callout">General SDK session hooks are not proof that a canvas extension can observe every app session.</div><h2>Evidence</h2><p>See the source-linked research document in this Copilot session. This mock uses condensed sample content, not live research results.</p>`;
    if(artifact.id==="decisions")return `<h2>Keep</h2><ul><li>Local-first access to the selected session.</li><li>Artifact identity independent of its current file path.</li><li>Explicit attribution and captured revisions.</li></ul><h2>Defer</h2><ul><li>Remote workspace retrieval.</li><li>A full block-based editor.</li><li>Unverified canvas-to-agent dispatch.</li></ul><div class="callout">Removing something from a collection must not delete the original file.</div>`;
    if(artifact.id==="inventory")return `<p>Proposed first-release coverage. These are design decisions, not connected capabilities.</p><table class="data-table"><thead><tr><th>Artifact</th><th>Preview</th><th>Capture</th></tr></thead><tbody>${[["Markdown","Document","Publication"],["Raster image","Image","Discovery"],["Diagram","Safe rendering","Publication"],["CSV","Table","Publication"],["PDF / Office","File entry","Reference"]].map(row=>`<tr>${row.map(cell=>`<td>${cell}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
    if(artifact.body)return `<p>${escapeHtml(artifact.body).replaceAll("\n","<br>")}</p>`;
    return `<h2>Preserve the working patterns</h2><p>Session navigation, filtering, and preview state should remain consistent when new outputs arrive.</p><h2>Next step</h2><p>Review this alongside the gallery reference and capture any decisions in the implementation session.</p>`;
}
function provenance(artifact){const revisions=artifact.revisions||[{v:artifact.version,time:artifact.time,label:"Captured sample revision"}];return `<aside class="provenance"><h3>Behind this artifact</h3><div class="key">Source session</div><div class="value">${escapeHtml(sessionName(artifact.session))}</div><div class="key">Captured by</div><div class="value row">${icon("layers")}${escapeHtml(artifact.origin)}</div><div class="key">Last captured</div><div class="value">Oct 20, ${artifact.time}</div><div class="revision-list">${revisions.map(revision=>`<button class="revision ${(state.revision||artifact.version)===revision.v?"active":""}" data-action="revision" data-version="${revision.v}"><span><strong>Version ${revision.v}${revision.v===artifact.version?" &middot; Latest":""}</strong><span class="muted">${revision.label}</span><span class="muted">${revision.time}</span></span></button>`).join("")}</div><div class="provenance-footer">Revisions shown here are sample snapshots, not recovered session history.</div></aside>`;}
function documentView(artifact){
    if(artifact.missing)return `<div class="document-layout"><article class="document"><div class="file-caption">${icon("file")}${artifact.file}</div><h2 class="document-title">${artifact.title}</h2><div class="empty">${icon("file")}<h3>The original is unavailable</h3><p>This sample demonstrates a retained reference without file contents. The artifact stays visible so its context is not lost.</p>${action("tab","View source details","", 'data-tab="details"')}</div></article>${provenance(artifact)}</div>`;
    return `<div class="document-layout"><article class="document"><div class="file-caption">${icon(typeIcon(artifact))}<span>${escapeHtml(artifact.file)}</span>${artifact.pinned?'<span class="row">'+icon("pin")+" Pinned</span>":""}</div>${state.revision&&state.revision<artifact.version?`<div class="version-notice">${icon("clock")}Viewing captured version ${state.revision}${action("latest","Back to latest","ghost")}</div>`:""}<h2 class="document-title">${escapeHtml(artifact.title==="Product brief"?"Session artifact workspace":artifact.title)}</h2><p class="lede">${escapeHtml(artifact.description)}</p><div class="byline"><span class="avatar">${icon("layers")}</span><span>Copilot</span><span>&middot;</span><span>Oct 20, ${(artifact.revisions?.find(revision=>revision.v===state.revision)?.time)||artifact.time}</span><span>&middot;</span><span>Version ${state.revision||artifact.version}</span></div><div class="prose" id="document-text">${content(artifact)}</div></article>${provenance(artifact)}</div>`;
}
function artifactHistory(artifact){const revisions=artifact.revisions||[{v:artifact.version,time:artifact.time,label:"Published to the artifact catalog"}];return `<section class="activity-panel"><h2 class="document-title">Artifact activity</h2><p class="muted small">Sample history for ${escapeHtml(artifact.title)}.</p>${revisions.map((revision,index)=>`<div class="timeline-group ${!index?"latest":""}"><div class="timeline-head"><strong>Copilot</strong><span class="muted">Oct 20 &middot; ${revision.time}</span></div><p>${revision.label}.</p><button class="change-card" data-action="revision" data-version="${revision.v}">${icon("file")}<span class="grow"><strong>${escapeHtml(artifact.file)}</strong><span>Captured version ${revision.v}</span></span>${icon("chevron")}</button></div>`).join("")}<p class="small muted">Only captured activity is shown. A file reference alone does not establish its complete history.</p></section>`;}
function details(artifact){return `<section class="activity-panel"><h2 class="document-title">Artifact details</h2><p class="muted small">The output and the evidence connecting it to a session.</p><dl class="detail-metadata">${[["File",artifact.file],["Artifact ID",`sample-${artifact.id}`],["Source session",sessionName(artifact.session)],["Capture method",artifact.origin],["Availability",artifact.missing?"Original unavailable":"Sample content available"],["Size",artifact.size],["Latest revision",`Version ${artifact.version}`],["Captured at",`Oct 20, 2026 at ${artifact.time}`],["Data source","In-memory prototype fixture"]].map(([key,value])=>`<dt>${key}</dt><dd>${escapeHtml(value)}</dd>`).join("")}</dl></section>`;}
function reader(){const artifact=selected();return `<section class="reader">${toolbar()}<div class="reader-content">${artifact?(state.tab==="preview"?documentView(artifact):state.tab==="activity"?artifactHistory(artifact):details(artifact)):empty("Choose a session with artifacts, or create a sample note.")}</div></section>`;}
function workspace(){return `${topbar()}<main class="frame">${sidebar()}<section class="sheet">${scopeHeader()}<div class="workspace ${state.mobileDetail?"mobile-detail":""}">${artifactNav()}${reader()}</div></section></main>`;}
function miniPreview(artifact){
    if(artifact.missing)return `<div class="missing-preview">${icon("file")}Original unavailable</div>`;
    if(artifact.kind==="image")return '<img src="/reference.png" alt="Screenshots app reference">';
    if(artifact.kind==="diagram")return diagram();
    if(artifact.kind==="table")return '<strong>Artifact type inventory</strong><div class="mini-lines"><span>Markdown &nbsp; Document &nbsp; Publication</span><span>Image &nbsp; Image preview &nbsp; Discovery</span><span>Diagram &nbsp; Safe rendering &nbsp; Publication</span></div>';
    return `<div class="mini-paper"><h3>${escapeHtml(artifact.title)}</h3><p>${escapeHtml(artifact.description)}</p><div class="mini-lines">${artifact.id==="checklist"?"<span>Map existing canvas patterns</span><span>Define artifact identity</span><span>Build the session catalog</span>":"<span>Keep the output beside its context.</span><span>Publish deliberately. Preserve revisions.</span><span>Leave original files untouched.</span>"}</div></div>`;
}
function library(){const list=filtered();return `${topbar()}<main class="library"><section class="sheet"><div class="library-inner"><div class="library-header"><div class="grow"><div class="file-caption">${icon("layers")}Artifacts / ${escapeHtml(sessionName(state.session))}</div><h1>Your session, in artifacts.</h1><p>${scoped().length} outputs${state.children?" including child sessions":""}. Every file keeps its context.</p></div>${action("new","New note","primary","",icon("plus"))}</div><div class="library-tools">${searchField()}<select id="session-select" aria-label="Select session">${sessions.map(session=>`<option value="${session.id}" ${state.session===session.id?"selected":""}>${session.name}</option>`).join("")}</select><span class="grow"></span><label class="small row"><input id="children" type="checkbox" ${state.children?"checked":""}> Include children</label></div><nav class="type-tabs" aria-label="File types">${types.map(([type,label])=>action("type",type==="all"?"All artifacts":label,state.kind===type?"active":"",`data-type="${type}"`)).join("")}</nav><div class="row small muted"><span class="grow">${list.length} ${state.pinned?"pinned ":""}artifacts</span><span>Latest captured first</span></div><div class="library-grid">${list.length?list.map(artifact=>`<button class="artifact-card" data-action="open-card" data-id="${artifact.id}"><div class="card-preview">${miniPreview(artifact)}</div><div class="card-info"><div class="row">${icon(typeIcon(artifact))}<strong class="truncate">${escapeHtml(artifact.title)}</strong></div><div class="meta"><span>${artifact.missing?"Unavailable":`Version ${artifact.version} &middot; ${artifact.time}`}</span><span>${artifact.session!==state.session?"Child session":artifact.file.split(".").pop().toUpperCase()}</span></div></div></button>`).join(""):empty()}</div></div></section></main>`;}
function activity(){const list=filtered();return `${topbar()}<main class="frame">${sidebar()}<section class="sheet">${scopeHeader()}<div class="activity-layout ${state.mobileDetail?"mobile-detail":""}"><section class="activity-feed"><div class="row"><h2 class="grow feed-title">The work, as it happened.</h2>${icon("clock")}</div><p class="small muted">Oct 20 &middot; ${list.length} artifact events &middot; Sample timeline</p><div class="filter-row">${searchField()}</div>${list.length?list.map((artifact,index)=>`<div class="timeline-group ${!index?"latest":""}"><div class="timeline-head"><span class="avatar">${icon("layers")}</span><strong>Copilot</strong><span class="muted">${artifact.time}</span></div><p>${artifact.id==="brief"?"Refined the product brief to separate captured revisions from best-effort discovery.":escapeHtml(artifact.description)}</p><button class="change-card" data-action="select" data-id="${artifact.id}">${icon(typeIcon(artifact))}<span class="grow"><strong>${escapeHtml(artifact.title)}</strong><span>${artifact.missing?"Reference retained":`Version ${artifact.version} &middot; ${sessionName(artifact.session)}`}</span></span>${artifact.id==="brief"?'<span class="change-count">Updated</span>':icon("chevron")}</button></div>`).join(""):empty()}</section><div class="activity-preview">${reader()}</div></div></section></main>`;}
function switcher(){document.querySelector("#switcher").innerHTML=`${iconButton("previous","Previous layout","back")}<span class="switch-label">Layout</span>${Object.entries(variantNames).map(([key,name])=>`<button class="variant ${state.variant===key?"active":""}" data-action="variant" data-variant="${key}" aria-pressed="${state.variant===key}">${key} &nbsp;${name}</button>`).join("")}<span class="separator"></span><span class="switch-label">Sample data</span>${iconButton("next","Next layout","chevron")}`;}
function render(){
    if(!scoped().some(artifact=>artifact.id===state.selected)){state.selected=scoped()[0]?.id||null;state.revision=null;}
    app.innerHTML=state.variant==="A"?workspace():state.variant==="B"?library():activity();switcher();
    document.title=`${variantNames[state.variant]} - Artifacts mock`;
    console.debug("Prototype state", {variant:state.variant,session:state.session,selected:state.selected,tab:state.tab,revision:state.revision,includeChildren:state.children,matching:filtered().length});
}
function toast(message){const element=document.querySelector("#toast");element.textContent=message;element.hidden=false;clearTimeout(toast.timer);toast.timer=setTimeout(()=>element.hidden=true,4000);}
function setVariant(key){state.variant=key;state.mobileDetail=false;state.mobileMenu=false;dialog.close();const url=new URL(location.href);url.searchParams.set("variant",key);historyApi.replaceState(null,"",url);render();}
const historyApi=window.history;
function openDialog(title,body,wide=false){dialog.className=wide?"preview-dialog":"";dialog.innerHTML=`<div class="dialog-header"><h2 class="grow">${title}</h2>${iconButton("close-dialog","Close dialog","close")}</div><div class="dialog-body">${body}</div>`;if(!dialog.open)dialog.showModal();}
function previewDialog(){dialog.className="preview-dialog";dialog.innerHTML=`<div class="dialog-header"><span class="grow small muted">Artifact preview / Sample data</span>${iconButton("close-dialog","Close preview","close")}</div>${reader()}`;if(!dialog.open)dialog.showModal();}
function selectArtifact(id){state.selected=id;state.tab="preview";state.revision=null;state.mobileDetail=true;state.selection="";render();}
function requestDialog(){const artifact=selected();const text=state.selection?`Selected passage:\n"${state.selection}"\n\n`:"";openDialog("Ask about this artifact",`<p>A preview of the proposed agent handoff. Nothing is sent from this mock.</p><label for="request">Request to Copilot</label><textarea id="request">For "${escapeHtml(artifact.title)}" (${escapeHtml(artifact.file)}), version ${state.revision||artifact.version}:\n\n${escapeHtml(text)}Review this artifact and suggest the next useful improvement.</textarea><div class="dialog-note">Target: ${escapeHtml(sessionName(artifact.session))}. Host integration is not connected.</div><div class="dialog-actions">${action("close-dialog","Cancel")}${action("copy-request","Copy request","primary")}</div>`);}
document.addEventListener("mouseup",()=>{const selection=window.getSelection();if(selection?.toString().trim()&&selection.anchorNode?.parentElement?.closest(".prose"))state.selection=selection.toString().trim();});
document.addEventListener("click",async event=>{
    const button=event.target.closest("[data-action]");if(!button)return;
    const act=button.dataset.action;
    if(act==="variant")return setVariant(button.dataset.variant);
    if(act==="previous"||act==="next"){const keys=Object.keys(variantNames);return setVariant(keys[(keys.indexOf(state.variant)+(act==="next"?1:2))%3]);}
    if(act==="close-dialog"){dialog.close();return;}
    if(act==="open-card"){selectArtifact(button.dataset.id);previewDialog();return;}
    if(act==="select"||act==="related"){const inDialog=dialog.open;selectArtifact(button.dataset.id);if(inDialog)previewDialog();return;}
    if(act==="session"){state.session=button.dataset.id;state.selected=null;state.mobileDetail=false;state.mobileMenu=false;state.search="";state.kind="all";state.pinned=false;state.revision=null;state.tab="preview";}
    if(act==="all"){state.pinned=false;state.kind="all";state.search="";state.mobileMenu=false;}
    if(act==="pinned"){state.pinned=true;state.mobileMenu=false;}
    if(act==="documents"){state.kind="document";state.pinned=false;state.mobileMenu=false;}
    if(act==="back"){state.mobileDetail=false;}
    if(act==="menu"){state.mobileMenu=!state.mobileMenu;}
    if(act==="tab"){state.tab=button.dataset.tab;}
    if(act==="type"){state.kind=button.dataset.type;}
    if(act==="revision"){state.revision=Number(button.dataset.version);state.tab="preview";}
    if(act==="latest"){state.revision=null;}
    if(act==="reset"){state.search="";state.kind="all";state.pinned=false;}
    if(act==="pin"){const artifact=selected();artifact.pinned=!artifact.pinned;toast(artifact.pinned?"Pinned in this mock.":"Removed from pinned artifacts.");}
    if(act==="ask"){requestDialog();return;}
    if(act==="copy-request"){try{await navigator.clipboard.writeText(document.querySelector("#request").value);toast("Request copied. Nothing was sent to an agent.");dialog.close();}catch{toast("Clipboard unavailable. Select and copy the request text manually.");}return;}
    if(act==="new"){openDialog("New sample note",`<p>This note only exists in this preview. Reloading clears it.</p><form id="note-form"><label for="note-title">Title</label><input id="note-title" required maxlength="100" placeholder="A decision worth keeping"><label for="note-body">Note</label><textarea id="note-body" required placeholder="Capture the context, not just the outcome."></textarea><div class="dialog-actions">${action("close-dialog","Cancel")}<button class="primary" type="submit">Create sample note</button></div></form>`);return;}
    if(act==="download"){
        const artifact=selected();
        if(artifact.kind==="image"){const link=document.createElement("a");link.href="/reference.png";link.download=artifact.file;link.click();return;}
        let text,filename=artifact.file;
        if(artifact.kind==="table"){text="Artifact,Preview,Capture\nMarkdown,Document,Publication\nRaster image,Image,Discovery\nDiagram,Safe rendering,Publication\nCSV,Table,Publication\nPDF / Office,File entry,Reference\n";}
        else{const holder=document.createElement("div");holder.innerHTML=content(artifact);text=`SAMPLE PROTOTYPE CONTENT\n${artifact.title}\nVersion ${state.revision||artifact.version}\n\n${holder.innerText||holder.textContent}`;filename=artifact.file.replace(/\.[^.]+$/,".txt");}
        const url=URL.createObjectURL(new Blob([text],{type:"text/plain"}));const link=document.createElement("a");link.href=url;link.download=filename;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);toast("Downloaded sample content.");return;
    }
    const keepDialog=dialog.open&&dialog.classList.contains("preview-dialog");render();if(keepDialog)previewDialog();
});
document.addEventListener("input",event=>{
    if(event.target.id!=="search")return;
    const start=event.target.selectionStart;state.search=event.target.value;render();const input=document.querySelector("#search");input.focus();input.setSelectionRange(start,start);
});
document.addEventListener("change",event=>{
    if(event.target.id==="type")state.kind=event.target.value;
    else if(event.target.id==="children"){state.children=event.target.checked;state.revision=null;}
    else if(event.target.id==="session-select"){state.session=event.target.value;state.selected=null;state.revision=null;state.tab="preview";}
    else if(event.target.matches("[data-check]"))state.checks[Number(event.target.dataset.check)]=event.target.checked;
    else return;
    const keepDialog=dialog.open&&dialog.classList.contains("preview-dialog");render();if(keepDialog)previewDialog();
});
document.addEventListener("submit",event=>{
    if(event.target.id!=="note-form")return;event.preventDefault();
    const title=document.querySelector("#note-title").value.trim(),body=document.querySelector("#note-body").value.trim();
    if(!title||!body){toast("Add a title and note content.");return;}
    const id=`note-${artifacts.length}`;artifacts.unshift({id,title,body,file:"sample-note.md",kind:"document",session:state.session,time:"09:45",description:"Your note, saved in this mock only.",version:1,size:"Sample text",origin:"User note"});dialog.close();state.search="";state.kind="all";state.pinned=false;selectArtifact(id);if(state.variant==="B")previewDialog();toast("Sample note created. It will reset on reload.");
});
document.addEventListener("keydown",event=>{
    if(dialog.open||event.target.closest("input,textarea,select,[contenteditable],button"))return;
    if(event.key==="ArrowRight"||event.key==="ArrowLeft"){event.preventDefault();const keys=Object.keys(variantNames);setVariant(keys[(keys.indexOf(state.variant)+(event.key==="ArrowRight"?1:2))%3]);}
});
window.addEventListener("popstate",()=>{const variant=new URLSearchParams(location.search).get("variant");state.variant=variantNames[variant]?variant:"A";render();});
console.assert(artifacts.filter(artifact=>artifact.session==="workspace").length===6,"Sample root artifact count");
console.assert(artifacts.filter(artifact=>["workspace","research","design"].includes(artifact.session)).length===8,"Sample child scope count");
render();
