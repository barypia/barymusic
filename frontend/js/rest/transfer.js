/* ==================== EXPORT ==================== */

function _downloadTransferResponse(response, fallbackName) {
	return response.blob().then(blob => {
		const disposition = response.headers.get('Content-Disposition') || '';
		const encoded = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
		const quoted = disposition.match(/filename="([^"]+)"/i)?.[1];
		const filename = encoded ? decodeURIComponent(encoded) : (quoted || fallbackName);
		const url = URL.createObjectURL(blob);
		const anchor = document.createElement('a');
		anchor.href = url;
		anchor.download = filename;
		document.body.appendChild(anchor);
		anchor.click();
		anchor.remove();
		setTimeout(() => URL.revokeObjectURL(url), 1000);
	});
}

let _transferSelectedSongIds = new Set();
let _transferSelectedSetlistIds = new Set();

async function initializeTransferSettings() {
	const importButton = document.getElementById('libraryImportTransferBtn');
	if (importButton) setElementDisplay(importButton, currentCanAddSongs === true);
	const importView = document.getElementById('transfer-tab-import');
	if (!currentCanAddSongs && importView && !importView.classList.contains('hidden')) {
		toggleSettingsSubmenu('librarySettings');
	}
	await populateTransferChoices();
}

async function openLibraryTransferSettings({ songId = null, setlistId = null } = {}) {
	const libraryTab = document.getElementById('settingsModal').querySelector('.modal-tab[data-tab="library"]');

	openModal('settingsModal');
	switchModalTab('settings', 'library', libraryTab, true);
	await initializeTransferSettings();
	if (songId != null) {
		document.getElementById('transferExportScope').value = 'songs';
		_transferSelectedSongIds = new Set([String(songId)]);
	}
	if (setlistId != null) {
		document.getElementById('transferExportFormat').value = 'barymusic';
		document.getElementById('transferExportScope').value = 'setlists';
		_transferSelectedSetlistIds = new Set([String(setlistId)]);
	}
	updateTransferExportOptions();
	toggleSettingsSubmenu('librarySettings', 'export'); 
	setButtonLoading(document.getElementById('transferExportBtn'), false);
	_updateTransferExportButton();
}

function openTransferSettingsForSong(songId) {
	return openLibraryTransferSettings({ songId });
}

function openTransferSettingsForSetlist(setlistId) {
	return openLibraryTransferSettings({ setlistId });
}

async function populateTransferChoices() {
	const availableIds = new Set((allSongs || []).map(song => String(song.id)));
	_transferSelectedSongIds = new Set([..._transferSelectedSongIds].filter(id => availableIds.has(id)));
	if (typeof _setlistList !== 'undefined' && !_setlistList) {
		const setlistView = document.querySelector('#mainContainer-tab-setlists .view-body[data-view="setlists"]');
		if (setlistView) await refreshSetlistListView(setlistView);
	}
	const availableSetlistIds = new Set((Array.isArray(_setlistList) ? _setlistList : []).map(setlist => String(setlist.id)));
	_transferSelectedSetlistIds = new Set([..._transferSelectedSetlistIds].filter(id => availableSetlistIds.has(id)));
	updateTransferExportOptions();
}

function renderTransferSongSelection() {
	const container = document.querySelector('[data-transfer-songlist-view]');
	if (!container) return;
	const visibleSongs = renderSonglist(container, {
		query: document.querySelector('[data-transfer-song-search]')?.value || '',
		selectedIds: _transferSelectedSongIds,
		multiple: true,
		emptyLabel: i18n.t('panels.songlist_empty'),
		onSelect: song => {
			const id = String(song.id);
			if (_transferSelectedSongIds.has(id)) _transferSelectedSongIds.delete(id);
			else _transferSelectedSongIds.add(id);
			renderTransferSongSelection();
		}
	});

	const count = document.getElementById('transferSongSelectionCount');
	if (count) count.textContent = i18n.t('transfer.selection_count', {
		selected: _transferSelectedSongIds.size,
		visible: visibleSongs.length
	});
	const clearButton = document.querySelector('[data-action="clear-transfer-songs"]');
	if (clearButton) clearButton.disabled = _transferSelectedSongIds.size === 0;
	const selectVisibleButton = document.querySelector('[data-action="select-visible-transfer-songs"]');
	if (selectVisibleButton) selectVisibleButton.disabled = visibleSongs.length === 0 || visibleSongs.every(song => _transferSelectedSongIds.has(String(song.id)));
	_updateTransferExportButton();
}

function selectVisibleTransferSongs() {
	getFilteredSonglist(document.querySelector('[data-transfer-song-search]')?.value || '')
		.forEach(song => _transferSelectedSongIds.add(String(song.id)));
	renderTransferSongSelection();
}

