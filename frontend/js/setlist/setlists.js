/* ==================== SETLISTY ==================== */

let activeSetlist = null;
let activeSetlistIndex = null;
let _setlistCache = {};
let _setlistList = null; // cache listy setlist — null = nie załadowane
let _setlistNavigating = false;
let _setlistActiveVisibility = 'all';
let _setlistActiveAuthor = 'all';
let _setlistItemCountRange = { min: null, max: null };
let _setlistActiveSongs = [];
let _setlistSongsMatch = 'any';
let _setlistSongOptionsScope = 'all';

function _getSetlistItemCount(setlist) {
    return setlist.itemCount ?? (setlist.items ? flattenSetlistItems(setlist.items).length : 0);
}

function _getSetlistSongIds(setlist) {
    return flattenSetlistItems(setlist.items || [])
        .filter(item => item.type === 'song' && item.songId != null)
        .map(item => Number(item.songId));
}

function _isSetlistFilterActive() {
    return _setlistActiveVisibility !== 'all'
        || _setlistActiveAuthor !== 'all'
        || _setlistItemCountRange.min != null
        || _setlistItemCountRange.max != null
        || _setlistActiveSongs.length > 0
        || _setlistSongsMatch !== 'any';
}

function updateSetlistFilterButton() {
    document.querySelectorAll('[data-action="filter-setlists"], [data-action="filter-transfer-setlists"]').forEach(button => {
        button.classList.toggle('active', _isSetlistFilterActive());
    });
}

function _resetSetlistFilters() {
    _setlistActiveVisibility = 'all';
    _setlistActiveAuthor = 'all';
    _setlistItemCountRange = { min: null, max: null };
    _setlistActiveSongs = [];
    _setlistSongsMatch = 'any';
    updateSetlistFilterButton();
}

// ─── Widok listy ─────────────────────────────────────────────────────────────


function _renderSetlistCards(view, setlists, {
    selectedId = activeSetlist?.id ?? null,
    selectedIds = null,
    onSelect = null,
    contextMenu = null,
    choice = false
} = {}) {
    if (!view) return;
    view.innerHTML = '';
    if (setlists.length === 0) {
        view.innerHTML = `<div class="text-secondary text-sm p-3 text-center">${i18n.t('setlists.no_results')}</div>`;
        return;
    }
    setlists.forEach(sl => {
        const isActive = selectedIds instanceof Set
            ? selectedIds.has(String(sl.id))
            : selectedId != null && String(selectedId) === String(sl.id);
        const card = document.createElement('button');
        card.type = 'button';
        card.dataset.setlistId = String(sl.id);
        card.setAttribute('aria-pressed', String(isActive));
        const itemCount = _getSetlistItemCount(sl);
        card.className = isActive
            ? 'px-1 py-2 rounded-xl text-left transition-all text-[0.85rem] w-full bg-[color-mix(in_srgb,_var(--color-accent)_12%,_transparent)] text-(--color-accent-hover) font-medium cursor-pointer'
            : 'px-1 py-2 rounded-xl text-left transition-all text-[0.85rem] w-full hover:text-accent-hover cursor-pointer';
        card.innerHTML = `
            <div class="flex items-center justify-between gap-2">
                <div class="flex items-center gap-1 min-w-0">
                    <span class="truncate">${escapeHtml(sl.title)}</span>
                    ${!sl.isPublic ? '<i data-lucide="lock" class="w-3 h-3 shrink-0 opacity-60"></i>' : ''}
                </div>
                ${choice ? `<i data-lucide="${isActive ? 'check' : 'circle'}" class="w-4 h-4 shrink-0"></i>` : ''}
            </div>
            <div class="text-xs mt-0.5">${i18n.t('setlists.item_count', { count: itemCount })}${sl.uploadedByUsername ? ' • ' + escapeHtml(sl.uploadedByUsername) : ''}</div>
        `;
        if (onSelect) card.addEventListener('click', () => onSelect(sl));
        else card.addEventListener('click', async () => {
            if (isActive) deactivateSetlist();
            else await activateSetlist(sl.id);
        });
        if (contextMenu) addContextMenu(card, pos => contextMenu(sl, pos));
        view.appendChild(card);
    });
    lucide.createIcons({ nodes: [view] });
}

