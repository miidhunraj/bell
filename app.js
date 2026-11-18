/* CALL BELL — stable device pairing, QR camera scan and guest call flow */
"use strict";
const $ = (id) => document.getElementById(id);
const STORE = "callbell.v5";
const NTFY = "https://ntfy.sh";
const state = {
  code:"", role:null, stream:null, wakeLock:null, audio:null,
  alarmTimer:null, vibrationTimer:null, cooldownTimer:null,
  remaining:30, busy:false, alarmActive:false, lastMessage:"",
  scanStream:null, scanFrame:null, scanCanvas:null, scanContext:null,
  installPrompt:null, lastRingAt:0
};
const requiredIds = [
 "setup-view","connect-view","receiver-view","kiosk-view","setup-counter","setup-phone",
 "shop-code","start-scan","scan-panel","scan-video","stop-scan","join-shop","connect-result",
 "phone-topic","open-ntfy","go-receiver","receiver-status","alarm-state","test-alarm","push-state",
 "test-push","receiver-topic","stream-label","guest-button","thanks-overlay","settings-modal",
 "kiosk-settings","close-modal","settings-code","shop-qr","copy-settings-code",
 "fullscreen-button","install-app","settings-test","reset-device","alarm-overlay","stop-alarm","toast"
];
const missing = requiredIds.filter(id=>!$(id));
if(missing.length) console.error("Call Bell markup is missing:",missing.join(", "));

