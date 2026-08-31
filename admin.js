import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

const supabase=createClient(SUPABASE_URL,SUPABASE_ANON_KEY);
const $=id=>document.getElementById(id);
const fmtDate=v=>new Date(v+'T12:00:00Z').toLocaleDateString('en-GB',{day:'numeric',month:'long',year:'numeric',timeZone:'UTC'});
const isoToday=()=>new Date().toISOString().slice(0,10);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let db={volunteers:[],teams:[],members:[],sites:[],rounds:[],roundSites:[],assignments:[],assignmentTeams:[],assignmentVolunteers:[],admins:[]};
let currentAdmin=null;
let modalSave=null;

function message(el,text,error=false){el.innerHTML=text?`<div class="notice ${error?'error':''}">${esc(text)}</div>`:''}

async function init(){
 $('loginForm').addEventListener('submit',login);
 $('signOutBtn').onclick=()=>supabase.auth.signOut();
 setupTabs();setupModal();setupButtons();
 supabase.auth.onAuthStateChange(()=>setTimeout(checkSession,0));
 await checkSession();
}

async function login(e){
 e.preventDefault();message($('loginMessage'),'');
 const {error}=await supabase.auth.signInWithPassword({email:$('loginEmail').value.trim(),password:$('loginPassword').value});
 if(error)message($('loginMessage'),error.message,true);
}

async function checkSession(){
 const {data:{session}}=await supabase.auth.getSession();
 if(!session){$('loginView').classList.remove('hidden');$('adminView').classList.add('hidden');return}
 const {data:profile,error}=await supabase.from('admin_profiles').select('id,display_name,email,can_manage,can_manage_admins,active').eq('id',session.user.id).single();
 if(error||!profile?.active||!profile?.can_manage){
  $('loginView').classList.remove('hidden');$('adminView').classList.add('hidden');
  message($('loginMessage'),'This account is signed in but is not authorised to manage the schedule.',true);return;
 }
 currentAdmin=profile;
 $('signedInAs').textContent=profile.display_name||session.user.email;
 $('adminsTab').classList.toggle('hidden',!profile.can_manage_admins);
 $('inviteAdminBtn')?.classList.toggle('hidden',!profile.can_manage_admins);
 $('loginView').classList.add('hidden');$('adminView').classList.remove('hidden');
 await generateRecurringRounds();
 await loadAll();
}

async function loadAll(){
 const requests=[
  supabase.from('volunteers').select('*').order('name'),
  supabase.from('project_teams').select('*').order('name'),
  supabase.from('project_team_members').select('*'),
  supabase.from('survey_sites').select('*').order('name'),
  supabase.from('survey_rounds').select('*').order('survey_date'),
  supabase.from('survey_round_sites').select('*'),
  supabase.from('site_assignments').select('*'),
  supabase.from('assignment_teams').select('*'),
  supabase.from('assignment_volunteers').select('*')
 ];
 if(currentAdmin?.can_manage_admins){
   requests.push(supabase.from('admin_profiles').select('id,display_name,email,can_manage,can_manage_admins,active,created_at').order('created_at'));
 }
 const qs=await Promise.all(requests);
 const err=qs.find(q=>q.error)?.error;if(err){alert(err.message);return}
 [db.volunteers,db.teams,db.members,db.sites,db.rounds,db.roundSites,db.assignments,db.assignmentTeams,db.assignmentVolunteers]=qs.slice(0,9).map(q=>q.data||[]);
 db.admins=currentAdmin?.can_manage_admins?(qs[9]?.data||[]):[];
 render();
}
const volunteerName=id=>db.volunteers.find(x=>x.id===id)?.name||'Unknown volunteer';
const teamName=id=>db.teams.find(x=>x.id===id)?.name||'Unknown team';
const siteName=id=>db.sites.find(x=>x.id===id)?.name||'Unknown site';
const roundName=id=>db.rounds.find(x=>x.id===id)?.name||'Unknown round';
const recurrenceLabel=r=>({none:'One-off',weekly:'Weekly',fortnightly:'Fortnightly',monthly:'Monthly',custom_days:`Every ${r.recurrence_interval} days`}[r.recurrence]||'One-off');

