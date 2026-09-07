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
let openSiteMapKey=null;
const siteMaps=new Map();

/*
 * Reuse the live Canal Watch FreshWater Watch dataset.
 * No survey-scheduler database fields are required.
 */
const WATER_QUALITY_CSV_URL =
  'https://raylancashire.github.io/queens-park-canal-map/freshwater.csv';

let waterQualityPromise=null;
let latestWaterQualityBySite=new Map();

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


function parseCsv(text){
 const rows=[];
 let row=[];
 let field='';
 let quoted=false;

 for(let i=0;i<text.length;i++){
   const char=text[i];

   if(quoted){
     if(char==='"'){
       if(text[i+1]==='"'){
         field+='"';
         i++;
       }else{
         quoted=false;
       }
     }else{
       field+=char;
     }
     continue;
   }

   if(char==='"'){
     quoted=true;
   }else if(char===','){
     row.push(field);
     field='';
   }else if(char==='\n'){
     row.push(field);
     rows.push(row);
     row=[];
     field='';
   }else if(char!=='\r'){
     field+=char;
   }
 }

 if(field!==''||row.length){
   row.push(field);
   rows.push(row);
 }

 if(!rows.length)return [];

 const headers=rows[0].map(h=>String(h||'').trim());

 return rows.slice(1)
   .filter(r=>r.some(v=>String(v||'').trim()!==''))
   .map(r=>{
     const item={};
     headers.forEach((h,index)=>{
       item[h]=String(r[index]??'').trim();
     });
     return item;
   });
}

function waterField(record,...names){
 for(const name of names){
   if(Object.prototype.hasOwnProperty.call(record,name)){
     const value=record[name];
     if(value!==undefined&&value!==null&&String(value).trim()!==''){
       return String(value).trim();
     }
   }
 }
 return '';
}

function normaliseWaterSiteName(value){
 return String(value||'')
   .toLowerCase()
   .replace(/^grand\s+union\s+canal\s*[-–—:]\s*/,'')
   .replace(/\b(sampling\s+)?site\b/g,' ')
   .replace(/\bgroup\b/g,' ')
   .replace(/&/g,' and ')
   .replace(/[^a-z0-9]+/g,' ')
   .replace(/\s+/g,' ')
   .trim();
}

function waterSiteName(record){
 return waterField(
   record,
   'Site Name','site_name','Site','site',
   'Sampling Site','sampling_site'
 );
}

function waterSampleDate(record){
 return waterField(record,'Sample Date','sample_date','Date','date');
}

function waterDateValue(value){
 const raw=String(value||'').trim();
 if(!raw)return 0;

 let match=raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
 if(match){
   return Date.UTC(Number(match[1]),Number(match[2])-1,Number(match[3]));
 }

 match=raw.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})/);
 if(match){
   return Date.UTC(Number(match[3]),Number(match[2])-1,Number(match[1]));
 }

 const parsed=Date.parse(raw);
 return Number.isNaN(parsed)?0:parsed;
}

function waterAssessment(record){
 const text=(
   waterField(record,'Assessment','assessment')+' '+
   waterField(record,'feedback_eng','Feedback','feedback_core')
 ).toLowerCase();

 if(text.includes('very poor')){
   return {label:'Very Poor',key:'very-poor'};
 }
 if(text.includes('excellent')||text.includes('very good')){
   return {label:'Excellent',key:'excellent'};
 }
 if(text.includes('good')){
   return {label:'Good',key:'good'};
 }
 if(text.includes('fair')||text.includes('moderate')){
   return {label:'Fair',key:'fair'};
 }
 if(text.includes('poor')){
   return {label:'Poor',key:'poor'};
 }

 return {label:'Not yet assessed',key:'unrated'};
}

async function loadWaterQualityAssessments(){
 if(waterQualityPromise)return waterQualityPromise;

 waterQualityPromise=(async()=>{
   try{
     const response=await fetch(WATER_QUALITY_CSV_URL,{cache:'no-store'});
     if(!response.ok)throw new Error(`HTTP ${response.status}`);

     const records=parseCsv(await response.text());
     const latest=new Map();

     records.forEach(record=>{
       const siteKey=normaliseWaterSiteName(waterSiteName(record));
       if(!siteKey)return;

       const dateValue=waterDateValue(waterSampleDate(record));
       const current=latest.get(siteKey);

       if(!current||dateValue>=current.dateValue){
         latest.set(siteKey,{
           record,
           dateValue,
           assessment:waterAssessment(record)
         });
       }
     });

     latestWaterQualityBySite=latest;
   }catch(error){
     console.warn('Canal Watch water-quality pin data could not be loaded:',error);
     latestWaterQualityBySite=new Map();
   }

   return latestWaterQualityBySite;
 })();

 return waterQualityPromise;
}