function makeCode(){
  const bytes=new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return "cb-"+Array.from(bytes,b=>b.toString(16).padStart(2,"0")).join("");
}
function cleanCode(value){
  let v=String(value||"").trim();
  try{if(v.startsWith("http")){const u=new URL(v);v=u.pathname.split("/").filter(Boolean).pop()||v;}}catch{}
  v=decodeURIComponent(v).trim().toLowerCase().replace(/^call-bell-/,"").replace(/[^a-z0-9_-]/g,"");
  return v;
}
function topic(){return "call-bell-"+state.code;}
function save(){try{localStorage.setItem(STORE,JSON.stringify({code:state.code,role:state.role}));}catch{}}
function load(){
  try{const v=JSON.parse(localStorage.getItem(STORE)||"{}");state.code=v.code||"";state.role=v.role||null;}catch{}
}
function toast(message){
  const el=$("toast");if(!el)return;
  el.textContent=message;el.classList.add("show");
  clearTimeout(toast.timer);toast.timer=setTimeout(()=>el.classList.remove("show"),2600);
}
function showScreen(name){
  const map={"setup":"setup-view","connect":"connect-view","receiver":"receiver-view","kiosk":"kiosk-view"};
  Object.entries(map).forEach(([key,id])=>$(id).hidden=key!==name);
  document.body.classList.toggle("kiosk-mode",name==="kiosk");
}
function vibrate(pattern){
  try{
    if(typeof navigator.vibrate==="function") return navigator.vibrate(pattern);
  }catch{}
  return false;
}
function getAudio(){
  const C=window.AudioContext||window.webkitAudioContext;
  if(!C)return null;
  if(!state.audio)state.audio=new C();
  if(state.audio.state==="suspended")state.audio.resume().catch(()=>{});
  return state.audio;
}
function tone(freq,duration,at){
  const ctx=getAudio();if(!ctx)return;
  const osc=ctx.createOscillator(),gain=ctx.createGain();
  osc.type="sine";osc.frequency.setValueAtTime(freq,at);
  gain.gain.setValueAtTime(.0001,at);
  gain.gain.exponentialRampToValueAtTime(.20,at+.025);
  gain.gain.exponentialRampToValueAtTime(.0001,at+duration);
  osc.connect(gain);gain.connect(ctx.destination);osc.start(at);osc.stop(at+duration+.04);
}
function playChime(){
  const ctx=getAudio();if(!ctx)return false;
  const t=ctx.currentTime;
  tone(784,.25,t);tone(988,.3,t+.22);tone(1175,.38,t+.48);
  return true;
}
function stopAlarm(){
  state.alarmActive=false;
  clearInterval(state.alarmTimer);clearInterval(state.vibrationTimer);
  state.alarmTimer=state.vibrationTimer=null;
  vibrate(0);
  $("alarm-overlay").hidden=true;
}
function startAlarm(message){
  if(state.alarmActive)return;
  state.alarmActive=true;
  $("alarm-time").textContent=message||"Someone is waiting for you.";
  $("alarm-overlay").hidden=false;
  playChime();vibrate([700,220,700,220,900]);
  state.alarmTimer=setInterval(()=>{if(state.alarmActive)playChime();},2600);
  state.vibrationTimer=setInterval(()=>{if(state.alarmActive)vibrate([700,220,700,220,900]);},3200);
  if("Notification" in window && Notification.permission==="granted"){
    try{new Notification("Call Bell — someone is waiting",{body:message||"Please come to the counter.",icon:"./icon-192.png",tag:"call-bell-ring",renotify:true});}catch{}
  }
}
function setReceiverStatus(label,live){
  const el=$("receiver-status");
  el.dataset.state=live?"live":"";
  el.innerHTML='<i></i> '+label;
  $("stream-label").textContent=live?"Connected · listening for your call":"Reconnecting · keep this page open";
}
function connectStream(){
  if(state.stream){state.stream.close();state.stream=null;}
  if(!state.code)return;
  const source=new EventSource(NTFY+"/"+encodeURIComponent(topic())+"/sse");
  state.stream=source;
  source.onopen=()=>setReceiverStatus("Listening",true);
  source.onerror=()=>setReceiverStatus("Reconnecting",false);
  source.onmessage=(event)=>{
    try{
      const data=JSON.parse(event.data);
      if(data.event!=="message" || (data.id&&data.id===state.lastMessage))return;
      state.lastMessage=data.id||String(Date.now());
      startAlarm(data.message||"Someone is waiting for you.");
      $("push-state").textContent="A call reached this phone";
    }catch(err){console.warn("Could not read Call Bell event",err);}
  };
}
async function sendNtfy(message,isTest=false){
  const query=new URLSearchParams({
    title:isTest?"Call Bell test":"Someone is waiting",
    priority:"urgent",tags:"bell,rotating_light",click:location.href
  });
  try{
    const response=await fetch(NTFY+"/"+encodeURIComponent(topic())+"?"+query,{
      method:"POST",headers:{"Content-Type":"text/plain;charset=UTF-8"},body:message
    });
    return response.ok;
  }catch(err){console.error("ntfy send failed",err);return false;}
}
async function copyText(value,label){
  try{
    await navigator.clipboard.writeText(value);
    toast(label+" copied");
  }catch{
    const field=document.createElement("textarea");field.value=value;
    field.style.position="fixed";field.style.opacity="0";document.body.appendChild(field);
    field.select();
    try{document.execCommand("copy");toast(label+" copied");}
    catch{toast("Please select and copy the code manually.");}
    field.remove();
  }
}
function makeQr(){
  if(!state.code)return;
  $("shop-qr").src="https://api.qrserver.com/v1/create-qr-code/?size=220x220&margin=8&data="+encodeURIComponent(state.code);
  $("shop-qr").alt="Scan this QR code to connect to Call Bell";
}
async function requestWakeLock(){
  try{if("wakeLock" in navigator&&!state.wakeLock)state.wakeLock=await navigator.wakeLock.request("screen");}catch{}
}
function enterKiosk(){
  if(!state.code)state.code=makeCode();
  state.role="counter";save();showScreen("kiosk");
  $("settings-code").textContent=state.code;makeQr();requestWakeLock();
  if(document.documentElement.requestFullscreen&&!document.fullscreenElement){
    document.documentElement.requestFullscreen().catch(()=>{});
  }
}
function enterPhoneSetup(){
  state.role="phone";save();showScreen("connect");
  $("shop-code").value=state.code||"";
  $("connect-result").hidden=true;
}
function joinPhone(){
  const code=cleanCode($("shop-code").value);
  if(code.length<8){toast("Please scan or enter the shop code from your tablet.");$("shop-code").focus();return;}
  state.code=code;state.role="phone";save();
  $("shop-code").value=code;
  $("phone-topic").textContent=topic();
  $("connect-result").hidden=false;
  // Ask for web notification permission only after a deliberate user action.
  if("Notification" in window && Notification.permission==="default"){
    Notification.requestPermission().then(p=>{
      if(p==="granted")toast("Browser notifications enabled");
    }).catch(()=>{});
  }
}
function openNtfyApp(){
  const appUrl="ntfy://ntfy.sh/"+encodeURIComponent(topic());
  // Try native app scheme. If it is not registered, leave the topic visible for manual setup.
  window.location.href=appUrl;
  setTimeout(()=>toast("If ntfy did not open, install it and subscribe to the topic shown here."),1200);
}
function openReceiver(){
  if(!state.code){toast("Connect this phone to your shop first.");return;}
  state.role="phone";save();showScreen("receiver");
  $("receiver-topic").textContent=topic();connectStream();
}
function openSettings(){
  $("settings-code").textContent=state.code||"Not generated yet";
  makeQr();
  $("fullscreen-button").innerHTML=document.fullscreenElement?"Exit fullscreen <span>⛶</span>":"Enter fullscreen <span>⛶</span>";
  $("settings-modal").hidden=false;
}
function closeSettings(){$("settings-modal").hidden=true;}
async function testPush(){
  $("push-state").textContent="Sending test…";
  const ok=await sendNtfy("This is a Call Bell test. Check that the ntfy app received it.",true);
  $("push-state").textContent=ok?"Sent to ntfy · check your notification":"Could not send · check internet";
  toast(ok?"Test sent to ntfy":"Test notification failed");
}
function startCooldown(){
  state.remaining=30;$("thanks-overlay").hidden=false;$("guest-button").disabled=true;
  $("countdown-number").textContent="30";$("countdown-text").textContent="You can call again in 30 seconds";
  $("countdown-bar").style.width="100%";
  clearInterval(state.cooldownTimer);
  state.cooldownTimer=setInterval(()=>{
    state.remaining--;
    $("countdown-number").textContent=String(state.remaining);
    $("countdown-text").textContent=state.remaining>0?"You can call again in "+state.remaining+" seconds":"Ready for another guest";
    $("countdown-bar").style.width=(state.remaining/30*100)+"%";
    if(state.remaining<=0){
      clearInterval(state.cooldownTimer);state.cooldownTimer=null;
      $("thanks-overlay").hidden=true;$("guest-button").disabled=false;
    }
  },1000);
}
async function guestCall(){
  if(state.busy||state.cooldownTimer)return;
  vibrate(65); // short acknowledgement on the customer tablet, where supported
  state.busy=true;$("guest-button").disabled=true;
  const label=$("guest-button").querySelector(".guest-label");label.textContent="Sending your call…";
  const ok=await sendNtfy("A guest is waiting for you. Please come to the counter.",false);
  state.busy=false;
  if(!ok){
    $("guest-button").disabled=false;label.textContent="Tap to call me";
    toast("Could not send the call. Please check the internet connection.");
    return;
  }
  label.textContent="Call sent";
  startCooldown();
}
function testLocalAlarm(){
  const sound=playChime();
  const buzz=vibrate([450,180,450,180,700]);
  $("alarm-state").textContent=sound?(buzz?"Sound and vibration test played":"Sound works · vibration is not supported here"):"Audio is unavailable in this browser";
  toast(buzz?"Sound and vibration tested":"Sound tested · device/browser does not expose vibration");
}
async function startQrScan(){
  const panel=$("scan-panel"),video=$("scan-video");
  panel.hidden=false;
  $("scan-hint").textContent="Opening your rear camera…";
  if(!navigator.mediaDevices||!navigator.mediaDevices.getUserMedia){
    $("scan-hint").textContent="Camera needs HTTPS and browser permission. Paste the code manually if needed.";
    return;
  }
  if(typeof window.jsQR!=="function"){
    $("scan-hint").textContent="QR scanner library did not load. Paste the shop code manually.";
    return;
  }
  try{
    state.scanStream=await navigator.mediaDevices.getUserMedia({audio:false,video:{facingMode:{ideal:"environment"},width:{ideal:1280},height:{ideal:720}}});
    video.srcObject=state.scanStream;
    await video.play();
    $("scan-hint").textContent="Camera ready — hold the tablet QR inside the camera view.";
    state.scanCanvas=document.createElement("canvas");
    state.scanContext=state.scanCanvas.getContext("2d",{willReadFrequently:true});
    const scan=()=>{
      if(!state.scanStream||panel.hidden)return;
      if(video.readyState>=2){
        const w=video.videoWidth,h=video.videoHeight;
        if(w&&h){
          state.scanCanvas.width=w;state.scanCanvas.height=h;
          state.scanContext.drawImage(video,0,0,w,h);
          const frame=state.scanContext.getImageData(0,0,w,h);
          const result=window.jsQR(frame.data,w,h,{inversionAttempts:"attemptBoth"});
          if(result&&result.data){
            const found=cleanCode(result.data);
            if(found.length>=8){
              $("shop-code").value=found;
              copyText(found,"Shop code");
              stopQrScan();joinPhone();return;
            }
          }
        }
      }
      state.scanFrame=requestAnimationFrame(scan);
    };
    scan();
  }catch(err){
    panel.hidden=false;
    $("scan-hint").textContent=err.name==="NotAllowedError"
      ?"Camera permission was blocked. Allow camera access for this website in your browser settings, then try again."
      :"Could not start the camera. Check HTTPS and camera permission, or paste the code manually.";
    console.error("Camera start failed",err);
  }
}
function stopQrScan(){
  if(state.scanFrame)cancelAnimationFrame(state.scanFrame);
  state.scanFrame=null;
  if(state.scanStream){state.scanStream.getTracks().forEach(t=>t.stop());state.scanStream=null;}
  $("scan-video").srcObject=null;
  $("scan-panel").hidden=true;
  $("scan-hint").textContent="Scan the QR on your tablet, or paste the shop code manually.";
}
function resetDevice(){
  if(!confirm("Reset this device's Call Bell setup?"))return;
  stopAlarm();stopQrScan();
  if(state.stream){state.stream.close();state.stream=null;}
  clearInterval(state.cooldownTimer);
  localStorage.removeItem(STORE);state.code="";state.role=null;
  closeSettings();showScreen("setup");
}
function toggleFullscreen(){
  if(document.fullscreenElement){
    document.exitFullscreen().then(()=>toast("Exited fullscreen")).catch(()=>toast("Use your browser controls to exit fullscreen."));
  }else if(document.documentElement.requestFullscreen){
    document.documentElement.requestFullscreen().then(()=>toast("Fullscreen enabled")).catch(()=>toast("Fullscreen is not available in this browser."));
  }else toast("Use your browser menu to enter fullscreen.");
}
function installApp(){
  if(state.installPrompt){
    state.installPrompt.prompt();
    state.installPrompt.userChoice.finally(()=>state.installPrompt=null);
    return;
  }
  toast(/iPhone|iPad|iPod/i.test(navigator.userAgent)
    ?"In Safari, tap Share → Add to Home Screen."
    :"Open your browser menu → Install app or Add to Home Screen.");
}

