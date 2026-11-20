/* ==================== REJESTRACJA WIDOKÓW PANELI (STATYCZNA) ==================== */

let updateSongCount;
let updateSetlistCount;

let _songlistActiveTags = [];
let _songlistActiveVisibility = 'all';
let _songlistActiveKeys = [];
let _songlistActiveTimeSignatures = [];
let _songlistTagsMatch = 'any';
let _songlistYearRange = { min: null, max: null, includeMissing: false };
let _songlistBpmRange = { min: null, max: null, includeMissing: false };
let _songlistActiveUploaders = [];
let _songlistMetadataFilters = { values: {}, has: [], missing: [] };

function _matchesSonglistTags(songTags, selectedTags = [], matchMode) {
    if (selectedTags.length === 0) return true;

    const tags = Array.isArray(songTags) ? songTags : [];
    const includeUntagged = selectedTags.includes(null);
    const tagsToMatch = selectedTags.filter(tag => tag !== null);
    if (includeUntagged && tags.length === 0) return true;
    if (tagsToMatch.length === 0) return false;
    return matchMode === 'all'
        ? tagsToMatch.every(tag => tags.includes(tag))
        : tagsToMatch.some(tag => tags.includes(tag));
}

function _matchesSonglistValue(value, selectedValues = []) {
    return selectedValues.length === 0
        || selectedValues.some(selected => selected === null ? !value : value === selected);
}

function _matchesSonglistRange(value, range = {}) {
    const hasRange = range.min != null || range.max != null;
    const isMissing = value == null || value === '';
    if (!hasRange) return range.includeMissing ? isMissing : true;
    if (isMissing) return !!range.includeMissing;
    const number = Number(value);
    if (!Number.isFinite(number)) return false;
    return (range.min == null || number >= range.min) && (range.max == null || number <= range.max);
}

function _isSonglistFilterActive() {
    return _songlistActiveVisibility !== 'all'
        || _songlistActiveTags.length > 0
        || _songlistTagsMatch !== 'any'
        || _songlistActiveKeys.length > 0
        || _songlistActiveTimeSignatures.length > 0
        || _songlistYearRange.min != null || _songlistYearRange.max != null || _songlistYearRange.includeMissing
        || _songlistBpmRange.min != null || _songlistBpmRange.max != null || _songlistBpmRange.includeMissing
        || _songlistActiveUploaders.length > 0
        || isMetadataFilterActive(_songlistMetadataFilters);
}

function _updateSonglistFilterButton() {
    document.querySelectorAll('[data-action="filter-category"], [data-action="filter-transfer-songs"]').forEach(button => {
        button.classList.toggle('active', _isSonglistFilterActive());
    });
}

function _resetSonglistFilters() {
    _songlistActiveVisibility = 'all';
    _songlistActiveTags = [];
    _songlistTagsMatch = 'any';
    _songlistActiveKeys = [];
    _songlistActiveTimeSignatures = [];
    _songlistYearRange = { min: null, max: null, includeMissing: false };
    _songlistBpmRange = { min: null, max: null, includeMissing: false };
    _songlistActiveUploaders = [];
    _songlistMetadataFilters = { values: {}, has: [], missing: [] };
    _updateSonglistFilterButton();
}

function _matchesSonglistFilters(song, filters, query) {
    const matchesVisibility = filters.visibility === 'all'
        || (filters.visibility === 'public' && song.isPublic)
        || (filters.visibility === 'private' && !song.isPublic);
    return _matchesSonglistTags(song.tags, filters.tags, filters.tagsMatch)
        && matchesVisibility
        && _matchesSonglistValue(song.key, filters.keys)
        && _matchesSonglistValue(song.timeSignature, filters.timeSignatures)
        && _matchesSonglistRange(song.year, filters.yearRange)
        && _matchesSonglistRange(song.bpm, filters.bpmRange)
        && _matchesSonglistValue(song.uploadedByUsername, filters.uploaders)
        && matchesMetadataFilters(song, filters.metadata)
        && (!query || songSearchText(song).includes(query));
}

function _currentSonglistFilters() {
    return {
        tags: _songlistActiveTags,
        tagsMatch: _songlistTagsMatch,
        visibility: _songlistActiveVisibility,
        keys: _songlistActiveKeys,
        timeSignatures: _songlistActiveTimeSignatures,
        yearRange: _songlistYearRange,
        bpmRange: _songlistBpmRange,
        uploaders: _songlistActiveUploaders,
        metadata: _songlistMetadataFilters
    };
}

