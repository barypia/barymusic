/* ==================== USTAWIENIA LOKALNE ==================== */

const PERFORMANCE_KEY = 'barymusic_performance';
const PERFORMANCE_TEST_VERSION = 1;

let settingsDraft = null;
const settingsSaveTimers = {};

function updateSettings(update, { apply = true } = {}) {
	update(settings);
	persistSettings();
	if (apply) applySettings(settings);
	window.dispatchEvent(new CustomEvent('settingsChanged', { detail: settings }));
	return settings;
}

function loadPerformanceResult() {
	try {
		const result = JSON.parse(localStorage.getItem(PERFORMANCE_KEY) || 'null');
		return result?.version === PERFORMANCE_TEST_VERSION ? result : null;
	} catch {
		return null;
	}
}

function savePerformanceResult(result) {
	try {
		localStorage.setItem(PERFORMANCE_KEY, JSON.stringify({
			version: PERFORMANCE_TEST_VERSION,
			testedAt: new Date().toISOString(),
			...result,
		}));
	} catch {}
}

function runSimplePerformanceTest() {
	if (loadPerformanceResult() || !settings.blurEnabled) return;
	if (document.visibilityState !== 'visible') {
		document.addEventListener('visibilitychange', runSimplePerformanceTest, { once: true });
		return;
	}

	const candidates = document.querySelectorAll('.header, .btn, .modal-content, .popup, .view-picker-popover, .backdrop-blur-md');
	const elements = Array.from(candidates).filter(element => {
		const style = getComputedStyle(element);
		const filter = style.backdropFilter || style.webkitBackdropFilter;
		return element.getClientRects().length > 0 && filter && filter !== 'none';
	}).slice(0, 4);
	if (!elements.length) return;

	const originalTransforms = elements.map(element => element.style.transform);
	const frameTimes = [];
	let startedAt = 0;
	let previousFrame = 0;

	const finish = timestamp => {
		elements.forEach((element, index) => { element.style.transform = originalTransforms[index]; });
		const elapsed = timestamp - startedAt;
		const fps = frameTimes.length / (elapsed / 1000);
		const slowFrameRatio = frameTimes.filter(duration => duration > 25).length / frameTimes.length;
		const weak = fps < 45 || slowFrameRatio > 0.35;

		savePerformanceResult({
			fps: Math.round(fps),
			slowFrameRatio: Math.round(slowFrameRatio * 100) / 100,
			weak,
			blurDisabled: weak,
		});

		if (weak) {
			updateSettings(current => { current.blurEnabled = false; });
			syncSettingsControls(settings);
		}
	};

	const measureFrame = timestamp => {
		if (!startedAt) {
			startedAt = timestamp;
			previousFrame = timestamp;
		} else {
			frameTimes.push(timestamp - previousFrame);
			previousFrame = timestamp;
		}

		const offset = frameTimes.length % 2 ? '0.01px' : '0px';
		elements.forEach(element => { element.style.transform = `translate3d(${offset}, 0, 0)`; });
		if (timestamp - startedAt < 900) requestAnimationFrame(measureFrame);
		else finish(timestamp);
	};

	requestAnimationFrame(measureFrame);
}

function getSetting(source, path) {
	return path.split('.').reduce((value, key) => value?.[key], source);
}

function setSetting(target, path, value, merge = false) {
	const keys = path.split('.');
	const key = keys.pop();
	const parent = keys.reduce((value, part) => value[part] ??= {}, target);
	parent[key] = merge ? { ...parent[key], ...value } : value;
}

function readSettingControl(control) {
	if (control.getAttribute('role') === 'switch') return control.getAttribute('aria-checked') !== 'true';
	if (control.dataset.settingType === 'number') return Number(control.value);
	if (control.dataset.settingType === 'json') {
		try { return JSON.parse(control.value); } catch { return {}; }
	}
	return control.value;
}

function writeSettingControl(control, value) {
	if (control.getAttribute('role') === 'switch') {
		control.setAttribute('aria-checked', value ? 'true' : 'false');
		control.classList.toggle('off', !value);
		return;
	}

	if (control.hasAttribute('data-setting-merge') && control.options) {
		const option = Array.from(control.options).find(item => {
			try {
				const subset = JSON.parse(item.value);
				return Object.entries(subset).every(([key, expected]) => value?.[key] === expected);
			} catch { return false; }
		});
		if (option) control.value = option.value;
	} else if (value !== undefined && value !== null) {
		control.value = value;
	}
	if (control.tagName === 'SELECT') updateCustomSelectLabel?.(control);
}

