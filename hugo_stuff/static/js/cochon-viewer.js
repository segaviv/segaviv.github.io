const canvas = document.querySelector('#cochon-canvas');
const example = document.querySelector('#cochon-example');
const upload = document.querySelector('#cochon-upload');
const file = document.querySelector('#cochon-file');
const reset = document.querySelector('#cochon-reset');
const status = document.querySelector('#cochon-status');
const stats = document.querySelector('#cochon-stats');
const sceneName = document.querySelector('#cochon-scene-name');
const placeholder = document.querySelector('#cochon-placeholder');
const stage = document.querySelector('.cochon-stage');
let viewer;
let busy = true;
let failed = false;
let loadedExample = '';

function setStatus(message, error = false) {
    status.textContent = message;
    status.dataset.error = String(error);
}

function setBusy(value) {
    busy = value;
    stage.setAttribute('aria-busy', String(value));
    example.disabled = upload.disabled = value || failed;
    reset.disabled = value || failed || !viewer?.scene;
}

function fatalError(error) {
    failed = true;
    setBusy(false);
    setStatus(`${error.message} Reload this page to try again.`, true);
}

async function loadScene(source, name, exampleURL = '') {
    if (busy || failed) return;
    setBusy(true);
    setStatus(`Loading ${name}…`);
    try {
        if (!await viewer.load(source) || failed) return;
        await viewer.render();
        if (failed) return;
        placeholder.hidden = true;
        sceneName.textContent = name;
        canvas.setAttribute('aria-label', `Interactive Cochon scene: ${name}`);
        loadedExample = exampleURL;
        example.value = loadedExample;
        setStatus('Scene ready. Drag to explore.');
    } catch (error) {
        example.value = loadedExample;
        if (!failed) setStatus(`Could not open ${name}. ${error.message}`, true);
    } finally {
        setBusy(false);
    }
}

example.addEventListener('change', () => {
    if (example.value) loadScene(example.value, example.selectedOptions[0].textContent, example.value);
});
upload.addEventListener('click', () => file.click());
file.addEventListener('change', () => {
    const scene = file.files[0];
    file.value = ''; // Allow retrying the same file after it has been corrected.
    if (scene) loadScene(scene, scene.name);
});
reset.addEventListener('click', () => viewer?.resetCamera());
window.addEventListener('pagehide', event => {
    if (!event.persisted) viewer?.dispose();
});

try {
    const { CochonViewer } = await import('../cochon-webgpu/cochon.js');
    viewer = await CochonViewer.create(canvas, {
        onError: fatalError,
        onStats: value => {
            stats.textContent = `${value.pigs.toLocaleString()} ${value.pigs === 1 ? 'pig' : 'pigs'}`;
        },
    });
    setBusy(false);
    if (!failed) setStatus('Choose an example or open a JSON scene.');
} catch (error) {
    fatalError(error);
}
