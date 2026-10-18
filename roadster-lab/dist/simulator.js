import * as THREE from './vendor/three.module.js';
import {createRoadster} from './model.js';
import {VehiclePhysics,STEP} from './physics.js';
import {FlightController} from './controller.js';
import {createWorld} from './world.js';
import {NPCManager} from './npc.js';
import {createUI} from './ui.js';
import {AudioSystem} from './audio.js';
import {VehicleEffects} from './effects.js';
import {Keybinds,ACTIONS,formatKey} from './keybinds.js';
import {createKeybindPanel} from './keybind-panel.js';
import {TakeoffPitchLock} from './takeoff-lock.js';
import {CameraRig,RenderPose} from './camera-rig.js';
import {simulationTimeScale} from './time-scale.js';
import {Playback} from './playback.js';
import {GamepadInput,mergeControls} from './gamepad-input.js';
import {GamepadRumble} from './gamepad-rumble.js';

const host=document.querySelector('#viewport');
const scene=new THREE.Scene();
const camera=new THREE.PerspectiveCamera(52,innerWidth/innerHeight,.1,1800);
let renderer;
try{
  renderer=new THREE.WebGLRenderer({antialias:true,powerPreference:'high-performance'});
}catch(error){
  host.innerHTML='<div style="padding:15vh 12vw;color:#edf5fc;font:20px system-ui"><h1>WebGL2 unavailable</h1><p>Please enable hardware acceleration or open this simulator in a current browser.</p><a href="viewer.html">Open the asset viewer →</a></div>';
  throw error;
}
renderer.setPixelRatio(Math.min(devicePixelRatio,1.8));renderer.setSize(innerWidth,innerHeight);
renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;
renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.12;
host.appendChild(renderer.domElement);
const world=createWorld(scene),npcs=new NPCManager(scene),body=new VehiclePhysics(),controller=new FlightController();
const model=createRoadster();scene.add(model.car);
const effects=new VehicleEffects(scene,model),audio=new AudioSystem(),playback=new Playback();
let settings={assisted:true,rate:180,invincible:false,infinite:false,bulletTime:false},time=0;
const keys=new Set(),physicalKeys=new Set(),pitchLock=new TakeoffPitchLock();
// Physical release state survives focus/modal clearing of active driving keys.
window.addEventListener('keydown',event=>{if(!event.repeat)physicalKeys.add(event.code);},true);
let accumulator=0,last=performance.now(),frame=0;
let lastControls=null,previousMode='GROUND',previousCrashed=false;
const cameraRig=new CameraRig(camera,renderer.domElement),renderPose=new RenderPose(body);
function reset(){playback.exit(body);playback.onReset(body);body.reset();renderPose.reset(body);controller.reset();pitchLock.reset();effects.reset();keys.clear();accumulator=0;ui.dismissLanding();syncModel();updateCamera(1,true);host.focus({preventScroll:true});}
function exitReplay(){playback.exit(body);renderPose.reset(body);cameraRig.rebase(renderPose);keys.clear();accumulator=0;effects.reset();controller.reset();pitchLock.reset();host.focus({preventScroll:true});ui.update(telemetry());}
const ui=createUI({onReset:reset,onRefill:()=>{if(!playback.playing)body.refill();},
  onRecord:()=>{if(playback.recording)playback.stopRecording(body);else playback.startRecording(body);host.focus({preventScroll:true});ui.update(telemetry());},
  onReplay:()=>{if(playback.start(body)){keys.clear();accumulator=0;effects.reset();host.focus({preventScroll:true});ui.update(telemetry());}},onExitReplay:exitReplay,
  onSettings:value=>{settings=value;if(settings.infinite&&!playback.playing)body.refill();controller.reset();}});
const keybinds=new Keybinds();
let bindingsActive=false;
const keybindPanel=createKeybindPanel(keybinds,{onActive:value=>{bindingsActive=value;keys.clear();controller.reset();},onClose:()=>{keys.clear();host.focus({preventScroll:true});}});
document.querySelector('#sim-keybinds').addEventListener('click',()=>keybindPanel.open());
keybinds.subscribe(()=>keys.clear());
let padStatus={connected:false,id:null},padFrame={state:null,edges:null};
const pad=new GamepadInput({onStatus:info=>{padStatus=info;ui.update(telemetry());}});
const rumble=new GamepadRumble();
const input=()=>{
  const activeKeys=bindingsActive||playback.playing?new Set():keys;
  const activePad=bindingsActive||playback.playing?null:padFrame.state;
  pitchLock.update(body.mode,physicalKeys,keybinds,activePad?.pitchHeld||false);
  const keyboardControls=keybinds.input(activeKeys,body.mode);
  return pitchLock.filter(mergeControls(keyboardControls,activePad,keybinds.inversions,body.mode),body.mode);
};
const telemetry=()=>({...body.snapshot(),assistActive:controller.assistActive,controlMode:controller.mode,
  pitchLocked:pitchLock.locked,pitchLockKeys:[...pitchLock.blocked].map(formatKey).concat(pitchLock.padBlocked?['STICK']:[]).join(' / '),cameraView:cameraRig.name,
  gamepad:padStatus.connected?(padStatus.id||'GAMEPAD').replace(/\s*\(.*\)\s*$/,'').slice(0,26):null,
  slowMo:!playback.playing&&simulationTimeScale(body,settings)===.5,recording:playback.recording,
  recordSeconds:playback.duration,replayReady:playback.ready,replaying:playback.playing,replayProgress:playback.progress,time});