function render(){
 $('volunteerList').innerHTML=db.volunteers.map(v=>record(v.name,v.email?`Email: ${esc(v.email)}`:'No email address',v.active?'Active':'Inactive',`volunteer:${v.id}`)).join('');
 $('siteList').innerHTML=db.sites.map(s=>{const bits=[s.address,s.latitude!=null&&s.longitude!=null?`${s.latitude}, ${s.longitude}`:null,s.three_word_location?`///${s.three_word_location.replace(/^\/+/, '')}`:null].filter(Boolean);return record(s.name,bits.join(' • ')||'No location details',s.active?'Active':'Inactive',`site:${s.id}`)}).join('');
 $('roundList').innerHTML=db.rounds.map(r=>{
  const count=db.roundSites.filter(x=>x.survey_round_id===r.id).length;
  const statusLabel=r.status==='conducted'?'Conducted':r.status==='cancelled'?'Cancelled':'Planned';
  const actual=r.status==='conducted'&&r.conducted_date?` • Conducted ${fmtDate(r.conducted_date)}`:'';
  return record(
    r.name,
    `${fmtDate(r.survey_date)}${actual} • ${recurrenceLabel(r)}${r.auto_repeat?' • Auto-repeat':''} • ${count} site${count===1?'':'s'}`,
    statusLabel,
    `round:${r.id}`
  )
}).join('');
 $('teamList').innerHTML=db.teams.map(t=>{const mem=db.members.filter(m=>m.team_id===t.id).map(m=>volunteerName(m.volunteer_id));return `<div class="record"><div><strong>${esc(t.name)}</strong><br><small>Coordinator: ${esc(volunteerName(t.coordinator_id))}</small><div class="assignment-summary">${mem.map(n=>`<span class="pill">${esc(n)}</span>`).join('')}</div></div><div>${mem.length} member${mem.length===1?'':'s'}</div><div>${t.active?'Active':'Inactive'}</div><div class="record-actions"><button class="secondary edit-team" data-id="${t.id}">Edit</button></div></div>`}).join('');
 $('assignmentList').innerHTML=db.assignments.map(a=>{const names=[...db.assignmentTeams.filter(x=>x.assignment_id===a.id).map(x=>teamName(x.team_id)),...db.assignmentVolunteers.filter(x=>x.assignment_id===a.id).map(x=>volunteerName(x.volunteer_id))];return `<div class="record"><div><strong>${esc(roundName(a.survey_round_id))} — ${esc(siteName(a.survey_site_id))}</strong><div class="assignment-summary">${names.length?names.map(n=>`<span class="pill">${esc(n)}</span>`).join(''):'No assignment'}</div></div><div>${a.status}</div><div></div><div class="record-actions"><button class="secondary edit-assignment" data-id="${a.id}">Edit</button><button class="danger delete-assignment" data-id="${a.id}">Delete</button></div></div>`}).join('');
 if($('adminList')){
   $('adminList').innerHTML=currentAdmin?.can_manage_admins
     ? db.admins.map(a=>{
         const isSelf=a.id===currentAdmin.id;
         const access=a.active?(a.can_manage?'Schedule manager':'No schedule access'):'Disabled';
         const manager=a.can_manage_admins?' • Admin Manager':'';
         return `<div class="record"><div><strong>${esc(a.display_name||a.email||'Administrator')}</strong><br><small>${esc(a.email||'No email recorded')}</small></div><div>${esc(access+manager)}</div><div>${isSelf?'Your account':''}</div><div class="record-actions"><button class="secondary edit-admin" data-id="${a.id}">Permissions</button></div></div>`;
       }).join('')
     : '';
 }

 bindRendered();
}
function record(title,meta,status,token){return `<div class="record"><div><strong>${esc(title)}</strong><br><small>${meta}</small></div><div>${status}</div><div></div><div class="record-actions"><button class="secondary edit-record" data-token="${token}">Edit</button></div></div>`}
function bindRendered(){
 document.querySelectorAll('.edit-record').forEach(b=>b.onclick=()=>{const [type,id]=b.dataset.token.split(':');if(type==='volunteer')openVolunteer(Number(id));if(type==='site')openSite(Number(id));if(type==='round')openRound(Number(id))});
 document.querySelectorAll('.edit-team').forEach(b=>b.onclick=()=>openTeam(Number(b.dataset.id)));
 document.querySelectorAll('.edit-assignment').forEach(b=>b.onclick=()=>openAssignment(Number(b.dataset.id)));
 document.querySelectorAll('.delete-assignment').forEach(b=>b.onclick=()=>deleteAssignment(Number(b.dataset.id)));
 document.querySelectorAll('.edit-admin').forEach(b=>b.onclick=()=>openAdminPermissions(b.dataset.id));
}

