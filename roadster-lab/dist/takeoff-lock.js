/** A physical-key release interlock, independent of axis inversion and rebinding.
 * Observe after each physics step, so the first FLIGHT controller tick is safe.
 */
export class TakeoffPitchLock {
  constructor(){this.reset();}
  reset(){this.previousMode='GROUND';this.blocked=new Set();this.padBlocked=false;}
  get locked(){return this.blocked.size>0||this.padBlocked;}
  /** padPitchHeld: right stick beyond the hold threshold at the GROUND→FLIGHT edge.
   *  Mirrors the physical-key interlock: the stick must return to centre first. */
  update(mode,keys,keybinds,padPitchHeld=false){
    if(mode==='FLIGHT'&&this.previousMode==='GROUND'){
      for(const code of keys)if(keybinds.matches('pitchDown',code)||keybinds.matches('forward',code))this.blocked.add(code);
      if(padPitchHeld)this.padBlocked=true;
    }
    for(const code of this.blocked)if(!keys.has(code))this.blocked.delete(code);
    if(!padPitchHeld)this.padBlocked=false;
    if(mode!=='FLIGHT'){this.blocked.clear();this.padBlocked=false;}
    this.previousMode=mode;
    return this.locked;
  }
  filter(input,mode){
    if(!this.locked||mode!=='FLIGHT')return input;
    const filtered={...input,forward:false,back:false};
    if('pitchAxis' in filtered)filtered.pitchAxis=0;
    return filtered;
  }
}