function latestWaterQualityForSurveySite(site){
 const wanted=normaliseWaterSiteName(site?.name);
 if(!wanted)return null;

 // Exact normalised-name match first.
 const exact=latestWaterQualityBySite.get(wanted);
 if(exact)return exact;

 // Safe fallback for names such as "Half Penny Steps" / "Half Penny Steps Group".
 for(const [key,value] of latestWaterQualityBySite.entries()){
   if(key===wanted||key.includes(wanted)||wanted.includes(key)){
     return value;
   }
 }

 return null;
}

function waterResultPinHtml(assessment){
 const key=assessment?.key||'unrated';

 return `
   <div
     class="water-result-map-pin ${key}"
     aria-hidden="true">
     <span></span>
   </div>`;
}

function siteFor(id){
 return db.sites.find(s=>s.id===id);
}

function hasCoordinates(site){
 return site &&
   Number.isFinite(Number(site.latitude)) &&
   Number.isFinite(Number(site.longitude));
}

function mapDisclosureHtml(siteId, mapKey=siteId){
 const site=siteFor(siteId);
 if(!hasCoordinates(site))return '';

 return `
   <button
     type="button"
     class="site-map-toggle"
     data-site-map-toggle="${mapKey}" data-site-id="${siteId}"
     aria-expanded="false">
     <span>View map</span>
     <span class="site-map-toggle-icon" aria-hidden="true">＋</span>
   </button>`;
}

function mapRowHtml(siteId, mapKey=siteId){
 const site=siteFor(siteId);
 if(!hasCoordinates(site))return '';

 const words=site.three_word_location
   ? `///${escapeHtml(String(site.three_word_location).replace(/^\/+/,''))}`
   : '';

 const meta=[site.address?escapeHtml(site.address):'',words]
   .filter(Boolean)
   .join(' • ');

 return `
   <tr
     class="site-map-table-row hidden"
     data-site-map-row="${mapKey}">
     <td colspan="5">
       <div class="site-map-full-panel">
         ${meta?`<div class="site-map-meta">${meta}</div>`:''}

         <div
           id="siteMap-${mapKey}"
           class="site-map-canvas site-map-canvas-full"
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
     </td>
   </tr>`;
}


function closeSiteMap(mapKey){
 const row=document.querySelector(`[data-site-map-row="${mapKey}"]`);
 const button=document.querySelector(`[data-site-map-toggle="${mapKey}"]`);

 if(row)row.classList.add('hidden');

 if(button){
   button.setAttribute('aria-expanded','false');
   const icon=button.querySelector('.site-map-toggle-icon');
   if(icon)icon.textContent='＋';
 }

 if(openSiteMapKey===mapKey)openSiteMapKey=null;
}