function clearTransferSongSelection() {
	_transferSelectedSongIds.clear();
	renderTransferSongSelection();
}

function openTransferSongFilter(event, trigger) {
	event?.stopPropagation();
	openSonglistFilterContextMenu(trigger, renderTransferSongSelection);
}

function renderTransferSetlistSelection() {
	const container = document.querySelector('[data-transfer-setlists-view]');
	if (!container) return;
	const visibleSetlists = renderSetlistList(container, {
		query: document.querySelector('[data-transfer-setlist-search]')?.value || '',
		selectedIds: _transferSelectedSetlistIds,
		choice: true,
		onSelect: setlist => {
			const id = String(setlist.id);
			if (_transferSelectedSetlistIds.has(id)) _transferSelectedSetlistIds.delete(id);
			else _transferSelectedSetlistIds.add(id);
			renderTransferSetlistSelection();
		}
	});

	const count = document.getElementById('transferSetlistSelectionCount');
	if (count) count.textContent = i18n.t('transfer.selection_count', {
		selected: _transferSelectedSetlistIds.size,
		visible: visibleSetlists.length
	});
	const clearButton = document.querySelector('[data-action="clear-transfer-setlists"]');
	if (clearButton) clearButton.disabled = _transferSelectedSetlistIds.size === 0;
	const selectVisibleButton = document.querySelector('[data-action="select-visible-transfer-setlists"]');
	if (selectVisibleButton) selectVisibleButton.disabled = visibleSetlists.length === 0 || visibleSetlists.every(setlist => _transferSelectedSetlistIds.has(String(setlist.id)));
	_updateTransferExportButton();
}

function selectVisibleTransferSetlists() {
	getFilteredSetlists(document.querySelector('[data-transfer-setlist-search]')?.value || '')
		.forEach(setlist => _transferSelectedSetlistIds.add(String(setlist.id)));
	renderTransferSetlistSelection();
}

function clearTransferSetlistSelection() {
	_transferSelectedSetlistIds.clear();
	renderTransferSetlistSelection();
}

function openTransferSetlistFilter(event, trigger) {
	event?.stopPropagation();
	openSetlistFilterContextMenu(trigger, renderTransferSetlistSelection);
}

function _updateTransferExportButton() {
	const button = document.getElementById('transferExportBtn');
	const scope = document.getElementById('transferExportScope')?.value;
	if (button && !button.classList.contains('btn-loading')) {
		button.disabled = (scope === 'songs' && _transferSelectedSongIds.size === 0)
			|| (scope === 'setlists' && _transferSelectedSetlistIds.size === 0);
	}
}

function updateTransferExportOptions() {
	const format = document.getElementById('transferExportFormat')?.value || 'barymusic';
	const scopeSelect = document.getElementById('transferExportScope');
	if (format !== 'barymusic') scopeSelect.value = 'songs';
	const scope = scopeSelect.value;
	const scopeRow = document.getElementById('transferExportScopeRow');

	if (scopeRow) {
		const hideScope = format !== 'barymusic';
		scopeRow.classList.toggle('transfer-export-scope--hidden', hideScope);
		scopeRow.setAttribute('aria-hidden', hideScope);
	}
	scopeSelect.disabled = format !== 'barymusic';
	setElementDisplay('#transferSongSelection', scope === 'songs');
	setElementDisplay('#transferSetlistSelection', format === 'barymusic' && scope === 'setlists');

	if (scope === 'songs') {
		renderTransferSongSelection();
	} else {
		renderTransferSetlistSelection();
	}
	if (format === 'barymusic') {
		scopeSelect.nextElementSibling.querySelector('[data-label]').textContent = i18n.t(`transfer.scope_${scope}`);
	}

	document.getElementById('transferExportHint').textContent = i18n.t(`transfer.${format}_hint`);
}

function _transferExportScope() {
	const type = document.getElementById('transferExportScope')?.value || 'songs';
	if (type === 'setlists') return { type, setlistIds: [..._transferSelectedSetlistIds].map(Number) };
	return { type: 'songs', songIds: [..._transferSelectedSongIds].map(Number) };
}

async function exportLibrarySelection() {
	const button = document.getElementById('transferExportBtn');
	setButtonLoading(button, true);
	try {
		const format = document.getElementById('transferExportFormat').value;
		const scope = _transferExportScope();
		if ((scope.type === 'songs' && !scope.songIds.length) || (scope.type === 'setlists' && !scope.setlistIds.length)) {
			throw new Error(i18n.t('transfer.empty_selection'));
		}
		const response = await fetch(`${restApiAddress}/api/transfer/export`, {
			method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ format, scope }),
		});
		if (!response.ok) {
			const payload = await response.json().catch(() => ({}));
			throw new Error(payload.error || i18n.t('songs.export_error'));
		}
		await _downloadTransferResponse(response, `barymusic-export-${new Date().toISOString().slice(0, 10)}`);
		showToast('success', i18n.t('songs.export_success'));
	} catch (error) {
		console.error(error);
		showToast('error', i18n.t('songs.export_error'), error.message);
	} finally {
		setButtonLoading(button, false);
		_updateTransferExportButton();
	}
}