function updateSettingOutput(control, value) {
	const output = document.getElementById(control.dataset.settingOutput);
	if (!output) return;
	output.textContent = control.dataset.settingFormat === 'blur'
		? i18n.t(`settings.appearance.blur_${value}px`)
		: control.dataset.settingFormat === 'percent'
			? `${value}%`
			: value;
}

function syncSettingsControls(currentSettings = settings, { resetDraft = true } = {}) {
	if (resetDraft || !settingsDraft) {
		settingsDraft = typeof structuredClone === 'function'
			? structuredClone(currentSettings)
			: JSON.parse(JSON.stringify(currentSettings));
	}

	document.querySelectorAll('[data-setting]').forEach(control => {
		const source = control.dataset.settingMode === 'draft' ? settingsDraft : currentSettings;
		const value = getSetting(source, control.dataset.setting);
		writeSettingControl(control, value);
		updateSettingOutput(control, value);
	});

	syncSettingDependencies(currentSettings);
	refreshCustomSelects();
	updateDisplayPreview();
}

function syncSettingDependencies(settings) {
	document.querySelectorAll('[data-setting-enabled-by]').forEach(element => {
		const enabled = Boolean(getSetting(settings, element.dataset.settingEnabledBy));
		element.style.opacity = enabled ? '1' : '0.25';
		element.style.pointerEvents = enabled ? 'auto' : 'none';
	});
}

function handleSettingChange(control) {
	const path = control.dataset.setting;
	const value = readSettingControl(control);
	const merge = control.hasAttribute('data-setting-merge');

	if (control.dataset.settingMode === 'draft') {
		setSetting(settingsDraft, path, value, merge);
		queueSettingsSectionSave(path.split('.')[0]);
	} else {
		const settings = updateSettings(current => setSetting(current, path, value, merge));
		document.querySelectorAll('[data-setting]').forEach(peer => {
			if (peer.dataset.setting === path && peer.dataset.settingMode !== 'draft') {
				writeSettingControl(peer, value);
				updateSettingOutput(peer, value);
			}
		});
		syncSettingDependencies(settings);
		refreshCustomSelects();
		if (path === 'language' && value !== i18next.language) i18n.changeLanguage(value);
	}

	writeSettingControl(control, value);
	updateSettingOutput(control, value);
	if (path.startsWith('display')) updateDisplayPreview();
}

function queueSettingsSectionSave(section) {
	clearTimeout(settingsSaveTimers[section]);
	settingsSaveTimers[section] = setTimeout(() => saveSettingsSection(section), 450);
}

function saveSettingsSection(section) {
	const value = settingsDraft?.[section];
	if (value === undefined) return;
	if (JSON.stringify(getSetting(settings, section)) === JSON.stringify(value)) return;
	const savedValue = typeof structuredClone === 'function'
		? structuredClone(value)
		: JSON.parse(JSON.stringify(value));
	updateSettings(settings => { settings[section] = savedValue; });

	if (section === 'display' && ws?.readyState === WebSocket.OPEN && channelId) {
		ws.send(JSON.stringify({ type: 'display_settings_update', settings: { display: value } }));
	}
}

function applySettings(settings) {
	document.documentElement.classList.toggle('no-blur', !settings.blurEnabled);
	document.documentElement.classList.toggle('no-animations', Boolean(settings.reduceAnimations));
	document.documentElement.style.setProperty('--blur-filter', settings.blurEnabled ? `blur(${settings.blurIntensity}px)` : 'none');
	applyDisplaySettings(settings.display);
}

function updateDisplayPreview() {
	const preview = document.getElementById('displayPreview');
	if (!preview || !settingsDraft?.display) return;
	const display = settingsDraft.display;
	const toPercent = value => Math.max(0, Math.min(100, Number(value) || 0));
	const leftPadding = toPercent(display.leftPadding);
	const rightPadding = toPercent(display.rightPadding);
	const topPadding = toPercent(display.topPadding);
	const bottomPadding = toPercent(display.bottomPadding);
	const paddingGuideColor = 'rgb(59 130 246 / 22%)';
	Object.assign(preview.style, {
		...display,
		letterSpacing: `${display.letterSpacing}px`,
		display: 'flex',
		flexDirection: 'column',
		justifyContent: display.justifyContent || 'center',
		position: 'relative',
		boxSizing: 'border-box',
		overflow: 'hidden',
		whiteSpace: 'nowrap',
		overflowWrap: 'normal',
		wordBreak: 'normal',
		backgroundImage: [
			`linear-gradient(to right, ${paddingGuideColor} 0 ${leftPadding}%, transparent ${leftPadding}% ${100 - rightPadding}%, ${paddingGuideColor} ${100 - rightPadding}% 100%)`,
			`linear-gradient(to bottom, ${paddingGuideColor} 0 ${topPadding}%, transparent ${topPadding}% ${100 - bottomPadding}%, ${paddingGuideColor} ${100 - bottomPadding}% 100%)`,
		].join(', '),
	});
	preview.innerHTML = `<span class="output-content">${[
		i18n.t('settings.display.preview_line_1'),
		i18n.t('settings.display.preview_line_2'),
		i18n.t('settings.display.preview_line_3'),
		i18n.t('settings.display.preview_line_4'),
		i18n.t('settings.display.preview_line_5'),
		i18n.t('settings.display.preview_line_5'),
	].join('<br>')}</span>`;
	autoResizeFont(preview, display);
}

