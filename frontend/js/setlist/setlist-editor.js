/* ==================== EDYTOR SETLIST ==================== */

let _editorItems = [];

// ─── Normaliza items (kompatybilność wsteczna: content→lines) ────────────────

function _normalizeSetlistItem(item) {
    if (item.type === 'song') {
        const song = (allSongs || []).find(s => s.id === item.songId);
        return { type: 'song', songId: item.songId, title: item.songTitle || item.title || (song?.title) || String(item.songId), songTitle: item.songTitle || (song?.title) || '', songKey: item.songKey || (song?.key) || null };
    }
    if (item.type === 'group') {
        return { type: 'group', title: item.title || '', items: _normalizeSetlistItems(item.items) };
    }
    // text item — normalize content→lines
    const lines = Array.isArray(item.lines) ? item.lines : (item.content ? item.content.split('\n') : []);
    return { type: 'text', sectionType: item.sectionType || 'verse', title: item.title || '', lines };
}

function _normalizeSetlistItems(items) {
    return (items || []).map(_normalizeSetlistItem);
}
	
/* ==================== TOGGLE SETLIST PUBLIC ==================== */

function toggleSetlistPublic(mode, el) {
	const currentValue = el.getAttribute('aria-checked') === 'true';
	const newValue = !currentValue;
	
	el.setAttribute('aria-checked', newValue ? 'true' : 'false');
	el.classList.toggle('off', !newValue);
	
	return newValue;
}

// ─── Modal dodaj / edytuj ─────────────────────────────────────────────────────

function openAddSetlistModal() {
    document.getElementById('setlistModalTitle').textContent = i18n.t('setlists.create_title');
    document.getElementById('setlistEditId').value = '';
    document.getElementById('setlistItemsModalSetlistId').value = '';
    document.getElementById('setlistTitle').value = '';
    document.getElementById('setlistDescription').value = '';
    const publicToggle = document.getElementById('setlistIsPublic');
    const isPublic = Boolean(settings.defaults?.setlistVisiblePublic);
    publicToggle.setAttribute('aria-checked', String(isPublic));
    publicToggle.classList.toggle('off', !isPublic);
    _editorItems = [];
    _renderSetlistItemsEditor();
    const firstTab = document.querySelector('#setlistModal .modal-tabs .modal-tab');
    if (firstTab) switchModalTab('setlist', 'info', firstTab);
    openModal('setlistModal');
    filterSetlistSongPicker();
}

async function openEditSetlistModal(id) {
    const sl = _setlistCache[id] || await fetchSetlist(id);
    document.getElementById('setlistModalTitle').textContent = i18n.t('setlists.edit_title');
    document.getElementById('setlistEditId').value = id;
    document.getElementById('setlistItemsModalSetlistId').value = id;
    document.getElementById('setlistTitle').value = sl ? sl.title : '';
    document.getElementById('setlistDescription').value = sl ? (sl.description || '') : '';
    const isPublic = sl ? sl.isPublic : true;
    const publicToggle = document.getElementById('setlistIsPublic');
    publicToggle.setAttribute('aria-checked', isPublic ? 'true' : 'false');
    publicToggle.classList.toggle('off', !isPublic);
    _editorItems = sl ? _normalizeSetlistItems(sl.items) : [];
    _renderSetlistItemsEditor();
    const firstTab = document.querySelector('#setlistModal .modal-tabs .modal-tab');
    if (firstTab) switchModalTab('setlist', 'info', firstTab);
    openModal('setlistModal');
    filterSetlistSongPicker();
}


async function submitSetlistForm(event) {
    if (event) event.preventDefault();
}

function _upsertSetlistInList(setlist) {
    if (!_setlistList || !setlist) return false;

    const index = _setlistList.findIndex(sl => sl.id === setlist.id);
    if (index === -1) _setlistList.unshift(setlist);
    else _setlistList[index] = setlist;

    _setlistList.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
    return true;
}

function _removeSetlistFromList(id) {
    if (!_setlistList) return false;
    const setlistId = Number(id);
    _setlistList = _setlistList.filter(sl => sl.id !== setlistId);
    return true;
}

