import { CochonViewer } from '../cochon-webgpu/cochon.js';

const host = document.querySelector('[data-scene-url]');

if (host && navigator.gpu) {
    const canvas = host.querySelector('canvas');
    const help = document.getElementById('profile-scene-help');
    let viewer;
    let generation = 0;

    function stop() {
        generation++;
        host.classList.remove('is-ready');
        canvas.setAttribute('aria-hidden', 'true');
        canvas.tabIndex = -1;
        help.hidden = true;
        viewer?.dispose();
        viewer = undefined;
    }

    async function start() {
        stop();
        const current = generation;
        const showFallback = error => {
            if (current !== generation) return;
            stop();
            console.warn('Profile scene unavailable; keeping the profile photo.', error);
        };

        try {
            const instance = await CochonViewer.create(canvas, {
                maxPixelRatio: 2,
                maxPixels: 1_000_000,
                onError: showFallback,
            });
            // Navigation or a GPU error may happen while initialization is pending.
            if (current !== generation) {
                instance.dispose();
                return;
            }
            viewer = instance;
            const loaded = await instance.load(host.dataset.sceneUrl);
            if (!loaded || current !== generation) return;
            await instance.render();
            if (current !== generation) return;

            host.classList.add('is-ready');
            canvas.removeAttribute('aria-hidden');
            canvas.tabIndex = 0;
            canvas.title = 'Drag to orbit · Scroll to zoom · Double-click to reset';
            help.hidden = false;
        } catch (error) {
            showFallback(error);
        }
    }

    window.addEventListener('pagehide', stop);
    // A page restored with Back/Forward needs a fresh GPU device after disposal.
    window.addEventListener('pageshow', event => {
        if (event.persisted) start();
    });
    start();
}