function setupTabs(){document.querySelectorAll('.tab').forEach(b=>b.onclick=()=>{document.querySelectorAll('.tab,.admin-section').forEach(x=>x.classList.remove('active'));b.classList.add('active');$(b.dataset.tab).classList.add('active')})}
function setupButtons(){
 $('addVolunteerBtn').onclick=()=>openVolunteer(null);$('addSiteBtn').onclick=()=>openSite(null);$('addRoundBtn').onclick=()=>openRound(null);$('addTeamBtn').onclick=()=>openTeam(null);$('addAssignmentBtn').onclick=()=>openAssignment(null);if($('inviteAdminBtn'))$('inviteAdminBtn').onclick=openInviteAdmin;
}
function setupModal(){
 $('modalClose').onclick=closeModal;$('modalCancel').onclick=closeModal;$('modalSave').onclick=()=>modalSave&&modalSave();
 $('modalBackdrop').onclick=e=>{if(e.target===$('modalBackdrop'))closeModal()}
}
function openModal(title,html,save){$('modalTitle').textContent=title;$('modalBody').innerHTML=html;$('modalBackdrop').classList.remove('hidden');modalSave=save}
function closeModal(){$('modalBackdrop').classList.add('hidden');modalSave=null}

function bindChoices(attr){document.querySelectorAll(`[${attr}]`).forEach(b=>b.onclick=()=>b.classList.toggle('selected'))}

function openVolunteer(id){
 const v=id?db.volunteers.find(x=>x.id===id):{name:'',email:'',active:true};
 openModal(id?'Edit volunteer':'Add volunteer',`<div class="form-grid"><label class="field">Volunteer name<input id="vName" value="${esc(v.name)}"></label><label class="field">Email address (optional)<input id="vEmail" type="email" value="${esc(v.email||'')}"></label></div><label class="inline-check"><input id="vActive" type="checkbox" ${v.active?'checked':''}> Active volunteer</label>`,async()=>{
  const row={name:$('vName').value.trim(),email:$('vEmail').value.trim()||null,active:$('vActive').checked};if(!row.name)return alert('Enter a volunteer name.');
  const q=id?supabase.from('volunteers').update(row).eq('id',id):supabase.from('volunteers').insert(row);const {error}=await q;if(error)return alert(error.message);closeModal();await loadAll();
 });
}

