/* ==================== INICJALIZACJA ==================== */

// Zmiana identyfikatora omija odpowiedzi mediów zapisane przez starsze wersje
// aplikacji jako immutable. Bieżące odpowiedzi są zawsze rewalidowane przez serwer.
const MEDIA_CACHE_POLICY_VERSION = '2';
const songMediaRevisions = new Map();

function songMediaKey(type, id) {
	return `${type === 'audio' ? 'audio' : 'sheets'}:${id}`;
}

function songMediaUrl(type, id) {
	const endpoint = type === 'audio' ? 'audio' : 'notes';
	const revision = songMediaRevisions.get(songMediaKey(type, id)) || 0;
	return `${restApiAddress}/api/files/${endpoint}/${encodeURIComponent(id)}?cache-policy=${MEDIA_CACHE_POLICY_VERSION}&revision=${revision}`;
}

function invalidateSongMedia(type, id) {
	const key = songMediaKey(type, id);
	songMediaRevisions.set(key, (songMediaRevisions.get(key) || 0) + 1);
}

function setElementDisplay(el, visible) {
	const element = typeof el === 'string' ? document.querySelector(el) : el;
	if (!element) {
		console.warn(`setElementDisplay: element "${el}" not found`);
		return;
	}
	const displayClass = visible ? 'flex' : 'hidden';
	const importantClass = visible ? 'flex!' : 'hidden!';
	element.classList.remove('flex', 'flex!', 'hidden', 'hidden!');
	element.classList.add(displayClass);

	const actualDisplay = getComputedStyle(element).display;
	const hasExpectedDisplay = visible ? actualDisplay === 'flex' : actualDisplay === 'none';
	if (!hasExpectedDisplay) element.classList.replace(displayClass, importantClass);
}

function setButtonLoading(button, isLoading) {
	if (!button) return;
	const loader = button.querySelector('[data-lucide="loader-circle"]');
	const label = button.querySelector('[data-button-loading-label]');

	if (isLoading) {
		if (button.classList.contains('btn-loading')) return;
		button.style.width = `${Math.ceil(button.getBoundingClientRect().width)}px`;
		button.disabled = true;
		button.setAttribute('aria-busy', 'true');
		button.classList.add('btn-loading');
		requestAnimationFrame(() => {
			if (button.classList.contains('btn-loading')) button.style.width = '42px';
		});
		return;
	}

	button.classList.remove('btn-loading');
	button.disabled = false;
	button.removeAttribute('aria-busy');
	button.style.width = '';
	if (loader) setElementDisplay(loader, false);
	if (label) setElementDisplay(label, true);
}

function toggleSearchField(el, button) {
	const field = typeof el === 'string' ? document.querySelector(el) : el;
	if (!field) {
		console.warn(`toggleSearchField: element "${el}" not found`);
		return;
	}

	const isOpening = field.classList.contains('search-field--collapsed');
	field.classList.toggle('search-field--collapsed', !isOpening);
	button?.classList.toggle('active', isOpening);
	button?.setAttribute('aria-expanded', String(isOpening));

	if (isOpening) {
		requestAnimationFrame(() => field.querySelector('input')?.focus());
	}
}

function toggleFullscreen() {
	if (!document.fullscreenElement) {
		document.documentElement.requestFullscreen?.();
	} else {
		document.exitFullscreen?.();
	}
}

document.addEventListener('fullscreenchange', () => {
	const btn = document.getElementById('fullscreenBtn');
	if (!btn) return;
	const isFullscreen = !!document.fullscreenElement;
	btn.classList.toggle('active', isFullscreen);
	btn.innerHTML = `<i data-lucide="${isFullscreen ? 'minimize' : 'maximize'}"></i>`;
	lucide.createIcons({ nodes: [btn] });
});

function showStartupSetupSkeleton() {
    const modal = document.getElementById('connectModal');
    if (!modal || modal.classList.contains('modal-open')) return;

    setElementDisplay('#connectScreenLoading', true);
    setElementDisplay('#connectScreenMode', false);
    setElementDisplay('#connectScreenChannels', false);
    setElementDisplay('#connectScreenCreateChannel', false);
    const errEl = document.getElementById('connectScreenError');
    if (errEl) errEl.classList.add('hidden');

    if (!document.querySelector('.modal-backdrop')) {
        const backdrop = document.createElement('div');
        backdrop.className = 'modal-backdrop';
        document.body.appendChild(backdrop);
        requestAnimationFrame(() => backdrop.classList.add('modal-backdrop-visible'));
    }

    modal.classList.add('modal-open');
    modal.removeAttribute('aria-hidden');
    document.body.classList.add('modal-active');
    requestAnimationFrame(() => {
        const dialog = modal.querySelector('.modal-dialog');
        if (dialog) dialog.classList.add('modal-dialog-visible');
    });
}

/**
 * Load remaining application scripts after i18n is initialized
 * Ensures proper startup order and prevents race conditions
 * Waits for all scripts to load before resolving
 */
async function loadApplicationScripts() {
    const scripts = [
        'js/ws/websocket.js',
        'js/rest/auth.js',
        'js/rest/lyrics-editor.js',
        'js/rest/musicxml-parser.js',
        'js/rest/add-song.js',
        'js/rest/transfer.js',
        'js/core/navigation.js',
        'js/core/songs-fetch.js',
        'js/core/components.js',
        'js/core/context-menu.js',
        'js/song/panel-views.js',
        'js/output/output.js',
        'js/core/settings.js',
        'js/song/panels.js',
        'js/song/sheets.js',
        'js/song/chords.js',
        'js/song/lyrics.js',
        'js/song/audio.js',
        'js/song/song.js',
        'js/setlist/setlists.js',
        'js/setlist/setlist-editor.js',
        'js/core/licenses/licenses.js'
    ];

    for (const src of scripts) {
        await new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.onload = resolve;
            script.onerror = () => {
                console.error(`Failed to load script: ${src}`);
                resolve(); // nie blokuj reszty mimo błędu
            };
            script.src = src;
            document.head.appendChild(script);
        });
    }
}

document.addEventListener('DOMContentLoaded', async () => {
    showStartupSetupSkeleton();

    // Initialize i18n first, before anything else
    if (window.i18n) {
        await i18n.init();
        const selectInSettings = document.getElementById('languageSelect');
        if (selectInSettings && i18next.language) selectInSettings.value = i18next.language.split('-')[0];
        const selectInSetup = document.getElementById('languageSetup');
        if (selectInSetup && i18next.language) selectInSetup.value = i18next.language.split('-')[0];
    }

    // Now that i18n is ready, load all remaining application scripts and wait for them
    await loadApplicationScripts();

    // Only after all scripts are loaded, initialize UI components
    initDropdowns();
    initModals();

    // Signal that i18n is ready and all scripts are loaded - other scripts listen for this
    window.dispatchEvent(new CustomEvent('i18nReady'));
    if (typeof promptForInitialAdminSetup === 'function') promptForInitialAdminSetup();
    
    fetch('/package.json')
        .then(r => r.json())
        .then(pkg => {
            const badge = document.getElementById('setup-version-badge');
            if (badge) badge.classList.remove('setup-version-badge--skeleton');
            if (!pkg.version) return;
            window.appVersion = pkg.version;
            const el = document.getElementById('barymusic-version');
            if (el) el.textContent = pkg.version;
            if (badge) badge.textContent = i18n.t('common.version_value', { version: pkg.version });
        })
        .catch(() => {
            const badge = document.getElementById('setup-version-badge');
            if (badge) badge.classList.remove('setup-version-badge--skeleton');
        });
});

lucide.createIcons();