async function openSiteMap(mapKey,siteId){
 const site=siteFor(siteId);
 if(!hasCoordinates(site))return;

 if(openSiteMapKey && openSiteMapKey!==mapKey){
   closeSiteMap(openSiteMapKey);
 }

 const row=document.querySelector(`[data-site-map-row="${mapKey}"]`);
 const button=document.querySelector(`[data-site-map-toggle="${mapKey}"]`);

 if(!row||!button)return;

 row.classList.remove('hidden');
 button.setAttribute('aria-expanded','true');

 const icon=button.querySelector('.site-map-toggle-icon');
 if(icon)icon.textContent='−';

 openSiteMapKey=mapKey;

 try{
   const L=await loadLeaflet();
   const lat=Number(site.latitude);
   const lon=Number(site.longitude);

   if(!siteMaps.has(mapKey)){
     const map=L.map(`siteMap-${mapKey}`,{
       scrollWheelZoom:false,
       attributionControl:true
     }).setView([lat,lon],17);

     L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{
       maxZoom:19,
       attribution:'&copy; OpenStreetMap contributors'
     }).addTo(map);

     const popupParts=[`<strong>${escapeHtml(site.name)}</strong>`];

     if(site.address){
       popupParts.push(`<br>${escapeHtml(site.address)}`);
     }

     if(site.three_word_location){
       popupParts.push(
         `<br>///${escapeHtml(String(site.three_word_location).replace(/^\/+/,''))}`
       );
     }

     const latestWater=latestWaterQualityForSurveySite(site);
     const assessment=latestWater?.assessment||{
       label:'No current water result',
       key:'unrated'
     };

     if(latestWater){
       popupParts.push(
         `<br><span class="map-water-result-label">Latest water-quality assessment: <strong>${escapeHtml(assessment.label)}</strong></span>`
       );
     }else{
       popupParts.push(
         '<br><span class="map-water-result-label">No matching current water-quality assessment</span>'
       );
     }

     const waterIcon=L.divIcon({
       className:'water-result-map-pin-wrapper',
       html:waterResultPinHtml(assessment),
       iconSize:[30,42],
       iconAnchor:[15,42],
       popupAnchor:[0,-38]
     });

     L.marker([lat,lon],{icon:waterIcon})
       .addTo(map)
       .bindPopup(popupParts.join(''))
       .openPopup();

     siteMaps.set(mapKey,map);
   }

   setTimeout(()=>{
     const map=siteMaps.get(mapKey);
     if(map)map.invalidateSize();
   },100);

 }catch(error){
   const canvas=document.getElementById(`siteMap-${mapKey}`);

   if(canvas){
     canvas.innerHTML=
       '<div class="site-map-error">Map could not be loaded. Use “Open larger map” instead.</div>';
   }
 }
}

function setupSiteMapDisclosures(){
 document.addEventListener('click',event=>{
   const button=event.target.closest('[data-site-map-toggle]');
   if(!button)return;

   const mapKey=button.dataset.siteMapToggle;
   const siteId=Number(button.dataset.siteId);
   const isOpen=button.getAttribute('aria-expanded')==='true';

   if(isOpen){
     closeSiteMap(mapKey);
   }else{
     openSiteMap(mapKey,siteId);
   }
 });
}


async function load(){
 // Load the live FreshWater Watch assessment data in parallel with Supabase.
 const waterLoad=loadWaterQualityAssessments();

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

 // Do not block the schedule if the external CSV is temporarily unavailable.
 await waterLoad;

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

function volunteerSignupHtml(r,a){
 const url=new URL('https://www.queensparktrust.org/what-we-do/canal-watch/canal-watch-volunteer');
 url.searchParams.set('round',String(r.id));
 url.searchParams.set('site',String(a.survey_site_id));

 return `
   <a
     class="volunteer-signup-link"
     href="${url.toString()}"
     target="_top">
     Volunteer sign-up
   </a>`;
}

function row(r,a){
 const names=namesFor(a);
 const covered=a.status==='complete'||names.length>0;
 const cls=a.status==='complete'?'complete':covered?'covered':'needed';
 const label=a.status==='complete'?'Completed':covered?'Covered':'Assignment needed';
 const assigned=names.length
   ? names.map(n=>`<span class="pill">${escapeHtml(n)}</span>`).join('')
   : '—';

 return `
 <tr class="survey-main-row">
   <td>
     <strong>${escapeHtml(siteName(a.survey_site_id))}</strong><br>
     <small>${escapeHtml(r.name)}</small>

     <div class="survey-site-actions">
       ${mapDisclosureHtml(a.survey_site_id, `${r.id}-${a.survey_site_id}`)}
       ${volunteerSignupHtml(r,a)}
     </div>
   </td>

   <td>${fmtDate(r.survey_date)}</td>
   <td class="assignment-column">${assigned}</td>
   <td><span class="status ${cls}">${label}</span></td>
   <td class="${isEmbed?'':'hidden'}">${isEmbed?contactHtml(a):''}</td>
 </tr>

 ${mapRowHtml(a.survey_site_id, `${r.id}-${a.survey_site_id}`)}
 `;
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
 openSiteMapKey=null;
 const rows=db.rounds.flatMap(r=>roundAssignments(r).map(a=>row(r,a)));
 $('scheduleBody').innerHTML=rows.join('')||'<tr><td colspan="5">No upcoming surveys scheduled.</td></tr>';
 stats(db.rounds);
}

function renderOne(id){
 openSiteMapKey=null;
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
