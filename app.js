const $ = id => document.getElementById(id);
const STORE_KEY = "counterbell.pro.v1";
const state = { code:"", role:null, busy:false, cooldown:false, cooldownTimer:null, remaining:30, settingsReturn:"counter" };

function randomCode(){
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return "shop-" + Array.from(bytes, b => b.toString(16).padStart(2,"0")).join("");
}
function cleanCode(value){ return value.trim().toLowerCase().replace(/[^a-z0-9_-]/g,"").slice(0,64); }
function topic(){ return "counter-bell-" + cleanCode(state.code); }
function save(){
  localStorage.setItem(STORE_KEY, JSON.stringify({code:state.code, role:state.role}));
}
function load(){
  try{
    const saved = JSON.parse(localStorage.getItem(STORE_KEY) || "{}");
    state.code = saved.code || "";
    state.role = saved.role || null;
  }catch{}
}
function toast(message){
  const el=$("toast"); el.textContent=message; el.classList.add("show");
  clearTimeout(toast.timer); toast.timer=setTimeout(()=>el.classList.remove("show"),2400);
}
function showScreen(name){
  $("onboarding").hidden = name !== "onboarding";
  $("phone-setup").hidden = name !== "phone";
  $("counter-screen").hidden = name !== "counter";
}
function setTopicText(){
  $("topic-value").textContent = topic();
  $("settings-topic").textContent = topic();
}
async function copyText(text, label){
  try{ await navigator.clipboard.writeText(text); toast(label + " copied"); }
  catch{ toast("Copy isn't available. Please select and copy the code."); }
}
async function publishNotification(test=false){
  const url = "https://ntfy.sh/" + encodeURIComponent(topic());
  const headers = {
    "Title": test ? "Counter Bell test" : "A guest is waiting",
    "Priority": "urgent",
    "Tags": "bell",
    "Click": location.href,
    "Content-Type": "text/plain"
  };
  try{
    const response = await fetch(url, {
      method:"POST",
      headers,
      body:test ? "This is a test alert from your counter." : "A guest has asked for assistance at the counter."
    });
    return response.ok;
  }catch(error){
    console.error("Notification request failed:", error);
    return false;
  }
}
function showPhoneInstructions(){
  const code=cleanCode($("shop-code").value);
  if(!code){toast("Enter the shop code from your counter tablet.");$("shop-code").focus();return;}
  state.code=code;state.role="phone";save();setTopicText();
  $("phone-instructions").hidden=false;
  $("open-ntfy").href="ntfy://ntfy.sh/"+encodeURIComponent(topic());
  $("phone-instructions").scrollIntoView({behavior:"smooth",block:"start"});
}
function startCounter(){
  if(!state.code)state.code=randomCode();
  state.role="counter";save();showScreen("counter");
  $("station-state").textContent="Ready when you are";
}
function stopCooldown(){
  if(state.cooldownTimer){clearInterval(state.cooldownTimer);state.cooldownTimer=null;}
  state.cooldown=false;state.remaining=30;
  $("success-overlay").hidden=true;
  $("call-button").disabled=false;
  $("station-state").textContent="Ready when you are";
}
function beginCooldown(){
  state.cooldown=true;state.remaining=30;
  $("success-overlay").hidden=false;
  $("call-button").disabled=true;
  $("cooldown-label").textContent="Ready for another call in 30 seconds";
  $("cooldown-number").textContent="30";
  $("cooldown-progress").style.width="100%";
  state.cooldownTimer=setInterval(()=>{
    state.remaining--;
    $("cooldown-number").textContent=String(state.remaining);
    $("cooldown-label").textContent=state.remaining>0 ? "Ready for another call in " + state.remaining + " seconds" : "Ready for another guest";
    $("cooldown-progress").style.width=(state.remaining/30*100)+"%";
    if(state.remaining<=0)stopCooldown();
  },1000);
}
async function callTeam(){
  if(state.busy||state.cooldown)return;
  state.busy=true;
  $("call-button").disabled=true;
  $("button-title").textContent="One moment…";
  $("station-state").textContent="Sending your message";
  const ok=await publishNotification(false);
  state.busy=false;
  if(!ok){
    $("call-button").disabled=false;
    $("button-title").textContent="Call our team";
    $("station-state").textContent="Couldn’t send — please try again";
    toast("No connection. Check the tablet’s internet and try again.");
    return;
  }
  $("station-state").textContent="Your team has been notified";
  beginCooldown();
}
function openSettings(){
  $("settings-topic").textContent=topic();
  $("settings-overlay").hidden=false;
  $("close-settings").focus();
}
function closeSettings(){$("settings-overlay").hidden=true;}
$("create-counter").addEventListener("click",()=>{
  state.code=randomCode();state.role="counter";save();startCounter();
});
$("choose-phone").addEventListener("click",()=>{
  showScreen("phone");$("phone-instructions").hidden=true;$("shop-code").value="";
});
$("back-home").addEventListener("click",()=>showScreen("onboarding"));
$("connect-phone").addEventListener("click",showPhoneInstructions);
$("copy-topic").addEventListener("click",()=>copyText(topic(),"Notification topic"));
$("call-button").addEventListener("click",callTeam);
$("open-settings").addEventListener("click",openSettings);
$("close-settings").addEventListener("click",closeSettings);
$("settings-overlay").addEventListener("click",e=>{if(e.target===$("settings-overlay"))closeSettings();});
$("settings-copy").addEventListener("click",()=>copyText(topic(),"Notification topic"));
$("test-notification").addEventListener("click",async()=>{
  const button=$("test-notification");button.disabled=true;button.firstChild.textContent="Sending test…";
  const ok=await publishNotification(true);
  button.disabled=false;button.firstChild.textContent="Send a test notification ";
  toast(ok?"Test notification sent. Check your phone.":"Could not send. Check the internet connection.");
});
$("change-device").addEventListener("click",()=>{closeSettings();showScreen("onboarding");});
document.addEventListener("keydown",e=>{if(e.key==="Escape"&&!$("settings-overlay").hidden)closeSettings();});
load();
if(state.role==="counter"&&state.code){showScreen("counter");}
else if(state.role==="phone"&&state.code){showScreen("phone");$("shop-code").value=state.code;showPhoneInstructions();}
else{showScreen("onboarding");}
if("serviceWorker" in navigator){
  window.addEventListener("load",()=>navigator.serviceWorker.register("./sw.js").catch(err=>console.warn("Service worker registration failed",err)));
}
window.addEventListener("beforeunload",()=>{if(state.cooldownTimer)clearInterval(state.cooldownTimer);});