pad.start();
const isControl=code=>ACTIONS.some(action=>keybinds.matches(action.id,code));
const drivingTarget=target=>!target?.closest?.('#sim-hud, input, select, textarea, button, summary, a, [contenteditable]:not([contenteditable="false"])');
window.addEventListener('keydown',event=>{
  if(bindingsActive||!drivingTarget(event.target))return;
  if(playback.playing){
    if(!event.repeat&&keybinds.matches('camera',event.code))cameraRig.cycle();
    if(!event.repeat&&keybinds.matches('reset',event.code))reset();
    return;
  }
  if(isControl(event.code)){
    event.preventDefault();
    // Focus/modal suppression requires a fresh press, not an OS auto-repeat.
    if(!event.repeat||keys.has(event.code))keys.add(event.code);
    audio.unlock();
  }
  if(!event.repeat&&keybinds.matches('reset',event.code))reset();
  if(!event.repeat&&keybinds.matches('camera',event.code)){cameraRig.cycle();ui.update(telemetry());}
});
// Capture releases before a cockpit widget can stop bubbling.
window.addEventListener('keyup',event=>{keys.delete(event.code);physicalKeys.delete(event.code);pitchLock.update(body.mode,physicalKeys,keybinds);ui.update(telemetry());if(isControl(event.code)&&!bindingsActive&&drivingTarget(event.target))event.preventDefault();},true);
window.addEventListener('focusin',event=>{if(event.target.closest?.('#sim-hud'))keys.clear();});
window.addEventListener('keydown',event=>{if(event.code==='Escape'&&!bindingsActive){if(playback.playing)exitReplay();keys.clear();host.focus({preventScroll:true});event.preventDefault();}},true);
host.addEventListener('pointerdown',()=>host.focus({preventScroll:true}));
window.addEventListener('pointerdown',()=>audio.unlock());
window.addEventListener('blur',()=>keys.clear());
document.addEventListener('visibilitychange',()=>{keys.clear();accumulator=0;renderPose.reset(body);last=performance.now();});
window.addEventListener('resize',()=>{camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight);});
function syncModel(){
  model.car.quaternion.copy(renderPose.q);
  model.car.position.copy(renderPose.p).sub(body.comLocal.clone().applyQuaternion(renderPose.q));
  model.layers.wheels.children.forEach((wheel,i)=>{
    const w=body.wheels[i];wheel.position.y=.80-w.length;
    // model wheel's local axle is Z. Steering rotates +Y, spin +Z.
    wheel.quaternion.setFromAxisAngle(new THREE.Vector3(0,1,0),w.steer);
    wheel.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,0,1),-w.spin));
  });
  model.materials.body.color.setHex(body.crashed?0xa9635d:0xe4e9e9);
}
function updateCamera(dt,snap=false){cameraRig.update(dt,renderPose,snap);}
function animate(now){
  requestAnimationFrame(animate);
  const dt=Math.min(.1,Math.max(0,(now-last)/1000));last=now;
  if(document.hidden)return;
  padFrame=pad.poll();
  const padEdges=padFrame.edges;
  if(!bindingsActive){
    if(padEdges.any)audio.unlock();
    if(padEdges.camera){cameraRig.cycle();ui.update(telemetry());}
    if(padEdges.reset)reset();
    if(cameraRig.mode===3){
      if(padEdges.zoomIn)cameraRig.zoom(Math.exp(-.18));
      if(padEdges.zoomOut)cameraRig.zoom(Math.exp(.18));
      // Right stick orbits only when it is not flying the attitude loop.
      if(padFrame.state&&(body.mode!=='FLIGHT'||playback.playing))cameraRig.rotate(padFrame.state.rsX*240*dt,padFrame.state.rsY*240*dt);
    }
  }
  if(playback.playing){
    const ended=playback.advance(dt,body);renderPose.reset(body);syncModel();world.update(time);effects.update(dt,body);updateCamera(dt);
    audio.update({speed:body.v.length(),thrust:body.thrust,slip:body.slip});
    ui.update(telemetry());renderer.render(scene,camera);frame++;
    if(ended)exitReplay();
    return;
  }
  accumulator+=dt; // Wall-clock accumulator; each tick consumes real time.
  const impactEvents=[];
  while(accumulator>=STEP){
    const effectiveStep=STEP*simulationTimeScale(body,settings);
    const controls=input();lastControls=controls;const throttles=controller.update(effectiveStep,body,controls,settings);
    renderPose.capture(body);
    body.step(effectiveStep,controls,throttles,settings);playback.record(effectiveStep,body);
    pitchLock.update(body.mode,physicalKeys,keybinds,padFrame.state?.pitchHeld||false);time+=effectiveStep;
    npcs.update(effectiveStep,time,body);accumulator-=STEP;
    while(body.events.length){const event=body.events.shift();impactEvents.push(event);ui.landing(event);audio.impact(Math.min(1,event.g/8));}
  }
  rumble.update(padFrame.state?.gamepad,{mode:body.mode,previousMode,boosting:!!lastControls&&lastControls.boostAxis>.5,
    crashed:body.crashed,previousCrashed,events:impactEvents});
  previousMode=body.mode;previousCrashed=body.crashed;
  renderPose.sample(body,accumulator/STEP);
  syncModel();world.update(time);effects.update(dt*simulationTimeScale(body,settings),body);updateCamera(dt);
  audio.update({speed:body.v.length(),thrust:body.thrust,slip:body.slip});
  if(frame++%2===0)ui.update(telemetry());
  renderer.render(scene,camera);
}
syncModel();updateCamera(1,true);ui.update({...body.snapshot(),time});
// A small explicit diagnostic surface enables repeatable integration testing.
window.rocketLab={body,controller,scene,model,npcs,world,audio,ui,reset,input,keys,physicalKeys,keybinds,keybindPanel,pitchLock,cameraRig,renderPose,playback,exitReplay,pad,rumble,get settings(){return {...settings};},get time(){return time;},get frame(){return frame;}};
requestAnimationFrame(animate);
