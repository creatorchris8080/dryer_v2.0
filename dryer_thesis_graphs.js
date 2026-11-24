(() => {
  const C = { blue: '#167db3', orange: '#e36e22', gray: '#76899a', teal: '#1c9a8a' };
  const fallback = {
    setpoint: 200, fanPercent: 60, heaterOn: true, ambient: 25,
    model: { width: .72, height: .72, depth: .45, airVolume: .72*.72*.45,
      fanMaxFlow: .5, inletArea: .06, heaterCellCount: 560, cellVolume: .0225**3,
      heaterCapacity: 1500, powerMax: 5000, controllerGain: 150,
      heaterExchange: 3, wallLossRate: .07, radiationArea: .15,
      emissivity: .8, diffusivity: .0015, heatCapacity: 1005, density: 1.18 }
  };
  let lastSignature = '';
  let predictions = null;
  const fmt = (v, d=1) => Number(v).toFixed(d);

  function canvasBase(id) {
    const el = document.getElementById(id), w = Math.max(280, el.clientWidth), h = el.clientHeight || 230;
    const dpr = Math.min(2, devicePixelRatio || 1), ctx = el.getContext('2d');
    el.width = w*dpr; el.height = h*dpr; ctx.setTransform(dpr,0,0,dpr,0,0);
    ctx.clearRect(0,0,w,h); ctx.fillStyle='#fff'; ctx.fillRect(0,0,w,h); ctx.font='10px Segoe UI';
    return {ctx,w,h,L:58,R:13,T:13,B:40,pw:w-71,ph:h-53};
  }
  function predict(settings) {
    const m={...fallback.model,...(settings.model||{})}, ambient=settings.ambient??25;
    const setpoint=Math.max(0,settings.setpoint??200), fan=Math.max(0,Math.min(1,(settings.fanPercent??60)/100));
    const heaterOn=settings.heaterOn!==false, rho=m.density||1.18, cp=m.heatCapacity||1005;
    const cellV=m.cellVolume||.0225**3, airC=Math.max(20,rho*cp*(m.airVolume||.72*.72*.45));
    const heaterC=m.heaterCapacity||1500, pMax=m.powerMax||5000, kp=m.controllerGain||150;
    const htrCells=m.heaterCellCount||560, htc=m.heaterExchange||3;
    const ua=htrCells*rho*cp*cellV*htc*(.8+.4*fan);
    const wallCells=2*(32*32+32*20+32*20), uaWall=(m.wallLossRate||.07)*rho*cp*cellV*wallCells*(.85+.3*fan);
    const radArea=m.radiationArea||.15, eps=m.emissivity||.8, sigma=5.67e-8;
    const points=[], dt=.5, end=600; let th=ambient, ta=ambient, energy=0;
    for(let t=0;t<=end;t+=dt){
      const power=heaterOn?Math.max(0,Math.min(pMax,kp*(setpoint-th))):0;
      const conv=ua*(th-ta), rad=eps*sigma*radArea*((th+273.15)**4-(ta+273.15)**4);
      const wall=uaWall*(ta-ambient), qAir=conv+rad;
      if(t%5===0)points.push({sec:t,heater:th,chamber:ta,power,heatAir:qAir,wallLoss:wall,energyKwh:energy});
      th+=dt*(power-qAir)/heaterC; ta+=dt*(qAir-wall)/airC;
      th=Math.max(ambient-20,Math.min(setpoint+30,th));ta=Math.max(ambient-20,Math.min(setpoint+30,ta));
      energy+=power*dt/3.6e6;
    }
    const finalAir=points[points.length-1].chamber, width=(m.width||.72)*1000, count=33;
    const temp=[],velocity=[],pressure=[],heatFlux=[];
    const fanQ=(m.fanMaxFlow||.5)*fan, inletV=fanQ/Math.max(.005,m.inletArea||.06);
    for(let i=0;i<count;i++){
      const u=i/(count-1),x=u*width,shape=1+.18*Math.cos(2*Math.PI*u);
      const tempValue=ambient+(finalAir-ambient)*shape;
      const vel=Math.max(0,inletV*.18*(.25+.75*Math.sin(Math.PI*u)));
      temp.push({x,y:tempValue});velocity.push({x,y:vel});pressure.push({x,y:-.5*rho*vel*vel});
    }
    const kAir=rho*cp*(m.diffusivity||.0015);
    for(let i=0;i<count;i++){
      const a=temp[Math.max(0,i-1)].y,b=temp[Math.min(count-1,i+1)].y;
      const dx=(i===0||i===count-1?width/(count-1):2*width/(count-1))/1000;
      heatFlux.push({x:temp[i].x,y:-kAir*(b-a)/Math.max(dx,1e-6)});
    }
    const at=(u,mult=1)=>ambient+(finalAir-ambient)*mult*(1+.18*Math.cos(2*Math.PI*u));
    const locations=[
      {name:'Lower center',value:at(.5,.93)},{name:'Mid center',value:at(.5,1)},
      {name:'Upper center',value:at(.5,1.04)},{name:'Near left heater',value:at(.04,1)},
      {name:'Near right heater',value:at(.96,1)}
    ];
    const buoyancy=Math.max(0,Math.min(.65,.52+.08*(finalAir-ambient)/Math.max(1,setpoint-ambient)));
    return {setpoint,fanPercent:fan*100,ambient,finalAir,width,points,temp,velocity,pressure,heatFlux,locations,
      upperFlow:fanQ*buoyancy,lowerFlow:fanQ*(1-buoyancy),
      pressureNote:'Relative Bernoulli pressure proxy from predicted velocity; not calibrated static pressure.'};
  }
  function line(id,series,opt={}) {
    const f=canvasBase(id),c=f.ctx,all=series.flatMap(s=>s.points||[]).filter(p=>Number.isFinite(p.x)&&Number.isFinite(p.y));
    if(!all.length)return;
    let xmin=opt.xmin??Math.min(...all.map(p=>p.x)),xmax=opt.xmax??Math.max(...all.map(p=>p.x));
    let ymin=opt.ymin??Math.min(...all.map(p=>p.y)),ymax=opt.ymax??Math.max(...all.map(p=>p.y));
    if(xmax-xmin<1e-9)xmax=xmin+1;if(ymax-ymin<1e-9){ymin-=.5;ymax+=.5}
    if(opt.pad!==false&&!('ymin'in opt)){const d=(ymax-ymin)*.12||.5;ymin-=d;ymax+=d}
    c.strokeStyle='#e4eaf0';c.lineWidth=1;c.fillStyle='#5f7181';
    for(let i=0;i<=4;i++){const y=f.T+f.ph*i/4,v=ymax-(ymax-ymin)*i/4;c.beginPath();c.moveTo(f.L,y);c.lineTo(f.w-f.R,y);c.stroke();c.textAlign='right';c.fillText((opt.yfmt||((x)=>x.toFixed(1)))(v),f.L-6,y+3)}
    for(let i=0;i<=4;i++){const x=f.L+f.pw*i/4,v=xmin+(xmax-xmin)*i/4;c.beginPath();c.moveTo(x,f.T);c.lineTo(x,f.T+f.ph);c.stroke();c.textAlign='center';c.fillText((opt.xfmt||((x)=>x.toFixed(1)))(v),x,f.h-20)}
    c.strokeStyle='#718394';c.beginPath();c.moveTo(f.L,f.T);c.lineTo(f.L,f.T+f.ph);c.lineTo(f.w-f.R,f.T+f.ph);c.stroke();
    for(const s of series){if(!s.points?.length)continue;c.beginPath();c.strokeStyle=s.color;c.lineWidth=s.width||2;c.setLineDash(s.dash||[]);s.points.forEach((p,i)=>{const x=f.L+f.pw*(p.x-xmin)/(xmax-xmin),y=f.T+f.ph*(1-(p.y-ymin)/(ymax-ymin));i?c.lineTo(x,y):c.moveTo(x,y)});c.stroke()}
    c.setLineDash([]);c.textAlign='center';c.fillStyle='#536779';c.fillText(opt.xlabel||'',f.L+f.pw/2,f.h-3);c.save();c.translate(13,f.T+f.ph/2);c.rotate(-Math.PI/2);c.fillText(opt.ylabel||'',0,0);c.restore();
  }
  function categories(id,items,{zeroBased=false,digits=1,xlabel=''}={}) {
    const f=canvasBase(id),c=f.ctx,top=f.T,bottom=f.T+f.ph,left=132,right=f.w-f.R,pw=right-left,row=f.ph/items.length;
    const values=items.map(v=>v.value),vmin=zeroBased?0:Math.max(0,Math.min(...values)-Math.max(.5,(Math.max(...values)-Math.min(...values))*.15));
    const vmax=Math.max(vmin+1e-6,Math.max(...values)+(zeroBased?0:Math.max(.5,(Math.max(...values)-Math.min(...values))*.15)));
    c.strokeStyle='#e4eaf0';c.fillStyle='#596d7e';c.font='9px Segoe UI';
    for(let i=0;i<=4;i++){const x=left+pw*i/4,v=vmin+(vmax-vmin)*i/4;c.beginPath();c.moveTo(x,top);c.lineTo(x,bottom);c.stroke();c.textAlign='center';c.fillText(v.toFixed(digits),x,bottom+15)}
    items.forEach((it,i)=>{const y=top+row*(i+.5),w=pw*Math.max(0,it.value-vmin)/(vmax-vmin);c.fillStyle=[C.blue,C.orange,C.teal,C.gray,C.orange][i%5];c.fillRect(left,y-row*.23,w,row*.46);c.fillStyle='#43586a';c.textAlign='right';c.fillText(it.name,left-7,y+3)});
    c.textAlign='center';c.fillText(xlabel,left+pw/2,f.h-3);
  }
  function draw(settings) {
    const d=predict(settings),pts=d.points.map(p=>({x:p.sec/60,y:p.chamber})),heater=d.points.map(p=>({x:p.sec/60,y:p.heater}));
    const projected=[{x:10,y:d.setpoint},{x:0,y:d.setpoint}];
    line('g1',[{color:C.blue,points:d.temp}],{xlabel:'Position / distance (mm)',ylabel:'Temperature (°C)',xfmt:x=>x.toFixed(0),yfmt:y=>y.toFixed(1)});
    line('g2',[{color:C.blue,points:pts},{color:C.orange,points:heater},{color:C.gray,dash:[4,3],points:projected}],{xmin:0,xmax:10,xlabel:'Time (min)',ylabel:'Temperature (°C)',xfmt:x=>x.toFixed(0),yfmt:y=>y.toFixed(0)});
    categories('g3',d.locations,{xlabel:'Predicted temperature (°C)',digits:1});
    line('g4',[{color:C.teal,points:d.velocity}],{xlabel:'Position / distance (mm)',ylabel:'Air velocity (m/s)',xfmt:x=>x.toFixed(0),yfmt:y=>y.toFixed(2)});
    categories('g5',[{name:'Upper outlet',value:d.upperFlow},{name:'Lower outlet',value:d.lowerFlow}],{horizontal:true,zeroBased:true,digits:3,xlabel:'Volumetric flow rate (m³/s)'});
    line('g6',[{color:C.gray,points:d.pressure}],{xlabel:'Position / distance (mm)',ylabel:'Relative pressure proxy (Pa)',xfmt:x=>x.toFixed(0),yfmt:y=>y.toFixed(2)});
    line('g7',[{color:C.orange,points:d.heatFlux}],{xlabel:'Position / distance (mm)',ylabel:'Heat flux estimate (W/m²)',xfmt:x=>x.toFixed(0),yfmt:y=>y.toFixed(1)});
    line('g8',[{color:C.teal,points:d.points.map(p=>({x:p.sec/60,y:p.energyKwh}))}],{xmin:0,xmax:10,ymin:0,xlabel:'Time (min)',ylabel:'Predicted energy (kWh)',xfmt:x=>x.toFixed(0),yfmt:y=>y.toFixed(3)});
    line('g9',[{color:C.orange,points:d.points.map(p=>({x:p.sec/60,y:p.heatAir}))}],{xmin:0,xmax:10,xlabel:'Time (min)',ylabel:'Heat transfer rate (W)',xfmt:x=>x.toFixed(0),yfmt:y=>y.toFixed(0)});
    const pressureNote=document.querySelector('#g6').parentElement.querySelector('.note');pressureNote.textContent=d.pressureNote+' Derived heat flux is a centerline diffusion estimate.';
    document.getElementById('setpoint').textContent=fmt(d.setpoint,0)+' °C';
    document.getElementById('simtime').textContent='10 min prediction';
  }
  function readSettings() {
    try { if(window.opener&&!window.opener.closed&&window.opener.thesisData)return window.opener.thesisData; } catch(e) {}
    return fallback;
  }
  function refresh() {
    const s=readSettings(),signature=JSON.stringify({setpoint:s.setpoint,fanPercent:s.fanPercent,heaterOn:s.heaterOn,model:s.model});
    const badge=document.getElementById('connection');
    if(window.opener&&!window.opener.closed){badge.textContent='Predictive model · auto updated';badge.className='badge live'}
    else{badge.textContent='Preview defaults · open from simulation to sync';badge.className='badge wait'}
    if(signature!==lastSignature){lastSignature=signature;draw(s)}
  }
  refresh();setInterval(refresh,400);addEventListener('resize',()=>{lastSignature='';refresh()});
})();