function openSite(id){
 const s=id?db.sites.find(x=>x.id===id):{name:'',address:'',latitude:null,longitude:null,three_word_location:'',active:true};
 openModal(id?'Edit survey site':'Add survey site',`<div class="form-grid"><label class="field">Site name<input id="sName" value="${esc(s.name)}"></label><label class="field">Address<input id="sAddress" value="${esc(s.address||'')}"></label><label class="field">GPS latitude<input id="sLat" inputmode="decimal" value="${s.latitude??''}"></label><label class="field">GPS longitude<input id="sLon" inputmode="decimal" value="${s.longitude??''}"></label></div><label class="field" style="margin-top:14px">Three-word location<input id="sWords" value="${esc(s.three_word_location||'')}" placeholder="word.word.word"></label><label class="inline-check"><input id="sActive" type="checkbox" ${s.active?'checked':''}> Active site</label>`,async()=>{
  const name=$('sName').value.trim(),lat=$('sLat').value.trim(),lon=$('sLon').value.trim(),words=$('sWords').value.trim().replace(/^\/+/,'');if(!name)return alert('Enter a site name.');if((lat&&!lon)||(!lat&&lon))return alert('Enter both GPS coordinates or leave both blank.');if(words&&words.split('.').length!==3)return alert('Use three words separated by full stops.');
  const row={name,address:$('sAddress').value.trim()||null,latitude:lat?Number(lat):null,longitude:lon?Number(lon):null,three_word_location:words||null,active:$('sActive').checked};const q=id?supabase.from('survey_sites').update(row).eq('id',id):supabase.from('survey_sites').insert(row);const {error}=await q;if(error)return alert(error.message);closeModal();await loadAll();
 });
}

function openTeam(id){
 const t=id?db.teams.find(x=>x.id===id):{name:'',coordinator_id:null,active:true};const memberIds=id?db.members.filter(m=>m.team_id===id).map(m=>m.volunteer_id):[];
 const volunteers=db.volunteers.filter(v=>v.active);
 openModal(id?'Edit project team':'Add project team',`<label class="field">Team name<input id="tName" value="${esc(t.name)}"></label><div class="picker-section"><h3>Team members and coordinator</h3><p>Click volunteers to add them, then choose one selected member as coordinator.</p><div class="team-person-grid">${volunteers.map(v=>{const mem=memberIds.includes(v.id),coord=t.coordinator_id===v.id;return `<div class="team-person ${mem?'selected-member':''}" data-card="${v.id}"><button type="button" class="member-toggle ${mem?'selected':''}" data-member="${v.id}"><span class="person-name">${esc(v.name)}</span><span class="person-state">${mem?'Team member':'Add to team'}</span></button><label class="coordinator-choice ${mem?'':'disabled'}"><input type="radio" name="coord" value="${v.id}" ${coord?'checked':''} ${mem?'':'disabled'}> Coordinator</label></div>`}).join('')}</div></div><label class="inline-check"><input id="tActive" type="checkbox" ${t.active?'checked':''}> Active team</label>`,async()=>{
  const name=$('tName').value.trim(),members=[...document.querySelectorAll('[data-member].selected')].map(b=>Number(b.dataset.member)),coord=document.querySelector('input[name="coord"]:checked');if(!name)return alert('Enter a team name.');if(!members.length)return alert('Select at least one member.');if(!coord)return alert('Choose a coordinator.');const coordinator_id=Number(coord.value);if(!members.includes(coordinator_id))return alert('Coordinator must be a team member.');
  let teamId=id;if(id){const {error}=await supabase.from('project_teams').update({name,coordinator_id,active:$('tActive').checked}).eq('id',id);if(error)return alert(error.message)}else{const {data,error}=await supabase.from('project_teams').insert({name,coordinator_id,active:$('tActive').checked}).select('id').single();if(error)return alert(error.message);teamId=data.id}
  await supabase.from('project_team_members').delete().eq('team_id',teamId);const {error}=await supabase.from('project_team_members').insert(members.map(volunteer_id=>({team_id:teamId,volunteer_id})));if(error)return alert(error.message);closeModal();await loadAll();
 });
 document.querySelectorAll('[data-member]').forEach(b=>b.onclick=()=>{const card=document.querySelector(`[data-card="${b.dataset.member}"]`),radio=card.querySelector('input[name="coord"]'),label=card.querySelector('.coordinator-choice'),state=card.querySelector('.person-state'),selected=b.classList.toggle('selected');card.classList.toggle('selected-member',selected);radio.disabled=!selected;label.classList.toggle('disabled',!selected);state.textContent=selected?'Team member':'Add to team';if(!selected&&radio.checked)radio.checked=false});
}