function getFilteredSetlists(query = '', setlists = null) {
    const normalizedQuery = String(query).trim().toLocaleLowerCase();
    const source = Array.isArray(setlists) ? setlists : _setlistList || [];
    return source.filter(sl => {
        const matchesQuery = !normalizedQuery || [sl.title, sl.description, sl.uploadedByUsername]
            .filter(Boolean)
            .some(value => String(value).toLocaleLowerCase().includes(normalizedQuery));
        const matchesVisibility = _setlistActiveVisibility === 'all'
            || (_setlistActiveVisibility === 'public' && sl.isPublic)
            || (_setlistActiveVisibility === 'private' && !sl.isPublic);
        const matchesAuthor = _setlistActiveAuthor === 'all'
            || String(sl.uploadedBy ?? '') === _setlistActiveAuthor;
        const itemCount = _getSetlistItemCount(sl);
        const matchesItemCount = (_setlistItemCountRange.min == null || itemCount >= _setlistItemCountRange.min)
            && (_setlistItemCountRange.max == null || itemCount <= _setlistItemCountRange.max);
        const songIds = new Set(_getSetlistSongIds(sl));
        const matchesSongs = _setlistActiveSongs.length === 0
            || (_setlistSongsMatch === 'all'
                ? _setlistActiveSongs.every(songId => songIds.has(Number(songId)))
                : _setlistActiveSongs.some(songId => songIds.has(Number(songId))));
        return matchesQuery && matchesVisibility && matchesAuthor && matchesItemCount && matchesSongs;
    });
}

function renderSetlistList(view, {
    setlists = null,
    query = '',
    ...options
} = {}) {
    const visibleSetlists = getFilteredSetlists(query, setlists);
    _renderSetlistCards(view, visibleSetlists, options);
    return visibleSetlists;
}

function renderSetlistListItems(containerEl) {
    const view = containerEl.querySelector('[data-setlists-view]');
    const query = containerEl.querySelector('[data-setlist-search]')?.value || '';
    renderSetlistList(view, {
        query,
        contextMenu: (setlist, pos) => _openSetlistCardContextMenu(setlist, pos)
    });
    if (typeof updateSetlistCount === 'function') updateSetlistCount();
}

function _refreshSetlistActiveState() {
    const containerEl = document.querySelector('#mainContainer-tab-setlists .view-body[data-view="setlists"]');
    if (containerEl && _setlistList) renderSetlistListItems(containerEl);
}

async function refreshSetlistListView(containerEl, forceReload = false) {
    const view = containerEl.querySelector('[data-setlists-view]');
    if (!view) return;
    if (_setlistList && !forceReload) {
        renderSetlistListItems(containerEl);
        return;
    }
    view.innerHTML = `<div class="text-secondary text-sm p-2 line-pulse">${i18n.t('common.loading')}</div>`;
    try {
        const resp = await fetch(`${restApiAddress}/api/setlists`, { credentials: 'include' });
        if (!resp.ok) throw new Error();
        _setlistList = await resp.json();
        renderSetlistListItems(containerEl);
    } catch {
        view.innerHTML = `<div class="text-secondary text-sm p-3 text-center">${i18n.t('setlists.load_error')}</div>`;
    }
}

// ─── Aktywna setlista ─────────────────────────────────────────────────────────

async function activateSetlist(id) {
    const sl = await fetchSetlist(id);
    if (!sl) return;
    activeSetlist = sl;
    activeSetlistIndex = null;
    const flat = flattenSetlistItems(sl.items);
    if (flat.length > 0) {
        navigateToSetlistItem(0);
    } else {
        updateSetlistHeader();
        refreshPanelContent['queue']();
    }
    _refreshSetlistActiveState();
    showToast('success', i18n.t('setlists.active_success'), sl.title);
}

function deactivateSetlist() {
    activeSetlist = null;
    activeSetlistIndex = null;
    updateSetlistHeader();
    refreshPanelContent['queue']();
    _refreshSetlistActiveState();
}

async function fetchAndActivateSetlist(id, callback) {
    const sl = await fetchSetlist(id);
    if (!sl) return;
    activeSetlist = sl;
    updateSetlistHeader();
    refreshPanelContent['queue']();
    _refreshSetlistActiveState();
    if (callback) callback();
}