function getFilteredSonglist(query = '', songs = null) {
    const normalizedQuery = String(query).trim().toLocaleLowerCase();
    const source = Array.isArray(songs)
        ? songs
        : typeof allSongs !== 'undefined' ? allSongs : [];
    const filters = _currentSonglistFilters();
    return source.filter(song => _matchesSonglistFilters(song, filters, normalizedQuery));
}

const _songlistActiveClass = 'px-1 py-2 rounded-xl text-left transition-all text-[0.85rem] w-[calc(100%-4px)] bg-[color-mix(in_srgb,_var(--color-accent)_12%,_transparent)] text-(--color-accent-hover) font-medium';
const _songlistInactiveClass = 'px-1 py-2 rounded-xl text-left transition-all text-[0.85rem] w-[calc(100%-4px)] hover:text-accent text-fg cursor-pointer';

function _setSonglistItemSelected(element, selected) {
    element.className = selected ? _songlistActiveClass : _songlistInactiveClass;
    element.setAttribute('aria-pressed', String(selected));
}

function _renderSonglistItems(container, songs, {
    selectedIds = new Set(),
    onSelect = null,
    contextMenu = null,
    multiple = false,
    emptyLabel = null
} = {}) {
    if (!container) return;

    container.innerHTML = '';
    if (songs.length === 0) {
        const empty = document.createElement('div');
        empty.dataset.songlistEmpty = '1';
        empty.className = 'flex items-center justify-center h-16 text-(--text-secondary) text-[0.85rem]';
        empty.textContent = emptyLabel || i18next.t('panels.songlist_empty');
        container.appendChild(empty);
        return;
    }

    songs.forEach(song => {
        const songId = String(song.id);
        const selected = selectedIds.has(songId);
        const el = document.createElement('button');
        el.type = 'button';
        el.dataset.songId = songId;
        _setSonglistItemSelected(el, selected);
        el.style.cssText = 'overflow-wrap:break-word;word-break:break-word;white-space:normal;text-align:left';

        if (multiple) {
            el.classList.add('songlist-choice');
            const title = document.createElement('span');
            title.textContent = song.title;
            const check = document.createElement('i');
            check.setAttribute('data-lucide', selected ? 'check' : 'circle');
            check.setAttribute('aria-hidden', 'true');
            el.append(title, check);
        } else {
            el.textContent = song.title;
        }

        if (onSelect) el.onclick = () => onSelect(song);
        if (contextMenu) addContextMenu(el, pos => contextMenu(song, pos));
        container.appendChild(el);
    });

    if (multiple) lucide.createIcons({ nodes: [container] });
}

function renderSonglist(container, {
    songs = null,
    query = '',
    ...options
} = {}) {
    const visibleSongs = getFilteredSonglist(query, songs);
    _renderSonglistItems(container, visibleSongs, options);
    return visibleSongs;
}

function setupScrollFade(viewBody, viewContent) {
    if (!viewBody || !viewContent) return;

    viewContent._scrollFadeCleanup?.();
    let animationFrameId = null;
    let fallbackTimerId = null;

    const updateFade = () => {
        const remainingScroll = Math.max(0, viewContent.scrollHeight - viewContent.scrollTop - viewContent.clientHeight);
        const atTop = viewContent.scrollTop <= 5;
        viewBody.classList.toggle('scrolled-to-top', atTop);
        viewBody.classList.toggle('scrolled-to-bottom', remainingScroll <= 5);
    };
    const scheduleFadeUpdate = () => {
        if (animationFrameId !== null || fallbackTimerId !== null) return;

        if (typeof requestAnimationFrame === 'function') {
            animationFrameId = requestAnimationFrame(() => {
                animationFrameId = null;
                updateFade();
            });
        } else {
            fallbackTimerId = setTimeout(() => {
                fallbackTimerId = null;
                updateFade();
            }, 0);
        }
    };
    const resizeObserver = typeof ResizeObserver === 'function'
        ? new ResizeObserver(scheduleFadeUpdate)
        : null;
    const mutationObserver = typeof MutationObserver === 'function'
        ? new MutationObserver(scheduleFadeUpdate)
        : null;

    viewContent.addEventListener('scroll', updateFade, { passive: true });
    window.addEventListener('resize', scheduleFadeUpdate, { passive: true });
    resizeObserver?.observe(viewContent);
    mutationObserver?.observe(viewContent, { childList: true, subtree: true });

    viewContent._scrollFadeCleanup = () => {
        viewContent.removeEventListener('scroll', updateFade);
        window.removeEventListener('resize', scheduleFadeUpdate);
        resizeObserver?.disconnect();
        mutationObserver?.disconnect();
        if (animationFrameId !== null) cancelAnimationFrame(animationFrameId);
        if (fallbackTimerId !== null) clearTimeout(fallbackTimerId);
    };
    updateFade();
}