function initDisplayPreviewResize() {
	const frame = document.getElementById('displayPreviewFrame');
	if (!frame || frame.dataset.resizeInitialized) return;
	frame.dataset.resizeInitialized = 'true';

	frame.querySelectorAll('[data-preview-resize]').forEach((handle) => {
		handle.addEventListener('pointerdown', (event) => {
			event.preventDefault();
			const side = handle.dataset.previewResize;
			const startX = event.clientX;
			const startWidth = frame.getBoundingClientRect().width;
			const maxWidth = frame.parentElement.clientWidth;

			const resize = (moveEvent) => {
				const delta = moveEvent.clientX - startX;
				const width = side === 'left' ? startWidth - delta : startWidth + delta;
				frame.style.width = `${Math.max(180, Math.min(maxWidth, width))}px`;
				updateDisplayPreview();
			};
			const stopResize = () => {
				window.removeEventListener('pointermove', resize);
				window.removeEventListener('pointerup', stopResize);
			};

			window.addEventListener('pointermove', resize);
			window.addEventListener('pointerup', stopResize, { once: true });
		});
	});

	if (typeof ResizeObserver === 'function') {
		const observer = new ResizeObserver(() => {
			const preview = document.getElementById('displayPreview');
			if (preview?.textContent.trim()) autoResizeFont(preview, settingsDraft?.display);
		});
		observer.observe(frame);
	}
}

function updateChannelDisplaySettingsDescription() {
	const description = document.getElementById('channelDisplaySettingsDescription');
	if (!description) return;

	const translationKey = typeof isNewChannel !== 'undefined' && isNewChannel
		? 'settings.display.description'
		: 'settings.display.description_without_channel';
	description.textContent = i18n.t(translationKey);
}

function initSettings() {
	updateChannelDisplaySettingsDescription();
	syncSettingsControls(settings);
	const settingsBody = document.getElementById('settingsBody');
	if (settingsBody) setupScrollFade(settingsBody, settingsBody);
	initDisplayPreviewResize();
}

document.addEventListener('input', event => {
	const control = event.target.closest?.('[data-setting]:not(select)');
	if (control && control.getAttribute('role') !== 'switch') handleSettingChange(control);
});

document.addEventListener('change', event => {
	const control = event.target.closest?.('select[data-setting]');
	if (control) handleSettingChange(control);
});

document.addEventListener('click', event => {
	const toggle = event.target.closest?.('[data-setting][role="switch"]');
	if (toggle) handleSettingChange(toggle);
});

document.addEventListener('keydown', event => {
	const toggle = event.target.closest?.('[data-setting][role="switch"]');
	if (toggle && (event.key === 'Enter' || event.key === ' ')) {
		event.preventDefault();
		handleSettingChange(toggle);
	}
});

window.addEventListener('i18nReady', initSettings);
window.addEventListener('i18nReady', runSimplePerformanceTest, { once: true });
i18next.on('languageChanged', () => syncSettingsControls(settings, { resetDraft: false }));
applySettings(settings);

/* ==================== USTAWIENIA ADMINISTRATORA ==================== */

let adminSaveTimer = null;
let adminSavedState = '';
let adminHydrating = false;
let adminSaving = false;

function setAdminToggle(control, checked) {
	if (!control) return;
	control.setAttribute('aria-checked', checked ? 'true' : 'false');
	control.classList.toggle('off', !checked);
	const target = document.getElementById(control.dataset.adminDisables);
	if (target) {
		target.style.opacity = checked ? '0.25' : '1';
		target.style.pointerEvents = checked ? 'none' : 'auto';
	}
}

function getAdminToggle(id) {
	return document.getElementById(id)?.getAttribute('aria-checked') === 'true';
}

function toggleAdminControl(control) {
	setAdminToggle(control, control.getAttribute('aria-checked') !== 'true');
}

