// Independently implemented WebGPU projection, stable radix sorting, and splat drawing.
const CAMERA = /* wgsl */ `
struct Camera {
    eye: vec4f, right: vec4f, up: vec4f, forward: vec4f,
    lens: vec4f, viewport: vec4f, config: vec4u,
}
struct Projected { centerExtent: vec4f, shapeAlpha: vec4f, colorDepth: vec4f }
`;

export const PROJECT = CAMERA + /* wgsl */ `
struct Splat { meanOpacity: vec4f, cov0: vec4f, cov1: vec4f, cov2: vec4f, logitPig: vec4f }
struct Pig { position: vec4f, sh: array<vec4f, 8> }
@group(0) @binding(0) var<uniform> cam: Camera;
@group(0) @binding(1) var<storage, read> splats: array<Splat>;
@group(0) @binding(2) var<storage, read> pigs: array<Pig>;
@group(0) @binding(3) var<storage, read_write> projected: array<Projected>;
@group(0) @binding(4) var<storage, read_write> pairs: array<vec2u>;

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3u) {
    let i = gid.x;
    if (i >= cam.config.x) { return; }
    // Reverse input order makes equal-depth instances draw in reverse part order,
    // matching the inverse of the stable front-to-back Python ordering.
    let slot = cam.config.x - 1u - i;
    pairs[slot] = vec2u(0xffffffffu, i);
    projected[i] = Projected(vec4f(0.0), vec4f(0.0), vec4f(0.0));
    let s = splats[i];
    let delta = s.meanOpacity.xyz - cam.eye.xyz;
    let p = vec3f(dot(delta,cam.right.xyz),dot(delta,cam.up.xyz),dot(delta,cam.forward.xyz));
    if (p.z <= cam.eye.w || s.meanOpacity.w < 1e-5) { return; }
    let center = vec2f(cam.lens.x*p.x/p.z+cam.lens.z, -cam.lens.y*p.y/p.z+cam.lens.w);
    // Evaluate the covariance Jacobian within a guarded view cone. Offscreen
    // centers near z=0 otherwise produce O(1/z^4) variances whose giant quads
    // leak back across the image. Keep the actual projected center unchanged.
    // Bounds include shifted principal points and the full resized viewport.
    let slopeCenter = vec2f((.5*cam.viewport.x-cam.lens.z)/cam.lens.x,
        (cam.lens.w-.5*cam.viewport.y)/cam.lens.y);
    let slopeRadius = 1.3*.5*cam.viewport.xy/cam.lens.xy;
    let slope = clamp(p.xy/p.z,slopeCenter-slopeRadius,slopeCenter+slopeRadius);
    let jx = cam.lens.x/p.z*(cam.right.xyz-slope.x*cam.forward.xyz);
    let jy = cam.lens.y/p.z*(-cam.up.xyz+slope.y*cam.forward.xyz);
    let covariance = mat3x3f(s.cov0.xyz,s.cov1.xyz,s.cov2.xyz);
    let a = max(dot(jx,covariance*jx),0.)+cam.viewport.z;
    let b = dot(jx,covariance*jy);
    let c = max(dot(jy,covariance*jy),0.)+cam.viewport.z;
    let extent = sqrt(cam.viewport.w*vec2f(a,c));
    if (any(center+extent < vec2f(0.0)) || any(center-extent > cam.viewport.xy)) { return; }
    let pig = pigs[u32(s.logitPig.w)];
    let direction = pig.position.xyz-cam.eye.xyz;
    let v = direction/max(length(direction),1e-6);
    let x=v.x; let y=v.y; let z=v.z;
    let basis = array<f32,8>(-.4886025119*y,.4886025119*z,-.4886025119*x,
        1.0925484306*x*y,-1.0925484306*y*z,.3153915653*(3.0*z*z-1.0),
        -1.0925484306*x*z,.5462742153*(x*x-y*y));
    var logits = s.logitPig.xyz;
    var terms = 0u;
    if (cam.config.y == 1u) { terms = 3u; }
    if (cam.config.y == 2u) { terms = 8u; }
    for (var k=0u;k<terms;k++) { logits += pig.sh[k].xyz*basis[k]; }
    let rgb = 1.0/(1.0+exp(-logits));
    // Store a triangular whitening transform instead of an expanded inverse
    // conic. q = |L^-1 delta|^2 stays nonnegative without cancellation between
    // huge positive/negative quadratic terms. A filtered PSD covariance has a
    // Schur complement >= the pixel filter; enforce that bound after rounding.
    let shear = b/a;
    let schur = max(c-b*shear,cam.viewport.z);
    let shape = vec3f(inverseSqrt(a),shear,inverseSqrt(schur));
    projected[i] = Projected(vec4f(center,extent),vec4f(shape,s.meanOpacity.w),vec4f(rgb,p.z));
    // Positive float depth bits are monotone; invert for back-to-front ascending sort.
    pairs[slot] = vec2u(~bitcast<u32>(p.z),i);
}
`;

