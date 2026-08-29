const STORAGE_KEY='canalWatchScheduleClickAssignmentsV1';

const seed={
rounds:[
{id:'r1',name:'September survey round',date:'2026-09-12',status:'planned',recurrence:'fortnightly',interval:1,autoRepeat:true,siteIds:['s1','s2']},
{id:'r2',name:'Late September survey round',date:'2026-09-26',status:'planned',recurrence:'none',interval:1,autoRepeat:false,siteIds:['s1']}],
sites:[
{id:'s1',name:"Queen's Park Canalside",active:true,address:'',latitude:'',longitude:'',threeWords:''},
{id:'s2',name:"Ha'Penny Steps",active:true,address:'',latitude:'',longitude:'',threeWords:''},
{id:'s3',name:'Ladbroke Grove Bridge',active:true,address:'',latitude:'',longitude:'',threeWords:''},
{id:'s4',name:'Meanwhile Gardens',active:true,address:'',latitude:'',longitude:'',threeWords:''}],
users:[
{id:'u1',name:'Volunteer A',email:'volunteer.a@example.org',active:true},
{id:'u2',name:'Volunteer B',email:'volunteer.b@example.org',active:true},
{id:'u3',name:'Volunteer C',email:'volunteer.c@example.org',active:true},
{id:'u4',name:'Volunteer D',email:'volunteer.d@example.org',active:true}],
teams:[
{id:'t1',name:"Queen's Park Team",coordinatorId:'u1',memberIds:['u1','u2'],active:true},
{id:'t2',name:'Canal West Team',coordinatorId:'u3',memberIds:['u3','u4'],active:true}],
assignments:[
{id:'a1',roundId:'r1',siteId:'s1',teamIds:['t1'],userIds:[],status:'covered'},
{id:'a2',roundId:'r1',siteId:'s2',teamIds:[],userIds:['u2'],status:'covered'},
{id:'a3',roundId:'r1',siteId:'s3',teamIds:[],userIds:[],status:'needed'},
{id:'a4',roundId:'r1',siteId:'s4',teamIds:['t2'],userIds:['u3'],status:'covered'},
{id:'a5',roundId:'r2',siteId:'s1',teamIds:[],userIds:[],status:'needed'},
{id:'a6',roundId:'r2',siteId:'s2',teamIds:['t1'],userIds:[],status:'covered'}]};

function loadData(){const s=localStorage.getItem(STORAGE_KEY);return s?JSON.parse(s):structuredClone(seed)}
function saveData(){localStorage.setItem(STORAGE_KEY,JSON.stringify(data))}
let data=loadData();

const byId=(arr,id)=>arr.find(x=>x.id===id);
const siteName=id=>byId(data.sites,id)?.name||'Unknown site';
const userName=id=>byId(data.users,id)?.name||'Unknown user';
const teamName=id=>byId(data.teams,id)?.name||'Unknown team';
const roundName=id=>byId(data.rounds,id)?.name||'Unknown round';
const fmtDate=v=>new Date(v+'T12:00:00').toLocaleDateString('en-GB',{day:'numeric',month:'long',year:'numeric'});
const newid=p=>p+Math.random().toString(36).slice(2,9);

function recurrenceLabel(r){
 const map={none:'One-off',weekly:'Weekly',fortnightly:'Fortnightly',monthly:'Monthly',custom_days:'Every N days'};
 const base=map[r.recurrence||'none']||'One-off';
 if(r.recurrence==='custom_days') return `Every ${r.interval||1} days`;
 return base;
}

function addDays(dateStr,days){
 const [y,m,d]=dateStr.split('-').map(Number);
 const dt=new Date(Date.UTC(y,m-1,d));
 dt.setUTCDate(dt.getUTCDate()+days);
 return dt.toISOString().slice(0,10);
}