function _refreshOpenSetlistPanels() {
    document.querySelectorAll('.view-body[data-view="setlists"]').forEach(el => {
        refreshSetlistListView(el);
    });
}

async function submitSetlistModalSave() {
    const editId = document.getElementById('setlistEditId').value;
    const title = document.getElementById('setlistTitle').value.trim();
    if (!title) {
        switchModalTab('setlist', 'info', document.querySelector('#setlistModal .modal-tab[data-tab="info"]'));
        document.getElementById('setlistTitle').focus();
        showToast('error', i18n.t('common.error'), i18n.t('setlists.name_required'));
        return;
    }

    const infoBody = {
        title,
        description: document.getElementById('setlistDescription').value.trim() || null,
        isPublic: document.getElementById('setlistIsPublic').getAttribute('aria-checked') === 'true',
    };

    try {
        setButtonLoading(document.getElementById('setlistSubmitBtn'), true);
        let savedId = editId ? parseInt(editId) : null;

        // Zapisz info
        const infoUrl = editId ? `${restApiAddress}/api/setlists/${editId}` : `${restApiAddress}/api/setlists`;
        const infoMethod = editId ? 'PUT' : 'POST';
        const infoResp = await fetch(infoUrl, {
            method: infoMethod,
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(infoBody),
        });
        if (!infoResp.ok) {
            const err = await infoResp.json();
            showToast('error', i18n.t('common.error'), i18n.t('setlists.save_error'));
            return;
        }
        if (!editId) {
            const data = await infoResp.json();
            savedId = data.id;
        }
        if (editId) delete _setlistCache[parseInt(editId)];

        // Odczytaj items z JSON-mode jeśli aktywny
        const jsonTA = document.getElementById('setlistItemsJson');
        const jsonMode = jsonTA && !jsonTA.classList.contains('hidden');
        if (jsonMode) {
            try {
                const parsed = JSON.parse(jsonTA.value || '[]');
                if (Array.isArray(parsed)) _editorItems = parsed;
            } catch { showToast('error', i18n.t('common.error'), i18n.t('setlists.json_error')); return; }
        }

        // Zapisz info + pozycje razem
        if (savedId) {
            function serializeItems(list) {
                return list.map(item => {
                    if (item.type === 'song') return { type: 'song', songId: item.songId };
                    if (item.type === 'group') return { type: 'group', title: item.title || null, items: serializeItems(item.items || []) };
                    return { type: 'text', sectionType: item.sectionType || 'verse', title: item.title || null, lines: item.lines || [] };
                });
            }
            const items = serializeItems(_editorItems);
            const itemsResp = await fetch(`${restApiAddress}/api/setlists/${savedId}`, {
                method: 'PUT',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ items }),
            });
            if (!itemsResp.ok) {
                const err = await itemsResp.json();
                showToast('error', i18n.t('common.error'), i18n.t('setlists.save_error'));
                return;
            }
            delete _setlistCache[savedId];
        }

        closeAllModals();
        showToast('success', i18n.t('common.success'), i18n.t(editId ? 'setlists.update_success' : 'setlists.create_success'));

        if (savedId && activeSetlist && activeSetlist.id === savedId) {
            await fetchAndActivateSetlist(savedId);
        }

        const savedSetlist = savedId ? (_setlistCache[savedId] || await fetchSetlist(savedId)) : null;
        if (!_upsertSetlistInList(savedSetlist)) _setlistList = null;
        _refreshOpenSetlistPanels();
    } catch {
        showToast('error', i18n.t('common.error'), i18n.t('setlists.save_error'));
    }
    setTimeout(() => {
        setButtonLoading(document.getElementById('setlistSubmitBtn'), false);
    }, 250);
}

// ─── Usuń ─────────────────────────────────────────────────────────────────────