function initStandaloneScrollFades() {
    document.querySelectorAll('[data-scroll-fade]').forEach(scrollArea => {
        setupScrollFade(scrollArea, scrollArea);
    });
}

window.addEventListener('i18nReady', initStandaloneScrollFades);


// Context menu - song info

function _songInfoHeaderActionAvailable(btn) {
	if (!btn) return false;
	if (btn.dataset.available === '1' || btn.dataset.available === '0') return btn.dataset.available === '1';
	return !btn.classList.contains('hidden') && !btn.classList.contains('hidden!');
}

function _markSongInfoHeaderAction(btn) {
	if (!btn) return;
	btn.dataset.available = (!btn.classList.contains('hidden') && !btn.classList.contains('hidden!')) ? '1' : '0';
}

function _measureSongInfoHeaderActions(controls, nodes) {
	if (!nodes.length) return 0;
	const probe = document.createElement('div');
	probe.style.cssText = 'position:absolute;visibility:hidden;pointer-events:none;display:flex;align-items:center;left:0;top:0;';
	probe.style.gap = getComputedStyle(controls).gap || '3px';
	nodes.forEach(node => {
		const clone = node.cloneNode(true);
		clone.classList.remove('hidden', 'hidden!');
		clone.style.display = 'inline-flex';
		probe.appendChild(clone);
	});
	document.body.appendChild(probe);
	const width = probe.getBoundingClientRect().width;
	probe.remove();
	return width;
}

function syncSongInfoHeaderOverflow() {
	const header = document.querySelector('#mainContainer-tab-songInfo .view-header');
	if (!header) return;
	const title = header.querySelector('.view-title');
	const controls = header.querySelector('.view-header-controls');
	const menuBtn = controls?.querySelector('[data-action="song-header-menu"]');
	if (!title || !controls || !menuBtn) return;

	const actions = [...controls.querySelectorAll('[data-header-action]')];
	const availableActions = actions.filter(_songInfoHeaderActionAvailable);
	if (!availableActions.length) {
		setElementDisplay(menuBtn, false);
		actions.forEach(btn => setElementDisplay(btn, false));
		return;
	}

	const style = getComputedStyle(header);
	const available = header.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
	const collapsed = title.scrollWidth + _measureSongInfoHeaderActions(controls, availableActions) > available + 1;
	setElementDisplay(menuBtn, collapsed);
	actions.forEach(btn => setElementDisplay(btn, _songInfoHeaderActionAvailable(btn) && !collapsed));
}

function _openSongInfoHeaderMenu(menuBtn) {
	const header = menuBtn.closest('.view-header');
	const icons = {
		'song-metadata': 'list-tree',
		'song-edit': 'pencil',
		'song-delete': 'trash',
	};
	const labels = {
		'song-metadata': () => i18n.t('songs.metadata.modal_title'),
		'song-edit': () => i18n.t('songs.edit'),
		'song-delete': () => i18n.t('songs.delete'),
	};
	const items = [...header.querySelectorAll('[data-header-action]')]
		.filter(_songInfoHeaderActionAvailable)
		.map(btn => ({
			icon: icons[btn.dataset.action],
			label: labels[btn.dataset.action]?.() || btn.title,
			danger: btn.classList.contains('danger'),
			action: () => btn.click(),
		}));
	showTriggeredContextMenu(items, menuBtn);
}

function initSongInfoHeaderOverflow() {
	const header = document.querySelector('#mainContainer-tab-songInfo .view-header');
	const menuBtn = header?.querySelector('[data-action="song-header-menu"]');
	if (!header || !menuBtn || menuBtn.dataset.bound === '1') return;
	menuBtn.dataset.bound = '1';
	header.querySelectorAll('[data-header-action]').forEach(btn => {
		if (!btn.dataset.available) _markSongInfoHeaderAction(btn);
	});
	menuBtn.addEventListener('click', () => _openSongInfoHeaderMenu(menuBtn));
	if (typeof ResizeObserver === 'function') {
		const observer = new ResizeObserver(() => syncSongInfoHeaderOverflow());
		observer.observe(header);
	}
	document.fonts?.ready.then(() => syncSongInfoHeaderOverflow());
	syncSongInfoHeaderOverflow();
}