const RADIX = /* wgsl */ `
struct Settings { count:u32, groups:u32, shift:u32, unused:u32 }
@group(0) @binding(0) var<uniform> settings: Settings;
`;
export const HISTOGRAM = RADIX + /* wgsl */ `
@group(0) @binding(1) var<storage, read> inputPairs: array<vec2u>;
@group(0) @binding(2) var<storage, read_write> histogram: array<u32>;
var<workgroup> bins: array<atomic<u32>,16>;
@compute @workgroup_size(256)
fn main(@builtin(local_invocation_index) lane:u32, @builtin(workgroup_id) group:vec3u) {
    if (lane < 16u) { atomicStore(&bins[lane],0u); }
    workgroupBarrier();
    let i = group.x*256u+lane;
    if (i < settings.count) { atomicAdd(&bins[(inputPairs[i].x >> settings.shift)&15u],1u); }
    workgroupBarrier();
    if (lane < 16u) { histogram[lane*settings.groups+group.x] = atomicLoad(&bins[lane]); }
}
`;
export const PREFIX = RADIX + /* wgsl */ `
@group(0) @binding(1) var<storage, read> histogram: array<u32>;
@group(0) @binding(2) var<storage, read_write> offsets: array<u32>;
@group(0) @binding(3) var<storage, read_write> bases: array<u32>;
var<workgroup> totals: array<u32,16>;
@compute @workgroup_size(16)
fn main(@builtin(local_invocation_index) digit:u32) {
    var total = 0u;
    for (var group=0u;group<settings.groups;group++) {
        let slot = digit*settings.groups+group;
        offsets[slot] = total;
        total += histogram[slot];
    }
    totals[digit] = total;
    workgroupBarrier();
    var base = 0u;
    for (var k=0u;k<digit;k++) { base += totals[k]; }
    bases[digit] = base;
}
`;
export const SCATTER = RADIX + /* wgsl */ `
@group(0) @binding(1) var<storage, read> inputPairs: array<vec2u>;
@group(0) @binding(2) var<storage, read_write> outputPairs: array<vec2u>;
@group(0) @binding(3) var<storage, read> offsets: array<u32>;
@group(0) @binding(4) var<storage, read> bases: array<u32>;
var<workgroup> ranks: array<u32,256>;
var<workgroup> items: array<vec2u,256>;
var<workgroup> first: array<atomic<u32>,16>;

@compute @workgroup_size(256)
fn main(@builtin(local_invocation_index) lane:u32, @builtin(workgroup_id) group:vec3u) {
    let i = group.x*256u+lane;
    var digit = 16u;
    var item = vec2u(0xffffffffu);
    if (i < settings.count) {
        item = inputPairs[i];
        digit = (item.x >> settings.shift)&15u;
    }
    ranks[lane] = (digit << 8u)|lane;
    items[lane] = item;
    if (lane < 16u) { atomicStore(&first[lane],0xffffffffu); }
    workgroupBarrier();
    // A fixed-size shared-memory network orders this block by (digit, input lane).
    // The global algorithm is eight stable radix passes, not a global bitonic sort.
    for (var size=2u;size<=256u;size <<= 1u) {
        for (var stride=size>>1u;stride>0u;stride >>= 1u) {
            let other = lane^stride;
            if (other > lane) {
                let ascending = (lane & size)==0u;
                if ((ranks[lane] > ranks[other]) == ascending) {
                    let r = ranks[lane]; ranks[lane] = ranks[other]; ranks[other] = r;
                    let pair = items[lane]; items[lane] = items[other]; items[other] = pair;
                }
            }
            workgroupBarrier();
        }
    }
    let bucket = ranks[lane]>>8u;
    if (bucket < 16u) { atomicMin(&first[bucket],lane); }
    workgroupBarrier();
    if (bucket < 16u) {
        let at = bases[bucket]+offsets[bucket*settings.groups+group.x]+lane-atomicLoad(&first[bucket]);
        outputPairs[at] = items[lane];
    }
}
`;