async function fetchSetlist(id) {
    try {
        const resp = await fetch(`${restApiAddress}/api/setlists/${id}`, { credentials: 'include' });
        if (!resp.ok) return null;
        const sl = await resp.json();
        _setlistCache[id] = sl;
        return sl;
    } catch {
        return null;
    }
}

// ─── Spłaszczanie items (pomija grupy jako pozycje, wchodzi w ich zawartość) ──

function flattenSetlistItems(items) {
    const flat = [];
    for (const item of (items || [])) {
        if (item.type === 'group') {
            flat.push(...flattenSetlistItems(item.items));
        } else {
            flat.push(item);
        }
    }
    return flat;
}

// ─── Header ───────────────────────────────────────────────────────────────────

function updateSetlistHeader() {
    const headerCenter = document.getElementById('headerCenter');
    if (!headerCenter) return;

    if (!activeSetlist) {
        setElementDisplay(headerCenter, false);
        headerCenter.innerHTML = '';
        return;
    }

    const items = flattenSetlistItems(activeSetlist.items);
    const total = items.length;
    const idx = activeSetlistIndex;
    const currentItem = idx !== null && items[idx] ? items[idx] : null;
    const posLabel = idx !== null ? `${idx + 1}/${total}` : `0/${total}`;
    const itemTitle = currentItem ? (currentItem.title || currentItem.songTitle || '—') : '—';

    const prevDisabled = idx === null || idx === 0;
    const nextDisabled = total === 0 || (idx !== null && idx >= total - 1);

    if (!document.getElementById('setlistPrevBtn')) {
        headerCenter.innerHTML = `
            <div id="setlistHeaderGrid" style="pointer-events:auto;display:grid;grid-template-columns:auto 1fr auto;align-items:center;gap:4px;max-width:420px;transition:grid-template-columns 0.3s ease">
                <button id="setlistPrevBtn" class="btn secondary" onclick="setlistNavigate(-1)">
                    <i data-lucide="chevron-left"></i>
                </button>
                <div id="setlistHeaderText" class="text-center px-1" style="min-width:0;overflow:hidden">
                    <div id="setlistHeaderTitle" class="text-sm font-semibold leading-tight" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis"></div>
                    <div id="setlistHeaderPos" class="text-xs leading-tight" style="color:var(--text-secondary,#888);white-space:nowrap;overflow:hidden;text-overflow:ellipsis"></div>
                </div>
                <button id="setlistNextBtn" class="btn secondary" onclick="setlistNavigate(1)">
                    <i data-lucide="chevron-right"></i>
                </button>
            </div>
        `;
        lucide.createIcons({ nodes: [headerCenter] });
    }

    const titleEl = document.getElementById('setlistHeaderTitle');
    const posEl   = document.getElementById('setlistHeaderPos');
    const prevBtn = document.getElementById('setlistPrevBtn');
    const nextBtn = document.getElementById('setlistNextBtn');
    const textEl  = document.getElementById('setlistHeaderText');

    titleEl.textContent = activeSetlist.title;

    const newPos = `${posLabel}: ${itemTitle}`;
    if (posEl.textContent !== newPos) {
        const oldW = textEl.getBoundingClientRect().width;
        posEl.textContent = newPos;
        const newW = textEl.getBoundingClientRect().width;
        const delta = (newW - oldW) / 2;
        if (Math.abs(delta) > 0.5) {
            prevBtn.style.transition = 'none';
            nextBtn.style.transition = 'none';
            prevBtn.style.transform = `translateX(${delta}px)`;
            nextBtn.style.transform = `translateX(${-delta}px)`;
            requestAnimationFrame(() => {
                prevBtn.style.transition = 'transform 0.3s ease, opacity 0.3s ease, scale 0.3s ease';
                nextBtn.style.transition = 'transform 0.3s ease, opacity 0.3s ease, scale 0.3s ease';
                prevBtn.style.transform = '';
                nextBtn.style.transform = '';
            });
        }
    }

    prevBtn.disabled = prevDisabled;
    nextBtn.disabled = nextDisabled;
    setElementDisplay(headerCenter, true);
}