function openRound(id){
 const r=id?db.rounds.find(x=>x.id===id):{
   name:'',
   survey_date:isoToday(),
   status:'planned',
   conducted_date:null,
   recurrence:'none',
   recurrence_interval:1,
   auto_repeat:false
 };
 const selected=id?db.roundSites.filter(x=>x.survey_round_id===id).map(x=>x.survey_site_id):[];
 const sites=db.sites.filter(s=>s.active);

 openModal(
   id?'Edit survey round':'Add survey round',
   `<div class="form-grid">
      <label class="field">
        Round name
        <input id="rName" value="${esc(r.name)}">
      </label>

      <label class="field">
        Planned survey date
        <input id="rDate" type="date" value="${r.survey_date}">
      </label>

      <label class="field">
        Survey status
        <select id="rStatus">
          <option value="planned" ${r.status==='planned'?'selected':''}>Planned</option>
          <option value="conducted" ${r.status==='conducted'?'selected':''}>Conducted</option>
          <option value="cancelled" ${r.status==='cancelled'?'selected':''}>Cancelled</option>
        </select>
      </label>

      <label class="field" id="conductedDateField" style="${r.status==='conducted'?'':'display:none'}">
        Actual survey date
        <input
          id="rConductedDate"
          type="date"
          value="${r.conducted_date||r.survey_date||''}">
      </label>
    </div>

    <p class="muted" style="margin-top:10px">
      Planned date records when the survey was scheduled. Actual survey date records when sampling was really carried out.
    </p>

    <div class="picker-section">
      <h3>Survey sites</h3>
      <p>Click one or more sites.</p>
      <div class="choice-grid">
        ${sites.map(s=>`
          <button
            type="button"
            class="choice ${selected.includes(s.id)?'selected':''}"
            data-rsite="${s.id}">
            ${esc(s.name)}
            <small>Sampling site</small>
          </button>`).join('')}
      </div>
    </div>

    <div class="recurrence-box">
      <label class="field">
        Recurrence
        <select id="rRec">
          <option value="none" ${r.recurrence==='none'?'selected':''}>One-off</option>
          <option value="weekly" ${r.recurrence==='weekly'?'selected':''}>Weekly</option>
          <option value="fortnightly" ${r.recurrence==='fortnightly'?'selected':''}>Fortnightly</option>
          <option value="monthly" ${r.recurrence==='monthly'?'selected':''}>Monthly</option>
          <option value="custom_days" ${r.recurrence==='custom_days'?'selected':''}>Every N days</option>
        </select>
      </label>

      <label class="field">
        Repeat interval
        <input id="rInterval" type="number" min="1" value="${r.recurrence_interval||1}">
      </label>

      <label class="inline-check">
        <input id="rAuto" type="checkbox" ${r.auto_repeat?'checked':''}>
        Automatically create the next survey round after this date has passed
      </label>
    </div>`,
   async()=>{
     const name=$('rName').value.trim();
     const survey_date=$('rDate').value;
     const status=$('rStatus').value;
     const conducted_date=status==='conducted' ? $('rConductedDate').value : null;
     const siteIds=[...document.querySelectorAll('[data-rsite].selected')]
       .map(b=>Number(b.dataset.rsite));

     if(!name||!survey_date)return alert('Enter a name and planned survey date.');
     if(!siteIds.length)return alert('Select at least one survey site.');
     if(status==='conducted'&&!conducted_date)return alert('Enter the actual survey date.');

     const recurrence=$('rRec').value;

     const row={
       name,
       survey_date,
       status,
       conducted_date,
       recurrence,
       recurrence_interval:Math.max(1,Number($('rInterval').value)||1),
       auto_repeat:$('rAuto').checked&&recurrence!=='none'&&status!=='cancelled'
     };

     let roundId=id;

     if(id){
       const {error}=await supabase
         .from('survey_rounds')
         .update(row)
         .eq('id',id);

       if(error)return alert(error.message);
     }else{
       const {data,error}=await supabase
         .from('survey_rounds')
         .insert(row)
         .select('id')
         .single();

       if(error)return alert(error.message);
       roundId=data.id;
     }

     await supabase
       .from('survey_round_sites')
       .delete()
       .eq('survey_round_id',roundId);

     let q=await supabase
       .from('survey_round_sites')
       .insert(siteIds.map(survey_site_id=>({
         survey_round_id:roundId,
         survey_site_id
       })));

     if(q.error)return alert(q.error.message);

     for(const survey_site_id of siteIds){
       if(!db.assignments.some(a=>
         a.survey_round_id===roundId &&
         a.survey_site_id===survey_site_id
       )){
         await supabase
           .from('site_assignments')
           .insert({
             survey_round_id:roundId,
             survey_site_id,
             status:'needed'
           });
       }
     }

     closeModal();
     await loadAll();
   }
 );

 bindChoices('data-rsite');

 const statusSelect=$('rStatus');
 const conductedField=$('conductedDateField');
 const conductedInput=$('rConductedDate');

 statusSelect.onchange=()=>{
   const conducted=statusSelect.value==='conducted';
   conductedField.style.display=conducted?'':'none';

   if(conducted&&!conductedInput.value){
     conductedInput.value=$('rDate').value||isoToday();
   }

   if(statusSelect.value==='cancelled'){
     $('rAuto').checked=false;
   }
 };
}

