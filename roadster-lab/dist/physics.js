import * as THREE from './vendor/three.module.js';
import {THRUSTERS} from './data.js';
import {MAX_PRESSURE,MAX_THRUST} from './controller.js';

export const G0=9.80665, DRY_MASS=1500, TANK_VOLUME=.6, TANK_TEMPERATURE=293.15;
export const INITIAL_GAS=MAX_PRESSURE*TANK_VOLUME/(1.38*287.05*TANK_TEMPERATURE);
export const STEP=1/60;
const clamp=THREE.MathUtils.clamp;
const Y=new THREE.Vector3(0,1,0);
const rating=t=>t.id[0]==='R'?MAX_THRUST.rear:t.id[0]==='L'?MAX_THRUST.lift:MAX_THRUST.yaw;
const nozzles=THRUSTERS.map(t=>({r:new THREE.Vector3(...t.position).sub(new THREE.Vector3(0,.65,0)),dir:new THREE.Vector3(...t.exhaust).negate(),max:rating(t)}));
const vec=(x=0,y=0,z=0)=>new THREE.Vector3(x,y,z);

/** Rigid body in SI units. p is COM, q body-to-world, omega BODY angular velocity.
 * Ground is an analytic raycast plane; no third-party physics or collision library.
 */
export class VehiclePhysics {
  constructor(){
    this.comLocal=vec(0,.65,0); this.p=vec();this.v=vec();this.q=new THREE.Quaternion();this.omega=vec();
    this.wheels=[];
    for(const x of [1.42,-1.40])for(const z of [-1.005,1.005])this.wheels.push({anchor:vec(x,.80-.65,z),x,z,compression:.15,length:.35,contact:false,force:0,steer:0,spin:0});
    this.throttles=new Float64Array(10);this.events=[];this.reset();
  }
  get mass(){return DRY_MASS+this.gas;}
  get position(){return this.p;}
  refill(){this.gas=INITIAL_GAS;this.pressure=MAX_PRESSURE;}
  reset(){
    this.p.set(-38,.65,5.5);this.v.set(0,0,0);this.q.identity();this.omega.set(0,0,0);
    this.refill();this.mode='GROUND';this.crashed=false;this.airTime=0;this.flightArmed=false;this.pending=null;this.g=1;this.altitude=0;this.slip=0;this.steer=0;this.thrust=0;this.events.length=0;this.throttles.fill(0);
    for(const w of this.wheels){w.contact=true;w.compression=.15;w.length=.35;w.steer=0;w.spin=0;w.force=this.mass*G0/4;}
  }
  getAttitude(){
    const front=vec(1,0,0).applyQuaternion(this.q),up=Y.clone().applyQuaternion(this.q),left=vec(0,0,1).applyQuaternion(this.q);
    return {pitch:Math.asin(clamp(front.y,-1,1)),roll:Math.atan2(-left.y,up.y),tilt:Math.acos(clamp(up.y,-1,1))};
  }
  step(dt,input={},throttles=[],settings={}){
    if(!(dt>0&&Number.isFinite(dt)))return;
    dt=Math.min(dt,STEP); // caller runs a fixed 60 Hz accumulator
    if(settings.infinite)this.refill();
    for(let i=0;i<10;i++)this.throttles[i]=this.crashed?0:clamp(Number.isFinite(throttles[i])?throttles[i]:0,0,1);
    // Ground steering uses the driver's screen-side convention. This sign is
    // deliberately independent of the flight controller's yaw mixer.
    // steerAxis (gamepad/pad merge) wins when present; booleans stay bit-identical.
    const steer=Number.isFinite(input.steerAxis)?clamp(input.steerAxis,-1,1):((input.left?1:0)-(input.right?1:0));
    const target=this.crashed?0:steer*.49;
    this.steer+=(target-this.steer)*(1-Math.exp(-dt*9));
    let peakG=0, hadContact=false;
    // Four solver microsteps stabilize damping and hard bump stops, while the
    // public simulation/controller step remains exactly 1/60 second.
    for(let sub=0;sub<4;sub++){
      const h=dt/4,m=this.mass,I=vec(m*.52,m*2.1,m*2.05);
      const F=vec(0,-m*G0,0),torque=vec();
      const inverse=this.q.clone().invert(),up=Y.clone().applyQuaternion(this.q);
      const omegaWorld=this.omega.clone().applyQuaternion(this.q);
      const add=(force,r)=>{F.add(force);torque.add(r.clone().cross(force));};
      const velocityAt=r=>this.v.clone().add(omegaWorld.clone().cross(r));
      let totalThrust=0;
      let requestedFlow=0;
      const nozzleForces=nozzles.map((n,i)=>{const f=n.max*this.throttles[i]*(this.pressure/MAX_PRESSURE);requestedFlow+=f/(G0*68);return f;});
      const fuelScale=settings.infinite||requestedFlow*h<=this.gas?1:this.gas/(requestedFlow*h||1);
      nozzles.forEach((n,i)=>{
        const f=nozzleForces[i]*fuelScale;totalThrust+=f;
        add(n.dir.clone().multiplyScalar(f).applyQuaternion(this.q),n.r.clone().applyQuaternion(this.q));
      });
      if(!settings.infinite){this.gas=Math.max(0,this.gas-requestedFlow*fuelScale*h);this.pressure=MAX_PRESSURE*Math.pow(this.gas/INITIAL_GAS,1.25);}
      this.thrust=totalThrust/170000;
      let contacts=0,normalTotal=0,stopHit=false,slip=0;
      for(const w of this.wheels){
        const r=w.anchor.clone().applyQuaternion(this.q),anchor=this.p.clone().add(r);
        const distance=up.y>.15?anchor.y/up.y:Infinity;
        const length=distance-.445;
        w.compression=clamp(.5-length,0,.5);w.length=clamp(length,0,.5);w.contact=length<.5&&distance>=0&&up.y>.15;w.force=0;
        // Ackermann: positive steer turns right (-Z), shorter inside radius.
        w.steer=0;
        if(w.x>0&&Math.abs(this.steer)>.001){const R=2.82/Math.tan(Math.abs(this.steer));const inside=Math.sign(this.steer)===-Math.sign(w.z);w.steer=Math.sign(this.steer)*Math.atan(2.82/(R+(inside?-1:1)*1.005));}
        if(!w.contact)continue;
        const contactR=r.clone().addScaledVector(up,-distance),pv=velocityAt(contactR);
        const spring=31280*Math.max(0,.5-length),damper=-4300*pv.y;
        const stop=Math.max(0,.02-length)*280000;
        const normal=clamp(spring+damper+stop,0,220000);
        w.force=normal;normalTotal+=normal;contacts++;stopHit ||=length<=.02;
        add(vec(0,normal,0),contactR);
        const forward=vec(Math.cos(w.steer),0,-Math.sin(w.steer)).applyQuaternion(this.q);forward.y=0;forward.normalize();
        const lateral=vec().crossVectors(forward,Y).normalize();
        const longitudinalSpeed=pv.dot(forward),lateralSpeed=pv.dot(lateral);
        let longitudinal=-longitudinalSpeed*38;
        if(!this.crashed&&this.mode==='GROUND'){
          const drive=Number.isFinite(input.driveAxis)?clamp(input.driveAxis,0,1):(input.forward?1:0);
          const brake=Number.isFinite(input.brakeAxis)?clamp(input.brakeAxis,0,1):(input.back?1:0);
          if(drive>0&&w.x<0)longitudinal+=4500*drive*Math.max(.22,1-Math.abs(longitudinalSpeed)/105);
          if(brake>0){
            if(longitudinalSpeed>.5)longitudinal-=Math.min(6000,longitudinalSpeed*m/(4*h))*brake;
            else if(w.x<0)longitudinal-=3000*brake;
          }
          if(drive<=0&&brake<=0&&Math.abs(longitudinalSpeed)<.25)longitudinal-=longitudinalSpeed*m/(4*h);
        }
        const latForce=-lateralSpeed*7200;
        const limit=normal*1.12,desired=Math.hypot(longitudinal,latForce),scale=desired>limit?limit/(desired||1):1;
        add(forward.multiplyScalar(longitudinal*scale).addScaledVector(lateral,latForce*scale),contactR);
        slip=Math.max(slip,clamp(Math.abs(lateralSpeed)/8+(1-scale)*.5,0,1));
        w.spin+=longitudinalSpeed/.445*h;
      }
      // Aerodynamic drag and body-down downforce. Damping is physical torque,
      // not an artificial attitude lock; all Euler gyroscopic terms are kept.
      const speed=this.v.length();F.addScaledVector(this.v,-.5*1.225*.64*speed);
      add(up.clone().multiplyScalar(-.5*1.225*.65*speed*speed),vec());
      const localDamping=this.omega.clone().multiplyScalar(-85-2*speed);
      torque.add(localDamping.applyQuaternion(this.q));
      let hullContact=false;
      // Eight body contact points keep an inverted/damaged body above the plane.
      for(const x of [-2.3,2.3])for(const y of [.22,1.3])for(const z of [-.95,.95]){
        const r=vec(x,y-.65,z).applyQuaternion(this.q),point=this.p.clone().add(r);
        if(point.y<.015){
          hullContact=true;
          const pv=velocityAt(r),normal=clamp((.015-point.y)*160000-Math.min(0,pv.y)*7000,0,180000);
          add(vec(clamp(-pv.x*1200,-normal*.7,normal*.7),normal,clamp(-pv.z*1200,-normal*.7,normal*.7)),r);
          normalTotal+=normal;
        }
      }
      const contact=contacts>0||hullContact;
      const load=normalTotal/(m*G0);peakG=Math.max(peakG,load);hadContact ||=contact;
      this.slip=slip;
      if(contact){
        if(this.flightArmed&&!this.pending){
          this.pending={verticalSpeed:this.v.y,g:load,tilt:this.getAttitude().tilt,time:.20,stopHit};
          this.flightArmed=false;
          if(-this.v.y>6)this.crash('Vertical impact exceeds 6 m/s',settings);
          else if(this.pending.tilt>Math.PI/4+1e-10)this.crash('Contact attitude exceeds 45°',settings);
        }
        if(this.pending){this.pending.g=Math.max(this.pending.g,load);this.pending.stopHit ||=stopHit;if(stopHit&&load>6)this.crash('Suspension bottom-out exceeds 6 G',settings);}
        // Damage is a contact invariant, not just a first-touchdown test.
        // A rotating landing can become a rollover after the report window.
        if(this.getAttitude().tilt>Math.PI/4+1e-10)this.crash('Contact attitude exceeds 45°',settings);
        if(stopHit&&load>6)this.crash('Suspension bottom-out exceeds 6 G',settings);
        this.mode='GROUND';this.airTime=0;
      }else{
        this.airTime+=h;
        if(this.airTime>.15){this.mode='FLIGHT';this.flightArmed=true;}
      }
      // Semi-implicit Euler translation, body-frame Euler rotation and an
      // exponential quaternion update. I*omega gyroscopic term is essential.
      this.v.addScaledVector(F,h/m);this.p.addScaledVector(this.v,h);
      const localTorque=torque.applyQuaternion(inverse);
      const gyro=this.omega.clone().cross(this.omega.clone().multiply(I));
      this.omega.add(localTorque.sub(gyro).divide(I).multiplyScalar(h));
      const angle=this.omega.length()*h;
      if(angle>1e-12)this.q.multiply(new THREE.Quaternion().setFromAxisAngle(this.omega.clone().normalize(),angle)).normalize();
      if(this.pending){this.pending.time-=h;if(this.pending.time<=0)this.finishLanding(settings);}
    }
    this.g=peakG;
    const up=Y.clone().applyQuaternion(this.q);
    let minHeight=Infinity;
    for(const w of this.wheels){const point=w.anchor.clone().applyQuaternion(this.q).add(this.p).addScaledVector(up,-.5);minHeight=Math.min(minHeight,point.y-.445);}
    this.altitude=Math.max(0,minHeight);
    if(!Number.isFinite(this.p.lengthSq())||this.p.y< -20){this.reset();this.events.push({grade:'RESET',title:'Safety reset',reason:'Simulation safety boundary'});}
  }
  crash(reason,settings){
    if(settings.invincible||this.crashed)return;
    this.crashed=true;this.throttles.fill(0);
    if(this.pending)this.pending.reason=reason;
    else this.events.push({grade:'CRASH',title:'CRASHED',reason,verticalSpeed:this.v.y,g:this.g,tilt:this.getAttitude().tilt});
  }
  finishLanding(settings){
    const e=this.pending;if(!e)return;
    const speed=Math.max(0,-e.verticalSpeed),deg=e.tilt*180/Math.PI;
    if(this.crashed){e.grade='CRASH';e.title='CRASHED';}
    else if(speed<1.5&&deg<5-1e-8&&e.g<2){e.grade='S';e.title='Butter Landing!';}
    else if(speed<3&&deg<15-1e-8){e.grade='A';e.title='Good Landing';}
    else{e.grade='B';e.title='Hard Touchdown';}
    e.reason=e.reason||(settings.invincible?'Invincible protection enabled':'Peak suspension load · first 200 ms');
    this.events.push({...e});this.pending=null;
  }
  snapshot(){return {speed:this.v.length(),pressure:this.pressure,gas:this.gas,g:this.g,altitude:this.altitude,verticalSpeed:this.v.y,...this.getAttitude(),mode:this.mode,crashed:this.crashed,throttles:Array.from(this.throttles)};}
}
