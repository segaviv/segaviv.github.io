import { PARTS } from './template.js';

export const dot = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0);
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const logit = x => { x = clamp(x, 1e-5, 1 - 1e-5); return Math.log(x / (1 - x)); };
function number(x, name, lo = -Infinity, hi = Infinity) {
    if (typeof x !== 'number' || !Number.isFinite(x) || x < lo || x > hi)
        throw new Error(`${name}: expected a finite number in [${lo}, ${hi}].`);
    return x;
}
function vector(x, n, name, lo, hi) {
    if (!Array.isArray(x) || x.length !== n) throw new Error(`${name}: expected ${n} values.`);
    return x.map(v => number(v, name, lo, hi));
}
function rotation(q) {
    const length = Math.hypot(...q);
    if (length < 1e-6) throw new Error('Rotation quaternion must be nonzero.');
    const [w, x, y, z] = q.map(v => v / length);
    return [[1-2*(y*y+z*z), 2*(x*y-z*w), 2*(x*z+y*w)],
        [2*(x*y+z*w), 1-2*(x*x+z*z), 2*(y*z-x*w)],
        [2*(x*z-y*w), 2*(y*z+x*w), 1-2*(x*x+y*y)]];
}
export function cameraFrame(camera) {
    const a = camera.azimuth * Math.PI / 180, e = camera.elevation * Math.PI / 180;
    const r = [Math.cos(a), 0, -Math.sin(a)];
    const u = [-Math.sin(a)*Math.sin(e), Math.cos(e), -Math.cos(a)*Math.sin(e)];
    const forward = [-Math.sin(a)*Math.cos(e), -Math.sin(e), -Math.cos(a)*Math.cos(e)];
    const roll = camera.roll * Math.PI / 180;
    return {
        right: r.map((v, i) => Math.cos(roll)*v + Math.sin(roll)*u[i]),
        up: u.map((v, i) => Math.cos(roll)*v - Math.sin(roll)*r[i]), forward,
        eye: camera.target.map((v, i) => v - camera.distance * forward[i]),
    };
}
export function normalizeCamera(value = {}) {
    const c = {width:256, height:256, azimuth:35, elevation:12, distance:5, fov:38,
        near:.05, target:[0,0,0], roll:0, fx:null, fy:null, cx:null, cy:null, ...value};
    for (const k of ['width','height']) {
        number(c[k], k, 8, 4096);
        if (!Number.isInteger(c[k])) throw new Error(`${k} must be an integer.`);
    }
    number(c.near, 'near', 1e-8, 1e6);
    number(c.distance, 'distance', c.near, 1e6);
    if (c.distance <= c.near) throw new Error('Camera distance must exceed near.');
    number(c.fov, 'fov', 1, 150);
    number(c.azimuth, 'azimuth'); number(c.elevation, 'elevation', -89.999999, 89.999999);
    number(c.roll, 'roll'); c.target = vector(c.target, 3, 'target', -1e6, 1e6);
    if (['fx','fy','cx','cy'].some(k => c[k] != null)) {
        for (const k of ['fx','fy','cx','cy']) number(c[k], k, k === 'fx' || k === 'fy' ? 1e-8 : -1e8, 1e8);
    }
    if ((c.world_to_camera != null) !== (c.camera_center != null)) throw new Error('Incomplete calibrated pose.');
    if (c.world_to_camera != null) {
        const R = c.world_to_camera;
        if (!Array.isArray(R) || R.length !== 3) throw new Error('Invalid camera rotation.');
        const rows = R.map(row => vector(row, 3, 'camera rotation'));
        for (let i=0;i<3;i++) for (let j=0;j<3;j++)
            if (Math.abs(dot(rows[i],rows[j]) - (i===j ? 1 : 0)) > 1e-4) throw new Error('Camera rotation must be orthonormal.');
        const determinant = rows[0][0]*(rows[1][1]*rows[2][2]-rows[1][2]*rows[2][1])
            - rows[0][1]*(rows[1][0]*rows[2][2]-rows[1][2]*rows[2][0])
            + rows[0][2]*(rows[1][0]*rows[2][1]-rows[1][1]*rows[2][0]);
        if (Math.abs(determinant - 1) > 1e-4) throw new Error('Camera rotation must have determinant +1.');
        const eye = vector(c.camera_center, 3, 'camera center', -1e6, 1e6), f = rows[2];
        c.distance = Math.max(c.near*2, Math.hypot(...eye));
        c.target = eye.map((v,i) => v + c.distance*f[i]);
        c.azimuth = Math.atan2(-f[0], -f[2])*180/Math.PI;
        c.elevation = clamp(Math.asin(clamp(-f[1],-1,1))*180/Math.PI,-89.999999,89.999999);
        c.roll = 0;
        const base = cameraFrame(c);
        c.roll = Math.atan2(dot(rows[0],base.up),dot(rows[0],base.right))*180/Math.PI;
    }
    delete c.world_to_camera; delete c.camera_center;
    return c;
}

