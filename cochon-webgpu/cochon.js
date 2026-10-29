import { decodeScene, normalizeCamera, cameraUniform } from './scene.js';
import { buffer, group, module, compute, createSortPipelines, RadixSorter, readBuffer } from './gpu.js';
import { PROJECT, DRAW, PRESENT } from './shaders.js';
import { attachControls } from './controls.js';

async function readScene(source, maxBytes, signal) {
    if (typeof Blob!=='undefined' && source instanceof Blob) {
        if (source.size>maxBytes) throw new Error('Scene file exceeds the byte limit.');
        return JSON.parse(await source.text());
    }
    if (typeof source!=='string' && !(source instanceof URL)) return source;
    const response=await fetch(source,{signal});
    if (!response.ok) throw new Error(`Could not load scene: HTTP ${response.status}.`);
    if (Number(response.headers.get('content-length'))>maxBytes) throw new Error('Scene exceeds the byte limit.');
    const reader=response.body.getReader(), chunks=[]; let size=0;
    try {
        while (true) {
            const {value,done}=await reader.read(); if (done) break;
            size+=value.length;
            if (size>maxBytes) {await reader.cancel(); throw new Error('Scene exceeds the byte limit.');}
            chunks.push(value);
        }
    } finally { reader.releaseLock(); }
    const bytes=new Uint8Array(size); let at=0;
    for (const chunk of chunks) {bytes.set(chunk,at); at+=chunk.length;}
    return JSON.parse(new TextDecoder().decode(bytes));
}