async function adminRequest(path, options = {}, errorKey = 'settings.admin.fetch_error', acceptedStatuses = []) {
	const response = await fetch(`${restApiAddress}${path}`, { credentials: 'include', ...options });
	const data = await response.json().catch(() => ({}));
	if (!response.ok && !acceptedStatuses.includes(response.status)) {
		const error = new Error(i18n.t(errorKey));
		error.status = response.status;
		throw error;
	}
	return data;
}

function setAdminText(ids, text, color = '') {
	for (const id of [].concat(ids)) {
		const element = document.getElementById(id);
		if (!element) continue;
		element.textContent = text;
		element.style.color = color;
	}
}

function setAdminTabVisible(visible) {
	document.querySelector('#settingsModal .modal-tab[data-tab="admin"]').classList.toggle('hidden!', !visible);
}

function hideAdminSettingsAfterAccessLoss(error) {
	if (error.status !== 401 && error.status !== 403) return false;
	currentIsAdmin = false;
	setAdminTabVisible(false);
	return true;
}

function toggleSettingsSubmenu(menuId, viewName = null) {
	const menu = document.getElementById(`${menuId}Menu`);
	const root = menu?.parentElement;
	if (!menu || !root) return;
	const views = Array.from(root.querySelectorAll('[data-settings-submenu-view]'));
	const nextPane = viewName
		? views.find(view => view.dataset.settingsSubmenuView === viewName)
		: menu;
	const currentPane = [menu, ...views].find(view => !view.classList.contains('hidden'));
	if (!nextPane || currentPane === nextPane) return;
	const channelDisplayDescription = root.querySelector('#channelDisplaySettingsDescription');
	channelDisplayDescription?.classList.toggle('channel-display-settings-description--hidden', menuId === 'displaySettings' && Boolean(viewName));

	function doSwitch() {
		menu.classList.toggle('hidden', Boolean(viewName));
		views.forEach(view => {
			const isActive = view.dataset.settingsSubmenuView === viewName;
			view.classList.toggle('hidden', !isActive);
			view.classList.toggle('flex', isActive);
		});
		nextPane.classList.add('modal-tab-pane', 'tab-fade-in');
		requestAnimationFrame(() => requestAnimationFrame(() => {
			nextPane.classList.remove('tab-fade-in');
		}));
		if (viewName) lucide.createIcons({ nodes: [root] });
	}

	currentPane.classList.add('modal-tab-pane', 'tab-fade-out');
	setTimeout(() => {
		currentPane.classList.remove('modal-tab-pane', 'tab-fade-out');
		doSwitch();
	}, 150);
}

function renderAdminHealth(data) {
	const statusLabel = ok => i18n.t(ok ? 'settings.admin.status_ok' : 'settings.admin.status_error');
	for (const [id, check] of [
		['adminHealthHttp', data.checks?.http],
		['adminHealthDatabase', data.checks?.database],
		['adminHealthWebsocket', data.checks?.websocket],
	]) {
		setAdminText(id, statusLabel(check?.ok), check?.ok ? 'var(--color-success-fg)' : 'var(--color-danger-fg)');
	}
	setAdminText('adminHealthWebsocketClients', i18n.t('settings.admin.websocket_clients', {
		count: data.checks?.websocket?.clients || 0,
	}));
	setAdminText('adminHealthUpdated', i18n.t('settings.admin.health_updated', {
		status: statusLabel(data.ok),
		version: data.version || '--',
		uptime: data.uptimeSeconds || 0,
		time: data.timestamp ? new Date(data.timestamp).toLocaleString() : '--',
	}));
}

function renderAdminFiles(data) {
	const issues = Number(data.issues || 0);
	setAdminText('adminFilesSummary', issues
		? i18n.t('settings.admin.files_issues', { issues, total: data.total || 0 })
		: i18n.t('settings.admin.files_ok', { total: data.total || 0 }),
	issues ? 'var(--color-danger-fg)' : 'var(--color-success-fg)');
}

function refreshAdminDiagnostics() {
	if (!currentIsAdmin) return;
	const statusIds = [
		'adminHealthUpdated', 'adminHealthHttp', 'adminHealthDatabase',
		'adminHealthWebsocket', 'adminHealthWebsocketClients', 'adminFilesSummary',
	];
	setAdminText(statusIds, i18n.t('settings.admin.status_loading'));

	const requests = [
		{ path: '/api/admin/health', errorKey: 'settings.admin.health_error', ids: statusIds.slice(0, 5), render: renderAdminHealth, acceptedStatuses: [503] },
		{ path: '/api/admin/diagnostics/files', errorKey: 'settings.admin.files_error', ids: ['adminFilesSummary'], render: renderAdminFiles },
	];
	return Promise.allSettled(requests.map(request => adminRequest(request.path, {}, request.errorKey, request.acceptedStatuses)
		.then(request.render)
		.catch(error => {
			if (hideAdminSettingsAfterAccessLoss(error)) return;
			console.error(error);
			setAdminText(request.ids, i18n.t(request.errorKey), 'var(--color-danger-fg)');
		})));
}

