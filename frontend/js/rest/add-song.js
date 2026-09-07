/* ==================== TAG EDITOR ==================== */

function tagEditorFocus(editorEl) {
	editorEl.querySelector('.tag-editor-input').focus();
}

function tagEditorGetTags(editorId) {
	const el = document.getElementById(editorId);
	if (!el) return [];
	const tags = Array.from(el.querySelectorAll('.tag-pill-text')).map(s => s.textContent.trim()).filter(Boolean);
	const seen = new Set();
	return tags.filter(t => {
		const lower = t.toLowerCase();
		if (seen.has(lower)) return false;
		seen.add(lower);
		return true;
	});
}

function tagEditorSetTags(editorId, tags) {
	const el = document.getElementById(editorId);
	if (!el) return;
	el.querySelectorAll('.tag-pill').forEach(p => p.remove());
	const input = el.querySelector('.tag-editor-input');
	input.value = '';
	tags.forEach(t => _tagEditorAddPill(el, t));
}

function tagEditorClear(editorId) {
	tagEditorSetTags(editorId, []);
}

function tagEditorRemovePill(button) {
	const pill = button.closest('.tag-pill');
	if (!pill) return;
	const text = pill.querySelector('.tag-pill-text').textContent.trim();
	const editorEl = pill.closest('.tag-editor');
	if (editorEl && editorEl.id === 'adminsTagEditor' && currentUser && text === currentUser) {
		const confirmMsg = i18n.t('settings.admin.remove_self_confirm');
		if (!confirm(confirmMsg)) {
			return;
		}
	}
	if (editorEl && editorEl.id === 'canAddSongsTagEditor' && currentUser && text === currentUser) {
		const confirmMsg = i18n.t('settings.admin.can_add_remove_self_confirm');
		if (!confirm(confirmMsg)) {
			return;
		}
	}
	pill.remove();
}

function _tagEditorAddPill(editorEl, text) {
	text = text.trim();
	if (!text) return;
	const existingTags = Array.from(editorEl.querySelectorAll('.tag-pill-text')).map(s => s.textContent.trim().toLowerCase());
	if (existingTags.includes(text.toLowerCase())) return;

	const pill = document.createElement('span');
	pill.className = 'tag-pill';
	pill.innerHTML = `<span class="tag-pill-text">${escapeHtml(text)}</span><button type="button" class="tag-pill-remove" tabindex="-1" onclick="tagEditorRemovePill(this)">×</button>`;
	const input = editorEl.querySelector('.tag-editor-input');
	editorEl.insertBefore(pill, input);
}

function tagEditorKeydown(event, editorId) {
	const input = event.target;
	const editorEl = document.getElementById(editorId);
	if (event.key === 'Enter' || event.key === ',') {
		event.preventDefault();
		const val = input.value.replace(/,/g, '').trim();
		if (val) {
			_tagEditorAddPill(editorEl, val);
			input.value = '';
		}
	} else if (event.key === 'Backspace' && input.value === '') {
		const pills = editorEl.querySelectorAll('.tag-pill');
		if (pills.length) {
			const lastPill = pills[pills.length - 1];
			const text = lastPill.querySelector('.tag-pill-text').textContent.trim();
			if (editorEl.id === 'adminsTagEditor' && currentUser && text === currentUser) {
				const confirmMsg = i18n.t('settings.admin.remove_self_confirm');
				if (!confirm(confirmMsg)) {
					return;
				}
			}
			if (editorEl.id === 'canAddSongsTagEditor' && currentUser && text === currentUser) {
				const confirmMsg = i18n.t('settings.admin.can_add_remove_self_confirm');
				if (!confirm(confirmMsg)) {
					return;
				}
			}
			lastPill.remove();
		}
	}
}

function tagEditorInput(event, editorId) {
	const input = event.target;
	const editorEl = document.getElementById(editorId);
	if (input.value.includes(',')) {
		const parts = input.value.split(',');
		parts.slice(0, -1).forEach(p => { if (p.trim()) _tagEditorAddPill(editorEl, p); });
		input.value = parts[parts.length - 1];
	}
}

/* ==================== TOGGLE SONG PUBLIC ==================== */