function openAssignment(id){
 const a=id?db.assignments.find(x=>x.id===id):null;const rounds=db.rounds.filter(r=>r.status!=='inactive'),sites=db.sites.filter(s=>s.active),teams=db.teams.filter(t=>t.active),vols=db.volunteers.filter(v=>v.active);
 const selectedTeams=id?db.assignmentTeams.filter(x=>x.assignment_id===id).map(x=>x.team_id):[],selectedVols=id?db.assignmentVolunteers.filter(x=>x.assignment_id===id).map(x=>x.volunteer_id):[];
 openModal(id?'Edit site assignment':'Add site assignment',`<div class="form-grid"><label class="field">Survey round<select id="aRound">${rounds.map(r=>`<option value="${r.id}" ${a?.survey_round_id===r.id?'selected':''}>${esc(r.name)} — ${fmtDate(r.survey_date)}</option>`).join('')}</select></label><label class="field">Survey site<select id="aSite">${sites.map(s=>`<option value="${s.id}" ${a?.survey_site_id===s.id?'selected':''}>${esc(s.name)}</option>`).join('')}</select></label></div><div class="picker-section"><h3>Project teams</h3><div class="choice-grid">${teams.map(t=>`<button type="button" class="choice ${selectedTeams.includes(t.id)?'selected':''}" data-ateam="${t.id}">${esc(t.name)}<small>Project team</small></button>`).join('')}</div></div><div class="picker-section"><h3>Individual volunteers</h3><div class="choice-grid">${vols.map(v=>`<button type="button" class="choice ${selectedVols.includes(v.id)?'selected':''}" data-avol="${v.id}">${esc(v.name)}<small>Volunteer</small></button>`).join('')}</div></div>`,async()=>{
  const survey_round_id=Number($('aRound').value),survey_site_id=Number($('aSite').value),teamIds=[...document.querySelectorAll('[data-ateam].selected')].map(b=>Number(b.dataset.ateam)),volIds=[...document.querySelectorAll('[data-avol].selected')].map(b=>Number(b.dataset.avol));
  let assignmentId=id;if(id){const {error}=await supabase.from('site_assignments').update({survey_round_id,survey_site_id,status:(teamIds.length||volIds.length)?'covered':'needed'}).eq('id',id);if(error)return alert(error.message)}else{const {data,error}=await supabase.from('site_assignments').upsert({survey_round_id,survey_site_id,status:(teamIds.length||volIds.length)?'covered':'needed'},{onConflict:'survey_round_id,survey_site_id'}).select('id').single();if(error)return alert(error.message);assignmentId=data.id}
  await Promise.all([supabase.from('assignment_teams').delete().eq('assignment_id',assignmentId),supabase.from('assignment_volunteers').delete().eq('assignment_id',assignmentId)]);
  if(teamIds.length){const {error}=await supabase.from('assignment_teams').insert(teamIds.map(team_id=>({assignment_id:assignmentId,team_id})));if(error)return alert(error.message)}
  if(volIds.length){const {error}=await supabase.from('assignment_volunteers').insert(volIds.map(volunteer_id=>({assignment_id:assignmentId,volunteer_id})));if(error)return alert(error.message)}
  closeModal();await loadAll();
 });bindChoices('data-ateam');bindChoices('data-avol');
}
async function deleteAssignment(id){if(!confirm('Delete this assignment?'))return;const {error}=await supabase.from('site_assignments').delete().eq('id',id);if(error)return alert(error.message);await loadAll()}