function setlistNavigate(delta) {
    if (!activeSetlist) return;
    const items = flattenSetlistItems(activeSetlist.items);
    let newIdx = (activeSetlistIndex === null ? (delta > 0 ? 0 : items.length - 1) : activeSetlistIndex + delta);
    newIdx = Math.max(0, Math.min(items.length - 1, newIdx));
    navigateToSetlistItem(newIdx);
}

function navigateToSetlistItem(index) {
    if (!activeSetlist) return;
    const items = flattenSetlistItems(activeSetlist.items);
    if (index < 0 || index >= items.length) return;

    activeSetlistIndex = index;
    updateSetlistHeader();

    // Zaktualizuj panel kolejki
    document.querySelectorAll('.panel-view[data-view="queue"]:not(.panel-view--hidden)').forEach(el => {
        if (el.dataset.rendered !== '1') return;
        const view = el.querySelector('[data-queue-view]');
        if (!view) return;
        view.querySelectorAll('[data-item-index]').forEach(row => {
            const rowIdx = parseInt(row.dataset.itemIndex, 10);
            const isCurrent = rowIdx === index;
            const isPast = rowIdx < index;
            row.classList.toggle('bg-accent/15', isCurrent);
            row.classList.toggle('text-accent', isCurrent);
            row.classList.toggle('opacity-40', isPast);
            row.classList.toggle('hover:bg-white/5', !isCurrent);
        });
        // Przewiń do aktywnej pozycji
        const activeRow = view.querySelector(`[data-item-index="${index}"]`);
        if (activeRow) activeRow.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    });

    const item = items[index];

    if (item.type === 'song') {
        if (!item.songId) return;
        _setlistNavigating = true;
        try { if (typeof openSong === 'function') openSong(item.songId); } finally { _setlistNavigating = false; }
    } else if (item.type === 'text') {
        _displaySetlistTextItem(item);
    }

    // Wyślij przez WebSocket jeśli jesteśmy ownerem kanału
    if (isNewChannel && ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'setlist_select', setlistId: activeSetlist.id, itemIndex: index }));
    }
}

// ─── WebSocket — obsługa wiadomości ──────────────────────────────────────────

function handleExternalWsMessage(data) {
    switch (data.type) {
        case 'setlist_select':
            if (!activeSetlist || activeSetlist.id !== data.setlistId) {
                fetchAndActivateSetlist(data.setlistId, () => {
                    activeSetlistIndex = data.itemIndex;
                    navigateToSetlistItem(data.itemIndex);
                });
            } else {
                navigateToSetlistItem(data.itemIndex);
            }
            break;
        case 'setlist_clear':
            deactivateSetlist();
            break;
    }
}

// ─── Wyświetlanie wstawki tekstowej w panelu tekstu ───────────────────────────

function _displaySetlistTextItem(item) {
    const lines = item.lines || [];
    const fakeSong = {
        id: null,
        title: item.title || i18n.t('setlists.default_text_title'),
        lyrics: [{
            id: 'setlist-text-0',
            type: item.sectionType || 'verse',
            text: lines.join('\n'),
            timestamp: null,
            repeat: null,
            sheetAnchor: null,
            orderIndex: 0,
        }],
        files: { audio: false, sheets: null },
        isPublic: true,
        uploadedByUsername: null,
        _isSetlistText: true,
    };

    currentSong = fakeSong;
    if (typeof displaySong === 'function') displaySong();
    if (typeof renderSong === 'function') renderSong();
}

