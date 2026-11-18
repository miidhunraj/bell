const $ = id => document.getElementById(id);
const STORE = "counterbell.v2";
const state = {
  code:"", role:null, stream:null, audio:null, alarmTimer:null, vibrationTimer:null,
  cooldownTimer:null, remaining:30, busy:false, alarmActive:false, lastMessage:""
};
const ntfyBase = "https://ntfy.sh";

function makeCode(){
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return "cb-" + Array.from(bytes,b=>b.toString(16).padStart(2,"0")).join("");
}
function normaliseCode(value){
  let v=value.trim().toLowerCase().replace(/[^a-z0-9_-]/g,"");
  if(v.startsWith("counter-bell-")) v=v.slice("counter-bell-".length);
  if(v.startsWith("cb-")) return v;
  return v;
}
function topic(){ return "counter-bell-" + state.code; }
function save(){ localStorage.setItem(STORE,JSON.stringify({code:state.code,role:state.role})); }
function load(){
  try{const v=JSON.parse(localStorage.getItem(STORE)||"{}");state.code=v.code||"";state.role=v.role||null;}catch{}
}
function toast(message){
  const el=$("toast");el.textContent=message;el.classList.add("show");
  clearTimeout(toast.timer);toast.timer=setTimeout(()=>el.classList.remove("show"),2500);
}
function screen(name){
  for(const [id,key] of [["setup-view","setup"],["connect-view","connect"],["receiver-view","receiver"],["kiosk-view","kiosk"]]) $(id).hidden=key!==name;
  document.body.classList.toggle("kiosk-mode",name==="kiosk");
}
function vibrate(pattern){try{if("vibrate" in navigator) navigator.vibrate(pattern);}catch{}}
function audioContext(){
  const C=window.AudioContext||window.webkitAudioContext;
  if(!C)return null;
  if(!state.audio)state.audio=new C();
  if(state.audio.state==="suspended")state.audio.resume().catch(()=>{});
  return state.audio;
}
function beep(freq,duration,when){
  const ctx=audioContext();if(!ctx)return;
  const osc=ctx.createOscillator(),gain=ctx.createGain();
  osc.type="sine";osc.frequency.setValueAtTime(freq,when);
  gain.gain.setValueAtTime(.0001,when);
  gain.gain.exponentialRampToValueAtTime(.25,when+.025);
  gain.gain.exponentialRampToValueAtTime(.0001,when+duration);
  osc.connect(gain);gain.connect(ctx.destination);osc.start(when);osc.stop(when+duration+.04);
}
function playChime(){
  const ctx=audioContext();if(!ctx)return false;
  const t=ctx.currentTime;
  beep(784,.28,t);beep(988,.32,t+.22);beep(1175,.42,t+.48);
  return true;
}
function stopAlarm(){
  state.alarmActive=false;
  clearInterval(state.alarmTimer);clearInterval(state.vibrationTimer);
  state.alarmTimer=state.vibrationTimer=null;
  try{navigator.vibrate?.(0);}catch{}
  $("alarm-overlay").hidden=true;
}
function startAlarm(message="A guest has called from the counter."){
  if(state.alarmActive)return;
  state.alarmActive=true;
  $("alarm-time").textContent=message;
  $("alarm-overlay").hidden=false;
  playChime();vibrate([500,220,500,650]);
  state.alarmTimer=setInterval(()=>{if(state.alarmActive)playChime();},2200);
  state.vibrationTimer=setInterval(()=>{if(state.alarmActive)vibrate([500,220,500,650]);},2600);
}
function setReceiverStatus(text,live=false){
  $("receiver-status").dataset.state=live?"live":"";
  $("receiver-status").lastChild.textContent=text;
  $("stream-label").textContent=live?"Live connection · listening for calls":"Reconnecting · keep this page open";
}
function connectStream(){
  if(state.stream){state.stream.close();state.stream=null;}
  if(!state.code)return;
  const url=ntfyBase+"/"+encodeURIComponent(topic())+"/sse";
  try{
    const stream=new EventSource(url);
    state.stream=stream;
    stream.onopen=()=>setReceiverStatus("Listening",true);
    stream.onerror=()=>setReceiverStatus("Reconnecting",false);
    stream.onmessage=(event)=>{
      try{
        const data=JSON.parse(event.data);
        if(data.event==="message" && data.id!==state.lastMessage){
          state.lastMessage=data.id||String(Date.now());
          $("push-state").textContent="A message reached this phone";
          startAlarm(data.message||"A guest has called from the counter.");
        }
      }catch{}
    };
  }catch(error){console.warn("ntfy live stream could not start",error);setReceiverStatus("Offline",false);}
}
async function sendNtfy(message,isTest=false){
  const query=new URLSearchParams({
    title:isTest?"Counter Bell test":"A guest is waiting",
    priority:"urgent",
    tags:"bell,rotating_light",
    click:location.href
  });
  const url=ntfyBase+"/"+encodeURIComponent(topic())+"?"+query.toString();
  try{
    const response=await fetch(url,{
      method:"POST",
      headers:{"Content-Type":"text/plain;charset=UTF-8"},
      body:message
    });
    return response.ok;
  }catch(error){
    console.error("ntfy request failed",error);
    return false;
  }
}
async function copy(value,label){
  try{await navigator.clipboard.writeText(value);toast(label+" copied");}
  catch{toast("Copy unavailable — please select and copy the code.");}
}
function showCounter(){
  if(!state.code)state.code=makeCode();
  state.role="counter";save();screen("kiosk");
  // Fullscreen is attempted only in response to this user gesture.
  const root=document.documentElement;
  if(!document.fullscreenElement && root.requestFullscreen){
    root.requestFullscreen().catch(()=>{});
  }
  if("wakeLock" in navigator)navigator.wakeLock.request("screen").catch(()=>{});
  $("settings-code").textContent=state.code;
}
function showPhoneConnect(){
  state.role="phone";save();screen("connect");
  $("connect-result").hidden=true;
}
function joinPhone(){
  const code=normaliseCode($("shop-code").value);
  if(!code || code.length<8){toast("Enter the shop code shown on your counter tablet.");$("shop-code").focus();return;}
  state.code=code;state.role="phone";save();
  $("phone-topic").textContent=topic();
  $("open-ntfy").href="https://ntfy.sh/"+encodeURIComponent(topic());
  $("connect-result").hidden=false;
}
function showReceiver(){
  if(!state.code){toast("Connect using your shop code first.");return;}
  state.role="phone";save();screen("receiver");
  $("receiver-topic").textContent=topic();
  connectStream();
}
async function testPush(){
  $("push-state").textContent="Sending test…";
  const ok=await sendNtfy("Counter Bell test alert. If you hear this, phone notifications are reaching your device.",true);
  $("push-state").textContent=ok?"Test sent — check ntfy notifications":"Could not send — check internet and topic";
  toast(ok?"Test sent. Check the ntfy app.":"Test failed. Check your connection.");
}
function startCooldown(){
  state.remaining=30;
  $("thanks-overlay").hidden=false;
  $("guest-button").disabled=true;
  $("countdown-number").textContent="30";
  $("countdown-text").textContent="You can call again in 30 seconds";
  $("countdown-bar").style.width="100%";
  state.cooldownTimer=setInterval(()=>{
    state.remaining--;
    $("countdown-number").textContent=String(state.remaining);
    $("countdown-text").textContent=state.remaining>0?`You can call again in ${state.remaining} seconds`:"Ready for another guest";
    $("countdown-bar").style.width=(state.remaining/30*100)+"%";
    if(state.remaining<=0){
      clearInterval(state.cooldownTimer);state.cooldownTimer=null;
      $("thanks-overlay").hidden=true;$("guest-button").disabled=false;
    }
  },1000);
}
async function guestCall(){
  if(state.busy||state.cooldownTimer)return;
  state.busy=true;$("guest-button").disabled=true;
  $("guest-label").textContent="Sending your message…";
  const ok=await sendNtfy("A guest is waiting at the counter. Please assist them.",false);
  state.busy=false;
  if(!ok){
    $("guest-button").disabled=false;
    $("guest-label").textContent="Tap to call our team";
    toast("Could not send. Please try again or let a team member know.");
    return;
  }
  $("guest-label").textContent="Message sent";
  startCooldown();
}
async function testLocalAlarm(){
  // This button click is the required user gesture to unlock mobile audio.
  const ok=playChime();
  vibrate([350,180,350]);
  $("alarm-state").textContent=ok?("Sound "+(navigator.vibrate?"and vibration":"; vibration not supported here")):"Audio is unavailable in this browser";
  toast(navigator.vibrate?"Sound and vibration test played":"Sound test played; this browser does not expose vibration");
}
function openSettings(){
  $("settings-code").textContent=state.code||"Not generated yet";
  $("settings-modal").hidden=false;
}
function closeSettings(){$("settings-modal").hidden=true;}
function resetDevice(){
  if(!confirm("Reset this device's Counter Bell setup?"))return;
  stopAlarm();if(state.stream)state.stream.close();
  if(state.cooldownTimer)clearInterval(state.cooldownTimer);
  localStorage.removeItem(STORE);state.code="";state.role=null;screen("setup");closeSettings();
}
$("setup-counter").addEventListener("click",showCounter);
$("setup-phone").addEventListener("click",showPhoneConnect);
$("back-setup").addEventListener("click",()=>screen("setup"));
$("join-shop").addEventListener("click",joinPhone);
$("copy-phone-topic").addEventListener("click",()=>copy(topic(),"ntfy topic"));
$("go-receiver").addEventListener("click",showReceiver);
$("test-alarm").addEventListener("click",testLocalAlarm);
$("test-push").addEventListener("click",testPush);
$("copy-receiver-topic").addEventListener("click",()=>copy(topic(),"ntfy topic"));
$("guest-button").addEventListener("click",guestCall);
$("kiosk-settings").addEventListener("click",openSettings);
$("receiver-settings").addEventListener("click",openSettings);
$("close-modal").addEventListener("click",closeSettings);
$("settings-modal").addEventListener("click",e=>{if(e.target===$("settings-modal"))closeSettings();});
$("copy-settings-code").addEventListener("click",()=>copy(state.code,"Shop code"));
$("fullscreen-button").addEventListener("click",()=>{
  const p=document.documentElement.requestFullscreen?.();
  if(p&&p.then)p.then(()=>toast("Fullscreen enabled")).catch(()=>toast("Use your browser menu to enter fullscreen."));
  else toast("Use your browser menu to enter fullscreen.");
});
$("settings-test").addEventListener("click",testPush);
$("reset-device").addEventListener("click",resetDevice);
$("stop-alarm").addEventListener("click",stopAlarm);
document.addEventListener("visibilitychange",()=>{
  if(document.visibilityState==="visible"&&state.role==="phone"&&state.code&&$("receiver-view").hidden===false)connectStream();
});
window.addEventListener("online",()=>{if(state.role==="phone"&&!$("receiver-view").hidden)connectStream();});
window.addEventListener("beforeunload",()=>{if(state.stream)state.stream.close();if(state.cooldownTimer)clearInterval(state.cooldownTimer);});

load();
if(state.role==="counter"&&state.code){$("settings-code").textContent=state.code;screen("kiosk");}
else if(state.role==="phone"&&state.code){$("shop-code").value=state.code;screen("connect");joinPhone();}
else screen("setup");

if("serviceWorker" in navigator){
  window.addEventListener("load",()=>navigator.serviceWorker.register("./sw.js").catch(err=>console.warn("Service worker registration failed",err)));
}
