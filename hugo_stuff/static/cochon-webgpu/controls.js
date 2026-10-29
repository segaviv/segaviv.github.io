import { cameraFrame } from './scene.js';

export function attachControls(viewer) {
    const canvas=viewer.canvas, events=new AbortController(), pointers=new Map();
    const on=(name,fn,options={})=>canvas.addEventListener(name,fn,{...options,signal:events.signal});
    const oldTouch=canvas.style.touchAction, oldTab=canvas.getAttribute('tabindex');
    canvas.style.touchAction='none'; if (oldTab==null) canvas.tabIndex=0;
    const zoom=amount=>{
        if (!viewer.scene) return;
        const c=viewer.camera;
        c.distance=Math.max(c.near*2,Math.min(1e6,c.distance*Math.exp(Math.max(-1,Math.min(1,amount)))));
        viewer.invalidate();
    };
    const rotate=(dx,dy)=>{
        if (!viewer.scene) return;
        const c=viewer.camera, h=Math.max(1,canvas.clientHeight);
        c.azimuth=((c.azimuth-dx/h*360+180)%360+360)%360-180;
        c.elevation=Math.max(-89,Math.min(89,c.elevation+dy/h*360)); viewer.invalidate();
    };
    const pan=(dx,dy)=>{
        if (!viewer.scene) return;
        const c=viewer.camera, {right,up}=cameraFrame(c);
        const s=Math.min(canvas.clientWidth/c.width,canvas.clientHeight/c.height);
        if (!(s>0)) return;
        const f=.5*c.height/Math.tan(c.fov*Math.PI/360);
        const ux=c.distance/((c.fx??f)*s), uy=c.distance/((c.fy??f)*s);
        c.target=c.target.map((v,k)=>v-dx*ux*right[k]+dy*uy*up[k]); viewer.invalidate();
    };
    const two=()=>{
        const [a,b]=[...pointers.values()];
        return {x:(a.x+b.x)/2,y:(a.y+b.y)/2,d:Math.hypot(a.x-b.x,a.y-b.y)};
    };
    on('pointerdown',e=>{
        if (e.button>2) return;
        e.preventDefault(); canvas.focus({preventScroll:true}); canvas.setPointerCapture(e.pointerId);
        pointers.set(e.pointerId,{x:e.clientX,y:e.clientY,button:e.button});
    });
    on('pointermove',e=>{
        const last=pointers.get(e.pointerId); if (!last) return;
        const before=pointers.size===2?two():null;
        const dx=e.clientX-last.x,dy=e.clientY-last.y;
        pointers.set(e.pointerId,{...last,x:e.clientX,y:e.clientY});
        if (before) { const after=two(); pan(after.x-before.x,after.y-before.y);
            if (before.d && after.d) zoom(Math.log(before.d/after.d)); }
        else if (last.button===1) zoom(dy*.01);
        else if (last.button===2||e.shiftKey||e.ctrlKey||e.metaKey) pan(dx,dy);
        else rotate(dx,dy);
    });
    for (const name of ['pointerup','pointercancel','lostpointercapture']) on(name,e=>pointers.delete(e.pointerId));
    on('contextmenu',e=>e.preventDefault());
    on('wheel',e=>{e.preventDefault(); zoom(e.deltaY*(e.deltaMode===1?16:e.deltaMode===2?canvas.clientHeight:1)*.0015);},{passive:false});
    on('dblclick',()=>viewer.resetCamera());
    on('keydown',e=>{
        const moves={ArrowLeft:[20,0],ArrowRight:[-20,0],ArrowUp:[0,20],ArrowDown:[0,-20]};
        if (moves[e.key]) {e.preventDefault(); pan(...moves[e.key]);}
        else if (e.key==='+'||e.key==='=') {e.preventDefault(); zoom(-.1);}
        else if (e.key==='-') {e.preventDefault(); zoom(.1);}
        else if (e.key.toLowerCase()==='r') viewer.resetCamera();
    });
    return ()=>{
        events.abort(); pointers.clear(); canvas.style.touchAction=oldTouch;
        if (oldTab==null) canvas.removeAttribute('tabindex'); else canvas.setAttribute('tabindex',oldTab);
    };
}