function renderQueueView(containerEl) {
    const view = containerEl.querySelector('[data-queue-view]');
    if (!view) return;
    view.innerHTML = '';

    if (!activeSetlist) {
        view.innerHTML = `<div class="text-secondary text-sm p-4 text-center" data-i18n="setlists.no_active">${i18n.t('setlists.no_active')}</div>`;
        return;
    }

    const flat = flattenSetlistItems(activeSetlist.items);

    if (flat.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'text-secondary text-sm px-3 py-2';
        empty.textContent = i18n.t('setlists.empty');
        view.appendChild(empty);
        return;
    }

    let flatIdx = 0;
    function renderQueueItems(items) {
        items.forEach(item => {
            if (item.type === 'group') {
                if (item.title) {
                    const gh = document.createElement('div');
                    gh.className = 'flex items-center gap-2 px-1 py-2 cursor-pointer transition-colors rounded-lg';
                    gh.innerHTML = `<i data-lucide="folder" class="w-3 h-3 text-accent/60 shrink-0"></i><span class="text-[0.7rem] font-semibold text-accent/70 uppercase tracking-wide truncate">${escapeHtml(item.title)}</span>`;
                    view.appendChild(gh);
                }
                renderQueueItems(item.items || []);
                return;
            }

            const idx = flatIdx++;
            const isCurrent = activeSetlistIndex === idx;
            const isPast = activeSetlistIndex !== null && idx < activeSetlistIndex;
            const row = document.createElement('div');
            row.className = `flex items-center gap-2 px-1 py-2 cursor-pointer transition-colors rounded-lg ${isCurrent ? 'bg-accent/15' : isPast ? 'opacity-40 hover:opacity-70 hover:bg-white/5' : 'hover:bg-white/5'}`;
            row.dataset.itemIndex = idx;

            const iconName = item.type === 'song' ? 'music-2' : 'align-left';
            row.innerHTML = `
                <span class="text-[0.7rem] w-4 text-right shrink-0 ${isCurrent ? 'text-accent-hover' : 'text-secondary'}">${isCurrent ? '<i data-lucide="play" class="w-3 h-3"></i>' : idx + 1}</span>
                <i data-lucide="${iconName}" class="w-3.5 h-3.5 shrink-0 ${isCurrent ? 'text-accent-hover' : 'text-secondary'}"></i>
                <div class="min-w-0 flex-1">
                    <div class="truncate text-sm ${isCurrent ? 'font-medium' : ''}">${escapeHtml(item.title || item.songTitle || '—')}</div>
                    ${item.type === 'song' && item.songKey ? `<div class="text-xs text-secondary leading-none">${escapeHtml(item.songKey)}</div>` : ''}
                </div>
            `;
            row.onclick = () => navigateToSetlistItem(idx);
            view.appendChild(row);
        });
    }
    renderQueueItems(activeSetlist.items);

    lucide.createIcons({ nodes: [view] });
}