function setAdminTags(editorId, value, inputId, placeholderKey) {
	tagEditorSetTags(editorId, String(value || '').split(',').map(tag => tag.trim()).filter(Boolean));
	const input = document.getElementById(inputId);
	if (input) input.placeholder = i18n.t(placeholderKey);
}

function readAdminSettings() {
	return {
		admins: tagEditorGetTags('adminsTagEditor').join(', '),
		canAddSongs: tagEditorGetTags('canAddSongsTagEditor').join(', '),
		allowRegistration: getAdminToggle('adminSettingsAllowReg'),
		allowAllUsersToAddSongs: getAdminToggle('adminSettingsAllowAllAdd'),
	};
}

function queueAdminSave() {
	if (adminHydrating || !currentIsAdmin) return;
	clearTimeout(adminSaveTimer);
	adminSaveTimer = setTimeout(saveAdminSettings, 500);
}

async function loadAdminSettings() {
	setAdminTabVisible(currentIsAdmin);
	if (!currentIsAdmin) return;
	toggleSettingsSubmenu('adminSettings');
	try {
		const data = await adminRequest('/api/admin/config');
		adminHydrating = true;
		setAdminTags('adminsTagEditor', data.admins, 'adminSettingsType', 'settings.admin.admins_placeholder');
		setAdminTags('canAddSongsTagEditor', data.canAddSongs, 'adminSettingsCanAddSongsType', 'settings.admin.can_add_placeholder');
		setAdminToggle(document.getElementById('adminSettingsAllowReg'), Boolean(data.allowRegistration));
		setAdminToggle(document.getElementById('adminSettingsAllowAllAdd'), Boolean(data.allowAllUsersToAddSongs));
		lucide.createIcons({ nodes: [document.getElementById('adminSettingsForm')] });
		requestAnimationFrame(() => {
			adminSavedState = JSON.stringify(readAdminSettings());
			adminHydrating = false;
		});
		refreshAdminDiagnostics();
	} catch (error) {
		adminHydrating = false;
		if (hideAdminSettingsAfterAccessLoss(error)) return;
		console.error(error);
		showToast('error', i18n.t('common.error'), i18n.t('settings.admin.fetch_error'));
	}
}

async function saveAdminSettings() {
	if (!currentIsAdmin || adminSaving) return;
	const body = readAdminSettings();
	const state = JSON.stringify(body);
	if (state === adminSavedState) return;
	adminSaving = true;
	try {
		await adminRequest('/api/admin/config', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(body),
		}, 'settings.admin.save_error');
		adminSavedState = state;
	} catch (error) {
		if (hideAdminSettingsAfterAccessLoss(error)) return;
		console.error(error);
		showToast('error', i18n.t('common.error'), i18n.t('settings.admin.save_error'));
	} finally {
		adminSaving = false;
		if (JSON.stringify(readAdminSettings()) !== adminSavedState) queueAdminSave();
	}
}

document.addEventListener('click', event => {
	const toggle = event.target.closest?.('[data-admin-setting][role="switch"]');
	if (toggle) {
		toggleAdminControl(toggle);
		queueAdminSave();
	}
	if (event.target.closest?.('[data-admin-refresh]')) refreshAdminDiagnostics();
	if (event.target.closest?.('#adminSettingsForm .tag-pill-remove')) setTimeout(queueAdminSave);
});

document.addEventListener('keydown', event => {
	const toggle = event.target.closest?.('[data-admin-setting][role="switch"]');
	if (toggle && (event.key === 'Enter' || event.key === ' ')) {
		event.preventDefault();
		toggleAdminControl(toggle);
		queueAdminSave();
	}
	if (event.target.matches?.('#adminSettingsForm .tag-editor-input') &&
		(event.key === 'Enter' || event.key === ',' || (event.key === 'Backspace' && !event.target.value))) {
		setTimeout(queueAdminSave);
	}
});

document.addEventListener('input', event => {
	if (event.target.matches?.('#adminSettingsForm .tag-editor-input')) queueAdminSave();
});

const adminForm = document.getElementById('adminSettingsForm');
if (adminForm) {
	adminForm.addEventListener('submit', event => event.preventDefault());
}
setAdminTabVisible(currentIsAdmin);