async function deleteSetlist(id) {
    if (!confirm(i18n.t('setlists.delete_confirm'))) return;

    try {
        const resp = await fetch(`${restApiAddress}/api/setlists/${id}`, {
            method: 'DELETE',
            credentials: 'include',
        });
        if (!resp.ok) {
            const err = await resp.json();
            showToast('error', i18n.t('common.error'));
            return;
        }
        delete _setlistCache[id];
        if (activeSetlist && activeSetlist.id === id) deactivateSetlist();
        showToast('success', i18n.t('common.success'), i18n.t('setlists.delete_success'));
        if (!_removeSetlistFromList(id)) _setlistList = null;
        _refreshOpenSetlistPanels();
    } catch {
        showToast('error', i18n.t('common.error'), i18n.t('common.error'));
    }
}

// ─── Edytor pozycji ───────────────────────────────────────────────────────────

function getSetlistSectionTypes() {
    return getSectionTypes().filter(type => type.value !== 'chorus_ref');
}

function _sectionTypeLabel(v) {
    return (getSetlistSectionTypes().find(t => t.value === v) || getSetlistSectionTypes()[0]).label;
}

// Ścieżka do pozycji: "3" = _editorItems[3], "1.2" = _editorItems[1].items[2]
function _getItemByPath(path) {
    const parts = String(path).split('.');
    let arr = _editorItems;
    let item = null;
    for (const p of parts) {
        item = arr[parseInt(p, 10)];
        if (!item) return null;
        arr = item.items || [];
    }
    return item;
}

function _removeItemByPath(path) {
    const parts = String(path).split('.');
    let arr = _editorItems;
    for (let i = 0; i < parts.length - 1; i++) {
        arr = arr[parseInt(parts[i], 10)]?.items || [];
    }
    arr.splice(parseInt(parts[parts.length - 1], 10), 1);
}

function _insertItemAtPath(item, targetPath) {
    const parts = String(targetPath).split('.');
    let arr = _editorItems;
    for (let i = 0; i < parts.length - 1; i++) {
        arr = arr[parseInt(parts[i], 10)]?.items || [];
    }
    arr.splice(parseInt(parts[parts.length - 1], 10), 0, item);
}

function _songItemFromId(songId) {
    const song = (allSongs || []).find(s => String(s.id) === String(songId));
    if (!song) return null;
    return { type: 'song', songId: song.id, title: song.title, songTitle: song.title, songKey: song.key || null };
}

function _renderSetlistItemsEditor() {
    const list = document.getElementById('setlistItemsList');
    if (!list) return;
    list.innerHTML = '';

    if (!list._dropBound) {
        list._dropBound = true;
        list.addEventListener('dragover', (e) => { if (e.dataTransfer.types.includes('text/plain')) e.preventDefault(); });
        list.addEventListener('drop', (e) => {
            const data = e.dataTransfer.getData('text/plain');
            if (!data.startsWith('song:')) return;
            e.preventDefault();
            const songId = data.slice(5);
            const item = _songItemFromId(songId);
            if (item) { _editorItems.push(item); _renderSetlistItemsEditor(); }
        });
    }

    if (_editorItems.length === 0) {
        list.innerHTML = `<div class="text-secondary text-sm px-3 py-4 text-center">${i18n.t('setlists.empty_list')}</div>`;
        return;
    }

    _editorItems.forEach((item, idx) => _renderEditorItem(list, item, String(idx)));
}

function _renderEditorItem(container, item, path) {
    if (item.type === 'group') {
        _renderEditorGroup(container, item, path);
    } else {
        _renderEditorLeaf(container, item, path);
    }
}