// Context menu - setlist list filter
function openSetlistFilterContextMenu(trigger, onRefresh = null) {
	const refresh = () => {
		if (typeof onRefresh === 'function') onRefresh();
		else {
			const container = document.querySelector('.view-body[data-view="setlists"]');
			if (container) renderSetlistListItems(container);
		}
		updateSetlistFilterButton();
	};
	const setlists = _setlistList || [];
	const authors = [...new Map(setlists
		.filter(setlist => setlist.uploadedBy != null && setlist.uploadedByUsername)
		.map(setlist => [String(setlist.uploadedBy), setlist.uploadedByUsername]))]
		.map(([value, label]) => ({ value, label }))
		.sort((a, b) => a.label.localeCompare(b.label));
	const itemCounts = setlists.map(_getSetlistItemCount);
	const itemCountBounds = itemCounts.length
		? { min: Math.min(...itemCounts), max: Math.max(...itemCounts) }
		: null;
	const usedSongItems = setlists.flatMap(setlist => flattenSetlistItems(setlist.items || []))
		.filter(item => item.type === 'song' && item.songId != null);
	const usedSongIds = new Set(usedSongItems.map(item => Number(item.songId)));
	const songTitles = new Map((typeof allSongs !== 'undefined' ? allSongs : [])
		.map(song => [Number(song.id), song.title]));
	usedSongItems.forEach(item => {
		const songId = Number(item.songId);
		if (!songTitles.has(songId)) songTitles.set(songId, item.songTitle || item.title || String(songId));
	});
	const songs = [...songTitles]
		.map(([value, label]) => ({
			value,
			label,
			visible: () => _setlistSongOptionsScope === 'all'
				|| usedSongIds.has(value)
				|| _setlistActiveSongs.includes(value)
		}))
		.sort((a, b) => a.label.localeCompare(b.label));
	showTriggeredContextMenu([
		{
			icon: 'eye',
			label: i18n.t('setlists.filter_visibility'),
			submenu: {
				type: 'single',
				value: _setlistActiveVisibility,
				defaultValue: 'all',
				clearable: true,
				items: [
					{ value: 'public', label: i18n.t('setlists.filter_public') },
					{ value: 'private', label: i18n.t('setlists.filter_private') }
				],
				onChange: value => { _setlistActiveVisibility = value; refresh(); }
			}
		},
		{
			icon: 'user-round',
			label: i18n.t('setlists.filter_author'),
			visible: authors.length > 0,
			submenu: {
				type: 'single',
				value: _setlistActiveAuthor,
				defaultValue: 'all',
				clearable: true,
				items: authors,
				onChange: value => { _setlistActiveAuthor = value; refresh(); }
			}
		},
		{ separator: true },
		{
			icon: 'list-ordered',
			label: i18n.t('setlists.filter_item_count'),
			visible: !!itemCountBounds,
			submenu: {
				type: 'range',
				value: _setlistItemCountRange,
				bounds: itemCountBounds,
				step: 1,
				labels: { min: i18n.t('setlists.filter_from'), max: i18n.t('setlists.filter_to') },
				onChange: value => { _setlistItemCountRange = value; refresh(); }
			}
		},
		{
			icon: 'music-2',
			label: i18n.t('setlists.filter_songs'),
			visible: songs.length > 0,
			submenu: {
				type: 'multi',
				value: _setlistActiveSongs,
				defaultValue: [],
				searchable: { placeholder: i18n.t('setlists.filter_search_options') },
				items: [
					{
						icon: 'list-music',
						label: i18n.t('setlists.filter_song_options_scope'),
						searchable: false,
						sticky: true,
						submenu: {
							type: 'single',
							value: _setlistSongOptionsScope,
							defaultValue: 'all',
							refreshParentOnChange: true,
							items: [
								{ value: 'all', label: i18n.t('setlists.filter_song_options_all') },
								{ value: 'used', label: i18n.t('setlists.filter_song_options_used') }
							],
							onChange: value => { _setlistSongOptionsScope = value; }
						}
					},
					{
						icon: 'list-filter',
						label: i18n.t('setlists.filter_songs_match'),
						searchable: false,
						sticky: true,
						submenu: {
							type: 'single',
							value: _setlistSongsMatch,
							defaultValue: 'any',
							items: [
								{ value: 'any', label: i18n.t('setlists.filter_match_any') },
								{ value: 'all', label: i18n.t('setlists.filter_match_all') }
							],
							onChange: value => { _setlistSongsMatch = value; refresh(); }
						}
					},
					{ separator: true, sticky: true },
					...songs
				],
				onChange: values => { _setlistActiveSongs = values; refresh(); }
			}
		},
		{ separator: true },
		{
			icon: 'rotate-ccw',
			label: i18n.t('setlists.filter_reset'),
			disabled: () => !_isSetlistFilterActive(),
			action: () => {
				_resetSetlistFilters();
				refresh();
			}
		}
	], trigger);
}

// Context menu - setlist list item
function _openSetlistCardContextMenu(sl, pos) {
	const isOwner = (currentUserId && sl.uploadedBy === currentUserId) || currentIsAdmin;

	const isOpened = sl.id === activeSetlist?.id
	const items = [
		{
			icon: 'list-video',
			content: `${sl?.title}`,
		},
		{
			icon: isOpened ? 'circle-x' : 'external-link',
			label: isOpened ? i18n.t('setlists.deactivate') : i18n.t('setlists.activate'),
			action: isOpened
				? () => deactivateSetlist()
				: () => activateSetlist(sl.id)
		},
		{
			icon: 'arrow-left-right',
			label: i18n.t('transfer.export_tab'),
			action: () => openTransferSettingsForSetlist(sl.id)
		},
		{
			icon: 'pencil',
			label: i18n.t('setlists.edit'),
			disabled: !isOwner,
			action: () => openEditSetlistModal(sl.id)
		},
		{
			icon: 'trash-2',
			label: i18n.t('setlists.delete'),
			disabled: !isOwner,
			danger: true,
			action: () => deleteSetlist(sl.id)
		}
	];

	showContextMenu(items, pos);
}