function addMonths(dateStr,months){
 const [y,m,d]=dateStr.split('-').map(Number);
 const dt=new Date(Date.UTC(y,m-1,d));
 const targetMonth=dt.getUTCMonth()+months;
 const day=dt.getUTCDate();
 dt.setUTCDate(1);
 dt.setUTCMonth(targetMonth);
 const last=new Date(Date.UTC(dt.getUTCFullYear(),dt.getUTCMonth()+1,0)).getUTCDate();
 dt.setUTCDate(Math.min(day,last));
 return dt.toISOString().slice(0,10);
}

function nextOccurrence(r){
 const rec=r.recurrence||'none';
 if(rec==='weekly') return addDays(r.date,7*(r.interval||1));
 if(rec==='fortnightly') return addDays(r.date,14*(r.interval||1));
 if(rec==='monthly') return addMonths(r.date,r.interval||1);
 if(rec==='custom_days') return addDays(r.date,Math.max(1,Number(r.interval)||1));
 return null;
}

function rollForwardRecurringRounds(){
 const today=new Date().toISOString().slice(0,10);
 const additions=[];
 data.rounds.forEach(r=>{
   if(!r.autoRepeat || !r.date || r.date>=today) return;
   let next=nextOccurrence(r);
   if(!next) return;

   let guard=0;
   while(next<today && guard<60){
     const temp={...r,date:next};
     next=nextOccurrence(temp);
     guard++;
   }

   const exists=data.rounds.some(x=>x.parentRoundId===r.id && x.date===next);
   if(!exists){
     additions.push({
       id:newid('r'),
       name:r.name,
       date:next,
       status:'planned',
       recurrence:r.recurrence,
       interval:r.interval||1,
       autoRepeat:r.autoRepeat,
       parentRoundId:r.id,
       siteIds:[...(r.siteIds||[])]
     });
   }
 });
 if(additions.length){
   data.rounds.push(...additions);
   saveData();
 }
}

function assignmentNames(a){
 const teamNames=(a.teamIds||[]).map(teamName);
 const userNames=(a.userIds||[]).map(userName);
 return [...teamNames,...userNames];
}
function isCovered(a){return assignmentNames(a).length>0 || a.status==='complete'}

function renderPublic(){
 const body=document.getElementById('scheduleBody'); if(!body)return;
 const f=document.getElementById('roundFilter');
 const today=new Date().toISOString().slice(0,10);

 const rounds=data.rounds
   .filter(r=>r.status!=='inactive' && r.date>=today)
   .sort((a,b)=>a.date.localeCompare(b.date));

 f.innerHTML=
   `<option value="all">All upcoming surveys</option>`+
   rounds.map(r=>`<option value="${r.id}">${r.name} — ${fmtDate(r.date)}</option>`).join('');

 f.addEventListener('change',()=>{
   if(f.value==='all') renderAllUpcoming();
   else renderRound(f.value);
 });

 renderAllUpcoming();
}

function renderAllUpcoming(){
 const today=new Date().toISOString().slice(0,10);
 const rounds=data.rounds
   .filter(r=>r.status!=='inactive' && r.date>=today)
   .sort((a,b)=>a.date.localeCompare(b.date));

 const rows=[];
 let totalSites=0, covered=0, uncovered=0;

 rounds.forEach(r=>{
   const roundSiteIds=(r.siteIds&&r.siteIds.length)
     ? r.siteIds
     : data.assignments.filter(a=>a.roundId===r.id).map(a=>a.siteId);

   const as=roundSiteIds.map(siteId=>{
     return data.assignments.find(a=>a.roundId===r.id&&a.siteId===siteId) ||
       {id:null,roundId:r.id,siteId,teamIds:[],userIds:[],status:'needed'};
   });

   totalSites+=as.length;
   covered+=as.filter(isCovered).length;
   uncovered+=as.filter(a=>!isCovered(a)).length;

   as.forEach(a=>{
     const names=assignmentNames(a);
     const cls=a.status==='complete'?'complete':names.length?'covered':'needed';
     const label=a.status==='complete'?'Completed':names.length?'Covered':'Assignment needed';
     const assigned=names.length?names.map(n=>`<span class="pill">${n}</span>`).join(''):'—';

     rows.push(`
       <tr>
         <td><strong>${siteName(a.siteId)}</strong><br><small>${r.name}</small></td>
         <td>${fmtDate(r.date)}</td>
         <td>${assigned}</td>
         <td><span class="status ${cls}">${label}</span></td>
       </tr>
     `);
   });
 });

 document.getElementById('scheduleBody').innerHTML=
   rows.join('') || '<tr><td colspan="4">No upcoming surveys scheduled.</td></tr>';

 document.getElementById('nextSurvey').textContent=
   rounds.length ? fmtDate(rounds[0].date) : '—';
 document.getElementById('siteCount').textContent=totalSites;
 document.getElementById('coveredCount').textContent=covered;
 document.getElementById('uncoveredCount').textContent=uncovered;
}