function _renderEditorGroup(container, item, path) {
    const group = document.createElement('div');
    group.className = 'setlist-editor-group rounded-lg mb-1 border border-white/10 overflow-hidden';
    group.dataset.path = path;

    // Nagłówek grupy
    const header = document.createElement('div');
    header.className = 'flex items-center gap-1.5 px-2 py-1.5 bg-white/[0.06] border-b border-white/10';
    header.innerHTML = `
        <div class="editor-drag-handle cursor-grab" title="${i18n.t('setlists.group_icon_title')}"><i data-lucide="grip-vertical" class="w-3.5 h-3.5"></i></div>
        <i data-lucide="folder" class="w-3.5 h-3.5 text-accent/70 shrink-0"></i>
        <input type="text" class="flex-1 min-w-0 bg-transparent border-none outline-none text-sm font-semibold text-accent/90 placeholder:text-secondary/50" placeholder="${i18n.t('setlists.group_placeholder')}" value="${escapeHtml(item.title || '')}">
        <button type="button" class="btn small danger" title="${i18n.t('setlists.remove_group')}"><i data-lucide="trash-2" class="w-3.5 h-3.5"></i></button>
    `;
    group.appendChild(header);

    const titleInput = header.querySelector('input');
    titleInput.addEventListener('input', () => { _getItemByPath(path).title = titleInput.value; });

    const deleteBtn = header.querySelector('.btn.danger');
    deleteBtn.addEventListener('click', () => { _removeItemByPath(path); _renderSetlistItemsEditor(); });

    // Lista pozycji wewnątrz grupy
    const innerList = document.createElement('div');
    innerList.className = 'setlist-editor-group-items';
    innerList.dataset.groupPath = path;

    if ((item.items || []).length === 0) {
        const empty = document.createElement('div');
        empty.className = 'text-secondary text-xs px-3 py-2 text-center setlist-group-empty mb-1';
        empty.textContent = i18n.t('setlists.empty_group');
        innerList.appendChild(empty);
    } else {
        (item.items || []).forEach((child, cidx) => _renderEditorItem(innerList, child, path + '.' + cidx));
    }

    // Drop na innerList (dla pustych grup gdzie placeholder zasłania)
    innerList.addEventListener('dragover', (e) => { e.preventDefault(); e.stopPropagation(); innerList.classList.add('ring-1', 'ring-accent/50'); });
    innerList.addEventListener('dragleave', (e) => { if (!innerList.contains(e.relatedTarget)) innerList.classList.remove('ring-1', 'ring-accent/50'); });
    innerList.addEventListener('drop', (e) => {
        e.preventDefault();
        e.stopPropagation();
        innerList.classList.remove('ring-1', 'ring-accent/50');
        const data = e.dataTransfer.getData('text/plain');
        if (!data) return;
        const groupItem = _getItemByPath(path);
        if (!groupItem) return;
        groupItem.items = groupItem.items || [];
        if (data.startsWith('song:')) {
            const si = _songItemFromId(data.slice(5));
            if (si) groupItem.items.push(si);
        } else {
            const moved = _getItemByPath(data);
            if (!moved || moved.type === 'group') return;
            _removeItemByPath(data);
            groupItem.items.push(moved);
        }
        _renderSetlistItemsEditor();
    });

    // Strefa drop na końcu — tylko gdy grupa ma już elementy (pusta ma własny placeholder)
    const dropZone = document.createElement('div');
    dropZone.className = 'setlist-group-dropzone';
    const hasItems = (item.items || []).length > 0;
    dropZone.textContent = i18n.t('setlists.drop_here');
    dropZone.addEventListener('dragover', (e) => { e.preventDefault(); e.stopPropagation(); dropZone.classList.add('active'); });
    dropZone.addEventListener('dragleave', () => dropZone.classList.remove('active'));
    dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        e.stopPropagation();
        dropZone.classList.remove('active');
        const data = e.dataTransfer.getData('text/plain');
        if (!data) return;
        const groupItem = _getItemByPath(path);
        if (!groupItem) return;
        groupItem.items = groupItem.items || [];
        if (data.startsWith('song:')) {
            const item = _songItemFromId(data.slice(5));
            if (item) groupItem.items.push(item);
        } else {
            const moved = _getItemByPath(data);
            if (!moved || moved.type === 'group') return;
            _removeItemByPath(data);
            groupItem.items.push(moved);
        }
        _renderSetlistItemsEditor();
    });
    if (hasItems) innerList.appendChild(dropZone);

    group.appendChild(innerList);

    // Drag grupy (top-level only)
    group.draggable = true;
    group.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/plain', path); group.classList.add('opacity-50'); e.stopPropagation(); });
    group.addEventListener('dragend', () => group.classList.remove('opacity-50'));
    group.addEventListener('dragover', (e) => { e.preventDefault(); e.stopPropagation(); group.classList.add('ring-1', 'ring-white/20'); });
    group.addEventListener('dragleave', (e) => { if (!group.contains(e.relatedTarget)) group.classList.remove('ring-1', 'ring-white/20'); });
    group.addEventListener('drop', (e) => {
        e.preventDefault();
        e.stopPropagation();
        group.classList.remove('ring-1', 'ring-white/20');
        const fromPath = e.dataTransfer.getData('text/plain');
        if (!fromPath || fromPath === path) return;
        // Jeśli to pozycja (nie grupa) — wrzuć do grupy na końcu
        const moved = _getItemByPath(fromPath);
        if (!moved) return;
        if (moved.type !== 'group') {
            _removeItemByPath(fromPath);
            const groupItem = _getItemByPath(path);
            if (groupItem) { groupItem.items = groupItem.items || []; groupItem.items.push(moved); }
        } else {
            // Reorder grup
            const toIdx = parseInt(path, 10);
            const fromIdx = parseInt(fromPath, 10);
            if (isNaN(toIdx) || isNaN(fromIdx)) return;
            const m = _editorItems.splice(fromIdx, 1)[0];
            _editorItems.splice(toIdx, 0, m);
        }
        _renderSetlistItemsEditor();
    });

    container.appendChild(group);
    lucide.createIcons({ nodes: [group] });
}