function _openSongInfoContextMenu(pos) {
	const canEdit = currentIsAdmin || (currentUser && currentUser === currentSong?.uploadedByUsername);

	const items = [
		{
			icon: 'pencil',
			label: i18n.t('songs.edit'),
			disabled: !canEdit,
			action: () => editSongOnTab('info')
		},
		{
			icon: 'arrow-left-right',
			label: i18n.t('transfer.export_tab'),
			disabled: !currentSong?.id,
			action: () => openTransferSettingsForSong(currentSong.id)
		},
		{
			icon: 'list-tree',
			label: i18n.t('songs.metadata.modal_title'),
			disabled: !currentSong,
			action: () => openSongMetadataModal()
		},
		{
			icon: 'trash',
			label: i18n.t('songs.delete'),
			disabled: !canEdit,
			danger: true,
			action: () => deleteSong()
		},
	];

	showContextMenu(items, pos);
}

const refreshPanelContent = {
    sheets() {
        const view = document.getElementById('mainContainer-tab-sheets');
        const viewBody = view.querySelector('.view-body');
        const sheetViewer = document.querySelector('.panel-view[data-view="sheets"]');
        const viewer = sheetViewer.querySelector('.sheet-viewer'); 

        if (!currentSong) {
            setElementDisplay(viewBody.querySelector('.view-header-controls'), false);
            viewer.innerHTML = '';
            removeContextMenu(sheetViewer);
        } else {
            updateFitBtn();

            if (sheetViewer.dataset.rendered === '1') {
                initSheetDragging();
                fitSheetToWidth();
                return;
            }

            const divStyles = 'flex items-center justify-center h-full text-[2rem] text-(--text-secondary)'
            if (currentSong?.files?.sheets) {
                viewer.innerHTML = `<div class="${divStyles} animate-pulse">${i18n.t('songs.loading_sheets')}</div>`;

                const img = document.createElement('img');
                img.alt = i18n.t('panels.sheets_title');
                img.src = songMediaUrl('sheets', currentSong.id);

                img.onload  = () => { 
                    viewer.innerHTML = ''; 
                    viewer.appendChild(img); 
                    setElementDisplay(viewBody.querySelector('.view-header-controls'), true);
                    setTimeout(() => { 
                        initSheetDragging(); 
                        fitSheetToWidth(); 
                    }, 50); 
                    addContextMenu(sheetViewer, pos => _openSheetsContextMenu(pos, sheetViewer));
                };

                img.onerror = () => { 
                    viewer.innerHTML = `<div class="${divStyles}">${i18n.t('songs.sheets_missing')}</div>`; 
                    setElementDisplay(viewBody.querySelector('.view-header-controls'), false);
					removeContextMenu(sheetViewer);
                };
            } else {
                viewer.innerHTML = `<div class="${divStyles}">${i18n.t('songs.sheets_missing')}</div>`;
                setElementDisplay(viewBody.querySelector('.view-header-controls'), false);
				removeContextMenu(sheetViewer);
            }
            
            sheetViewer.dataset.rendered = '1';
        }
    },

    text() {
        const view = document.getElementById('mainContainer-tab-text');
        const viewBody = view.querySelector('.view-body');

        if (!currentSong) {
            setElementDisplay(viewBody.querySelector('.view-header-controls'), false);
            viewBody.querySelector('[data-lyrics-grid]').innerHTML = '';
            return;
        }
        
        const hasChords = currentSong?.lyrics?.some(l =>
            l.hasChords || /\[[A-GHa-gh][♯♭#b]?(?:m|maj|dim|aug)?[0-9]*]/.test(l.text)
        );
        const hasTimestamps = currentSong?.lyrics?.some(l => l.timestamp !== undefined && l.timestamp !== null);

        setElementDisplay(viewBody.querySelector('.view-header-controls'), true);

        const tsBtn = viewBody.querySelector('[data-action="toggle-timestamps"]');
        if (tsBtn) {
            setElementDisplay(tsBtn, hasTimestamps);
            tsBtn.classList.toggle('active', timestampsVisible);
        }
        viewBody.querySelectorAll('[data-chords-only]').forEach(el => {
            setElementDisplay(el, hasChords);
        });
        const toggleChordsBtn = viewBody.querySelector('[data-action="toggle-chords"]');
        if (toggleChordsBtn && hasChords) {
            toggleChordsBtn.classList.add('active');
        }

        const grid = viewBody.querySelector('[data-lyrics-grid]');
        if (grid) {
            grid.innerHTML = '';
            populateLyricsGrid(grid, currentSong);
        }

        requestAnimationFrame(() => {
            const scrollBtn = viewBody.querySelector('[data-action="toggle-scroll"]');
            const isWithoutScroll = grid && grid.scrollHeight <= grid.clientHeight + 1;
            setElementDisplay(scrollBtn, !isWithoutScroll);
            syncLyricScrollbarForContent();
            if (!hasChords && !hasTimestamps && isWithoutScroll) {
                setElementDisplay(viewBody.querySelector('.view-header-controls'), false);
            }
        });
    },

    songInfo() {
        const view = document.getElementById('mainContainer-tab-songInfo');
        const viewHeader = view.querySelector('.view-header');
        const viewBody = view.querySelector('[data-view="songInfo"]');

        const metadataBtn = viewHeader.querySelector('[data-action="song-metadata"]');
        const editBtn = viewHeader.querySelector('[data-action="song-edit"]');
        const deleteBtn = viewHeader.querySelector('[data-action="song-delete"]');

        if (!currentSong) {
            setElementDisplay('#songInfo-mainView', false);
            setElementDisplay('#songInfo-noSong', true);
            setElementDisplay(metadataBtn, false);
            setElementDisplay(editBtn, false);
            setElementDisplay(deleteBtn, false);
            _markSongInfoHeaderAction(metadataBtn);
            _markSongInfoHeaderAction(editBtn);
            _markSongInfoHeaderAction(deleteBtn);
            syncSongInfoHeaderOverflow();
            return;
        } else {
            setElementDisplay('#songInfo-mainView', true);
            setElementDisplay('#songInfo-noSong', false)
            setElementDisplay(metadataBtn, true);
            updateAddSongButtonVisibility(editBtn, currentSong?.uploadedBy ?? null);
            updateAddSongButtonVisibility(deleteBtn, currentSong?.uploadedBy ?? null);
            _markSongInfoHeaderAction(metadataBtn);
            _markSongInfoHeaderAction(editBtn);
            _markSongInfoHeaderAction(deleteBtn);
            syncSongInfoHeaderOverflow();
        }

        const titleEl = viewBody.querySelector('#songInfo-Title');
        const idEl = viewBody.querySelector('#songInfo-Id');
        if (titleEl) titleEl.textContent = currentSong.title;
        if (idEl) idEl.textContent = i18n.t('common.id_value', { id: currentSong.id });

        if (viewBody.dataset.rendered !== '1') {
            viewBody.dataset.rendered = '1';
            addContextMenu(viewBody, pos => _openSongInfoContextMenu(pos));
        }

        const songInfo_mainView = viewBody.querySelector('#songInfo-mainView');
        if (songInfo_mainView) {
            const titleRow = songInfo_mainView.firstElementChild;
            songInfo_mainView.innerHTML = '';
            if (titleRow) songInfo_mainView.appendChild(titleRow);

            const metadata = getSongMetadata(currentSong);
            const tagsValue = Array.isArray(currentSong.tags) && currentSong.tags.length ? currentSong.tags.join(', ') : null;
            const authorsValue = metadataAuthorNames(currentSong).join(', ') || null;
            const releasedValue = metadata.released || currentSong.year || null;
            const transpositionValue = metadata.transposition != null ? (metadata.transposition > 0 ? `+${metadata.transposition}` : String(metadata.transposition)) : null;

            // Grupuj metadane w kategorie zgodne z METADATA_SECTIONS + sekcja "Podstawowe"
            const categoryItems = {
                basic: [
                    { icon: 'tag',          label: 'songs.tags_label',         value: tagsValue },
                    { icon: 'gauge',        label: 'songs.metadata.bpm',       value: currentSong.bpm ? i18n.t('songs.bpm_value', { bpm: currentSong.bpm }) : null },
                    { icon: 'hash',         label: 'songs.metadata.key',       value: currentSong.key || null },
                    { icon: 'ruler',        label: 'songs.metadata.timeSignature', value: currentSong.timeSignature || null },
                    { icon: 'cloud-upload', label: 'songs.metadata.uploaded_by', value: currentSong.uploadedByUsername || null },
                ],
                people: [
                    { icon: 'user-round',   label: 'songs.metadata.authors',   value: authorsValue },
                ],
                release: [
                    { icon: 'calendar',     label: 'songs.metadata.released',  value: releasedValue },
                    { icon: 'disc-3',       label: 'songs.metadata.album',     value: metadata.album || null },
                    { icon: 'building-2',   label: 'songs.metadata.publisher', value: metadata.publisher || null },
                    { icon: 'copyright',    label: 'songs.metadata.copyright', value: metadata.copyright || null },
                    { icon: 'barcode',      label: 'songs.metadata.ccliNo',    value: metadata.ccliNo || null },
                    { icon: 'book-open',    label: 'songs.metadata.songbooks', value: metadata.songbooks && metadata.songbooks.length ? metadata.songbooks.map(sb => sb.entry ? `${sb.name} #${sb.entry}` : sb.name).join(', ') : null },
                ],
                performance: [
                    { icon: 'sliders-vertical', label: 'songs.metadata.transposition', value: transpositionValue },
                    { icon: 'music',        label: 'songs.metadata.capo',      value: metadata.capo ? i18n.t('songs.metadata.capo_value', { capo: metadata.capo }) : null },
                    { icon: 'clock',        label: 'songs.metadata.duration',  value: metadata.duration || null },
                    { icon: 'gauge-circle', label: 'songs.metadata.tempoText', value: metadata.tempoText || null },
                    { icon: 'git-branch',   label: 'songs.metadata.variant',   value: metadata.variant || null },
                    { icon: 'tag',          label: 'songs.metadata.customVersion', value: metadata.customVersion || null },
                ],
                other: [
                    { icon: 'languages',    label: 'songs.metadata.lang',      value: metadata.lang || null },
                    { icon: 'heading',      label: 'songs.metadata.sortTitle', value: metadata.sortTitle || null },
                    { icon: 'book-text',    label: 'songs.metadata.titles',    value: metadata.titles && metadata.titles.length ? metadata.titles.map(t => t.text).join(', ') : null },
                    { icon: 'message-square', label: 'songs.metadata.comments', value: metadata.comments && metadata.comments.length ? metadata.comments : null },
                ],
            };

            const categoryOrder = ['basic', 'people', 'release', 'performance', 'other'];
            const categoryTitleKey = cat => `songs.metadata.section_${cat}`;

            // Sprawdź, czy jest choć jedna wartość
            const allValid = categoryOrder.flatMap(cat => categoryItems[cat].filter(i => i.value));
            if (!allValid.length) {
                const noInfo = document.createElement('div');
                noInfo.className = 'flex items-center justify-center h-full text-[1.5rem]';
                noInfo.style.color = 'var(--color-muted)';
                noInfo.textContent = i18n.t('songs.no_info');
                songInfo_mainView.appendChild(noInfo);
            } else {
                categoryOrder.forEach(cat => {
                    const valid = categoryItems[cat].filter(i => i.value);
                    if (!valid.length) return;

                    const listGroup = document.createElement('div');
                    listGroup.className = 'list-group';

                    const titleEl = document.createElement('span');
                    titleEl.className = 'list-group__title';
                    titleEl.textContent = i18n.t(categoryTitleKey(cat));
                    listGroup.appendChild(titleEl);

                    valid.forEach(({ icon, label, value }) => {
                        const listItem = document.createElement('div');
                        listItem.className = 'list-item';

                        const iconWrapper = document.createElement('div');
                        iconWrapper.className = 'list-item__icon';
                        const iconEl = document.createElement('i');
                        iconEl.setAttribute('data-lucide', icon);
                        iconWrapper.appendChild(iconEl);

                        const textWrapper = document.createElement('div');
                        textWrapper.className = 'list-item__text';
                        const title = document.createElement('span');
                        title.className = 'list-item__title';
                        title.textContent = i18n.t(label);

                        // Komentarze jako tablica — renderuj jako osobne akapity w kontenerze
                        if (Array.isArray(value)) {
                            const commentContainer = document.createElement('div');
                            commentContainer.className = 'list-item__comment-list';
                            value.forEach(comment => {
                                const p = document.createElement('p');
                                p.className = 'list-item__comment';
                                p.textContent = comment;
                                commentContainer.appendChild(p);
                            });
                            textWrapper.appendChild(title);
                            textWrapper.appendChild(commentContainer);
                        } else {
                            const desc = document.createElement('span');
                            desc.className = 'list-item__desc';
                            desc.textContent = value;
                            textWrapper.appendChild(title);
                            textWrapper.appendChild(desc);
                        }

                        listItem.appendChild(iconWrapper);
                        listItem.appendChild(textWrapper);
                        listGroup.appendChild(listItem);
                    });

                    songInfo_mainView.appendChild(listGroup);
                });
            }
        }

        lucide.createIcons({ nodes: [viewBody] });

        // Scroll fade top/bottom jak w songlist view body
        const accordionContent = view.querySelector('.accordion-content');
        if (accordionContent) {
            setupScrollFade(accordionContent, accordionContent);
        }
    },

    audio() {
        const view = document.getElementById('mainContainer-tab-audio');
        const viewHeader = view.querySelector('.view-header');
        const viewBody = view.querySelector('[data-view="audio"]');

        const hasTimestamps = currentSong?.lyrics?.some(l => l.timestamp !== undefined && l.timestamp !== null);

        const autoSyncBtn = viewHeader.querySelector('[data-action="toggle-auto-sync"]');
        if (autoSyncBtn) {
            autoSyncBtn.onclick = () => toggleAutoSync();
        }

        const audioBody = viewBody.querySelector('.audio-panel-body');
        const noSongError = viewBody.querySelector('#audio-noSongError');
        const noAudioError = viewBody.querySelector('#audio-noAudioError');

        if (currentSong === null) {
            setElementDisplay(audioBody, false);
            setElementDisplay(noSongError, true);
            setElementDisplay(noAudioError, false);
            setElementDisplay(autoSyncBtn, false);
            return;
        } else if (!currentSong?.files?.audio) {
            setElementDisplay(audioBody, false);
            setElementDisplay(noSongError, false);
            setElementDisplay(noAudioError, true);
            setElementDisplay(autoSyncBtn, false);
            return;
        } else {
            setElementDisplay(audioBody, true);
            setElementDisplay(noSongError, false);
            setElementDisplay(noAudioError, false);
            setElementDisplay(autoSyncBtn, true);
        }

        if (viewBody.dataset.rendered !== '1') {
            viewBody.dataset.rendered = '1';
            addContextMenu(viewBody, pos => _openAudioContextMenu(pos));
            initCustomAudioPlayer();
        }

        const audioPlayer = viewBody.querySelector('#audioPlayer');
        const audioSource = viewBody.querySelector('#audioPlayer source');

        if (audioSource) {
            audioSource.src = songMediaUrl('audio', currentSong.id);
            if (audioPlayer) audioPlayer.load();
        }

        if (!hasTimestamps) {
            autoSyncBtn.style.opacity = '0.5';
        } else {
            autoSyncBtn.style.opacity = '';
            autoSyncEnabled = true;
            autoSyncBtn.classList.add('active');
            startAutoSync();
        }

        updateTimestampVisibility();
    },

    songlist(onlyActive = false) {
        const view = document.getElementById('mainContainer-tab-songlist');
        const viewHeader = view.querySelector('.view-header');
        const viewBody = view.querySelector('.view-body');
        const viewContent = viewBody.querySelector('[data-songlist-view]');

        viewHeader.querySelector('[data-action="filter-category"]').onclick = (e) => {
            e.stopPropagation();
            openSonglistFilterContextMenu(e.currentTarget);
        };
        _updateSonglistFilterButton();

        viewHeader.querySelector('[data-action="search-songs"]').onclick = (e) => {
            toggleSearchField('#songlistSearchField', e.currentTarget);
        };
        viewBody.querySelector('[data-songlist-search]').oninput = () => refreshPanelContent['songlist']();

        const addBtn = viewHeader.querySelector('[data-action="add-song"]');
        addBtn.onclick = () => openAddSongModal();
        updateAddSongButtonVisibility(addBtn);

        setupScrollFade(viewBody, viewContent);

        const activeId = typeof currentSong !== 'undefined' && currentSong ? String(currentSong.id) : null;

        if (onlyActive) {
            viewContent.querySelectorAll('[data-song-id]').forEach(element => {
                _setSonglistItemSelected(element, element.dataset.songId === activeId);
            });
            return;
        }

        const query = viewBody.querySelector('[data-songlist-search]')?.value.trim().toLowerCase() ?? '';
        renderSonglist(viewContent, {
            query,
            selectedIds: new Set(activeId ? [activeId] : []),
            onSelect: song => openSong(song.id),
            contextMenu: (song, pos) => _openSongItemContextMenu(song, pos)
        });

        updateSongCount = function () {
            const songCount = viewContent.querySelectorAll('button').length;
            viewHeader.querySelector('.view-title').textContent = i18n.t('songs.count', { count: songCount });
        };
        updateSongCount();
    },
    
    setlists() {
        const view = document.getElementById('mainContainer-tab-setlists');
        const viewHeader = view.querySelector('.view-header');
        const viewBody = view.querySelector('.view-body');
        const viewContent = viewBody.querySelector('[data-setlists-view]');

        const addBtn = viewHeader.querySelector('[data-action="add-setlist"]');
        addBtn.onclick = () => openAddSetlistModal();
        setElementDisplay(addBtn, (currentCanAddSongs || currentIsAdmin));

        viewHeader.querySelector('[data-action="filter-setlists"]').onclick = (e) => {
            e.stopPropagation();
            openSetlistFilterContextMenu(e.currentTarget);
        };
        updateSetlistFilterButton();
        viewHeader.querySelector('[data-action="search-setlists"]').onclick = (e) => {
            toggleSearchField('#setlistSearchField', e.currentTarget);
        };
        viewBody.querySelector('[data-setlist-search]').oninput = () => renderSetlistListItems(viewBody);

        setupScrollFade(viewBody, viewContent);

        updateSetlistCount = function () {
            const setlistCount = viewContent.querySelectorAll('button').length;
            viewHeader.querySelector('.view-title').textContent = i18n.t('setlists.count', { count: setlistCount });
        };

        refreshSetlistListView(viewBody);
    },

    queue() {
        const view = document.getElementById('mainContainer-tab-queue');
        const viewHeader = view.querySelector('.view-header');
        const viewBody = view.querySelector('.view-body');
        const viewContent = viewBody.querySelector('[data-queue-view]');

        viewHeader.querySelector('[data-action="queue-edit"]').onclick = () => {
            if (activeSetlist) openEditSetlistModal(activeSetlist.id);
        };
        viewHeader.querySelector('[data-action="queue-delete"]').onclick = () => {
            if (activeSetlist) deleteSetlist(activeSetlist.id);
        };
        viewHeader.querySelector('[data-action="queue-deactivate"]').onclick = () => {
            deactivateSetlist();
            if (typeof currentSong !== 'undefined' && currentSong && !currentSong._isSetlistText) {
                currentSong = null;
                if (typeof displaySong === 'function') displaySong();
                if (typeof renderSong === 'function') renderSong();
            }
        };

        const hasSetlist = !!activeSetlist;
        const isOwner = hasSetlist && ((currentUserId && activeSetlist.uploadedBy === currentUserId) || currentIsAdmin);
        setElementDisplay('[data-action="queue-edit"]', isOwner);
        setElementDisplay('[data-action="queue-delete"]', isOwner);
        setElementDisplay('[data-action="queue-deactivate"]', hasSetlist);

        renderQueueView(viewBody);

        setupScrollFade(viewBody, viewContent);
    },

    socket(users) {
        const view = document.getElementById('mainContainer-tab-socket');
        const viewHeader = view.querySelector('.view-header');

        const channelExitBtn = viewHeader.querySelector('[data-action="channel-exit"]');
        channelExitBtn.onclick = () => channelExit();

        if (libraryMode) {
            setElementDisplay(channelExitBtn, false);
            setElementDisplay('#connection-channel', false);
            setElementDisplay('#connection-library', true);
        } else {
            setElementDisplay(channelExitBtn, true);
            setElementDisplay('#connection-channel', isNewChannel);
            setElementDisplay('#connection-library', false);

            if (isNewChannel) {
                const channelValue = document.getElementById('channelValue');
                channelValue.textContent = channelName;

                const pingValue = document.getElementById('pingValue');
                pingValue.textContent = socketPing ? `${socketPing.toFixed(0)} ms` : `? ms`;

                pingValue.className = (!socketPing) ? 'text-faint' :
                    socketPing < 50 ? 'text-green-400' :
                        socketPing < 100 ? 'text-yellow-300' :
                            socketPing < 200 ? 'text-orange-400' :
                                'text-red-400';
            }

            if (users === undefined) return;
            const usersList = document.getElementById('channelUsersList');
            if (usersList) {
                usersList.innerHTML = '';
                users.forEach(user => {
                    const isSelf = currentUser && user.username === currentUser;
                    const adminBadge = isSelf && currentIsAdmin ? ` <span class="text-secondary text-xs" data-i18n="connection.admin_label">${i18n.t('connection.admin_label')}</span>` : '';
                    const selfBadge = isSelf ? ` <span class="text-secondary text-xs" data-i18n="connection.you_label">${i18n.t('connection.you_label')}</span>` : '';
                    const ownerBadge = user.isOwner ? ` <span class="text-secondary text-xs" data-i18n="connection.host_label">${i18n.t('connection.host_label')}</span>` : '';
                    const name = user.username ? escapeHtml(user.username) : `<span class="text-secondary" data-i18n="connection.guest">${i18n.t('connection.guest')}</span>`;
                    usersList.insertAdjacentHTML('beforeend', `<div class="flex items-center gap-1 text-sm py-0.5">${name}${selfBadge}${adminBadge}${ownerBadge}</div>`);
                });
            }
        }
    }
};

initSongInfoHeaderOverflow();