export const DRAW = CAMERA + /* wgsl */ `
@group(0) @binding(0) var<uniform> cam: Camera;
@group(0) @binding(1) var<storage, read> projected: array<Projected>;
@group(0) @binding(2) var<storage, read> pairs: array<vec2u>;
struct Vertex {
    @builtin(position) position:vec4f,
    @location(0) delta:vec2f,
    @location(1) @interpolate(flat) shapeAlpha:vec4f,
    @location(2) @interpolate(flat) color:vec3f,
}
@vertex fn vertex(@builtin(vertex_index) vertexIndex:u32, @builtin(instance_index) instance:u32) -> Vertex {
    let corners = array<vec2f,6>(vec2f(-1.,-1.),vec2f(1.,-1.),vec2f(-1.,1.),
        vec2f(-1.,1.),vec2f(1.,-1.),vec2f(1.,1.));
    let p = projected[pairs[instance].y];
    let delta = corners[vertexIndex]*p.centerExtent.zw;
    let pixel = p.centerExtent.xy+delta;
    var clip = vec4f(pixel.x/cam.viewport.x*2.-1.,1.-pixel.y/cam.viewport.y*2.,0.,1.);
    if (p.shapeAlpha.w == 0.) { clip = vec4f(2.,2.,0.,1.); }
    return Vertex(clip,delta,p.shapeAlpha,p.colorDepth.xyz);
}
@fragment fn fragment(v:Vertex) -> @location(0) vec4f {
    let d = v.delta; let c = v.shapeAlpha;
    let local = vec2f(d.x*c.x,(d.y-c.y*d.x)*c.z);
    let q = dot(local,local);
    if (q > cam.viewport.w) { discard; }
    var footprint = exp(-.5*q);
    if (cam.config.z == 1u) {
        let s = 16.*exp(-2.264383186472449*q);
        // Avoid cancellation in 1-exp(-s) in the small-density tails.
        footprint = select(1.-exp(-s),s*(1.-.5*s),s < .001)/.9999998874648253;
    }
    let alpha = min(.995,c.w*footprint);
    if (alpha < 1e-5) { discard; }
    return vec4f(v.color*alpha,alpha);
}
`;
export const PRESENT = /* wgsl */ `
@group(0) @binding(0) var source: texture_2d<f32>;
@vertex fn vertex(@builtin(vertex_index) i:u32) -> @builtin(position) vec4f {
    let p = array<vec2f,3>(vec2f(-1.,-1.),vec2f(3.,-1.),vec2f(-1.,3.));
    return vec4f(p[i],0.,1.);
}
@fragment fn fragment(@builtin(position) p:vec4f) -> @location(0) vec4f {
    return textureLoad(source,vec2i(p.xy),0);
}
`;