function renderRound(roundId){
 const r=byId(data.rounds,roundId); if(!r)return;
 const roundSiteIds=(r.siteIds&&r.siteIds.length)?r.siteIds:data.assignments.filter(a=>a.roundId===roundId).map(a=>a.siteId);
 const as=roundSiteIds.map(siteId=>{
   return data.assignments.find(a=>a.roundId===roundId&&a.siteId===siteId) ||
     {id:null,roundId,siteId,teamIds:[],userIds:[],status:'needed'};
 });

 document.getElementById('scheduleBody').innerHTML=as.map(a=>{
  const names=assignmentNames(a);
  const cls=a.status==='complete'?'complete':names.length?'covered':'needed';
  const label=a.status==='complete'?'Completed':names.length?'Covered':'Assignment needed';
  const assigned=names.length?names.map(n=>`<span class="pill">${n}</span>`).join(''):'—';
  return `<tr><td>${siteName(a.siteId)}</td><td>${fmtDate(r.date)}</td><td>${assigned}</td><td><span class="status ${cls}">${label}</span></td></tr>`;
 }).join('')||'<tr><td colspan="4">No sites scheduled yet.</td></tr>';

 document.getElementById('nextSurvey').textContent=fmtDate(r.date);
 document.getElementById('siteCount').textContent=as.length;
 document.getElementById('coveredCount').textContent=as.filter(isCovered).length;
 document.getElementById('uncoveredCount').textContent=as.filter(a=>!isCovered(a)).length;
}

function setupTabs(){document.querySelectorAll('.tab').forEach(btn=>btn.addEventListener('click',()=>{document.querySelectorAll('.tab,.admin-section').forEach(x=>x.classList.remove('active'));btn.classList.add('active');document.getElementById(btn.dataset.tab).classList.add('active')}))}

function record(title,meta,status,editId,toggleId,isDelete=false){
 return `<div class="record"><div><strong>${title}</strong><br><small>${meta}</small></div><div>${status}</div><div></div><div class="record-actions"><button class="secondary edit-record" data-id="${editId}">Edit</button><button class="${isDelete?'danger':'secondary'} toggle-record" data-id="${toggleId}">${isDelete?'Delete':'Active / inactive'}</button></div></div>`;
}

