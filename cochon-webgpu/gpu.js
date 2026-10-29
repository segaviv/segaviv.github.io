import { HISTOGRAM, PREFIX, SCATTER } from './shaders.js';

export function buffer(device, size, usage, data, label='cochon buffer') {
    const result = device.createBuffer({label,size:Math.max(4,size),usage,
        mappedAtCreation:!!data});
    if (data) {
        new Uint8Array(result.getMappedRange()).set(new Uint8Array(data.buffer,data.byteOffset,data.byteLength));
        result.unmap();
    }
    return result;
}
export function group(device, pipeline, buffers) {
    return device.createBindGroup({layout:pipeline.getBindGroupLayout(0),
        entries:buffers.map((b,binding) => ({binding,resource:{buffer:b}}))});
}
export async function module(device, code, label) {
    const shader = device.createShaderModule({code,label});
    const report = await shader.getCompilationInfo();
    const errors = report.messages.filter(m => m.type==='error');
    if (errors.length) throw new Error(`${label}: ${errors.map(m => `${m.lineNum}:${m.linePos} ${m.message}`).join('\n')}`);
    return shader;
}
export async function compute(device, code, label) {
    return device.createComputePipelineAsync({label,layout:'auto',compute:{
        module:await module(device,code,label),entryPoint:'main'}});
}
export async function createSortPipelines(device) {
    const [histogram,prefix,scatter] = await Promise.all([
        compute(device,HISTOGRAM,'cochon radix histogram'),compute(device,PREFIX,'cochon radix prefix'),
        compute(device,SCATTER,'cochon radix scatter')]);
    return {histogram,prefix,scatter};
}

/** Stable ascending u32 key/value sort; eight 4-bit passes, no frame readback. */
export class RadixSorter {
    constructor(device,count,pipelines) {
        if (!Number.isInteger(count) || count < 1 || Math.ceil(count/256)>device.limits.maxComputeWorkgroupsPerDimension)
            throw new Error('Unsupported radix sort count.');
        if (count*8>device.limits.maxStorageBufferBindingSize || count*8>device.limits.maxBufferSize)
            throw new Error('Sort buffers exceed this GPU’s limits.');
        this.device=device; this.count=count; this.groups=Math.ceil(count/256); this.pipelines=pipelines;
        const storage=GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST|GPUBufferUsage.COPY_SRC;
        this.resources=[];
        const make=(n,usage,data) => {
            const b=buffer(device,n,usage,data); this.resources.push(b); return b;
        };
        this.input=make(count*8,storage); this.scratch=make(count*8,storage);
        const histogram=make(this.groups*16*4,storage), offsets=make(this.groups*16*4,storage), bases=make(64,storage);
        this.bindings=[];
        for (let i=0;i<8;i++) {
            const uniform=make(16,GPUBufferUsage.UNIFORM,new Uint32Array([count,this.groups,i*4,0]));
            const src=i%2 ? this.scratch : this.input, dst=i%2 ? this.input : this.scratch;
            this.bindings.push({
                histogram:group(device,pipelines.histogram,[uniform,src,histogram]),
                prefix:group(device,pipelines.prefix,[uniform,histogram,offsets,bases]),
                scatter:group(device,pipelines.scatter,[uniform,src,dst,offsets,bases]),
            });
        }
        this.output=this.input; // An even number of ping-pong passes.
    }
    encode(pass) {
        for (const bindings of this.bindings) for (const name of ['histogram','prefix','scatter']) {
            pass.setPipeline(this.pipelines[name]); pass.setBindGroup(0,bindings[name]);
            pass.dispatchWorkgroups(name==='prefix'?1:this.groups);
        }
    }
    destroy() { for (const b of this.resources) b.destroy(); this.resources=[]; }
}

/** Explicit diagnostics only. Normal navigation never calls mapAsync or reads GPU arrays. */
export async function readBuffer(device, source, bytes) {
    const staging=buffer(device,bytes,GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ);
    try {
        const encoder=device.createCommandEncoder(); encoder.copyBufferToBuffer(source,0,staging,0,bytes);
        device.queue.submit([encoder.finish()]); await staging.mapAsync(GPUMapMode.READ);
        return staging.getMappedRange().slice(0);
    } finally { staging.unmap(); staging.destroy(); }
}