async function exportAdminBackup() {
	const button = document.getElementById('adminBackupBtn');
	setButtonLoading(button, true);
	const anchor = document.createElement('a');
	anchor.href = `${restApiAddress}/api/admin/backup`;
	anchor.download = '';
	document.body.appendChild(anchor);
	anchor.click();
	anchor.remove();
	showToast('success', i18n.t('settings.admin.backup_success'));
	setTimeout(() => setButtonLoading(button, false), 500);
}

/* ==================== IMPORT ==================== */

let _transferImportToken = null;
let _transferImportFiles = [];
let _transferImportRevision = 0;

function _transferImportText(key, values = {}) {
	return i18n.t(key, { ...values, interpolation: { escapeValue: false } });
}

function _transferWarningText(warning) {
	if (!warning?.code) return String(warning || '');
	return _transferImportText(`transfer.import_warnings.${warning.code}`, warning.values);
}

function _renderTransferSelectedFiles(files) {
	const wrap = document.getElementById('transferSelectedFiles');
	if (!wrap) return;
	wrap.innerHTML = files.length ? `
		<div class="list-item w-full">
			<div class="list-item__text">
				<span class="list-item__title">${escapeHtml(_transferImportText('transfer.selected_files', { count: files.length }))}</span>
				${files.map((file, index) => `
					<div class="flex items-center gap-2">
						<span class="list-item__desc flex-1 break-all">${escapeHtml(file.name)}</span>
						<button type="button" class="btn small danger" data-transfer-remove-file="${index}" title="${escapeHtml(i18n.t('transfer.remove_file'))}" aria-label="${escapeHtml(i18n.t('transfer.remove_file'))}"><i data-lucide="x"></i></button>
					</div>`).join('')}
			</div>
		</div>` : '';
	wrap.querySelectorAll('[data-transfer-remove-file]').forEach(button => {
		button.addEventListener('click', () => {
			_transferImportFiles.splice(Number(button.dataset.transferRemoveFile), 1);
			_resetTransferImportPreview();
			_renderTransferSelectedFiles(_transferImportFiles);
		});
	});
	setElementDisplay(wrap, !!files.length);
	if (window.lucide) window.lucide.createIcons();
}

function _resetTransferImportPreview() {
	_transferImportToken = null;
	_transferImportRevision++;
	const preview = document.getElementById('transferImportPreview');
	if (preview) { preview.innerHTML = ''; setElementDisplay(preview, false); }
	setElementDisplay(document.getElementById('transferPreviewBtn'), true);
	setElementDisplay(document.getElementById('transferCommitBtn'), false);
}

async function previewLibraryImport() {
	const files = _transferImportFiles;
	if (!files.length) {
		showToast('error', i18n.t('songs.import_error'), i18n.t('transfer.choose_files'));
		return;
	}
	const button = document.getElementById('transferPreviewBtn');
	const revision = _transferImportRevision;
	setButtonLoading(button, true);
	try {
		const formData = new FormData();
		files.forEach(file => formData.append('files', file));
		const response = await fetch(`${restApiAddress}/api/transfer/import/preview`, { 
			method: 'POST', credentials: 'include', 
			body: formData 
		});
		const result = await response.json().catch(() => ({}));
		if (!response.ok) throw new Error(result.error || i18n.t('songs.import_error'));
		if (revision !== _transferImportRevision) return;
		_transferImportToken = result.token;
		_renderTransferImportPreview(result);
		setElementDisplay(document.getElementById('transferPreviewBtn'), false);
		setElementDisplay(document.getElementById('transferCommitBtn'), true);
	} catch (error) {
		console.error(error);
		showToast('error', i18n.t('songs.import_error'), error.message);
	} finally {
		setButtonLoading(button, false);
	}
}

