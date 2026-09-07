/* ==================== WIDOK UTWORU ==================== */

let currentSong = null;
let songId = null;

function openSong(id) {
    document.getElementById('song').dataset.song = id;
    loadSong();
}


function loadSong() {
    cleanupSongState();

    songId = document.getElementById('song').dataset.song;

    currentSong = allSongs.find(s => String(s.id) === String(songId));
    if (!currentSong) throw new Error(i18n.t('songs.not_found'));

    // Jeśli utwór nie pochodzi z nawigacji setlisty i nie należy do aktywnej setlisty — dezaktywuj
    if (!_setlistNavigating && typeof activeSetlist !== 'undefined' && activeSetlist) {
        const flat = typeof flattenSetlistItems === 'function' ? flattenSetlistItems(activeSetlist.items) : [];
        const inSetlist = flat.some(item => item.type === 'song' && String(item.songId) === String(songId));
        if (!inSetlist && typeof deactivateSetlist === 'function') {
            deactivateSetlist();
            _setlistNavigating = true;
        }
    }

    displaySong();
    try { renderSong(); } finally { _setlistNavigating = false; }
    refreshPanelContent['songlist'](true);
}

function renderSong() {
    renderAllPanels();
}

function cleanupSongState(isClosingSong = false) {
    currentSong = null;
    songId = null;
    
    // Zatrzymaj audio
    const audioPlayer = document.getElementById('audioPlayer');
    if (audioPlayer) {
        audioPlayer.pause();
        audioPlayer.currentTime = 0;
        const icon = document.querySelector('#playPauseBtn');
		icon.innerHTML = '<i data-lucide="play"></i>'
        lucide.createIcons({ nodes: [icon] });
    }

    // Zatrzymaj autoSync
    if (syncCheckInterval) {
        clearInterval(syncCheckInterval);
        syncCheckInterval = null;
    }

    // Reset transpozycji
    resetTranspose();

    // Reset zmiennych
    autoSyncEnabled = false;
    currentLyricIndex = -1;
    currentSong = null;
    timestampsVisible = true;
    sheetZoom = 1;
    translateX = 0;
    translateY = 0;

    const containerEl = document.querySelector('.panel-view[data-view="sheets"]');
    containerEl.dataset.rendered = '0'

    if (isClosingSong) {
        renderAllPanels();
    }
}

let timestampsVisible = true;

function updateTimestampVisibility() {
	document.querySelectorAll('.timestamp').forEach(ts => {
		ts.classList.toggle('flex', timestampsVisible);
		ts.classList.toggle('hidden', !timestampsVisible);
	});
}

function toggleTimestamps() {
	timestampsVisible = !timestampsVisible;
	updateTimestampVisibility();
	document.querySelectorAll('[data-action="toggle-timestamps"]').forEach(btn => {
		btn.classList.toggle('active', timestampsVisible);
	});
}

function toggleOutputFullscreen() {
    const fullscreenToggle = document.getElementById('fullscreenToggleOutput');
    const isFullscreen = document.body.classList.toggle('output-fullscreen');
    fullscreenToggle.classList.toggle('active', isFullscreen);
    fullscreenToggle.innerHTML = isFullscreen ? '<i data-lucide="minimize"></i>' : '<i data-lucide="maximize"></i>';
    lucide.createIcons({ nodes: [fullscreenToggle] });

    if (isFullscreen) {
        document.documentElement.requestFullscreen?.();
    } else if (document.fullscreenElement) {
        document.exitFullscreen?.();
    }
}

document.addEventListener('fullscreenchange', () => {
    if (!document.fullscreenElement && document.body.classList.contains('output-fullscreen')) {
        document.body.classList.remove('output-fullscreen');
        const btn = document.getElementById('fullscreenToggleOutput');
        if (btn) {
            btn.classList.remove('active');
            btn.innerHTML = '<i data-lucide="maximize"></i>';
            lucide.createIcons({ nodes: [btn] });
        }
    }
});

window.addEventListener('resize', () => {
	updateTimestampVisibility();
	fitSheetToWidth();
});

// Context menu - song list item
function _openSongItemContextMenu(song, pos) {
	const canEdit = currentIsAdmin || (currentUser && currentUser === song.uploadedByUsername);

	const isOpened = song.id === currentSong?.id
	const items = [
		{
			icon: 'music',
			content: `${song?.title}`,
		},
		{
			icon: isOpened ? 'circle-x' : 'external-link',
			label: isOpened ? i18n.t('songs.close') : i18n.t('songs.open'),
			action: () => isOpened ? cleanupSongState(true) : openSong(song.id)
		},
		{
			icon: 'arrow-left-right',
			label: i18n.t('transfer.export_tab'),
			action: () => openTransferSettingsForSong(song.id)
		},
		{
			icon: 'pencil',
			label: i18n.t('songs.edit'),
			disabled: !canEdit,
			action: () => editSong(song)
		},
		{
			icon: 'trash-2',
			label: i18n.t('songs.delete'),
			disabled: !canEdit,
			danger: true,
			action: () => deleteSong(song)
		}
	];

	showContextMenu(items, pos);
}