function _renderEditorLeaf(container, item, path) {
    const section = document.createElement('div');
    const isInGroup = path.includes('.');
    section.className = `lyrics-editor-section border-b border-blue-500/10 last:border-b-0${item.type === 'text' ? '' : ' lyrics-editor-section--song'}${isInGroup ? ' bg-black/20' : ' bg-black/30'}`;
    section.draggable = true;
    section.dataset.path = path;

    if (item.type === 'song') {
        section.innerHTML = `
            <div class="flex items-center gap-1.5 px-2 py-1 bg-blue-500/[0.07] border-b border-blue-500/10">
                <div class="editor-drag-handle" title="${i18n.t('setlists.drag_item')}"><i data-lucide="grip-vertical" class="w-3.5 h-3.5"></i></div>
                <i data-lucide="music-2" class="w-3.5 h-3.5 text-secondary shrink-0"></i>
                <div class="flex-1 min-w-0">
                    <span class="text-sm font-medium truncate">${escapeHtml(item.title || item.songTitle || '—')}</span>
                    ${item.songKey ? `<span class="text-xs text-secondary ml-1.5">${escapeHtml(item.songKey)}</span>` : ''}
                </div>
                <div class="flex gap-1 ml-auto">
                    <button type="button" class="btn small danger" title="${i18n.t('setlists.remove_item')}"><i data-lucide="trash-2" class="w-3.5 h-3.5"></i></button>
                </div>
            </div>`;
    } else {
        const typeDef = _sectionTypeLabel(item.sectionType || 'verse');
        const linesText = (item.lines || []).join('\n');
        section.innerHTML = `
            <div class="flex items-center gap-1.5 px-2 py-1 bg-blue-500/[0.07] border-b border-blue-500/10">
                <div class="editor-drag-handle" title="${i18n.t('setlists.drag_item')}"><i data-lucide="grip-vertical" class="w-3.5 h-3.5"></i></div>
                <button type="button" class="editor-type-btn" data-value="${item.sectionType || 'verse'}">
                    <span class="editor-type-label">${typeDef}</span>
                    <i data-lucide="chevron-down" class="w-3 h-3 opacity-50"></i>
                </button>
                <div class="w-px h-3.5 bg-white/10 shrink-0"></div>
                <input type="text" class="lyrics-editor-meta-input flex-1 min-w-0" placeholder="${i18n.t('setlists.text_item_title')}" value="${escapeHtml(item.title || '')}" style="background:transparent;border:none;outline:none;font-size:0.8rem;color:var(--text-primary)">
                <div class="flex gap-1 ml-auto">
                    <button type="button" class="btn small danger" title="${i18n.t('setlists.remove_item')}"><i data-lucide="trash-2" class="w-3.5 h-3.5"></i></button>
                </div>
            </div>
            <div class="lyrics-editor-textarea-wrap">
                <div class="lyrics-editor-highlight" aria-hidden="true"></div>
                <textarea class="lyrics-editor-textarea w-full" placeholder="${i18n.t('setlists.text_item_placeholder')}">${escapeHtml(linesText)}</textarea>
            </div>`;
    }

    // Usuń
    section.querySelector('.btn.danger').addEventListener('click', () => { _removeItemByPath(path); _renderSetlistItemsEditor(); });

    // Drag-to-reorder (top-level lub w grupie)
    section.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/plain', path); section.classList.add('opacity-50'); e.stopPropagation(); });
    section.addEventListener('dragend', () => section.classList.remove('opacity-50'));
    section.addEventListener('dragover', (e) => { e.preventDefault(); e.stopPropagation(); section.classList.add('ring-1', 'ring-accent'); });
    section.addEventListener('dragleave', () => section.classList.remove('ring-1', 'ring-accent'));
    section.addEventListener('drop', (e) => {
        e.preventDefault();
        e.stopPropagation();
        section.classList.remove('ring-1', 'ring-accent');
        const fromPath = e.dataTransfer.getData('text/plain');
        if (!fromPath || fromPath === path) return;
        const moved = _getItemByPath(fromPath);
        if (!moved) return;
        // Grupy można wrzucać tylko na top-level
        if (moved.type === 'group' && path.includes('.')) return;
        _removeItemByPath(fromPath);
        // Przelicz ścieżkę docelową po usunięciu (jeśli w tej samej tablicy i fromIdx < toIdx, idx się przesunął)
        const toPathParts = path.split('.');
        const fromPathParts = fromPath.split('.');
        const sameParent = toPathParts.slice(0, -1).join('.') === fromPathParts.slice(0, -1).join('.');
        let toIdx = parseInt(toPathParts[toPathParts.length - 1], 10);
        if (sameParent && parseInt(fromPathParts[fromPathParts.length - 1], 10) < toIdx) toIdx--;
        toPathParts[toPathParts.length - 1] = String(toIdx);
        _insertItemAtPath(moved, toPathParts.join('.'));
        _renderSetlistItemsEditor();
    });

    container.appendChild(section);
    lucide.createIcons({ nodes: [section] });

    if (item.type === 'text') {
        const titleInput = section.querySelector('input[type="text"]');
        const textarea = section.querySelector('.lyrics-editor-textarea');
        const highlight = section.querySelector('.lyrics-editor-highlight');
        const typeBtn = section.querySelector('.editor-type-btn');

        titleInput.addEventListener('input', () => { const it = _getItemByPath(path); if (it) it.title = titleInput.value; });

        function syncHighlight() {
            const escaped = textarea.value
                .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
                .replace(/\[([^\]\n]*)\]?/g, (_, inner) => `<span class="chord-highlight">[${inner}]</span>`);
            highlight.innerHTML = escaped + '\n';
        }
        textarea.addEventListener('input', () => {
            const it = _getItemByPath(path);
            if (it) it.lines = textarea.value.split('\n');
            if (typeof autoResizeTextarea === 'function') autoResizeTextarea(textarea);
            syncHighlight();
        });
        syncHighlight();
        if (typeof autoResizeTextarea === 'function') autoResizeTextarea(textarea);

        if (typeBtn) {
            typeBtn.addEventListener('click', (ev) => {
                ev.stopPropagation();
                _openSetlistSectionTypePicker(section, path, typeBtn);
            });
        }
    }
}