function renderAdmin(){
 if(!document.getElementById('roundList'))return;
 document.getElementById('roundList').innerHTML=data.rounds.map(r=>record(r.name,`${fmtDate(r.date)} • ${recurrenceLabel(r)}${r.autoRepeat?' • Auto-repeat':''}`,r.status,'round:'+r.id,'round:'+r.id)).join('');
 document.getElementById('siteList').innerHTML=data.sites.map(s=>{
 const bits=[];
 if(s.address) bits.push(s.address);
 if(s.latitude!=='' && s.longitude!=='') bits.push(`${s.latitude}, ${s.longitude}`);
 if(s.threeWords) bits.push(`///${s.threeWords.replace(/^\/+/, '')}`);
 return record(s.name,bits.length?bits.join(' • '):'Sampling site • No location details',s.active?'Active':'Inactive','site:'+s.id,'site:'+s.id);
}).join('');
 document.getElementById('userList').innerHTML=data.users.map(u=>record(
 u.name,
 u.email ? `Volunteer • ${u.email}` : 'Volunteer • No email address',
 u.active?'Active':'Inactive',
 'user:'+u.id,
 'user:'+u.id
)).join('');
 document.getElementById('teamList').innerHTML=data.teams.map(t=>{
   const members=t.memberIds.map(id=>`<span class="pill">${userName(id)}</span>`).join('')||'No members';
   return `<div class="record"><div><strong>${t.name}</strong><br><small>Coordinator: ${userName(t.coordinatorId)}</small><div class="assignment-summary">${members}</div></div><div>${t.memberIds.length} member${t.memberIds.length===1?'':'s'}</div><div>${t.active?'Active':'Inactive'}</div><div class="record-actions"><button class="secondary team-edit" data-id="${t.id}">Edit</button><button class="secondary team-members" data-id="${t.id}">Members</button><button class="secondary team-toggle" data-id="${t.id}">Active / inactive</button></div></div>`;
 }).join('');
 document.getElementById('assignmentList').innerHTML=data.assignments.map(a=>{
   const names=assignmentNames(a);
   const chips=names.length?names.map(n=>`<span class="pill">${n}</span>`).join(''):'No assignment';
   return `<div class="record"><div><strong>${roundName(a.roundId)} — ${siteName(a.siteId)}</strong><div class="assignment-summary">${chips}</div></div><div>${isCovered(a)?'Covered':'Needed'}</div><div></div><div class="record-actions"><button class="secondary assignment-edit" data-id="${a.id}">Edit assignment</button><button class="danger assignment-delete" data-id="${a.id}">Delete</button></div></div>`;
 }).join('');
 bindAdminEvents();
}

function bindAdminEvents(){
 document.querySelectorAll('.edit-record').forEach(b=>b.onclick=()=>editSimple(b.dataset.id));
 document.querySelectorAll('.toggle-record').forEach(b=>b.onclick=()=>toggleSimple(b.dataset.id));
 document.querySelectorAll('.team-edit').forEach(b=>b.onclick=()=>editTeam(b.dataset.id));
 document.querySelectorAll('.team-members').forEach(b=>b.onclick=()=>openMemberPicker(b.dataset.id));
 document.querySelectorAll('.team-toggle').forEach(b=>b.onclick=()=>toggleTeam(b.dataset.id));
 document.querySelectorAll('.assignment-edit').forEach(b=>b.onclick=()=>openAssignmentPicker(b.dataset.id));
 document.querySelectorAll('.assignment-delete').forEach(b=>b.onclick=()=>deleteAssignment(b.dataset.id));
}

function editSimple(token){
 const [type,id]=token.split(':');
 if(type==='round'){openRoundEditor(id);return}
 if(type==='site'){openSiteEditor(id);return}
 if(type==='user'){
 const u=byId(data.users,id);
 const n=prompt('Volunteer name:',u.name);
 if(!n)return;
 const e=prompt('Email address (optional):',u.email||'');
 if(e===null)return;
 u.name=n;
 u.email=e.trim();
}
 saveData();renderAdmin()
}
function toggleSimple(token){
 const [type,id]=token.split(':');
 if(type==='round'){const r=byId(data.rounds,id);r.status=r.status==='inactive'?'planned':'inactive'}
 if(type==='site'){const s=byId(data.sites,id);s.active=!s.active}
 if(type==='user'){const u=byId(data.users,id);u.active=!u.active}
 saveData();renderAdmin()
}
function editTeam(id){openTeamEditor(id)}
function toggleTeam(id){const t=byId(data.teams,id);t.active=!t.active;saveData();renderAdmin()}
function deleteAssignment(id){if(confirm('Delete this site assignment?')){data.assignments=data.assignments.filter(a=>a.id!==id);saveData();renderAdmin()}}

function addRound(){
 const r={id:newid('r'),name:'New survey round',date:new Date().toISOString().slice(0,10),status:'planned',recurrence:'none',interval:1,autoRepeat:false,siteIds:[]};
 data.rounds.push(r);
 saveData();
 renderAdmin();
 openRoundEditor(r.id);
}

