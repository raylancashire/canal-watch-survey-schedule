import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

const supabase=createClient(SUPABASE_URL,SUPABASE_ANON_KEY);
const isEmbed=new URLSearchParams(window.location.search).get('embed')==='1';
const $=id=>document.getElementById(id);
const fmtDate=v=>new Date(v+'T12:00:00Z').toLocaleDateString('en-GB',{day:'numeric',month:'long',year:'numeric',timeZone:'UTC'});
const today=()=>new Date().toISOString().slice(0,10);
const escapeHtml=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

let db={rounds:[],sites:[],teams:[],volunteers:[],roundSites:[],assignments:[],assignmentTeams:[],assignmentVolunteers:[]};

async function load(){
 const queries=await Promise.all([
  supabase.from('survey_rounds').select('*').neq('status','inactive').gte('survey_date',today()).order('survey_date'),
  supabase.from('survey_sites').select('*').eq('active',true),
  supabase.from('project_teams').select('*').eq('active',true),
  supabase.from('volunteers').select('id,name,active').eq('active',true),
  supabase.from('survey_round_sites').select('*'),
  supabase.from('site_assignments').select('*').neq('status','cancelled'),
  supabase.from('assignment_teams').select('*'),
  supabase.from('assignment_volunteers').select('*')
 ]);

 const err=queries.find(q=>q.error)?.error;
 if(err){
   $('publicMessage').innerHTML=`<div class="notice error">Unable to load schedule: ${escapeHtml(err.message)}</div>`;
   return;
 }

 [db.rounds,db.sites,db.teams,db.volunteers,db.roundSites,db.assignments,db.assignmentTeams,db.assignmentVolunteers]=queries.map(q=>q.data||[]);
 renderFilter();
 renderAll();
}

const siteName=id=>db.sites.find(x=>x.id===id)?.name||'Unknown site';
const teamName=id=>db.teams.find(x=>x.id===id)?.name||'Unknown team';
const volunteerName=id=>db.volunteers.find(x=>x.id===id)?.name||'Unknown volunteer';

function namesFor(a){
 const teams=db.assignmentTeams.filter(x=>x.assignment_id===a.id).map(x=>teamName(x.team_id));
 const volunteers=db.assignmentVolunteers.filter(x=>x.assignment_id===a.id).map(x=>volunteerName(x.volunteer_id));
 return [...teams,...volunteers];
}

function teamIdsFor(a){
 return db.assignmentTeams.filter(x=>x.assignment_id===a.id).map(x=>x.team_id);
}

function roundAssignments(r){
 const siteIds=db.roundSites.filter(x=>x.survey_round_id===r.id).map(x=>x.survey_site_id);
 return siteIds.map(siteId=>
   db.assignments.find(a=>a.survey_round_id===r.id&&a.survey_site_id===siteId) ||
   {id:null,survey_round_id:r.id,survey_site_id:siteId,status:'needed'}
 );
}

function renderFilter(){
 $('roundFilter').innerHTML='<option value="all">All upcoming surveys</option>'+
   db.rounds.map(r=>`<option value="${r.id}">${escapeHtml(r.name)} — ${fmtDate(r.survey_date)}</option>`).join('');

 $('roundFilter').onchange=()=>{
   $('roundFilter').value==='all'
     ? renderAll()
     : renderOne(Number($('roundFilter').value));
 };
}

function contactHtml(a){
 const teamIds=teamIdsFor(a);

 if(!teamIds.length){
   return '<span class="contact-unavailable">No project-team coordinator</span>';
 }

 return teamIds.map(teamId=>{
   const team=db.teams.find(t=>t.id===teamId);
   const label=teamIds.length===1 ? 'Email coordinator' : `Email ${team?.name||'coordinator'}`;
   return `<button type="button"
      class="contact-button"
      data-contact-team="${teamId}"
      data-contact-team-name="${escapeHtml(team?.name||'Project team')}">${escapeHtml(label)}</button>`;
 }).join(' ');
}

function row(r,a){
 const names=namesFor(a);
 const covered=a.status==='complete'||names.length>0;
 const cls=a.status==='complete'?'complete':covered?'covered':'needed';
 const label=a.status==='complete'?'Completed':covered?'Covered':'Assignment needed';
 const assigned=names.length
   ? names.map(n=>`<span class="pill">${escapeHtml(n)}</span>`).join('')
   : '—';

 return `<tr>
   <td><strong>${escapeHtml(siteName(a.survey_site_id))}</strong><br><small>${escapeHtml(r.name)}</small></td>
   <td>${fmtDate(r.survey_date)}</td>
   <td class="assignment-column">${assigned}</td>
   <td><span class="status ${cls}">${label}</span></td>
   <td class="${isEmbed?'':'hidden'}">${isEmbed?contactHtml(a):''}</td>
 </tr>`;
}

function stats(rounds){
 const all=rounds.flatMap(r=>roundAssignments(r));
 const covered=all.filter(a=>a.status==='complete'||namesFor(a).length);
 $('nextSurvey').textContent=rounds[0]?fmtDate(rounds[0].survey_date):'—';
 $('siteCount').textContent=all.length;
 $('coveredCount').textContent=covered.length;
 $('uncoveredCount').textContent=all.length-covered.length;
}

function renderAll(){
 const rows=db.rounds.flatMap(r=>roundAssignments(r).map(a=>row(r,a)));
 $('scheduleBody').innerHTML=rows.join('')||'<tr><td colspan="5">No upcoming surveys scheduled.</td></tr>';
 stats(db.rounds);
}

function renderOne(id){
 const r=db.rounds.find(x=>x.id===id);
 if(!r)return;
 const rows=roundAssignments(r).map(a=>row(r,a));
 $('scheduleBody').innerHTML=rows.join('')||'<tr><td colspan="5">No sites are attached to this survey round.</td></tr>';
 stats([r]);
}

function setupCompactView(){
 if(isEmbed)$('contactHeading').classList.remove('hidden');
}

function setupContactModal(){
 const backdrop=$('contactBackdrop');
 const form=$('contactForm');

 const close=()=>{
   backdrop.classList.add('hidden');
   $('contactStatus').innerHTML='';
 };

 $('contactClose').onclick=close;
 $('contactCancel').onclick=close;
 backdrop.addEventListener('click',e=>{if(e.target===backdrop)close()});

 document.addEventListener('click',e=>{
   const button=e.target.closest('[data-contact-team]');
   if(!button)return;
   $('contactTeamId').value=button.dataset.contactTeam;
   $('contactTeamLabel').textContent=`Message to the coordinator of ${button.dataset.contactTeamName}.`;
   backdrop.classList.remove('hidden');
 });

 form.addEventListener('submit',async e=>{
   e.preventDefault();

   const send=$('contactSend');
   send.disabled=true;
   $('contactStatus').innerHTML='<p class="muted">Sending…</p>';

   const {data,error}=await supabase.functions.invoke('contact-coordinator',{
     body:{
       team_id:Number($('contactTeamId').value),
       sender_name:$('contactName').value.trim(),
       sender_email:$('contactEmail').value.trim(),
       subject:$('contactSubject').value.trim(),
       message:$('contactMessage').value.trim(),
       page_url:window.location.href
     }
   });

   if(error||data?.error){
     $('contactStatus').innerHTML=`<div class="notice error">${escapeHtml(data?.error||error?.message||'Unable to send message.')}</div>`;
     send.disabled=false;
     return;
   }

   $('contactStatus').innerHTML='<div class="notice">Message sent to the coordinator.</div>';
   setTimeout(close,1200);
   send.disabled=false;
 });
}

setupCompactView();
setupContactModal();
load();
