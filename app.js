const $ = id => document.getElementById(id);
const KEY = "hellobell.v3";
const state = { code:"", role:"", cooldown:false, timer:null, remaining:30, sending:false, audio:null };
function randomCode(){
  const bytes=new Uint8Array(10); crypto.getRandomValues(bytes);
  return "shop-"+Array.from(bytes,b=>b.toString(16).padStart(2,"0")).join("");
}
function normalise(s){return String(s||"").toLowerCase().trim().replace(/[^a-z0-9-]/g,"").slice(0,60);}
function topic(){return "hello-bell-"+normalise(state.code);}
function save(){localStorage.setItem(KEY,JSON.stringify({code:state.code,role:state.role}));}
function load(){try{const v=JSON.parse(localStorage.getItem(KEY)||"{}");state.code=v.code||"";state.role=v.role||"";}catch{}}
function show(name){
  $("setup-screen").hidden=name!=="setup";
  $("code-screen").hidden=name!=="code";
  $("station-screen").hidden=name!=="station";
}
function toast(s){const el=$("toast");el.textContent=s;el.classList.add("show");clearTimeout(toast.t);toast.t=setTimeout(()=>el.classList.remove("show"),2500);}
async function copy(s,label){try{await navigator.clipboard.writeText(s);toast(label+" copied");}catch{toast("Copy not available. Please select the text and copy it.");}}
function renderCode(){
  $("shop-code").value=state.code;
  $("topic-code").textContent=topic();
  $("settings-topic").textContent=topic();
  $("settings-shop-code").textContent=state.code;
}
function startCounter(){
  if(!state.code)state.code=randomCode();
  state.role="counter";save();renderCode();show("station");
  // Fullscreen is requested only after a deliberate user tap, as browsers require.
  if(document.documentElement.requestFullscreen){document.documentElement.requestFullscreen().catch(()=>{});}
}
function activatePhone(){
  const value=normalise($("shop-code").value);
  if(!value){toast("Enter the shop code from the counter tablet.");return;}
  state.code=value;state.role="phone";save();renderCode();
  $("test-result").textContent="Subscribe to "+topic()+" in ntfy, allow notifications, then send a test alert.";
}
function unlockAudio(){
  try{
    const C=window.AudioContext||window.webkitAudioContext;
    if(!C)return;
    if(!state.audio)state.audio=new C();
    if(state.audio.state==="suspended")state.audio.resume();
  }catch{}
}
function chime(){
  unlockAudio();if(!state.audio)return;
  const ctx=state.audio,now=ctx.currentTime;
  [880,1174.66,1568].forEach((f,i)=>{
    const osc=ctx.createOscillator(),gain=ctx.createGain();
    osc.type="sine";osc.frequency.value=f;
    gain.gain.setValueAtTime(.0001,now+i*.12);
    gain.gain.exponentialRampToValueAtTime(.16,now+i*.12+.025);
    gain.gain.exponentialRampToValueAtTime(.0001,now+i*.12+.48);
    osc.connect(gain);gain.connect(ctx.destination);osc.start(now+i*.12);osc.stop(now+i*.12+.5);
  });
}
async function sendNtfy(test=false){
  const headers={
    "Title":test?"Hello Bell test":"A guest is waiting",
    "Priority":"urgent",
    "Tags":"bell,rotating_light",
    "Content-Type":"text/plain"
  };
  try{
    const r=await fetch("https://ntfy.sh/"+encodeURIComponent(topic()),{
      method:"POST",headers,
      body:test?"Test alert from your Hello Bell counter.":"A guest has pressed the counter bell and is waiting for assistance."
    });
    if(!r.ok)throw new Error("ntfy returned "+r.status);
    return true;
  }catch(e){console.error("ntfy send failed",e);return false;}
}
function resetCooldown(){
  if(state.timer)clearInterval(state.timer);
  state.timer=null;state.cooldown=false;state.remaining=30;
  $("thankyou").hidden=true;$("call-button").disabled=false;
  $("call-title").textContent="Tap to call";
  $("station-message").textContent="Ready when you are";
}
function beginCooldown(){
  state.cooldown=true;state.remaining=30;$("thankyou").hidden=false;
  $("call-button").disabled=true;
  $("count-number").textContent="30";$("count-message").textContent="You can call again in 30 seconds";
  $("count-fill").style.width="100%";
  state.timer=setInterval(()=>{
    state.remaining--;
    $("count-number").textContent=String(state.remaining);
    $("count-message").textContent=state.remaining>0?"You can call again in "+state.remaining+" seconds":"Ready for another guest";
    $("count-fill").style.width=(state.remaining/30*100)+"%";
    if(state.remaining<=0)resetCooldown();
  },1000);
}
async function callTeam(){
  if(state.sending||state.cooldown)return;
  state.sending=true;$("call-button").disabled=true;
  $("call-title").textContent="Sending…";$("station-message").textContent="Contacting your team";
  const ok=await sendNtfy(false);
  state.sending=false;
  if(!ok){
    $("call-button").disabled=false;$("call-title").textContent="Tap to call";
    $("station-message").textContent="Connection issue — please try again";
    toast("Alert not sent. Check Wi-Fi/mobile data and try again.");
    return;
  }
  chime();try{navigator.vibrate?.([120,60,120]);}catch{}
  $("station-message").textContent="Your team has been notified";
  beginCooldown();
}
async function testAlert(button){
  button.disabled=true;
  const old=button.textContent;button.textContent="Sending test…";
  const ok=await sendNtfy(true);
  button.disabled=false;button.textContent=old;
  const message=ok?"Test sent. Check your phone’s ntfy notification.":"Could not send. Check the internet connection.";
  $("test-result").textContent=message;toast(message);
}
$("make-counter").addEventListener("click",()=>{state.code=randomCode();startCounter();});
$("make-phone").addEventListener("click",()=>{state.role="";show("code");$("shop-code").value="";});
$("connect-phone").addEventListener("click",()=>{
  let value=normalise($("shop-code").value);
  if(value.startsWith("hello-bell-"))value=value.slice("hello-bell-".length);
  if(value.startsWith("topic-"))value=value.slice(6);
  if(!value){toast("Paste the shop code from the counter tablet.");$("shop-code").focus();return;}
  state.code=value;state.role="phone";save();renderCode();
  $("test-result").textContent="Subscribe to "+topic()+" in ntfy, allow notifications, then send a test alert.";
  toast("Phone connected to this shop code.");
});
$("back-setup").addEventListener("click",()=>show("setup"));
$("copy-code").addEventListener("click",()=>copy(state.code,"Shop code"));
$("copy-topic").addEventListener("click",()=>copy(topic(),"ntfy topic"));
$("open-ntfy").addEventListener("click",()=>{window.open("https://ntfy.sh/app","_blank","noopener");});
$("test-alert").addEventListener("click",()=>testAlert($("test-alert")));
$("call-button").addEventListener("click",callTeam);
$("station-settings").addEventListener("click",()=>{renderCode();$("settings-modal").hidden=false;});
$("close-settings").addEventListener("click",()=>{$("settings-modal").hidden=true;});
$("settings-modal").addEventListener("click",e=>{if(e.target===$("settings-modal"))$("settings-modal").hidden=true;});
$("settings-copy").addEventListener("click",()=>copy(topic(),"ntfy topic"));
$("settings-code-copy").addEventListener("click",()=>copy(state.code,"Shop code"));
$("settings-test").addEventListener("click",()=>testAlert($("settings-test")));
$("reset-device").addEventListener("click",()=>{$("settings-modal").hidden=true;show("setup");});
document.addEventListener("visibilitychange",()=>{if(document.visibilityState==="visible"&&state.role==="counter"){$("station-message").textContent=state.cooldown?"Please wait a moment":"Ready when you are";}});
load();
if(state.role==="counter"&&state.code)show("station");
else if(state.role==="phone"&&state.code){show("code");renderCode();}
else show("setup");
if("serviceWorker" in navigator)window.addEventListener("load",()=>navigator.serviceWorker.register("./sw.js").catch(console.warn));