function openRoundEditor(roundId){
 const r=byId(data.rounds,roundId);
 const activeSites=data.sites.filter(s=>s.active);
 const selectedSites=r.siteIds||[];

 openModal('Survey round',`
   <div class="form-grid">
     <label class="field">Round name
       <input id="roundNameInput" value="${r.name.replace(/"/g,'&quot;')}">
     </label>
     <label class="field">Survey date
       <input id="roundDateInput" type="date" value="${r.date}">
     </label>
   </div>

   <div class="picker-section">
     <h3>Survey sites</h3>
     <p>Click one or more sites to include in this survey round.</p>
     <div class="choice-grid">
       ${activeSites.map(s=>`
         <button type="button"
                 class="choice ${selectedSites.includes(s.id)?'selected':''}"
                 data-round-site="${s.id}">
           ${s.name}
           <small>Sampling site</small>
         </button>
       `).join('')}
     </div>
   </div>

   <div class="recurrence-box">
     <label class="field">Recurrence
       <select id="roundRecurrence">
         <option value="none" ${r.recurrence==='none'?'selected':''}>One-off</option>
         <option value="weekly" ${r.recurrence==='weekly'?'selected':''}>Weekly</option>
         <option value="fortnightly" ${r.recurrence==='fortnightly'?'selected':''}>Fortnightly</option>
         <option value="monthly" ${r.recurrence==='monthly'?'selected':''}>Monthly</option>
         <option value="custom_days" ${r.recurrence==='custom_days'?'selected':''}>Every N days</option>
       </select>
     </label>

     <label class="field" id="roundIntervalWrap">Repeat interval
       <input id="roundIntervalInput" type="number" min="1" max="365" value="${r.interval||1}">
       <span class="help-text" id="roundIntervalHelp"></span>
     </label>

     <label class="inline-check">
       <input id="roundAutoRepeat" type="checkbox" ${r.autoRepeat?'checked':''}>
       <span>Automatically create the next survey round after this survey date has passed.</span>
     </label>
     <p class="help-text">The selected survey sites are copied into each automatically repeated round.</p>
   </div>
 `,()=>{
   const name=document.getElementById('roundNameInput').value.trim();
   const date=document.getElementById('roundDateInput').value;
   const recurrence=document.getElementById('roundRecurrence').value;
   const interval=Math.max(1,Number(document.getElementById('roundIntervalInput').value)||1);
   const autoRepeat=document.getElementById('roundAutoRepeat').checked && recurrence!=='none';
   const siteIds=[...document.querySelectorAll('[data-round-site].selected')].map(b=>b.dataset.roundSite);

   if(!name){alert('Please enter a round name.');return}
   if(!date){alert('Please choose a survey date.');return}
   if(!siteIds.length){alert('Please select at least one survey site.');return}

   r.name=name;
   r.date=date;
   r.recurrence=recurrence;
   r.interval=interval;
   r.autoRepeat=autoRepeat;
   r.siteIds=siteIds;

   // Ensure each selected site has an assignment record for this round.
   siteIds.forEach(siteId=>{
     if(!data.assignments.some(a=>a.roundId===r.id && a.siteId===siteId)){
       data.assignments.push({
         id:newid('a'),
         roundId:r.id,
         siteId,
         teamIds:[],
         userIds:[],
         status:'needed'
       });
     }
   });

   // Remove empty/unassigned records for sites no longer part of the round.
   data.assignments=data.assignments.filter(a=>{
     if(a.roundId!==r.id) return true;
     if(siteIds.includes(a.siteId)) return true;
     const hasAssignments=(a.teamIds||[]).length || (a.userIds||[]).length || a.status==='complete';
     return hasAssignments;
   });

   saveData();
   renderAdmin();
   closeModal();
 });

 document.querySelectorAll('[data-round-site]').forEach(btn=>{
   btn.addEventListener('click',()=>btn.classList.toggle('selected'));
 });

 const rec=document.getElementById('roundRecurrence');
 const interval=document.getElementById('roundIntervalInput');
 const help=document.getElementById('roundIntervalHelp');
 function updateRecurrenceUI(){
   const val=rec.value;
   interval.disabled=val==='none';
   if(val==='weekly') help.textContent='1 = every week, 2 = every 2 weeks.';
   else if(val==='fortnightly') help.textContent='1 = every 2 weeks, 2 = every 4 weeks.';
   else if(val==='monthly') help.textContent='1 = every month, 2 = every 2 months.';
   else if(val==='custom_days') help.textContent='Enter the number of days between surveys.';
   else help.textContent='No recurrence.';
 }
 rec.addEventListener('change',updateRecurrenceUI);
 updateRecurrenceUI();
}