/* All event wiring happens after the markup has loaded. */
$("setup-counter").addEventListener("click",enterKiosk);
$("setup-phone").addEventListener("click",enterPhoneSetup);
$("back-setup").addEventListener("click",()=>{stopQrScan();showScreen("setup");});
$("join-shop").addEventListener("click",joinPhone);
$("start-scan").addEventListener("click",startQrScan);
$("stop-scan").addEventListener("click",stopQrScan);
$("copy-phone-topic").addEventListener("click",()=>copyText(topic(),"Topic"));
$("open-ntfy").addEventListener("click",openNtfyApp);
$("go-receiver").addEventListener("click",openReceiver);
$("test-alarm").addEventListener("click",testLocalAlarm);
$("test-push").addEventListener("click",testPush);
$("copy-receiver-topic").addEventListener("click",()=>copyText(topic(),"Topic"));
$("guest-button").addEventListener("click",guestCall);
$("kiosk-settings").addEventListener("click",openSettings);
$("receiver-settings").addEventListener("click",openSettings);
$("close-modal").addEventListener("click",closeSettings);
$("settings-modal").addEventListener("click",e=>{if(e.target===$("settings-modal"))closeSettings();});
$("copy-settings-code").addEventListener("click",()=>copyText(state.code,"Shop code"));
$("fullscreen-button").addEventListener("click",toggleFullscreen);
$("install-app").addEventListener("click",installApp);
$("settings-test").addEventListener("click",testPush);
$("reset-device").addEventListener("click",resetDevice);
$("stop-alarm").addEventListener("click",stopAlarm);
document.addEventListener("fullscreenchange",()=>{
  if(!$("settings-modal").hidden)$("fullscreen-button").innerHTML=document.fullscreenElement?"Exit fullscreen <span>⛶</span>":"Enter fullscreen <span>⛶</span>";
});
window.addEventListener("beforeinstallprompt",e=>{e.preventDefault();state.installPrompt=e;});
document.addEventListener("visibilitychange",()=>{
  if(document.visibilityState==="visible"){
    if(state.role==="counter")requestWakeLock();
    if(state.role==="phone"&&!$("receiver-view").hidden)connectStream();
  }
});
window.addEventListener("online",()=>{if(state.role==="phone"&&!$("receiver-view").hidden)connectStream();});
window.addEventListener("beforeunload",()=>{
  if(state.stream)state.stream.close();
  stopQrScan();
});
load();
if(state.role==="counter"&&state.code){
  $("settings-code").textContent=state.code;showScreen("kiosk");
}else if(state.role==="phone"&&state.code){
  $("shop-code").value=state.code;showScreen("connect");joinPhone();
}else showScreen("setup");
if("serviceWorker" in navigator){
  window.addEventListener("load",()=>navigator.serviceWorker.register("./sw.js").catch(err=>console.warn("Service worker registration failed",err)));
}