function _openSetlistSectionTypePicker(section, path, anchor) {
    const item = _getItemByPath(path);
    const currentType = item?.sectionType || 'verse';
    const rect = anchor.getBoundingClientRect();

    const menuItems = getSetlistSectionTypes().map(type => {
        const isActive = type.value === currentType;

        return {
            icon: isActive ? 'circle-check' : 'circle',
            label: type.label,
            active: isActive,
            action: () => {
                const currentItem = _getItemByPath(path);
                if (!currentItem) return;

                currentItem.sectionType = type.value;
                _renderSetlistItemsEditor();
            },
        };
    });

    showContextMenu(menuItems, { x: rect.left, y: rect.bottom + 4 }, anchor);
}

function filterSetlistSongPicker() {
    const searchEl = document.getElementById('setlistSongPickerSearch');
    const query = searchEl ? searchEl.value.toLowerCase() : '';
    const list = document.getElementById('setlistSongPickerList');
    if (!list) return;
    list.innerHTML = '';

    const filtered = (allSongs || []).filter(s => s.title.toLowerCase().includes(query));
    if (filtered.length === 0) {
        list.innerHTML = `<div class="text-secondary text-xs px-2 py-3 text-center">${i18n.t('setlists.no_results')}</div>`;
        return;
    }

    filtered.forEach(song => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.draggable = true;
        btn.className = 'px-2 py-1.5 rounded-lg hover:bg-accent/10 hover:text-accent text-left w-full text-[0.82rem] transition-colors cursor-grab';
        btn.innerHTML = `<div class="truncate">${escapeHtml(song.title)}</div>`;
        btn.onclick = () => addSetlistSongItem(song);
        btn.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/plain', 'song:' + song.id); e.dataTransfer.effectAllowed = 'copy'; });
        list.appendChild(btn);
    });
}