// Context menu - song list filter
function openSonglistFilterContextMenu(trigger, onRefresh = null) {
	const songs = typeof allSongs !== 'undefined' ? allSongs : [];
	const types = [...new Set(songs.flatMap(song => Array.isArray(song.tags) ? song.tags : []).filter(Boolean))].sort();
	const keys = [...new Set(songs.map(song => song.key).filter(Boolean))].sort();
	const timeSignatures = [...new Set(songs.map(song => song.timeSignature).filter(Boolean))].sort();
	const composers = [...new Set(songs.map(song => song.composer).filter(Boolean))].sort();
	const uploaders = [...new Set(songs.map(song => song.uploadedByUsername).filter(Boolean))].sort();
	const getBounds = values => {
		const numbers = values.map(Number).filter(Number.isFinite);
		return numbers.length ? { min: Math.min(...numbers), max: Math.max(...numbers) } : null;
	};
	const yearBounds = getBounds(songs.map(song => song.year).filter(value => value != null));
	const bpmBounds = getBounds(songs.map(song => song.bpm).filter(value => value != null));
	const refresh = () => {
		if (typeof onRefresh === 'function') onRefresh();
		else refreshPanelContent.songlist();
		_updateSonglistFilterButton();
	};

	showTriggeredContextMenu([
		{
			icon: 'eye',
			label: i18n.t('songs.filter_visibility'),
			visible: typeof currentUser !== 'undefined' && !!currentUser,
			submenu: {
				type: 'single',
				value: _songlistActiveVisibility,
				defaultValue: 'all',
				clearable: true,
				items: [
					{ value: 'public', label: i18n.t('songs.filter_public') },
					{ value: 'private', label: i18n.t('songs.filter_private') }
				],
				onChange: value => { _songlistActiveVisibility = value; refresh(); }
			}
		},
		{
			icon: 'cloud-upload',
			label: i18n.t('songs.filter_uploader'),
			visible: uploaders.length > 0,
			submenu: {
				type: 'multi',
				value: _songlistActiveUploaders,
				defaultValue: [],
				searchable: { placeholder: i18n.t('songs.filter_search_options') },
				items: uploaders.map(value => ({ value, label: value })),
				onChange: values => { _songlistActiveUploaders = values; refresh(); }
			}
		},
		{ separator: true },
		{
			icon: 'tags',
			label: i18n.t('songs.filter_tags'),
			submenu: {
				type: 'multi',
				value: _songlistActiveTags,
				defaultValue: [],
				searchable: { placeholder: i18n.t('songs.filter_search_options') },
				items: [
					{ value: null, label: i18n.t('songs.filter_include_without_tags') },
					{
						icon: 'list-filter',
						label: i18n.t('songs.filter_tags_match'),
						searchable: false,
						sticky: true,
						submenu: {
							type: 'single',
							value: _songlistTagsMatch,
							defaultValue: 'any',
							items: [
								{ value: 'any', label: i18n.t('songs.filter_match_any') },
								{ value: 'all', label: i18n.t('songs.filter_match_all') }
							],
							onChange: value => { _songlistTagsMatch = value; refresh(); }
						}
					},
					{ separator: true, sticky: true },
					...types.map(value => ({ value, label: value }))
				],
				onChange: values => { _songlistActiveTags = values; refresh(); }
			}
		},
		{ separator: true },
		{
			icon: 'music-2',
			label: i18n.t('songs.filter_key'),
			visible: keys.length > 0,
			submenu: {
				type: 'multi',
				value: _songlistActiveKeys,
				defaultValue: [],
				searchable: { placeholder: i18n.t('songs.filter_search_options') },
				items: [
					{ value: null, label: i18n.t('songs.filter_include_without_key') },
					{ separator: true },
					...keys.map(value => ({ value, label: value }))
				],
				onChange: values => { _songlistActiveKeys = values; refresh(); }
			}
		},
		{
			icon: 'clock-3',
			label: i18n.t('songs.filter_time_signature'),
			visible: timeSignatures.length > 0,
			submenu: {
				type: 'multi',
				value: _songlistActiveTimeSignatures,
				defaultValue: [],
				searchable: { placeholder: i18n.t('songs.filter_search_options') },
				items: [
					{ value: null, label: i18n.t('songs.filter_include_without_time_signature') },
					{ separator: true },
					...timeSignatures.map(value => ({ value, label: value }))
				],
				onChange: values => { _songlistActiveTimeSignatures = values; refresh(); }
			}
		},
		{
			icon: 'gauge',
			label: i18n.t('songs.filter_bpm'),
			visible: !!bpmBounds,
			submenu: {
				type: 'range',
				value: _songlistBpmRange,
				bounds: bpmBounds,
				step: 1,
				labels: { min: i18n.t('songs.filter_from'), max: i18n.t('songs.filter_to') },
				missingItem: { label: i18n.t('songs.filter_include_without_bpm') },
				onChange: value => { _songlistBpmRange = value; refresh(); }
			}
		},
		{ separator: true },
		{
			icon: 'user-round',
			label: i18n.t('songs.filter_composer'),
			visible: composers.length > 0,
			submenu: {
				type: 'multi',
				value: _songlistActiveComposers,
				defaultValue: [],
				searchable: { placeholder: i18n.t('songs.filter_search_options') },
				items: [
					{ value: null, label: i18n.t('songs.filter_include_without_composer') },
					{ separator: true },
					...composers.map(value => ({ value, label: value }))
				],
				onChange: values => { _songlistActiveComposers = values; refresh(); }
			}
		},
		{
			icon: 'calendar',
			label: i18n.t('songs.filter_year'),
			visible: !!yearBounds,
			submenu: {
				type: 'range',
				value: _songlistYearRange,
				bounds: yearBounds,
				step: 1,
				labels: { min: i18n.t('songs.filter_from'), max: i18n.t('songs.filter_to') },
				missingItem: { label: i18n.t('songs.filter_include_without_year') },
				onChange: value => { _songlistYearRange = value; refresh(); }
			}
		},
		{ separator: true },
		{
			icon: 'rotate-ccw',
			label: i18n.t('songs.filter_reset'),
			disabled: () => !_isSonglistFilterActive(),
				action: () => {
				_resetSonglistFilters();
				refresh();
			}
		}
	], trigger);
}