function addSite(){
 const s={id:newid('s'),name:'New survey site',active:true,address:'',latitude:'',longitude:'',threeWords:''};
 data.sites.push(s);
 saveData();
 renderAdmin();
 openSiteEditor(s.id);
}

function openSiteEditor(siteId){
 const s=byId(data.sites,siteId);

 openModal('Survey site',`
   <div class="form-grid">
     <label class="field">Site name
       <input id="siteNameInput" value="${(s.name||'').replace(/"/g,'&quot;')}">
     </label>
     <label class="field">Address
       <input id="siteAddressInput" value="${(s.address||'').replace(/"/g,'&quot;')}" placeholder="Street, area or landmark">
     </label>
   </div>

   <div class="form-grid" style="margin-top:14px">
     <label class="field">GPS latitude
       <input id="siteLatitudeInput" inputmode="decimal" value="${s.latitude??''}" placeholder="e.g. 51.525123">
     </label>
     <label class="field">GPS longitude
       <input id="siteLongitudeInput" inputmode="decimal" value="${s.longitude??''}" placeholder="e.g. -0.205456">
     </label>
   </div>

   <div class="picker-section">
     <label class="field">Three-word location
       <input id="siteThreeWordsInput" value="${(s.threeWords||'').replace(/"/g,'&quot;')}" placeholder="e.g. word.word.word">
       <span class="help-text">Enter the three words only, or with /// at the start.</span>
     </label>
   </div>

   <p class="help-text">Address, GPS coordinates and three-word location are all optional. Use whichever details you have.</p>
 `,()=>{
   const name=document.getElementById('siteNameInput').value.trim();
   const address=document.getElementById('siteAddressInput').value.trim();
   const latRaw=document.getElementById('siteLatitudeInput').value.trim();
   const lonRaw=document.getElementById('siteLongitudeInput').value.trim();
   const threeWords=document.getElementById('siteThreeWordsInput').value.trim().replace(/^\/+/,'');

   if(!name){alert('Please enter a site name.');return}

   if((latRaw && !lonRaw) || (!latRaw && lonRaw)){
     alert('Please enter both latitude and longitude, or leave both blank.');
     return;
   }

   if(latRaw && lonRaw){
     const lat=Number(latRaw), lon=Number(lonRaw);
     if(!Number.isFinite(lat) || lat < -90 || lat > 90){
       alert('Latitude must be between -90 and 90.');
       return;
     }
     if(!Number.isFinite(lon) || lon < -180 || lon > 180){
       alert('Longitude must be between -180 and 180.');
       return;
     }
   }

   if(threeWords && threeWords.split('.').length!==3){
     alert('The three-word location should contain three words separated by full stops.');
     return;
   }

   s.name=name;
   s.address=address;
   s.latitude=latRaw;
   s.longitude=lonRaw;
   s.threeWords=threeWords;

   saveData();
   renderAdmin();
   closeModal();
 });
}