/** Resolve physical JSON parameters once; all per-camera work is performed on the GPU. */
export function decodeScene(data, {maxPigs = 20000} = {}) {
    if (data?.format !== 'cochon-splatting' || data.version !== 1 || data.template !== 'pig-v1')
        throw new Error('Expected a Cochon scene (version 1, pig-v1 template).');
    if (!Array.isArray(data.pigs) || data.pigs.length < 1 || data.pigs.length > maxPigs)
        throw new Error(`Scene must contain 1–${maxPigs} pigs.`);
    const kernel = data.kernel ?? 'gaussian', degree = data.sh_degree ?? 2;
    if (!['gaussian','density'].includes(kernel) || ![0,1,2].includes(degree)) throw new Error('Invalid kernel or SH degree.');
    const background = vector(data.background, 3, 'background', 0, 1), camera = normalizeCamera(data.camera);
    const count = data.pigs.length * PARTS.length;
    const splats = new Float32Array(count * 20), pigs = new Float32Array(data.pigs.length * 36);
    const parents = PARTS.map(part => PARTS.findIndex(p => p.name === part.parent));
    for (let i=0;i<data.pigs.length;i++) {
        const pig = data.pigs[i];
        const position = vector(pig.position, 3, 'position', -1e4, 1e4);
        const R = rotation(vector(pig.rotation_wxyz, 4, 'rotation'));
        const scale = vector(pig.scale, 3, 'scale', .0025, 20);
        const color = vector(pig.color, 3, 'color', 0, 1).map(logit);
        // Match load_scene's physical/logit clamp for exact endpoints.
        const opacity = clamp(number(pig.opacity, 'opacity', 0, 1), 1e-5, 1-1e-5);
        if (!Array.isArray(pig.sh) || pig.sh.length !== 8) throw new Error('SH must have 8 RGB coefficients.');
        pigs.set(position, i*36);
        pig.sh.forEach((v,k) => pigs.set(vector(v,3,'SH',-3,3), i*36+4+k*4));
        const centers = [], sizes = [];
        PARTS.forEach((part,j) => {
            const change = pig.parts?.[part.name];
            if (!change) throw new Error(`Missing pig part: ${part.name}.`);
            const offset = vector(change.offset_fraction,3,'part offset',-1,1).map(x => clamp(x,-.999999,.999999));
            const localScale = vector(change.scale,3,'part scale',.52,1.92)
                .map(x => Math.exp(.65*clamp(Math.log(x)/.65,-.999999,.999999)));
            const tint = vector(change.tint,3,'part tint',-1,1).map(x => clamp(x,-.999999,.999999));
            let center = part.center.map((v,k) => v + 1.5*part.sigma[k]*offset[k]);
            let size = localScale;
            const parent = parents[j];
            if (parent >= 0) {
                center = center.map((v,k) => centers[parent][k]+v*sizes[parent][k]);
                size = size.map((v,k) => v*sizes[parent][k]);
            }
            centers.push(center); sizes.push(size);
            const mean = R.map((row,k) => dot(row, center.map((v,t) => v*scale[t]))+position[k]);
            const ca = Math.cos(part.angle), sa = Math.sin(part.angle);
            const rp = [[ca,-sa,0],[sa,ca,0],[0,0,1]];
            const A = R.map(row => [0,1,2].map(col =>
                row.reduce((sum,v,k) => sum+v*scale[k]*rp[k][col],0) * size[col]*part.sigma[col]));
            const base = (i*PARTS.length+j)*20;
            splats.set([...mean,opacity],base);
            for (let r=0;r<3;r++) splats.set(A.map(row => dot(A[r],row)),base+4+r*4);
            const logits = part.fixed_color ? part.fixed_color.map(logit) : color.map((v,k) => v+part.tint[k]);
            splats.set([...logits.map((v,k) => v+.8*tint[k]),i],base+16);
        });
    }
    return {splats, pigs, count, pigCount:data.pigs.length, background, camera, kernel, degree};
}

export function cameraUniform(camera, width, height, scene) {
    const frame = cameraFrame(camera), scale = Math.min(width/camera.width,height/camera.height);
    const focal = .5*camera.height/Math.tan(camera.fov*Math.PI/360);
    const result = new ArrayBuffer(112), f = new Float32Array(result), u = new Uint32Array(result);
    f.set([...frame.eye,camera.near],0); f.set(frame.right,4); f.set(frame.up,8); f.set(frame.forward,12);
    f.set([(camera.fx??focal)*scale,(camera.fy??focal)*scale,
        (width-camera.width*scale)/2+(camera.cx??camera.width/2)*scale,
        (height-camera.height*scale)/2+(camera.cy??camera.height/2)*scale],16);
    const threshold = 1e-5;
    const qmax = scene.kernel === 'gaussian' ? -2*Math.log(threshold)
        : -Math.log(-Math.log1p(-threshold*(1-Math.exp(-16)))/16)/2.264383186472449;
    f.set([width,height,.3*scale*scale,qmax],20);
    u.set([scene.count,scene.degree,scene.kernel==='density'?1:0,0],24);
    return result;
}