function addSetlistSongItem(song) {
    _editorItems.push({ type: 'song', songId: song.id, title: song.title, songTitle: song.title, songKey: song.key || null });
    _renderSetlistItemsEditor();
    const wrap = document.querySelector('#setlist-tab-items .lyrics-editor-wrap');
    if (wrap) wrap.scrollTop = wrap.scrollHeight;
}

function addSetlistTextItem() {
    _editorItems.push({ type: 'text', sectionType: 'verse', title: '', lines: [] });
    _renderSetlistItemsEditor();
    const wrap = document.querySelector('#setlist-tab-items .lyrics-editor-wrap');
    if (wrap) wrap.scrollTop = wrap.scrollHeight;
}

function addSetlistGroupItem() {
    _editorItems.push({ type: 'group', title: '', items: [] });
    _renderSetlistItemsEditor();
    const wrap = document.querySelector('#setlist-tab-items .lyrics-editor-wrap');
    if (wrap) wrap.scrollTop = wrap.scrollHeight;
    // Focus na input nazwy nowej grupy
    requestAnimationFrame(() => {
        const groups = document.querySelectorAll('#setlistItemsList .setlist-editor-group');
        const last = groups[groups.length - 1];
        if (last) last.querySelector('input')?.focus();
    });
}

function switchSetlistItemsTab(tab, btn) {
    const editor = document.getElementById('setlistItemsList');
    const jsonTA = document.getElementById('setlistItemsJson');
    if (!editor || !jsonTA) return;

    const addBtns = document.querySelectorAll('#setlist-tab-items button[onclick="addSetlistTextItem()"], #setlist-tab-items button[onclick="addSetlistGroupItem()"]');

    // Synchronize before switching
    if (tab === 'json') {
        function exportItems(list) {
            return list.map(item => {
                if (item.type === 'song') return { type: 'song', songId: item.songId };
                if (item.type === 'group') return { type: 'group', title: item.title || '', items: exportItems(item.items || []) };
                return { type: 'text', sectionType: item.sectionType || 'verse', title: item.title || '', lines: item.lines || [] };
            });
        }
        jsonTA.value = JSON.stringify(exportItems(_editorItems), null, 2);
        editor.classList.add('hidden');
        jsonTA.classList.remove('hidden');
        addBtns.forEach(b => { b.style.opacity = '0'; b.style.pointerEvents = 'none'; });
    } else {
        try {
            const parsed = JSON.parse(jsonTA.value || '[]');
            if (Array.isArray(parsed)) _editorItems = _normalizeSetlistItems(parsed);
        } catch { showToast('error', i18n.t('common.error'), i18n.t('setlists.json_error')); return; }
        editor.classList.remove('hidden');
        jsonTA.classList.add('hidden');
        addBtns.forEach(b => { b.style.opacity = ''; b.style.pointerEvents = ''; });
        _renderSetlistItemsEditor();
    }

    // Update tab buttons
    const tabBar = btn.closest('.lyrics-tab-bar');
    if (tabBar) tabBar.querySelectorAll('.lyrics-tab').forEach(b => b.classList.toggle('active', b === btn));
}