function addUser(){
 const n=prompt('Volunteer name:');
 if(!n)return;
 const e=prompt('Email address (optional):')||'';
 data.users.push({id:newid('u'),name:n,email:e,active:true});
 saveData();
 renderAdmin();
}
function addTeam(){
 const n=prompt('Project team name:');if(!n)return;
 const firstActive=data.users.find(u=>u.active);
 data.teams.push({id:newid('t'),name:n,coordinatorId:firstActive?.id||null,memberIds:firstActive?[firstActive.id]:[],active:true});
 saveData();renderAdmin();
 const team=data.teams[data.teams.length-1];
 openTeamEditor(team.id);
}
function addAssignment(){
 const activeRounds=data.rounds.filter(r=>r.status!=='inactive');
 const activeSites=data.sites.filter(s=>s.active);
 const r=activeRounds[0],s=activeSites.find(site=>!data.assignments.some(a=>a.roundId===r?.id&&a.siteId===site.id))||activeSites[0];
 if(!r||!s){alert('Add at least one active survey round and site first.');return}
 const a={id:newid('a'),roundId:r.id,siteId:s.id,teamIds:[],userIds:[],status:'needed'};
 data.assignments.push(a);saveData();renderAdmin();openAssignmentPicker(a.id)
}

let modalSaveHandler=null;
function openModal(title,body,saveHandler){
 document.getElementById('modalTitle').textContent=title;
 document.getElementById('modalBody').innerHTML=body;
 document.getElementById('modalBackdrop').classList.remove('hidden');
 modalSaveHandler=saveHandler;
}
function closeModal(){document.getElementById('modalBackdrop').classList.add('hidden');modalSaveHandler=null}

function pickerButtons(items,selected,type){
 return items.map(item=>`<button type="button" class="choice ${selected.includes(item.id)?'selected':''}" data-picker="${type}" data-id="${item.id}">${item.name}<small>${type==='user'?'Volunteer':'Project team'}</small></button>`).join('');
}
function bindPickerButtons(){
 document.querySelectorAll('.choice').forEach(btn=>btn.addEventListener('click',()=>btn.classList.toggle('selected')))
}

function openMemberPicker(teamId){openTeamEditor(teamId)}

function openTeamEditor(teamId){
 const t=byId(data.teams,teamId);
 const users=data.users.filter(u=>u.active);
 const memberIds=t.memberIds||[];

 openModal(`Project team — ${t.name}`,`
   <label class="field">Team name
     <input id="teamNameInput" value="${t.name.replace(/"/g,'&quot;')}">
   </label>

   <div class="picker-section">
     <h3>Team members and coordinator</h3>
     <p>Click volunteers to add them to the team. Then choose one selected member as coordinator.</p>

     <div class="team-person-grid">
       ${users.map(u=>{
         const isMember=memberIds.includes(u.id);
         const isCoordinator=t.coordinatorId===u.id;
         return `
           <div class="team-person ${isMember?'selected-member':''}" data-person-card="${u.id}">
             <button type="button"
                     class="member-toggle ${isMember?'selected':''}"
                     data-member-toggle="${u.id}"
                     aria-pressed="${isMember?'true':'false'}">
               <span class="person-name">${u.name}</span>
               <span class="person-state">${isMember?'Team member':'Add to team'}</span>
             </button>

             <label class="coordinator-choice ${isMember?'':'disabled'}">
               <input type="radio"
                      name="teamCoordinator"
                      value="${u.id}"
                      ${isCoordinator?'checked':''}
                      ${isMember?'':'disabled'}>
               Coordinator
             </label>
           </div>
         `;
       }).join('')}
     </div>
   </div>
 `,()=>{
   const name=document.getElementById('teamNameInput').value.trim();
   if(!name){alert('Please enter a team name.');return}

   const selectedMembers=[...document.querySelectorAll('[data-member-toggle].selected')]
     .map(b=>b.dataset.memberToggle);

   if(!selectedMembers.length){
     alert('Please select at least one team member.');
     return;
   }

   const coordinatorInput=document.querySelector('input[name="teamCoordinator"]:checked');
   if(!coordinatorInput){
     alert('Please choose a coordinator from the selected team members.');
     return;
   }

   const coordinatorId=coordinatorInput.value;
   if(!selectedMembers.includes(coordinatorId)){
     alert('The coordinator must be one of the selected team members.');
     return;
   }

   t.name=name;
   t.memberIds=selectedMembers;
   t.coordinatorId=coordinatorId;
   saveData();
   renderAdmin();
   closeModal();
 });

 document.querySelectorAll('[data-member-toggle]').forEach(btn=>{
   btn.addEventListener('click',()=>{
     const id=btn.dataset.memberToggle;
     const card=document.querySelector(`[data-person-card="${id}"]`);
     const radio=card.querySelector('input[name="teamCoordinator"]');
     const label=card.querySelector('.coordinator-choice');
     const state=card.querySelector('.person-state');

     const selected=btn.classList.toggle('selected');
     btn.setAttribute('aria-pressed',selected?'true':'false');
     card.classList.toggle('selected-member',selected);
     radio.disabled=!selected;
     label.classList.toggle('disabled',!selected);
     state.textContent=selected?'Team member':'Add to team';

     if(!selected && radio.checked){
       radio.checked=false;
     }
   });
 });
}

