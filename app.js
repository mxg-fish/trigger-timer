
const interval=document.getElementById("interval");
const threshold=document.getElementById("threshold");
const intervalValue=document.getElementById("intervalValue");
const thresholdValue=document.getElementById("thresholdValue");
const soundChoice=document.getElementById("soundChoice");
const stateEl=document.getElementById("state");
const elapsedEl=document.getElementById("elapsed");
const meterBar=document.getElementById("meterBar");
const dbReadout=document.getElementById("dbReadout");

let ctx, analyser, mic, source;
let armed=false;
let startedAt=0;
let raf;
let active=[];

function sync(){
 intervalValue.textContent=Number(interval.value).toFixed(2);
 thresholdValue.textContent=threshold.value;
}
sync();
interval.oninput=sync;
threshold.oninput=sync;

async function setupAudio(){
 if(!ctx) ctx=new(window.AudioContext||window.webkitAudioContext)();
 if(ctx.state==="suspended") await ctx.resume();

 if(!mic){
  mic=await navigator.mediaDevices.getUserMedia({audio:true});
  source=ctx.createMediaStreamSource(mic);
  analyser=ctx.createAnalyser();
  analyser.fftSize=2048;
  source.connect(analyser);
 }
}

function dbPercent(db){
 return Math.max(0,Math.min(100,((db+80)/75)*100));
}

function getDb(){
 const data=new Float32Array(analyser.fftSize);
 analyser.getFloatTimeDomainData(data);

 let sum=0;
 for(const s of data) sum+=s*s;

 const rms=Math.sqrt(sum/data.length)||0.000001;
 return 20*Math.log10(rms);
}

function elapsed(){
 if(!startedAt) return "00:00.00";
 const ms=performance.now()-startedAt;
 const hundredths=Math.floor(ms/10)%100;
 const sec=Math.floor(ms/1000)%60;
 const min=Math.floor(ms/60000);
 return `${String(min).padStart(2,"0")}:${String(sec).padStart(2,"0")}.${String(hundredths).padStart(2,"0")}`;
}

function osc(start,duration,freq,type="sine",gainAmt=.6,endFreq=null){
 const o=ctx.createOscillator();
 const g=ctx.createGain();

 o.type=type;
 o.frequency.setValueAtTime(freq,ctx.currentTime+start);

 if(endFreq){
   o.frequency.linearRampToValueAtTime(endFreq,ctx.currentTime+start+duration);
 }

 g.gain.setValueAtTime(0.0001,ctx.currentTime+start);
 g.gain.exponentialRampToValueAtTime(gainAmt,ctx.currentTime+start+.02);
 g.gain.exponentialRampToValueAtTime(0.0001,ctx.currentTime+start+duration);

 o.connect(g).connect(ctx.destination);
 o.start(ctx.currentTime+start);
 o.stop(ctx.currentTime+start+duration+.02);

 active.push(o,g);
}

function playSound(){
 stopAudio();

 const s=soundChoice.value;

 if(s==="beep"){
   osc(0,3,950,"sine");
 }

 if(s==="alarm"){
   for(let t=0;t<3;t+=0.5){
      osc(t,.22,1200,"square");
   }
 }

 if(s==="gong"){
   osc(0,3,220,"triangle",0.9,120);
   osc(0,2.5,440,"sine",0.4,200);
 }

 if(s==="woo"){
   osc(0,0.7,450,"sawtooth",0.7,900);
   osc(0.7,1.0,900,"sawtooth",0.7,600);
   osc(1.7,1.3,600,"triangle",0.5,400);
 }
}

function stopAudio(){
 for(const n of active){
   try{
     if(n.stop) n.stop();
     if(n.disconnect) n.disconnect();
   }catch(e){}
 }
 active=[];
}

function stopAll(){
 armed=false;
 startedAt=0;
 stateEl.textContent="Idle";
 stopAudio();
}

async function arm(){
 await setupAudio();

 armed=true;
 stateEl.textContent="Armed";

 const check=()=>{
   if(!armed) return;

   const db=getDb();
   dbReadout.textContent=`${db.toFixed(1)} dB`;
   meterBar.style.width=`${dbPercent(db)}%`;

   if(db>=Number(threshold.value)){
      armed=false;
      startedAt=performance.now();
      stateEl.textContent="Timing";

      setTimeout(()=>{
        stateEl.textContent="Alarm";
        playSound();

        setTimeout(()=>{
          stateEl.textContent="Complete";
        },3000);

      },Number(interval.value)*1000);
   }

   elapsedEl.textContent=elapsed();
   raf=requestAnimationFrame(check);
 };

 cancelAnimationFrame(raf);
 check();
}

document.getElementById("armBtn").onclick=arm;

document.getElementById("testBtn").onclick=async()=>{
 await setupAudio();
 playSound();
};

document.getElementById("stopBtn").onclick=()=>{
 stopAll();
};