/** Standalone WebGPU viewer for cochon-splatting/v1 JSON; no Python or runtime dependencies. */
export class CochonViewer {
    static async create(canvas, options={}) {
        if (!navigator.gpu) throw new Error('WebGPU is unavailable. Use a WebGPU-enabled browser on HTTPS or localhost.');
        let device=options.device;
        const owned=!device;
        if (!device) {
            const adapter=await navigator.gpu.requestAdapter({powerPreference:'high-performance'});
            if (!adapter) throw new Error('No WebGPU adapter is available.');
            device=await adapter.requestDevice({requiredLimits:{
                maxStorageBufferBindingSize:Math.min(adapter.limits.maxStorageBufferBindingSize,512*1024**2),
                maxBufferSize:Math.min(adapter.limits.maxBufferSize,512*1024**2),
            }});
        }
        let viewer;
        try {viewer=new CochonViewer(canvas,device,owned,options);await viewer.initialize();return viewer;}
        catch(error) {if(viewer) viewer.dispose();else if(owned) device.destroy();throw error;}
    }
    constructor(canvas,device,owned,options) {
        this.canvas=canvas; this.device=device; this.owned=owned;
        this.options={maxPigs:20000,maxFileBytes:128*1024**2,maxPixelRatio:2,maxPixels:4_000_000,
            controls:true,onError:()=>{},onStats:()=>{},...options};
        for (const k of ['maxPigs','maxFileBytes','maxPixelRatio','maxPixels'])
            if (!Number.isFinite(this.options[k]) || this.options[k]<=0) throw new Error(`Invalid ${k}.`);
        this.disposed=false; this.lost=false; this.revision=0; this.frame=0; this.dirty=false;
        this.resources=[]; this.stats={};
    }
    async initialize() {
        const d=this.device;
        this.context=this.canvas.getContext('webgpu');
        if (!this.context) throw new Error('This canvas is already in use or WebGPU is unavailable.');
        this.format=navigator.gpu.getPreferredCanvasFormat();
        this.context.configure({device:d,format:this.format,alphaMode:'opaque'});
        this.onGPUError=e=>this.fail(new Error(e.error.message));
        d.addEventListener('uncapturederror',this.onGPUError);
        d.lost.then(info=>{
            if (!this.disposed) {this.lost=true; this.fail(new Error(`WebGPU device lost: ${info.message || info.reason}. Recreate the viewer.`));}
        });
        const [project,sort,draw,present]=await Promise.all([
            compute(d,PROJECT,'cochon projection'),createSortPipelines(d),
            module(d,DRAW,'cochon splat draw'),module(d,PRESENT,'cochon presentation')]);
        this.projectPipeline=project; this.sortPipelines=sort;
        this.drawPipeline=await d.createRenderPipelineAsync({label:'cochon splats',layout:'auto',
            vertex:{module:draw,entryPoint:'vertex'},fragment:{module:draw,entryPoint:'fragment',targets:[{
                format:'rgba16float',blend:{color:{srcFactor:'one',dstFactor:'one-minus-src-alpha'},
                    alpha:{srcFactor:'one',dstFactor:'one-minus-src-alpha'}}}]},primitive:{topology:'triangle-list'}});
        this.presentPipeline=await d.createRenderPipelineAsync({label:'cochon present',layout:'auto',
            vertex:{module:present,entryPoint:'vertex'},fragment:{module:present,entryPoint:'fragment',
                targets:[{format:this.format}]},primitive:{topology:'triangle-list'}});
        this.uniform=buffer(d,112,GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST);
        if (this.options.controls) this.removeControls=attachControls(this);
        this.resize=new ResizeObserver(()=>this.invalidate()); this.resize.observe(this.canvas);
    }
    fail(error) {this.lastError=error; this.options.onError(error);}
    check() {if (this.disposed||this.lost) throw new Error('Viewer is disposed or its WebGPU device was lost.');}
    async load(source) {
        this.check(); const revision=++this.revision;
        this.abort?.abort(); const abort=new AbortController(); this.abort=abort;
        const data=await readScene(source,this.options.maxFileBytes,abort.signal);
        if (revision!==this.revision||this.disposed) return false;
        const d=this.device;
        const maxPigs=Math.min(this.options.maxPigs,Math.floor(Math.min(
            d.limits.maxStorageBufferBindingSize,d.limits.maxBufferSize)/(28*80)));
        const scene=decodeScene(data,{maxPigs});
        for (const size of [scene.splats.byteLength,scene.pigs.byteLength,scene.count*48])
            if (size>d.limits.maxStorageBufferBindingSize || size>d.limits.maxBufferSize)
                throw new Error('Scene exceeds this GPU’s buffer limit; reduce the pig count.');
        if (this.flight) await this.flight;
        if (revision!==this.revision||this.disposed) return false;
        const pending=[]; let sorter; let scopesOpen=true;
        d.pushErrorScope('out-of-memory'); d.pushErrorScope('validation');
        try {
            const make=(size,usage,data)=>{const b=buffer(d,size,usage,data);pending.push(b);return b;};
            const splats=make(scene.splats.byteLength,GPUBufferUsage.STORAGE,scene.splats);
            const pigs=make(scene.pigs.byteLength,GPUBufferUsage.STORAGE,scene.pigs);
            const projected=make(scene.count*48,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC);
            sorter=new RadixSorter(d,scene.count,this.sortPipelines);
            const projectBind=group(d,this.projectPipeline,[this.uniform,splats,pigs,projected,sorter.input]);
            const drawBind=group(d,this.drawPipeline,[this.uniform,projected,sorter.output]);
            const checks=[d.popErrorScope(),d.popErrorScope()];scopesOpen=false;
            const [validation,memory]=await Promise.all(checks);
            if (validation||memory) throw new Error((validation||memory).message);
            if (revision!==this.revision||this.disposed) {sorter.destroy();pending.forEach(b=>b.destroy());return false;}
            this.releaseScene(); this.resources=pending; this.sorter=sorter; this.projected=projected;
            this.projectBind=projectBind; this.drawBind=drawBind;
            delete scene.splats; delete scene.pigs; this.scene=scene;
            this.original=structuredClone(scene.camera); this.camera=structuredClone(scene.camera);
            this.invalidate(); return true;
        } catch(error) {
            if(scopesOpen) await Promise.all([d.popErrorScope(),d.popErrorScope()]);
            sorter?.destroy();pending.forEach(b=>b.destroy());throw error;
        }
    }
    getCamera() {this.check();return structuredClone(this.camera);}
    setCamera(camera) {this.check();this.camera=normalizeCamera({...this.camera,...camera});this.invalidate();}
    resetCamera() {if(this.original) {this.camera=structuredClone(this.original);this.invalidate();}}
    setKernel(kernel) {
        if (!['gaussian','density'].includes(kernel)) throw new Error('Invalid kernel.');
        this.check();if(this.scene) {this.scene.kernel=kernel;this.invalidate();}
    }
    invalidate() {
        if(this.disposed||this.lost) return;
        this.dirty=true;
        if(this.frame||this.flight) return;
        this.frame=requestAnimationFrame(()=>{this.frame=0;this.render().catch(e=>this.fail(e));});
    }
    sizeTarget() {
        const r={width:this.canvas.clientWidth,height:this.canvas.clientHeight};
        if(!r.width||!r.height) return false;
        let ratio=Math.min(globalThis.devicePixelRatio||1,this.options.maxPixelRatio);
        ratio=Math.min(ratio,Math.sqrt(this.options.maxPixels/(r.width*r.height)),
            this.device.limits.maxTextureDimension2D/Math.max(r.width,r.height));
        const w=Math.max(1,Math.floor(r.width*ratio)),h=Math.max(1,Math.floor(r.height*ratio));
        if(this.target && w===this.canvas.width && h===this.canvas.height) return true;
        this.canvas.width=w;this.canvas.height=h;this.target?.destroy();
        this.target=this.device.createTexture({label:'cochon float blend target',size:[w,h],format:'rgba16float',
            usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_SRC});
        this.targetView=this.target.createView();
        this.presentBind=this.device.createBindGroup({layout:this.presentPipeline.getBindGroupLayout(0),
            entries:[{binding:0,resource:this.targetView}]});return true;
    }
    async render() {
        this.check();
        if(this.flight) {await this.flight;return this.render();}
        if(!this.scene||!this.sizeTarget()) return this.stats;
        cancelAnimationFrame(this.frame);this.frame=0;this.dirty=false;
        const start=performance.now(),d=this.device,s=this.scene;
        d.queue.writeBuffer(this.uniform,0,cameraUniform(this.camera,this.canvas.width,this.canvas.height,s));
        const encoder=d.createCommandEncoder({label:'cochon frame'});
        const pass=encoder.beginComputePass();
        pass.setPipeline(this.projectPipeline);pass.setBindGroup(0,this.projectBind);
        pass.dispatchWorkgroups(Math.ceil(s.count/256));this.sorter.encode(pass);pass.end();
        const draw=encoder.beginRenderPass({colorAttachments:[{view:this.targetView,
            clearValue:[...s.background,1],loadOp:'clear',storeOp:'store'}]});
        draw.setPipeline(this.drawPipeline);draw.setBindGroup(0,this.drawBind);draw.draw(6,s.count);draw.end();
        const present=encoder.beginRenderPass({colorAttachments:[{view:this.context.getCurrentTexture().createView(),
            clearValue:[0,0,0,1],loadOp:'clear',storeOp:'store'}]});
        present.setPipeline(this.presentPipeline);present.setBindGroup(0,this.presentBind);present.draw(3);present.end();
        d.queue.submit([encoder.finish()]);
        this.flight=d.queue.onSubmittedWorkDone();
        try {
            await this.flight;
            this.stats={pigs:s.pigCount,gaussians:s.count,width:this.canvas.width,height:this.canvas.height,
                frameMs:performance.now()-start,sort:'GPU radix',renderer:'WebGPU'};
            if(!this.disposed) this.options.onStats(this.stats);
            return this.stats;
        } finally {this.flight=null;if(this.dirty) this.invalidate();}
    }
    /** Diagnostic readback for tests; not used in normal rendering. */
    async inspect() {
        await this.render();
        return {pairs:new Uint32Array(await readBuffer(this.device,this.sorter.output,this.scene.count*8)),
            projected:new Float32Array(await readBuffer(this.device,this.projected,this.scene.count*48))};
    }
    releaseScene() {this.sorter?.destroy();this.resources.forEach(b=>b.destroy());this.resources=[];this.scene=null;}
    dispose() {
        if(this.disposed) return;
        this.disposed=true;this.revision++;this.abort?.abort();cancelAnimationFrame(this.frame);
        this.resize?.disconnect();this.removeControls?.();this.releaseScene();
        this.uniform?.destroy();this.target?.destroy();this.context?.unconfigure();
        if(this.onGPUError) this.device.removeEventListener('uncapturederror',this.onGPUError);
        if(this.owned) this.device.destroy();
    }
}

export { decodeScene } from './scene.js';