function addDays(s,n){const d=new Date(s+'T00:00:00Z');d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10)}
function addMonths(s,n){const [y,m,d]=s.split('-').map(Number);const x=new Date(Date.UTC(y,m-1,1));x.setUTCMonth(x.getUTCMonth()+n);const last=new Date(Date.UTC(x.getUTCFullYear(),x.getUTCMonth()+1,0)).getUTCDate();x.setUTCDate(Math.min(d,last));return x.toISOString().slice(0,10)}
function nextDate(r){const i=r.recurrence_interval||1;if(r.recurrence==='weekly')return addDays(r.survey_date,7*i);if(r.recurrence==='fortnightly')return addDays(r.survey_date,14*i);if(r.recurrence==='monthly')return addMonths(r.survey_date,i);if(r.recurrence==='custom_days')return addDays(r.survey_date,i);return null}

async function generateRecurringRounds(){
 const {data:rounds}=await supabase.from('survey_rounds').select('*').eq('auto_repeat',true).neq('recurrence','none').lt('survey_date',isoToday()).order('survey_date');
 if(!rounds?.length)return;
 for(const source of rounds){
   const {data:children}=await supabase.from('survey_rounds').select('id,survey_date').eq('parent_round_id',source.id);
   if(children?.length)continue;
   let date=nextDate(source),previous=source,guard=0;
   while(date&&date<=isoToday()&&guard<100){
     const {data:newRound,error}=await supabase.from('survey_rounds').insert({name:source.name,survey_date:date,status:'planned',recurrence:source.recurrence,recurrence_interval:source.recurrence_interval,auto_repeat:true,parent_round_id:previous.id}).select('id').single();
     if(error)break;
     const {data:sites}=await supabase.from('survey_round_sites').select('survey_site_id').eq('survey_round_id',previous.id);
     if(sites?.length){await supabase.from('survey_round_sites').insert(sites.map(s=>({survey_round_id:newRound.id,survey_site_id:s.survey_site_id})));await supabase.from('site_assignments').insert(sites.map(s=>({survey_round_id:newRound.id,survey_site_id:s.survey_site_id,status:'needed'})))}
     previous={...source,id:newRound.id,survey_date:date};date=nextDate(previous);guard++;
   }
   if(date&&guard<100){
     const {data:newRound,error}=await supabase.from('survey_rounds').insert({name:source.name,survey_date:date,status:'planned',recurrence:source.recurrence,recurrence_interval:source.recurrence_interval,auto_repeat:true,parent_round_id:previous.id}).select('id').single();
     if(!error){const {data:sites}=await supabase.from('survey_round_sites').select('survey_site_id').eq('survey_round_id',previous.id);if(sites?.length){await supabase.from('survey_round_sites').insert(sites.map(s=>({survey_round_id:newRound.id,survey_site_id:s.survey_site_id})));await supabase.from('site_assignments').insert(sites.map(s=>({survey_round_id:newRound.id,survey_site_id:s.survey_site_id,status:'needed'})))}}
   }
 }
}

