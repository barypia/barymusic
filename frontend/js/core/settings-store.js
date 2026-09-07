/* ==================== GLOBALNY STAN USTAWIEŃ ==================== */

(function initializeSettingsStore() {
	const storageKey = 'barymusic_settings';
	const defaults = {
		language: null,
		startupBehavior: 'startScreen',
		blurEnabled: true,
		blurIntensity: 8,
		reduceAnimations: false,
		defaults: {
			songVisiblePublic: false,
			setlistVisiblePublic: false,
		},
		layout: {
			left: 280,
			right: 280,
			'right-closed': false,
		},
		display: {
			fontFamily: 'Noto Sans',
			fontWeight: '400',
			lineHeight: 1.6,
			letterSpacing: 0,
			textAlign: 'center',
			justifyContent: 'center',
			background: '#141414',
			color: '#ffffff',
			textShadow: 'none',
			leftPadding: 3,
			rightPadding: 3,
			topPadding: 3,
			bottomPadding: 3,
		},
	};

	function mergeDeep(base, overrides) {
		if (!base || typeof base !== 'object') return overrides ?? base;
		const result = Array.isArray(base) ? [...base] : { ...base };
		Object.keys(result).forEach(key => {
			result[key] = result[key] && typeof result[key] === 'object'
				? mergeDeep(result[key], overrides?.[key])
				: overrides && key in overrides ? overrides[key] : result[key];
		});
		return result;
	}

	function readSettings() {
		let stored = {};
		try {
			stored = JSON.parse(localStorage.getItem(storageKey) || '{}');
		} catch {}
		return mergeDeep(defaults, stored);
	}

	window.settings = readSettings();
	window.persistSettings = () => {
		localStorage.setItem(storageKey, JSON.stringify(window.settings));
	};
	window.reloadSettings = () => {
		const current = readSettings();
		Object.keys(window.settings).forEach(key => delete window.settings[key]);
		Object.assign(window.settings, current);
		return window.settings;
	};

	window.addEventListener('storage', event => {
		if (event.key !== storageKey) return;
		window.reloadSettings();
		if (typeof window.applySettings === 'function') window.applySettings(window.settings);
		if (typeof window.syncSettingsControls === 'function') window.syncSettingsControls(window.settings);
		if (window.i18n?.isInitialized && window.settings.language && window.settings.language !== i18next.language) {
			window.i18n.changeLanguage(window.settings.language);
		}
		window.dispatchEvent(new CustomEvent('settingsChanged', { detail: window.settings }));
	});
})();
