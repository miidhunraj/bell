const $ = id => document.getElementById(id);
const STORE = "callbell.v2";
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
  if(v.startsWith("call-bell-")) v=v.slice("call-bell-".length);
  if(v.startsWith("cb-")) return v;
  return v;
}
function topic(){ return "call-bell-" + state.code; }
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
  playChime();vibrate([700,250,700,250,1000]);
  state.alarmTimer=setInterval(()=>{if(state.alarmActive)playChime();},2400);
  state.vibrationTimer=setInterval(()=>{if(state.alarmActive)vibrate([700,250,700,250,1000]);},2800);
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
    title:isTest?"Call Bell test":"A guest is waiting",
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
  $("open-ntfy").textContent="Open in ntfy app";
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
  const ok=await sendNtfy("Call Bell test alert. If you hear this, phone notifications are reaching your device.",true);
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
  // One short haptic acknowledgement on the customer tablet at the instant of tap.
  try{if(navigator.vibrate)navigator.vibrate(70);}catch{}
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
  vibrate([500,180,500,180,700]);
  $("alarm-state").textContent=ok?("Sound "+(navigator.vibrate?"and vibration":"; vibration not supported here")):"Audio is unavailable in this browser";
  toast(navigator.vibrate?"Sound and vibration test played":"Sound test played; this browser does not expose vibration");
}
function openSettings(){
  $("settings-code").textContent=state.code||"Not generated yet";
  if(state.code) $("shop-qr").src="https://api.qrserver.com/v1/create-qr-code/?size=260x260&data="+encodeURIComponent(state.code);
  $("fullscreen-button").innerHTML=document.fullscreenElement?'Exit fullscreen <span>⛶</span>':'Enter fullscreen <span>⛶</span>';
  $("settings-modal").hidden=false;
}
function closeSettings(){$("settings-modal").hidden=true;}

function closeScanner(){
  if(state.scanLoop)cancelAnimationFrame(state.scanLoop);
  state.scanLoop=null;
  if(state.scannerStream){state.scannerStream.getTracks().forEach(t=>t.stop());state.scannerStream=null;}
  $("scanner-modal").hidden=true;
}
async function startScanner(){
  $("scanner-modal").hidden=false;
  $("scanner-status").textContent="Requesting camera permission…";
  if(!navigator.mediaDevices?.getUserMedia){
    $("scanner-status").textContent="Camera scanning requires HTTPS and a supported browser.";
    return;
  }
  if(!("BarcodeDetector" in window)){
    $("scanner-status").textContent="QR scanning is not supported by this browser. Use the manual code field.";
    return;
  }
  try{
    state.scannerStream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:"environment"}},audio:false});
    $("scanner-video").srcObject=state.scannerStream;
    await $("scanner-video").play();
    state.barcodeDetector=new BarcodeDetector({formats:["qr_code"]});
    $("scanner-status").textContent="Point the camera at the tablet’s QR code…";
    const scan=async()=>{
      if(!state.scannerStream||$("scanner-modal").hidden)return;
      try{
        const codes=await state.barcodeDetector.detect($("scanner-video"));
        if(codes.length){
          const raw=(codes[0].rawValue||"").trim();
          const decoded=normaliseCode(raw);
          if(decoded.length>=8){
            $("shop-code").value=decoded;
            try{await navigator.clipboard.writeText(decoded);}catch{}
            closeScanner();
            toast("Shop code scanned and filled in");
            joinPhone();
            return;
          }
        }
      }catch{}
      state.scanLoop=requestAnimationFrame(scan);
    };
    scan();
  }catch(err){
    $("scanner-status").textContent=err.name==="NotAllowedError"?"Camera permission was denied. Allow camera access and try again.":"Could not start the camera. You can paste the code manually.";
  }
}

function resetDevice(){
  if(!confirm("Reset this device's Call Bell setup?"))return;
  stopAlarm();if(state.stream)state.stream.close();
  if(state.cooldownTimer)clearInterval(state.cooldownTimer);
  localStorage.removeItem(STORE);state.code="";state.role=null;screen("setup");closeSettings();
}
$("setup-counter").addEventListener("click",showCounter);
$("setup-phone").addEventListener("click",showPhoneConnect);
$("back-setup").addEventListener("click",()=>screen("setup"));
$("join-shop").addEventListener("click",joinPhone);
$("scan-code").addEventListener("click",startScanner);
$("close-scanner").addEventListener("click",closeScanner);
$("scanner-manual").addEventListener("click",closeScanner);
$("scanner-modal").addEventListener("click",e=>{if(e.target===$("scanner-modal"))closeScanner();});
document.addEventListener("fullscreenchange",()=>{
  if(!$("settings-modal").hidden)$("fullscreen-button").innerHTML=document.fullscreenElement?'Exit fullscreen <span>⛶</span>':'Enter fullscreen <span>⛶</span>';
});
window.addEventListener("beforeinstallprompt",e=>{e.preventDefault();state.installPrompt=e;});
$("install-app").addEventListener("click",async()=>{
  if(state.installPrompt){
    state.installPrompt.prompt();
    await state.installPrompt.userChoice;
    state.installPrompt=null;
  }else{
    toast(/iPhone|iPad|iPod/i.test(navigator.userAgent)?"In Safari: Share → Add to Home Screen":"Open browser menu → Install app / Add to Home Screen");
  }
});
$("copy-phone-topic").addEventListener("click",()=>copy(topic(),"ntfy topic"));
$("open-ntfy").addEventListener("click",()=>{
  // Use ntfy's app URI scheme so Android/iOS can hand off to the installed app.
  window.location.href="ntfy://ntfy.sh/"+encodeURIComponent(topic());
});
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
$("fullscreen-button").addEventListener("click",async()=>{
  try{
    if(document.fullscreenElement){await document.exitFullscreen();toast("Exited fullscreen");}
    else if(document.documentElement.requestFullscreen){await document.documentElement.requestFullscreen();toast("Fullscreen enabled");}
    else toast("Use your browser menu to enter fullscreen.");
  }catch{toast("Fullscreen is controlled by your browser on this device.");}
  $("fullscreen-button").innerHTML=document.fullscreenElement?'Exit fullscreen <span>⛶</span>':'Enter fullscreen <span>⛶</span>';
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