async function callAdminFunction(body){
 const {data,error}=await supabase.functions.invoke('manage-admins',{body});
 if(error){
   let detail=error.message;
   try{
     if(error.context){
       const payload=await error.context.json();
       detail=payload?.error||detail;
     }
   }catch{}
   throw new Error(detail);
 }
 if(data?.error) throw new Error(data.error);
 return data;
}

function openInviteAdmin(){
 if(!currentAdmin?.can_manage_admins)return;
 openModal('Invite administrator',`
   <div class="form-grid">
     <label class="field">Name
       <input id="adminInviteName" placeholder="Administrator name">
     </label>
     <label class="field">Email address
       <input id="adminInviteEmail" type="email" placeholder="name@example.org">
     </label>
   </div>
   <label class="inline-check">
     <input id="adminInviteManageAdmins" type="checkbox">
     Can manage other administrator accounts
   </label>
   <p class="help-text">The invited person will automatically receive schedule-management access. Admin-management access is optional.</p>
 `,async()=>{
   const display_name=$('adminInviteName').value.trim();
   const email=$('adminInviteEmail').value.trim();
   if(!email)return alert('Enter an email address.');
   $('modalSave').disabled=true;
   try{
     await callAdminFunction({
       action:'invite',
       email,
       display_name,
       can_manage_admins:$('adminInviteManageAdmins').checked,
       redirect_to:new URL('admin.html',window.location.href).href
     });
     closeModal();
     await loadAll();
     alert('Administrator invitation sent.');
   }catch(e){
     alert(e.message);
   }finally{
     $('modalSave').disabled=false;
   }
 });
}

function openAdminPermissions(id){
 if(!currentAdmin?.can_manage_admins)return;
 const a=db.admins.find(x=>x.id===id);
 if(!a)return;
 const isSelf=a.id===currentAdmin.id;
 openModal('Administrator permissions',`
   <p><strong>${esc(a.display_name||'Administrator')}</strong><br><span class="muted">${esc(a.email||'')}</span></p>
   <label class="inline-check">
     <input id="adminCanManage" type="checkbox" ${a.can_manage?'checked':''} ${isSelf?'disabled':''}>
     Can manage the survey schedule
   </label>
   <label class="inline-check">
     <input id="adminCanManageAdmins" type="checkbox" ${a.can_manage_admins?'checked':''} ${isSelf?'disabled':''}>
     Can view, invite and manage administrators
   </label>
   <label class="inline-check">
     <input id="adminActive" type="checkbox" ${a.active?'checked':''} ${isSelf?'disabled':''}>
     Administrator account enabled
   </label>
   ${isSelf?'<p class="help-text">For safety, you cannot remove your own Admin Manager rights from this screen.</p>':''}
 `,async()=>{
   if(isSelf){closeModal();return}
   $('modalSave').disabled=true;
   try{
     await callAdminFunction({
       action:'update',
       user_id:a.id,
       can_manage:$('adminCanManage').checked,
       can_manage_admins:$('adminCanManageAdmins').checked,
       active:$('adminActive').checked
     });
     closeModal();
     await loadAll();
   }catch(e){
     alert(e.message);
   }finally{
     $('modalSave').disabled=false;
   }
 });
}

init();
