const $ = id => document.getElementById(id);
const KEY = "counter-bell-v2";
const BROKERS = ["wss://broker.emqx.io:8084/mqtt","wss://test.mosquitto.org:8081/mqtt","wss://broker.hivemq.com:8884/mqtt"];
const state = {code:"",server:"https://ntfy.sh",role:null,repeat:false,armed:false,ringing:false,count:0,history:[],client:null,broker:0,lastId:"",audio:null,timers:{},installPrompt:null,cooldown:false};

function slug(value){return value.toLowerCase().replace(/[^a-z0-9_-]/g,"").slice(0,48)}
function topic(){return "counterbell-"+state.code}
function pushUrl(){return state.server.replace(/\/+$/,"")+"/"+encodeURIComponent(topic())}
function save(){localStorage.setItem(KEY,JSON.stringify({code:state.code,server:state.server,role:state.role,repeat:state.repeat,count:state.count,history:state.history.slice(0,40)}))}
function load(){try{const v=JSON.parse(localStorage.getItem(KEY)||"{}");Object.assign(state,{code:v.code||"",server:v.server||"https://ntfy.sh",role:v.role||null,repeat:!!v.repeat,count:Number(v.count)||0,history:Array.isArray(v.history)?v.history:[]})}catch{}}
let toastTimer;
function toast(message){const el=$("toast");el.textContent=message;el.classList.add("show");clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.remove("show"),2300)}
function status(id,message){$(id).lastChild.textContent=message}
function buzz(pattern){try{navigator.vibrate?.(pattern)}catch{}}
function getAudio(){const C=window.AudioContext||window.webkitAudioContext;if(!C)return null;if(!state.audio)state.audio=new C();if(state.audio.state==="suspended")state.audio.resume().catch(()=>{});return state.audio}
function beep(freq,duration,when){const ctx=state.audio;if(!ctx)return;const osc=ctx.createOscillator(),gain=ctx.createGain();osc.type="sine";osc.frequency.value=freq;gain.gain.setValueAtTime(.0001,when);gain.gain.exponentialRampToValueAtTime(.22,when+.025);gain.gain.exponentialRampToValueAtTime(.0001,when+duration);osc.connect(gain).connect(ctx.destination);osc.start(when);osc.stop(when+duration+.03)}
function soundLoop(){if(!state.ringing||!state.armed||!state.audio)return;const t=state.audio.currentTime;beep(880,.18,t);beep(660,.18,t+.22);beep(880,.18,t+.44);state.timers.sound=setTimeout(soundLoop,1250)}
function vibrationLoop(){if(!state.ringing)return;buzz([500,180,500]);state.timers.vibe=setTimeout(vibrationLoop,1800)}
async function sendRing(){
  const id=crypto.randomUUID?crypto.randomUUID():Math.random().toString(36).slice(2)+Date.now();
  if(state.client?.connected)state.client.publish("counterbell/"+topic(),JSON.stringify({type:"ring",id}),{qos:1});
  const params=new URLSearchParams({title:"Customer at the counter",priority:"urgent",tags:"bell",click:location.href});
  try{const response=await fetch(pushUrl()+"?"+params,{method:"POST",headers:{"Content-Type":"text/plain"},body:"Someone is waiting at the counter."});return response.ok}catch{return false}
}
function connectBroker(){
  if(!window.mqtt||!state.code)return;
  if(state.client){try{state.client.end(true)}catch{}}
  const url=BROKERS[state.broker++%BROKERS.length];
  const client=mqtt.connect(url,{clientId:"cb-"+Math.random().toString(16).slice(2),clean:true,connectTimeout:5000,reconnectPeriod:5000});
  state.client=client;
  client.on("connect",()=>{state.broker=0;if(state.role==="receiver")client.subscribe("counterbell/"+topic(),{qos:1})});
  client.on("message",(_topic,payload)=>{try{const data=JSON.parse(payload.toString());if(data.type==="ring")receiveRing(data.id)}catch{}});
}
function receiveRing(id){
  if(id&&id===state.lastId)return;if(id)state.lastId=id;
  const now=new Date();state.ringing=true;$("alert-time").textContent=now.toLocaleString();
  $("alert-screen").hidden=false;document.title="Customer waiting · Counter Bell";
  if(state.armed){getAudio();soundLoop()}vibrationLoop();buzz([500,180,500]);
  state.history.unshift({at:now.toISOString(),kind:"customer"});state.history=state.history.slice(0,40);save();renderHistory();
  if(state.repeat)scheduleRepeat(1);
}
function scheduleRepeat(n){if(!state.ringing||n>5)return;state.timers.repeat=setTimeout(async()=>{if(!state.ringing)return;await sendRing();scheduleRepeat(n+1)},60000)}
function dismiss(){state.ringing=false;Object.values(state.timers).forEach(clearTimeout);state.timers={};buzz(0);$("alert-screen").hidden=true;document.title="Counter Bell";if(state.role==="receiver")status("phone-status","Waiting for a call")}
function renderHistory(){
  const list=$("history-list");if(!state.history.length){list.innerHTML='<li class="empty">No calls received yet.</li>';return}
  list.replaceChildren(...state.history.slice(0,12).map(item=>{const li=document.createElement("li"),label=document.createElement("span"),time=document.createElement("time");label.textContent=item.kind==="test"?"Test alert":"Customer at counter";time.textContent=new Date(item.at).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"});li.append(label,time);return li}))
}
function show(which){$("onboarding").hidden=which!=="onboarding";$("station").hidden=which!=="station";$("receiver").hidden=which!=="receiver"}
function openSettings(){show("onboarding");$("channel").value=state.code;$("server").value=state.server==="https://ntfy.sh"?"":state.server}
function enter(role){
  const code=slug($("channel").value.trim());if(!code){toast("Add a channel code first.");return}
  state.code=code;state.server=($("server").value.trim()||"https://ntfy.sh").replace(/\/+$/,"");if(!/^https?:\/\//i.test(state.server)){toast("Server URL must start with https://");return}
  state.role=role;save();
  if(role==="station"){$("station-channel").textContent="#"+topic();$("call-count").textContent=state.count;show("station")}
  else{$("channel-name").textContent=topic();$("qr-code").src="https://api.qrserver.com/v1/create-qr-code/?size=352x352&data="+encodeURIComponent(state.server+"/"+topic());$("repeat-alert").checked=state.repeat;renderHistory();show("receiver")}
  connectBroker();
}
function generateCode(){const bytes=new Uint8Array(9);crypto.getRandomValues(bytes);$("channel").value="shop-"+Array.from(bytes,b=>b.toString(16).padStart(2,"0")).join("")}
$("generate").addEventListener("click",generateCode);
$("choose-station").addEventListener("click",()=>enter("station"));
$("choose-phone").addEventListener("click",()=>enter("receiver"));
$("station-settings").addEventListener("click",openSettings);$("phone-settings").addEventListener("click",openSettings);
$("call-button").addEventListener("click",async()=>{
  if(state.cooldown)return;state.cooldown=true;const button=$("call-button"),title=$("call-title");button.dataset.state="sending";title.textContent="Sending…";
  const ok=await sendRing();state.count++;$("call-count").textContent=state.count;save();button.dataset.state=ok?"sent":"failed";title.textContent=ok?"Call sent":"Couldn't send";status("station-status",ok?"Alert sent":"Connection problem");
  setTimeout(()=>{button.dataset.state="";title.textContent="Tap to call";status("station-status","Ready for customers");state.cooldown=false},1800);
});
$("dismiss-alert").addEventListener("click",dismiss);
$("repeat-alert").addEventListener("change",e=>{state.repeat=e.target.checked;save()});
$("arm-sound").addEventListener("click",()=>{getAudio();if(!state.audio){toast("Audio is not supported on this browser.");return}beep(880,.16,state.audio.currentTime);state.armed=true;$("arm-sound").textContent="Enabled";$("arm-description").textContent="Backup sound is enabled while this page stays open."});
$("test-alert").addEventListener("click",async()=>{const button=$("test-alert");button.disabled=true;button.textContent="Sending test…";const ok=await sendRing();state.history.unshift({at:new Date().toISOString(),kind:"test"});state.history=state.history.slice(0,40);save();renderHistory();button.textContent=ok?"Test alert sent":"Could not send";if(!ok)toast("Check your internet connection and channel code.");setTimeout(()=>{button.disabled=false;button.textContent="Send a test alert"},2000)});
$("copy-channel").addEventListener("click",async()=>{try{await navigator.clipboard.writeText(topic());toast("Channel copied")}catch{toast("Copy unavailable in this browser")}});
$("open-ntfy").addEventListener("click",()=>{location.href="ntfy://"+state.server.replace(/^https?:\/\//,"")+"/"+topic()});
$("open-browser").addEventListener("click",()=>window.open(pushUrl(),"_blank","noopener,noreferrer"));
$("install-app").addEventListener("click",async()=>{if(state.installPrompt){state.installPrompt.prompt();await state.installPrompt.userChoice;state.installPrompt=null}else toast(/iPhone|iPad|iPod/.test(navigator.userAgent)?"In Safari, tap Share, then Add to Home Screen.":"Open your browser menu and choose Install app.")});
window.addEventListener("beforeinstallprompt",e=>{e.preventDefault();state.installPrompt=e});
if("serviceWorker"in navigator)window.addEventListener("load",()=>navigator.serviceWorker.register("./sw.js").catch(()=>{}));
document.addEventListener("visibilitychange",()=>{if(document.visibilityState==="visible"&&state.role&&!state.client?.connected)connectBroker()});
window.addEventListener("online",()=>{if(state.role)connectBroker()});
load();$("channel").value=state.code;if(!state.code)generateCode();$("server").value=state.server==="https://ntfy.sh"?"":state.server;
if(state.role&&state.code)enter(state.role);else show("onboarding");