function openAssignmentPicker(assignmentId){
 const a=byId(data.assignments,assignmentId);
 const rounds=data.rounds.filter(r=>r.status!=='inactive');
 const sites=data.sites.filter(s=>s.active);
 const teams=data.teams.filter(t=>t.active);
 const users=data.users.filter(u=>u.active);
 openModal('Edit site assignment',`
   <div class="form-grid">
     <label class="field">Survey round<select id="assignmentRound">${rounds.map(r=>`<option value="${r.id}" ${r.id===a.roundId?'selected':''}>${r.name} — ${fmtDate(r.date)}</option>`).join('')}</select></label>
     <label class="field">Survey site<select id="assignmentSite">${sites.map(s=>`<option value="${s.id}" ${s.id===a.siteId?'selected':''}>${s.name}</option>`).join('')}</select></label>
   </div>
   <div class="picker-section">
     <h3>Project teams</h3><p>Click one or more project-team names.</p>
     <div class="choice-grid">${pickerButtons(teams,a.teamIds||[],'team')}</div>
   </div>
   <div class="picker-section">
     <h3>Individuals</h3><p>Click one or more individual users. You can combine these with a project team.</p>
     <div class="choice-grid">${pickerButtons(users,a.userIds||[],'user')}</div>
   </div>
 `,()=>{
   const roundId=document.getElementById('assignmentRound').value;
   const siteId=document.getElementById('assignmentSite').value;
   const duplicate=data.assignments.some(x=>x.id!==a.id&&x.roundId===roundId&&x.siteId===siteId);
   if(duplicate){alert('That survey round and site already has an assignment record. Edit the existing record instead.');return}
   a.roundId=roundId;a.siteId=siteId;
   a.teamIds=[...document.querySelectorAll('[data-picker="team"].selected')].map(b=>b.dataset.id);
   a.userIds=[...document.querySelectorAll('[data-picker="user"].selected')].map(b=>b.dataset.id);
   a.status=(a.teamIds.length||a.userIds.length)?'covered':'needed';
   saveData();renderAdmin();closeModal()
 });
 bindPickerButtons()
}

function initAdminControls(){
 const pairs=[['addRoundBtn',addRound],['addSiteBtn',addSite],['addUserBtn',addUser],['addTeamBtn',addTeam],['addAssignmentBtn',addAssignment]];
 pairs.forEach(([id,fn])=>{const el=document.getElementById(id);if(el)el.addEventListener('click',fn)});
 const close=document.getElementById('modalClose'),cancel=document.getElementById('modalCancel'),save=document.getElementById('modalSave'),backdrop=document.getElementById('modalBackdrop');
 if(close)close.onclick=closeModal;if(cancel)cancel.onclick=closeModal;if(save)save.onclick=()=>modalSaveHandler&&modalSaveHandler();
 if(backdrop)backdrop.addEventListener('click',e=>{if(e.target===backdrop)closeModal()})
}

document.addEventListener('DOMContentLoaded',()=>{rollForwardRecurringRounds();renderPublic();setupTabs();renderAdmin();initAdminControls()});