function _renderTransferImportPreview(result) {
	const wrap = document.getElementById('transferImportPreview');
	if (!wrap) return;
	const songs = result.songs || [];
	const setlists = result.setlists || [];
	const warnings = result.warnings || [];
	const sources = result.sources || [{ filename: '', formats: result.formats || [], songs, setlists }];
	wrap.innerHTML = `
		<div class="list-group min-w-0 w-full">
			<span class="list-group__title">${escapeHtml(i18n.t('transfer.preview_title'))}</span>
			<div class="list-item">
				<span class="list-item__title">${escapeHtml(_transferImportText('transfer.preview_summary', { songs: songs.length, setlists: setlists.length }))}</span>
			</div>
		</div>
		${sources.map(source => {
			const visibleSongs = source.songs || [];
			return `<div class="list-group min-w-0 w-full">
				<span class="list-group__title break-all">${escapeHtml(source.filename)}</span>
				<div class="list-item">
					<span class="list-item__desc">${escapeHtml(_transferImportText('transfer.detected_formats', { formats: (source.formats || []).join(', ') }))}</span>
				</div>
				${(source.setlists || []).map(item => `<div class="list-item">
					<div class="list-item__text">
						<span class="list-item__title">${escapeHtml(item.title)}</span>
						<span class="list-item__desc">${escapeHtml(i18n.t('transfer.setlist_to_import'))}</span>
					</div>
				</div>`).join('')}
				${visibleSongs.map(song => {
					const details = [
						song.fromSetlist ? i18n.t('transfer.setlist_song') : i18n.t('transfer.song_to_import'),
						song.hasAudio ? i18n.t('transfer.import_audio') : '',
						song.hasSheets ? i18n.t('transfer.import_sheets') : '',
					].filter(Boolean).join(', ');
					return `<div class="list-item">
						<div class="list-item__text">
							<span class="list-item__title">${escapeHtml(song.title)}</span>
							<span class="list-item__desc">${escapeHtml(details)}</span>
						</div>
					</div>`;
				}).join('')}
			</div>`;
		}).join('')}
		<div class="list-group min-w-0 w-full">
			<span class="list-group__title">${escapeHtml(i18n.t('transfer.before_import'))}</span>
			<div class="list-item">
				<div class="list-item__text">
					${[i18n.t('transfer.new_ids_notice'), ...warnings.map(_transferWarningText)].map(message => `<span class="list-item__desc">${escapeHtml(message)}</span>`).join('')}
				</div>
			</div>
		</div>`;
	setElementDisplay(wrap, true);
}

async function commitLibraryImport() {
	if (!_transferImportToken) return;
	const button = document.getElementById('transferCommitBtn');
	setButtonLoading(button, true);
	try {
		const response = await fetch(`${restApiAddress}/api/transfer/import/commit`, {
			method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ token: _transferImportToken }),
		});
		const result = await response.json().catch(() => ({}));
		if (!response.ok) throw new Error(result.error || i18n.t('songs.import_error'));
		_transferImportToken = null;
		await loadJson();
		if (typeof refreshPanelContent !== 'undefined' && refreshPanelContent.songlist) refreshPanelContent.songlist();
		_setlistList = null;
		const setlistView = document.querySelector('#mainContainer-tab-setlists .view-body[data-view="setlists"]');
		if (setlistView && typeof refreshSetlistListView === 'function') refreshSetlistListView(setlistView, true);
		showToast('success', i18n.t('transfer.import_complete', { songs: result.importedSongs, setlists: result.importedSetlists }));
		_transferImportFiles = [];
		_renderTransferSelectedFiles([]);
		closeAllModals();
	} catch (error) {
		console.error(error);
		showToast('error', i18n.t('songs.import_error'), error.message);
	} finally {
		setButtonLoading(button, false);
	}
}

async function restoreBootstrapBackup(input) {
	const file = input.files?.[0];
	if (!file) return;
	const status = document.getElementById('bootstrapRestoreStatus');
	if (status) status.textContent = i18n.t('transfer.restoring');
	try {
		const formData = new FormData();
		formData.append('file', file);
		const response = await fetch(`${restApiAddress}/api/auth/bootstrap/restore`, { 
			method: 'POST', 
			body: formData 
		});
		const result = await response.json().catch(() => ({}));
		if (!response.ok) throw new Error(result.error || i18n.t('transfer.restore_error'));
		if (status) status.textContent = i18n.t('transfer.restore_success');
		showToast('success', i18n.t('transfer.restore_success'));
		setTimeout(() => location.reload(), 1200);
	} catch (error) {
		console.error(error);
		if (status) status.textContent = error.message;
		showToast('error', i18n.t('transfer.restore_error'), error.message);
	} finally {
		input.value = '';
	}
}

document.getElementById('transferImportFiles')?.addEventListener('change', () => {
	const input = document.getElementById('transferImportFiles');
	const known = new Set(_transferImportFiles.map(file => `${file.name}\0${file.size}\0${file.lastModified}`));
	for (const file of input.files) {
		const key = `${file.name}\0${file.size}\0${file.lastModified}`;
		if (!known.has(key)) {
			known.add(key);
			_transferImportFiles.push(file);
		}
	}
	input.value = '';
	_resetTransferImportPreview();
	_renderTransferSelectedFiles(_transferImportFiles);
});