function toggleSongPublic(mode, el) {
	const currentValue = el.getAttribute('aria-checked') === 'true';
	const newValue = !currentValue;
	
	el.setAttribute('aria-checked', newValue ? 'true' : 'false');
	el.classList.toggle('off', !newValue);
	
	return newValue;
}

/* ==================== DODAWANIE / EDYCJA UTWORÓW ==================== */

function editSongOnTab(tab) {
	editSong();
	// editSong() otwiera modal i resetuje zakładkę do 'info', więc przełączamy po otwarciu
	if (tab !== 'info') {
		requestAnimationFrame(() => {
			const btn = document.querySelector(`#songModal .modal-tab[data-tab="${tab}"]`);
			if (btn) switchModalTab('song', tab, btn);
		});
	}
}

function escapeHtml(str) {
	return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

let _deleteAudio = false;
let _deleteSheets = false;

async function importLyricsFromMusicXml(prefix) {
	const editorEl = document.getElementById(prefix + 'LyricsEditor');
	if (editorEl && editorEl.innerHTML !== '') {
		if (!confirm(i18n.t('songs.musicxml_import_confirm'))) return;
	}
	const btn = document.getElementById(prefix + 'ImportMusicXmlBtn');
	if (btn) btn.disabled = true;
	try {
		const lyrics = await importMusicXmlFromFile();
		if (!lyrics) return;
		loadEditorData(prefix + 'LyricsEditor', lyrics, null);
		showToast('success', i18n.t('songs.musicxml_import_success'));
	} catch (err) {
		console.error(err);
		showToast('error', i18n.t('songs.import_error'));
	} finally {
		if (btn) btn.disabled = false;
	}
}

// Zbierz dane formularza utworu ze wspólnego modalu.
function collectSongFormData(prefix) {
	function val(suffix) { return document.getElementById(prefix + suffix).value.trim(); }

	const tags = tagEditorGetTags(prefix + 'TagEditor');
	const lyrics = collectEditorData(prefix + 'LyricsEditor');
	if (lyrics === undefined) return null;
	const isPublicToggle = document.getElementById(prefix + 'IsPublic');
	const isPublic = isPublicToggle 
		? isPublicToggle.getAttribute('aria-checked') === 'true'
		: false;
	
	return {
		title: val('Title'),
		tags,
		bpm: parseInt(val('Bpm')) || null,
		key: val('Key') || null,
		timeSignature: val('TimeSignature') || null,
		composer: val('Composer') || null,
		year: parseInt(val('Year')) || null,
		lyrics: lyrics ?? EMPTY_LYRICS,
		isPublic: isPublic,
	};
}

async function uploadSongFile(songId, type, fileInputId) {
	const file = document.getElementById(fileInputId).files[0];
	if (!file) return;
	const formData = new FormData();
	formData.append('file', file);
	const res = await fetch(`${restApiAddress}/api/songs/${songId}/${type}`, {
		method: 'POST', credentials: 'include', body: formData
	});
	if (!res.ok) {
		throw new Error(i18n.t('songs.upload_error', { status: res.status }));
	}
}

async function uploadSheetsFile(songId, fileInputId) {
	await uploadSongFile(songId, 'sheets', fileInputId);
}

async function deleteSongFile(songId, type) {
	const response = await fetch(`${restApiAddress}/api/songs/${songId}/${type}`, {
		method: 'DELETE',
		credentials: 'include',
	});
	if (!response.ok) {
		throw new Error(i18n.t('songs.update_error'));
	}
}

async function fetchFreshSong(songId) {
	const response = await fetch(`${restApiAddress}/api/songs/${songId}`, {
		credentials: 'include',
		cache: 'no-store',
	});
	if (!response.ok) {
		throw new Error(i18n.t('songs.load_error'));
	}
	const song = await response.json();
	if (!Array.isArray(song.tags)) song.tags = [];
	return song;
}

function markFileForDeletion(type) {
	if (type === 'audio') {
		_deleteAudio = true;
		const audioStatusEl = document.getElementById('songAudioStatus');
		audioStatusEl.textContent = i18n.t('songs.audio_pending_removal');
		audioStatusEl.className = 'text-xs mb-2 text-red-500';
		document.getElementById('songAudioDelete').classList.add('hidden');
	} else if (type === 'sheets') {
		_deleteSheets = true;
		const sheetsStatusEl = document.getElementById('songSheetsStatus');
		sheetsStatusEl.textContent = i18n.t('songs.sheets_pending_removal');
		sheetsStatusEl.className = 'text-xs mb-2 text-red-500';
		document.getElementById('songSheetsDelete').classList.add('hidden');
	}
}

function resetAddSongFileStatus() {
	const audioStatus = document.getElementById('songAudioStatus');
	if (audioStatus) {
		audioStatus.textContent = i18n.t('songs.audio_missing');
		audioStatus.className = 'text-xs mb-2 text-red-500';
	}
	const sheetsStatus = document.getElementById('songSheetsStatus');
	if (sheetsStatus) {
		sheetsStatus.textContent = i18n.t('songs.sheets_missing');
		sheetsStatus.className = 'text-xs mb-2 text-red-500';
	}
}

async function submitNewSong(event) {
	event.preventDefault();

	const songData = collectSongFormData('song');
	if (!songData) return;

	if (!songData.title) {
		showToast('error', i18n.t('common.error'), i18n.t('songs.title_error'))
		return;
	}

	try {
		setButtonLoading(document.getElementById('songSubmitBtn'), true);

		const response = await fetch(`${restApiAddress}/api/songs`, {
			method: 'POST',
			credentials: 'include',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(songData)
		});

		const data = await response.json();

		if (!response.ok) {
			throw new Error(i18n.t('songs.create_error'));
		}

		const newId = data.id;
		await uploadSongFile(newId, 'audio', 'songAudioFile');
		await uploadSheetsFile(newId, 'songSheetsFile');

		document.getElementById('songForm').reset();
		clearEditor('songLyricsEditor');
		resetAddSongFileStatus();
		showToast('success', i18n.t('songs.create_success'));
		closeAllModals();

		// Pobierz tylko nowy utwór i wstaw do allSongs
		const newSongRes = await fetch(`${restApiAddress}/api/songs/${newId}`, { credentials: 'include' });
		if (newSongRes.ok) {
			const newSong = await newSongRes.json();
			if (!Array.isArray(newSong.tags)) newSong.tags = [];
			allSongs.push(newSong);
			sortSongsByTitle(allSongs);
			songFiles[newId] = newSong.files;
		}
		openSong(newId);

	} catch (error) {
		console.error('Error adding song:', error);
		showToast('error', i18n.t('songs.update_error'));
	}
	setTimeout(() => {
		setButtonLoading(document.getElementById('songSubmitBtn'), false);
	}, 250);
}

function submitSongModal(event) {
	if (document.getElementById('songEditId').value) return submitEditSong(event);
	return submitNewSong(event);
}

function openAddSongModal() {
	document.getElementById('songModalTitle').textContent = i18n.t('songs.create_title');
	document.querySelector('#songSubmitBtn [data-button-loading-label]').textContent = i18n.t('common.add');
	document.getElementById('songEditId').value = '';
	document.getElementById('songForm').reset();
	tagEditorClear('songTagEditor');
	clearEditor('songLyricsEditor');
	loadEditorData('songLyricsEditor', null, null);
	setEditorMediaContext('songLyricsEditor', false, false);
	const publicToggle = document.getElementById('songIsPublic');
	const isPublic = Boolean(settings.defaults?.songVisiblePublic);
	publicToggle.setAttribute('aria-checked', String(isPublic));
	publicToggle.classList.toggle('off', !isPublic);
	_deleteAudio = false;
	_deleteSheets = false;
	document.getElementById('songAudioDelete').classList.add('hidden');
	document.getElementById('songSheetsDelete').classList.add('hidden');
	const mediaCol = document.getElementById('songMediaCol');
	mediaCol.classList.add('hidden');
	mediaCol.classList.remove('flex');
	document.getElementById('songSheetViewerWrap').classList.add('hidden');
	document.getElementById('songAudioPlayer').classList.add('hidden');
	const audio = document.getElementById('editModalAudioPlayer');
	if (audio && !audio.paused) audio.pause();
	resetAddSongFileStatus();
	const firstTab = document.querySelector('#songModal .modal-tabs .modal-tab');
	if (firstTab) switchModalTab('song', 'info', firstTab, true);
	openModal('songModal');
}

function editSong(song = currentSong) {
	if (!song) return;
	document.getElementById('songModalTitle').textContent = i18n.t('songs.edit_title');
	document.querySelector('#songSubmitBtn [data-button-loading-label]').textContent = i18n.t('common.save');
	document.getElementById('songEditId').value = song.id;

	const fields = {
		Title: song.title,
		Bpm: song.bpm, Key: song.key, TimeSignature: song.timeSignature,
		Year: song.year, Composer: song.composer,
	};
	for (const [suffix, value] of Object.entries(fields)) {
		document.getElementById('song' + suffix).value = value ?? '';
	}
	const tags = Array.isArray(song.tags) ? song.tags : (song.tags ? String(song.tags).split(',').map(t => t.trim()).filter(Boolean) : []);
	tagEditorSetTags('songTagEditor', tags);

	const hasAudio  = song.files?.audio ?? false;
	const hasSheets = song.files?.sheets ?? false;

	loadEditorData('songLyricsEditor', song.lyricsRaw, song.lyrics);
	setEditorMediaContext('songLyricsEditor', hasAudio, hasSheets);
	const audioStatusEl  = document.getElementById('songAudioStatus');
	const sheetsStatusEl = document.getElementById('songSheetsStatus');
	audioStatusEl.textContent  = hasAudio ? i18n.t('songs.audio_uploaded') : i18n.t('songs.audio_missing');
	audioStatusEl.className    = `text-xs mb-2 ${hasAudio ? 'text-green-600' : 'text-red-500'}`;
	document.getElementById('songAudioDelete').classList.toggle('hidden', !hasAudio);
	document.getElementById('songAudioFile').value = '';
	sheetsStatusEl.textContent = hasSheets ? i18n.t('songs.sheets_uploaded') : i18n.t('songs.sheets_missing');
	sheetsStatusEl.className   = `text-xs mb-2 ${hasSheets ? 'text-green-600' : 'text-red-500'}`;
	document.getElementById('songSheetsDelete').classList.toggle('hidden', !hasSheets);
	document.getElementById('songSheetsFile').value = '';
	const isPublicToggle = document.getElementById('songIsPublic');
	if (isPublicToggle) {
		isPublicToggle.setAttribute('aria-checked', song.isPublic ? 'true' : 'false');
		isPublicToggle.classList.toggle('off', !song.isPublic);
	}
	_deleteAudio = false;
	_deleteSheets = false;

	// Reset zakładek modalnych do "Informacje"
	const firstTab = document.querySelector('#songModal .modal-tabs .modal-tab');
	if (firstTab) switchModalTab('song', 'info', firstTab, true);

	// Inicjalizuj media w zakładce Tekst
	const mediaCol = document.getElementById('songMediaCol');
	const sheetWrap = document.getElementById('songSheetViewerWrap');
	const audioPlayerEl = document.getElementById('songAudioPlayer');
	if (mediaCol) {
		const showMedia = hasSheets || hasAudio;
		mediaCol.classList.toggle('hidden', !showMedia);
		mediaCol.classList.toggle('flex', showMedia);
		if (hasSheets) {
			sheetWrap.classList.remove('hidden');
			sheetWrap.classList.add('flex');
			initEditModalSheet(song.id);
		} else {
			sheetWrap.classList.add('hidden');
			sheetWrap.classList.remove('flex');
		}
		if (hasAudio) {
			audioPlayerEl.classList.remove('hidden');
			initEditModalAudio(song.id);
		} else {
			audioPlayerEl.classList.add('hidden');
		}
	}

	setButtonLoading(document.getElementById('songSubmitBtn'), false);
	openModal('songModal');
}

async function submitEditSong(event) {
	event.preventDefault();

	const originalId = document.getElementById('songEditId').value;
	const originalSong = allSongs.find(song => String(song.id) === String(originalId));
	if (!originalSong) {
		showToast('error', i18n.t('common.error'), i18n.t('songs.not_found'));
		return;
	}
	const songData = collectSongFormData('song');
	if (!songData) return;

	if (!songData.title) {
		showToast('error', i18n.t('common.error'), i18n.t('songs.title_error'))
		return;
	}

	try {
		setButtonLoading(document.getElementById('songSubmitBtn'), true);
		const audioFile = document.getElementById('songAudioFile').files[0];
		const sheetsFile = document.getElementById('songSheetsFile').files[0];
		const audioChanged = Boolean(audioFile) || _deleteAudio;
		const sheetsChanged = Boolean(sheetsFile) || _deleteSheets;

		const response = await fetch(`${restApiAddress}/api/songs/${originalId}`, {
			method: 'PUT',
			credentials: 'include',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(songData)
		});

		if (!response.ok) {
			throw new Error(i18n.t('songs.update_error'));
		}

		// Usuwanie plików
		if (_deleteAudio && !audioFile) {
			await deleteSongFile(originalId, 'audio');
		}
		if (_deleteSheets && !sheetsFile) {
			await deleteSongFile(originalId, 'sheets');
		}
		// Upload nowych plików
		await uploadSongFile(originalId, 'audio', 'songAudioFile');
		await uploadSheetsFile(originalId, 'songSheetsFile');

		if (audioChanged) invalidateSongMedia('audio', originalId);
		if (sheetsChanged) invalidateSongMedia('sheets', originalId);

		// Pobierz stan zapisany przez serwer (w tym faktyczny typ nowego pliku nut).
		const updatedSong = await fetchFreshSong(originalId);
		const idx = allSongs.findIndex(song => String(song.id) === String(originalId));
		if (idx !== -1) {
			allSongs[idx] = updatedSong;
			sortSongsByTitle(allSongs);
			songFiles[originalId] = updatedSong.files;
		}

		const refreshOpenedSong = String(currentSong?.id) === String(originalId);
		_deleteAudio = false;
		_deleteSheets = false;

		if (refreshOpenedSong) {
			loadSong();
		} else if (typeof refreshPanelContent?.songlist === 'function') {
			refreshPanelContent.songlist();
		}

		closeAllModals();
		showToast('success', i18n.t('songs.update_success'));

	} catch (error) {
		console.error('Error editing song:', error);
		showToast('error', i18n.t('songs.update_error'));
	}
	setTimeout(() => {
		setButtonLoading(document.getElementById('songSubmitBtn'), false);
	}, 250);
}

async function deleteSong(song = currentSong) {
	if (!song) return;
	if (!confirm(i18n.t('songs.delete_confirm', { title: song.title }))) return;
	const deletingCurrentSong = String(currentSong?.id) === String(song.id);

	try {
		const response = await fetch(`${restApiAddress}/api/songs/${song.id}`, {
			method: 'DELETE',
			credentials: 'include',
		});

		if (!response.ok) {
			const data = await response.json().catch(() => ({}));
			throw new Error(i18n.t('songs.delete_error'));
		}

		allSongs = allSongs.filter(item => String(item.id) !== String(song.id));
		delete songFiles[song.id];
		if (deletingCurrentSong) {
			cleanupSongState();
			resetAllPanelsToEmpty();
			displaySongWithChannel();
		} else if (typeof refreshPanelContent?.songlist === 'function') {
			refreshPanelContent.songlist();
		}
		showToast('success', i18n.t('songs.delete_success'));

	} catch (error) {
		console.error('Error deleting song:', error);
		showToast('error', i18n.t('songs.delete_error'));
	}
}

function updateFileLabel(input) {
	const inputId = input.id;
	
	// Mapowanie inputów do elementów statusu
	const statusMap = {
		'songAudioFile': 'songAudioStatus',
		'songSheetsFile': 'songSheetsStatus',
	};
	
	const statusId = statusMap[inputId];
	const statusDiv = statusId ? document.getElementById(statusId) : null;
	
	if (statusDiv) {
		if (input.files[0]) {
			statusDiv.textContent = i18n.t('songs.file_will_be_added', { name: input.files[0].name });
			statusDiv.className = 'text-xs mb-2 text-green-600';
		} else {
			statusDiv.textContent = statusDiv.dataset.default || i18n.t('songs.choose_file');
			statusDiv.className = 'list-item__desc';
		}
	}
}

function updateAddSongButtonVisibility(buttonOrId, uploadedBy = null) {
	const addBtn = typeof buttonOrId === 'string' ? document.getElementById(buttonOrId) : buttonOrId;
	if (!addBtn) return;

	const isAuthor = uploadedBy !== null && currentUserId === uploadedBy;
	const canEdit  = currentIsAdmin || isAuthor;
	const visible  = uploadedBy !== null ? canEdit : currentCanAddSongs;
	setElementDisplay(addBtn, visible)
}
