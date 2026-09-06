import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

const supabase=createClient(SUPABASE_URL,SUPABASE_ANON_KEY);
const isEmbed=new URLSearchParams(window.location.search).get('embed')==='1';
const $=id=>document.getElementById(id);
const fmtDate=v=>new Date(v+'T12:00:00Z').toLocaleDateString('en-GB',{day:'numeric',month:'long',year:'numeric',timeZone:'UTC'});
const today=()=>new Date().toISOString().slice(0,10);
const escapeHtml=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

let db={rounds:[],sites:[],teams:[],volunteers:[],roundSites:[],assignments:[],assignmentTeams:[],assignmentVolunteers:[]};

let leafletPromise=null;
let openSiteMapId=null;
const siteMaps=new Map();

function loadLeaflet(){
 if(window.L)return Promise.resolve(window.L);
 if(leafletPromise)return leafletPromise;

 leafletPromise=new Promise((resolve,reject)=>{
   if(!document.querySelector('link[data-canal-leaflet]')){
     const link=document.createElement('link');
     link.rel='stylesheet';
     link.href='https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
     link.dataset.canalLeaflet='1';
     document.head.appendChild(link);
   }

   const existing=document.querySelector('script[data-canal-leaflet]');
   if(existing){
     existing.addEventListener('load',()=>resolve(window.L),{once:true});
     existing.addEventListener('error',reject,{once:true});
     return;
   }

   const script=document.createElement('script');
   script.src='https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
   script.dataset.canalLeaflet='1';
   script.onload=()=>resolve(window.L);
   script.onerror=reject;
   document.head.appendChild(script);
 });

 return leafletPromise;
}

function siteFor(id){
 return db.sites.find(s=>s.id===id);
}

function hasCoordinates(site){
 return site &&
   Number.isFinite(Number(site.latitude)) &&
   Number.isFinite(Number(site.longitude));
}

function mapDisclosureHtml(siteId){
 const site=siteFor(siteId);
 if(!hasCoordinates(site))return '';

 const words=site.three_word_location
   ? ` • ///${escapeHtml(String(site.three_word_location).replace(/^\/+/,''))}`
   : '';

 const address=site.address
   ? `<div class="site-map-meta">${escapeHtml(site.address)}${words}</div>`
   : (words ? `<div class="site-map-meta">${words.replace(/^ • /,'')}</div>` : '');

 return `
   <div class="site-map-disclosure">
     <button
       type="button"
       class="site-map-toggle"
       data-site-map-toggle="${siteId}"
       aria-expanded="false"
       aria-controls="siteMapPanel-${siteId}">
       <span>View map</span>
       <span class="site-map-toggle-icon" aria-hidden="true">＋</span>
     </button>

     <div
       id="siteMapPanel-${siteId}"
       class="site-map-panel hidden"
       data-site-map-panel="${siteId}">
       ${address}
       <div
         id="siteMap-${siteId}"
         class="site-map-canvas"
         role="img"
         aria-label="Map showing ${escapeHtml(site.name)}">
       </div>
       <a
         class="site-map-open-link"
         href="https://www.openstreetmap.org/?mlat=${Number(site.latitude)}&mlon=${Number(site.longitude)}#map=18/${Number(site.latitude)}/${Number(site.longitude)}"
         target="_blank"
         rel="noopener">
         Open larger map
       </a>
     </div>
   </div>`;
}

function closeSiteMap(siteId){
 const panel=document.querySelector(`[data-site-map-panel="${siteId}"]`);
 const button=document.querySelector(`[data-site-map-toggle="${siteId}"]`);
 if(panel)panel.classList.add('hidden');
 if(button){
   button.setAttribute('aria-expanded','false');
   const icon=button.querySelector('.site-map-toggle-icon');
   if(icon)icon.textContent='＋';
 }
 if(openSiteMapId===siteId)openSiteMapId=null;
}

async function openSiteMap(siteId){
 const site=siteFor(siteId);
 if(!hasCoordinates(site))return;

 if(openSiteMapId && openSiteMapId!==siteId){
   closeSiteMap(openSiteMapId);
 }

 const panel=document.querySelector(`[data-site-map-panel="${siteId}"]`);
 const button=document.querySelector(`[data-site-map-toggle="${siteId}"]`);
 if(!panel||!button)return;

 panel.classList.remove('hidden');
 button.setAttribute('aria-expanded','true');
 const icon=button.querySelector('.site-map-toggle-icon');
 if(icon)icon.textContent='−';
 openSiteMapId=siteId;

 try{
   const L=await loadLeaflet();
   const lat=Number(site.latitude);
   const lon=Number(site.longitude);

   if(!siteMaps.has(siteId)){
     const map=L.map(`siteMap-${siteId}`,{
       scrollWheelZoom:false,
       attributionControl:true
     }).setView([lat,lon],17);

     L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{
       maxZoom:19,
       attribution:'&copy; OpenStreetMap contributors'
     }).addTo(map);

     const popupParts=[`<strong>${escapeHtml(site.name)}</strong>`];
     if(site.address)popupParts.push(`<br>${escapeHtml(site.address)}`);
     if(site.three_word_location){
       popupParts.push(`<br>///${escapeHtml(String(site.three_word_location).replace(/^\/+/,''))}`);
     }

     L.marker([lat,lon])
       .addTo(map)
       .bindPopup(popupParts.join(''))
       .openPopup();

     siteMaps.set(siteId,map);
   }

   setTimeout(()=>siteMaps.get(siteId)?.invalidateSize(),80);
 }catch(error){
   const canvas=document.getElementById(`siteMap-${siteId}`);
   if(canvas){
     canvas.innerHTML='<div class="site-map-error">Map could not be loaded. Use “Open larger map” instead.</div>';
   }
 }
}

function setupSiteMapDisclosures(){
 document.addEventListener('click',event=>{
   const button=event.target.closest('[data-site-map-toggle]');
   if(!button)return;

   const siteId=Number(button.dataset.siteMapToggle);
   const isOpen=button.getAttribute('aria-expanded')==='true';

   if(isOpen){
     closeSiteMap(siteId);
   }else{
     openSiteMap(siteId);
   }
 });
}


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
   <td>
     <strong>${escapeHtml(siteName(a.survey_site_id))}</strong><br>
     <small>${escapeHtml(r.name)}</small>
     ${mapDisclosureHtml(a.survey_site_id)}
   </td>
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
 openSiteMapId=null;
 const rows=db.rounds.flatMap(r=>roundAssignments(r).map(a=>row(r,a)));
 $('scheduleBody').innerHTML=rows.join('')||'<tr><td colspan="5">No upcoming surveys scheduled.</td></tr>';
 stats(db.rounds);
}

function renderOne(id){
 openSiteMapId=null;
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
setupSiteMapDisclosures();
load();
