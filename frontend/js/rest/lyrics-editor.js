/* ==================== EDYTOR TEKSTU LYRICS V2 ==================== */

function getSectionTypes() {
	return [
		{ value: 'verse',        label: i18n.t('songs.section_verse') },
		{ value: 'chorus',       label: i18n.t('songs.section_chorus') },
		{ value: 'bridge',       label: i18n.t('songs.section_bridge') },
		{ value: 'intro',        label: i18n.t('songs.section_intro') },
		{ value: 'outro',        label: i18n.t('songs.section_outro') },
		{ value: 'interlude',    label: i18n.t('songs.section_interlude') },
		{ value: 'chorus_ref',   label: i18n.t('songs.section_chorus_reference'), sep: true },
	];
}

const SECTION_PREFIX = {
	chorus: 'c', bridge: 'b', intro: 'i', outro: 'o', interlude: 'int',
};

const EMPTY_LYRICS = { version: 2, sections: {}, order: [] };

// Resolve related DOM elements from an editor ID (e.g. 'songLyricsEditor')
function getEditorElements(editorId) {
	const prefix = editorId.replace('LyricsEditor', '');
	return {
		editor:       document.getElementById(editorId),
		jsonTextarea: document.getElementById(prefix + 'LyricsJson'),
		addBtn:       document.getElementById(prefix + 'AddSectionBtn'),
	};
}

function normalizeChordNotation(text) {
	return text.replace(/\[([^\]\n]+)\]/g, (m, inner) =>
		'[' + inner.replace(/([A-GHa-gh])#/g, '$1♯').replace(/([A-GHa-gh♯])b/g, '$1♭') + ']'
	);
}

// Load v2 sections into the visual editor from a parsed lyrics object
function loadV2Sections(editorId, data) {
	const seenIds = new Set();
	data.order.forEach(function (entry) {
		const section = data.sections[entry.id];
		if (!section) return;
		// Refren powtórzony — wstaw chorus_ref zamiast duplikować tekst
		if (section.type === 'chorus' && seenIds.has(entry.id)) {
			addEditorSection(editorId, 'chorus_ref', '', entry.repeat ?? null, entry.timestamp ?? null, null);
			return;
		}
		seenIds.add(entry.id);
		addEditorSection(editorId, section.type, normalizeChordNotation(section.lines.join('\n')), entry.repeat ?? null, entry.timestamp ?? null, entry.sheetAnchor ?? null);
	});
}

function addEditorSection(editorId, type = 'verse', text = '', repeat = null, timestamp = null, sheetAnchor = null) {
	const editor = document.getElementById(editorId);
	if (!editor) return;

	const isRef = type === 'chorus_ref';
	const currentTypeDef = getSectionTypes().find(st => st.value === type) || getSectionTypes()[0];
	const tsValue = timestamp ?? '';

	const metaChips = `
		<div class="w-px h-3.5 bg-white/10 shrink-0"></div>
		<label class="editor-meta-chip" title="${i18n.t('songs.repeat_label')}">
			<i data-lucide="repeat" class="w-3 h-3 shrink-0 text-faint"></i>
			<input type="number" class="lyrics-editor-meta-input lyrics-editor-repeat-input" min="1" placeholder="1" value="${repeat ?? ''}">
			<span class="editor-meta-chip-unit">×</span>
		</label>
		<label class="editor-meta-chip editor-ts-chip" title="${i18n.t('songs.timestamp_label')}">
			<i data-lucide="timer" class="w-3 h-3 shrink-0 text-faint"></i>
			<input type="number" class="lyrics-editor-meta-input lyrics-editor-ts-input" min="0" placeholder="—" value="${tsValue}">
			<span class="editor-meta-chip-unit">${i18n.t('common.seconds_short')}</span>
		</label>
		${isRef ? '' : `<button type="button" class="btn small secondary editor-sheet-anchor-btn" title="${i18n.t('songs.save_sheets_position')}"><i data-lucide="anchor" class="w-3.5 h-3.5"></i></button>`}
	`;

	const bodyHtml = isRef
		? `<div class="editor-chorus-ref-body"><i data-lucide="repeat-2"></i><span>${i18n.t('songs.section_chorus_reference_description')}</span></div>`
		: `<div class="lyrics-editor-textarea-wrap">
				<div class="lyrics-editor-highlight" aria-hidden="true"></div>
				<textarea class="lyrics-editor-textarea w-full" placeholder="${i18n.t('songs.text_placeholder')}"></textarea>
			</div>`;

	editor.insertAdjacentHTML('beforeend', `
		<div class="lyrics-editor-section border-b border-blue-500/10 bg-black/30 last:border-b-0${isRef ? ' lyrics-editor-section--ref' : ''}" data-type="${type}">
			<div class="flex items-center gap-1.5 px-2 py-1 bg-blue-500/[0.07] border-b border-blue-500/10">
				<div class="editor-drag-handle" title="${i18n.t('songs.drag_handle')}"><i data-lucide="grip-vertical" class="w-3.5 h-3.5"></i></div>
				<button type="button" class="editor-type-btn" data-value="${type}">
					<span class="editor-type-label">${currentTypeDef.label}</span>
					<i data-lucide="chevron-down" class="w-3 h-3 opacity-50"></i>
				</button>
				${metaChips}
				<div class="flex gap-1 ml-auto">
					<button type="button" class="btn small danger editor-remove-btn" title="${i18n.t('songs.remove_section')}"><i data-lucide="trash-2" class="w-3.5 h-3.5"></i></button>
					<div class="w-px h-3.5 bg-white/10 self-center shrink-0"></div>
					<div class="editor-section-menu-wrap">
						<button type="button" class="btn small secondary editor-menu-btn" title="${i18n.t('songs.more_options')}"><i data-lucide="ellipsis" class="w-3.5 h-3.5"></i></button>
					</div>
				</div>
			</div>
			${bodyHtml}
		</div>
	`);

	const section = editor.lastElementChild;
	const typeBtn = section.querySelector('.editor-type-btn');
	const removeBtn = section.querySelector('.editor-remove-btn');
	const menuBtn = section.querySelector('.editor-menu-btn');
	const dragHandle = section.querySelector('.editor-drag-handle');

	lucide.createIcons({ nodes: [section] });

	typeBtn.onclick = (e) => {
		e.stopPropagation();
		_openEditorTypePicker(section, editorId, typeBtn);
	};

	removeBtn.onclick = () => { section.remove(); };
	menuBtn.onclick = (e) => { e.stopPropagation(); _openEditorSectionMenu(section, editorId, menuBtn); };
	_initEditorDragHandle(dragHandle, section, editor);

	// Timestamp chip wspólny dla ref i normalnych sekcji
	const tsChipAny = section.querySelector('.editor-ts-chip');
	if (tsChipAny) {
		if (timestamp !== null) tsChipAny.classList.add('active');
		tsChipAny.addEventListener('click', (e) => {
			if (e.target.tagName === 'INPUT') return;
			editorSaveAudioAnchor(section, tsChipAny);
		});
	}

	if (!isRef) {
		const textarea = section.querySelector('.lyrics-editor-textarea');
		const sheetAnchorBtn = section.querySelector('.editor-sheet-anchor-btn');
		const highlight = section.querySelector('.lyrics-editor-highlight');

		textarea.value = text;
		if (sheetAnchor !== null) {
			section.dataset.sheetAnchor = JSON.stringify(sheetAnchor);
			sheetAnchorBtn.classList.add('active');
			sheetAnchorBtn.title = i18n.t('songs.change_sheets_position');
		}

		sheetAnchorBtn.onclick = () => editorSaveSheetAnchor(section);

		function syncHighlight() {
			const escaped = textarea.value
				.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
				.replace(/\[([^\]\n]+)\]/g, (_, inner) => `<span class="chord-highlight">[${inner}]</span>`);
			highlight.innerHTML = escaped + '\n';
		}
		section._syncHighlight = syncHighlight;
		textarea.addEventListener('input', () => {
			const pos = textarea.selectionStart;
			const before = textarea.value;
			const after = normalizeChordNotation(before);
			if (after !== before) {
				const diff = after.length - before.length;
				textarea.value = after;
				textarea.selectionStart = textarea.selectionEnd = pos + diff;
			}
			delete textarea.dataset.originalValue;
			autoResizeTextarea(textarea);
			syncHighlight();
		});
		textarea.addEventListener('scroll', () => { highlight.scrollTop = textarea.scrollTop; });
		syncHighlight();
		requestAnimationFrame(() => autoResizeTextarea(textarea));
	}
	_applyEditorMediaContext(editor);
}

/* ==================== TRANSPOZYCJA W EDYTORZE ==================== */

function _editorApplyTranspose(text, semitones) {
	if (!semitones) return text;
	const norm = ((semitones % 12) + 12) % 12;
	const preferFlats = [1, 3, 5, 6, 8, 10].includes(norm);
	return text.replace(/\[([^\]\n]+)\]/g, (m, chord) => {
		const match = chord.match(/^([A-GHa-gh][♯♭#b]?)(.*)/);
		if (!match) return m;
		const [, root, suffix] = match;
		const isMinor = root === root.toLowerCase() && root !== root.toUpperCase();
		const rootIdx = CHORD_MAP[root];
		if (rootIdx === undefined) return m;
		const newIdx = ((rootIdx + semitones) % 12 + 12) % 12;
		const names = isMinor
			? (preferFlats ? CHORD_NAMES_FLAT_MINOR : CHORD_NAMES_SHARP_MINOR)
			: (preferFlats ? CHORD_NAMES_FLAT : CHORD_NAMES_SHARP);
		return '[' + names[newIdx] + suffix + ']';
	});
}

const _editorTransposeState = {};

function editorTransposeBake(editorId, delta) {
	const editor = document.getElementById(editorId);
	if (!editor) return;
	const current = _editorTransposeState[editorId] ?? 0;
	const next = current + delta;
	if (next < -12 || next > 12) return;
	editor.querySelectorAll('.lyrics-editor-section').forEach(section => {
		const textarea = section.querySelector('.lyrics-editor-textarea');
		if (!textarea) return;
		if (!textarea.dataset.originalValue) textarea.dataset.originalValue = textarea.value;
		textarea.value = _editorApplyTranspose(textarea.dataset.originalValue, next);
		section._syncHighlight?.();
		autoResizeTextarea(textarea);
	});
	_editorTransposeState[editorId] = next;
	_updateEditorTransposeDisplay(editorId);
}

function _updateEditorTransposeDisplay(editorId) {
	const val = _editorTransposeState[editorId] ?? 0;
	const text = val === 0 ? '0' : (val > 0 ? `+${val}` : `${val}`);
	document.querySelectorAll(`[data-editor-transpose-display="${editorId}"]`).forEach(el => {
		el.textContent = text;
		el.classList.toggle('text-accent', val !== 0);
		el.classList.toggle('text-secondary', val === 0);
	});
	document.querySelectorAll(`[data-editor-transpose-down="${editorId}"]`).forEach(btn => { btn.disabled = val <= -12; });
	document.querySelectorAll(`[data-editor-transpose-up="${editorId}"]`).forEach(btn => { btn.disabled = val >= 12; });
}

/* ==================== MENU KONTEKSTOWE SEKCJI ==================== */

/* ==================== PICKER TYPU SEKCJI ==================== */

function _openEditorTypePicker(section, editorId, anchorBtn) {
	// Toggle — zamknij jeśli ten sam anchor jest już otwarty
	if (_activeEditorPopup?._anchor === anchorBtn) { closeEditorPopup(); return; }
	closeEditorPopup();

	const currentType = section.dataset.type || 'verse';
	const menu = document.createElement('div');
	menu.className = 'editor-section-menu editor-type-picker';
	menu.innerHTML = getSectionTypes().map(st => `
		${st.sep ? '<div class="editor-menu-sep"></div>' : ''}
		<button type="button" class="editor-menu-item${st.value === currentType ? ' editor-menu-item--active' : ''}" data-value="${st.value}">
			<i data-lucide="check" style="${st.value === currentType ? '' : 'visibility:hidden'}"></i>
			${st.label}
		</button>
	`).join('');

	_showEditorPopup(menu, anchorBtn, 'left');

	menu.addEventListener('click', (e) => {
		const btn = e.target.closest('[data-value]');
		if (!btn) return;
		closeEditorPopup();
		_applyEditorTypeChange(section, editorId, btn.dataset.value);
	});
}

function _applyEditorTypeChange(section, editorId, newType) {
	const oldType = section.dataset.type;
	if (oldType === newType) return;

	const typeDef = getSectionTypes().find(st => st.value === newType);
	if (!typeDef) return;

	// Zaktualizuj etykietę i data-value na przycisku
	section.dataset.type = newType;
	const typeBtn = section.querySelector('.editor-type-btn');
	if (typeBtn) {
		typeBtn.dataset.value = newType;
		typeBtn.querySelector('.editor-type-label').textContent = typeDef.label;
	}

	// Zmiana między ref a normalną — przebuduj sekcję
	const wasRef = oldType === 'chorus_ref';
	const isNowRef = newType === 'chorus_ref';
	if (wasRef !== isNowRef) {
		const editor = document.getElementById(editorId);
		const repeatInput = section.querySelector('.lyrics-editor-repeat-input');
		const tsInput = section.querySelector('.lyrics-editor-ts-input');
		const textarea = section.querySelector('.lyrics-editor-textarea');
		const r = repeatInput ? parseInt(repeatInput.value) || null : null;
		const ts = tsInput?.value !== '' ? parseInt(tsInput.value) : null;
		const anchor = section.dataset.sheetAnchor ? JSON.parse(section.dataset.sheetAnchor) : null;
		const curText = textarea?.value || '';
		const next = section.nextElementSibling;
		section.remove();
		addEditorSection(editorId, newType, curText, r, ts, anchor);
		const rebuilt = editor.lastElementChild;
		if (next) editor.insertBefore(rebuilt, next);
	}
}

/* ==================== DRAG & DROP SEKCJI ==================== */

function _initEditorDragHandle(handle, section, editor) {
	handle.addEventListener('mousedown', (e) => {
		e.preventDefault();
		_startEditorDrag(e.clientY, section, editor);
	});
	handle.addEventListener('touchstart', (e) => {
		e.preventDefault();
		_startEditorDrag(e.touches[0].clientY, section, editor);
	}, { passive: false });
}

function _startEditorDrag(startY, section, editor) {
	closeEditorPopup();

	const EASING = 'cubic-bezier(0.25, 1, 0.5, 1)';
	const DURATION = 200;

	const sectionH = section.offsetHeight;
	const sectionW = section.offsetWidth;
	const offsetY  = startY - section.getBoundingClientRect().top;

	// --- Sekcja unosi się absolute ---
	const editorRect = editor.getBoundingClientRect();
	const sectionRect = section.getBoundingClientRect();

	// Placeholder trzyma miejsce w flow
	const ph = document.createElement('div');
	ph.className = 'editor-drag-placeholder';
	ph.style.height = sectionH + 'px';
	ph.style.transition = `height ${DURATION}ms ${EASING}`;
	editor.insertBefore(ph, section);

	editor.style.position = 'relative';
	section.classList.add('editor-section--dragging');
	section.style.width  = sectionW + 'px';
	section.style.top    = (sectionRect.top - editorRect.top + editor.scrollTop) + 'px';
	section.style.left   = '0';

	function _sectionOrder(ed, skip) {
		return [...ed.querySelectorAll('.lyrics-editor-section')]
			.filter(s => s !== skip)
			.map(s => ({ el: s, top: s.getBoundingClientRect().top }));
	}

	function _flipOthers(before) {
		// Czytaj nowe pozycje po zmianie DOM
		before.forEach(({ el, top: prevTop }) => {
			const nowTop = el.getBoundingClientRect().top;
			const dy = prevTop - nowTop;
			if (Math.abs(dy) < 1) return;
			// Skocz od razu do poprzedniej pozycji (bez animacji)
			el.style.transition = 'none';
			el.style.transform  = `translateY(${dy}px)`;
			// Wymuś reflow żeby przeglądarka "widziała" translateY
			el.offsetHeight; // eslint-disable-line no-unused-expressions
			// Teraz animuj do 0
			el.style.transition = `transform ${DURATION}ms ${EASING}`;
			el.style.transform  = '';
			el.addEventListener('transitionend', () => {
				el.style.transition = '';
				el.style.transform  = '';
			}, { once: true });
		});
	}

	function movePlaceholder(clientY) {
		const midY = clientY - offsetY + sectionH / 2;
		let target = null;
		for (const s of editor.querySelectorAll('.lyrics-editor-section')) {
			if (s === section) continue;
			const r = s.getBoundingClientRect();
			if (midY < r.top + r.height / 2) { target = s; break; }
		}
		const newNext = target;
		const curNext = ph.nextElementSibling;
		if (curNext === newNext) return; // nie zmienił się

		const before = _sectionOrder(editor, section);
		if (newNext) editor.insertBefore(ph, newNext);
		else         editor.appendChild(ph);
		_flipOthers(before);
	}

	function onMove(e) {
		const clientY = e.clientY ?? e.touches?.[0]?.clientY;
		// Przesuń unoszoną sekcję
		const top = clientY - editorRect.top - offsetY + editor.scrollTop;
		section.style.top = Math.max(0, top) + 'px';
		movePlaceholder(clientY);
	}

	function onEnd(e) {
		document.removeEventListener('mousemove', onMove);
		document.removeEventListener('mouseup',   onEnd);
		document.removeEventListener('touchmove', onMove);
		document.removeEventListener('touchend',  onEnd);

		// Pozycja wizualna unoszonej sekcji
		const floatTop = section.getBoundingClientRect().top;

		// Zdejmij styl dragging i wstaw w docelowe miejsce
		const before = _sectionOrder(editor, section);
		section.classList.remove('editor-section--dragging');
		section.style.width = '';
		section.style.top   = '';
		section.style.left  = '';
		editor.style.position = '';
		editor.insertBefore(section, ph);
		ph.remove();

		// Animuj pozostałe sekcje które się ruszyły
		_flipOthers(before);

		// Animuj samą przeciąganą sekcję — FLIP z pozycji float → landing
		const landTop = section.getBoundingClientRect().top;
		const dy = floatTop - landTop;
		if (Math.abs(dy) > 1) {
			section.style.transition = 'none';
			section.style.transform  = `translateY(${dy}px)`;
			section.offsetHeight; // reflow
			section.style.transition = `transform ${DURATION}ms ${EASING}`;
			section.style.transform  = '';
			section.addEventListener('transitionend', () => {
				section.style.transition = '';
				section.style.transform  = '';
			}, { once: true });
		}
	}

	document.addEventListener('mousemove', onMove);
	document.addEventListener('mouseup',   onEnd);
	document.addEventListener('touchmove', onMove, { passive: true });
	document.addEventListener('touchend',  onEnd);
}

/* ==================== WSPÓLNY SYSTEM POPUPÓW EDYTORA ==================== */

let _activeEditorPopup = null;

function _showEditorPopup(menu, anchorBtn, align = 'right') {
	menu._anchor = anchorBtn;
	document.body.appendChild(menu);
	lucide.createIcons({ nodes: [menu] });
	_activeEditorPopup = menu;

	const btnRect = anchorBtn.getBoundingClientRect();
	requestAnimationFrame(() => {
		const menuW = menu.offsetWidth;
		const menuH = menu.offsetHeight;
		let left = align === 'left' ? btnRect.left : btnRect.right - menuW;
		let top = btnRect.bottom + 4;
		if (top + menuH > window.innerHeight - 8) top = btnRect.top - menuH - 4;
		if (left + menuW > window.innerWidth - 8) left = window.innerWidth - menuW - 8;
		if (left < 8) left = 8;
		menu.style.left = left + 'px';
		menu.style.top = top + 'px';
	});

	setTimeout(() => {
		document.addEventListener('click', _onEditorPopupOutsideClick);
	}, 0);
}

function _onEditorPopupOutsideClick(e) {
	if (_activeEditorPopup && !_activeEditorPopup.contains(e.target)) {
		closeEditorPopup();
	}
}

function closeEditorPopup() {
	if (!_activeEditorPopup) return;
	_activeEditorPopup.remove();
	_activeEditorPopup = null;
	document.removeEventListener('click', _onEditorPopupOutsideClick);
}

/* ==================== MENU KONTEKSTOWE SEKCJI ==================== */

function _openEditorSectionMenu(section, editorId, anchorBtn) {
	// Toggle — zamknij jeśli ten sam anchor jest już otwarty
	if (_activeEditorPopup?._anchor === anchorBtn) { closeEditorPopup(); return; }
	closeEditorPopup();

	const editor = document.getElementById(editorId);
	const isFirst = !section.previousElementSibling;
	const isLast = !section.nextElementSibling;

	const menu = document.createElement('div');
	menu.className = 'editor-section-menu';
	menu.innerHTML = `
		<button type="button" class="editor-menu-item" data-action="move-top" ${isFirst ? 'disabled' : ''}><i data-lucide="chevrons-up"></i> ${i18n.t('songs.move_to_top')}</button>
		<button type="button" class="editor-menu-item" data-action="move-up" ${isFirst ? 'disabled' : ''}><i data-lucide="chevron-up"></i> ${i18n.t('songs.move_up')}</button>
		<button type="button" class="editor-menu-item" data-action="move-down" ${isLast ? 'disabled' : ''}><i data-lucide="chevron-down"></i> ${i18n.t('songs.move_down')}</button>
		<button type="button" class="editor-menu-item" data-action="move-bottom" ${isLast ? 'disabled' : ''}><i data-lucide="chevrons-down"></i> ${i18n.t('songs.move_to_bottom')}</button>
		<div class="editor-menu-sep"></div>
		<button type="button" class="editor-menu-item" data-action="duplicate"><i data-lucide="copy"></i> ${i18n.t('songs.duplicate_section')}</button>
	`;

	_showEditorPopup(menu, anchorBtn, 'right');

	menu.addEventListener('click', (e) => {
		const btn = e.target.closest('[data-action]');
		if (!btn || btn.disabled) return;
		const action = btn.dataset.action;
		closeEditorPopup();
		if (action === 'move-up') {
			const prev = section.previousElementSibling;
			if (prev) editor.insertBefore(section, prev);
		} else if (action === 'move-down') {
			const next = section.nextElementSibling;
			if (next) editor.insertBefore(next, section);
		} else if (action === 'move-top') {
			editor.insertBefore(section, editor.firstElementChild);
		} else if (action === 'move-bottom') {
			editor.appendChild(section);
		} else if (action === 'duplicate') {
			_duplicateEditorSection(section, editorId);
		}
	});
}

function _duplicateEditorSection(section, editorId) {
	const editor = document.getElementById(editorId);
	const type = section.dataset.type || 'verse';
	const textarea = section.querySelector('.lyrics-editor-textarea');
	const repeatInput = section.querySelector('.lyrics-editor-repeat-input');
	const tsInput = section.querySelector('.lyrics-editor-ts-input');
	const sheetAnchor = section.dataset.sheetAnchor ? JSON.parse(section.dataset.sheetAnchor) : null;

	const repeat = repeatInput?.value ? parseInt(repeatInput.value) : null;
	const ts = tsInput?.value !== '' ? parseInt(tsInput.value) : null;

	// Wstaw za bieżącą sekcją
	const next = section.nextElementSibling;
	addEditorSection(editorId, type, textarea?.value || '', repeat, ts, sheetAnchor);
	const newSection = editor.lastElementChild;
	if (next) editor.insertBefore(newSection, next);
}

function collapseEditorBtn(btn, collapse) {
	if (collapse) {
		btn.classList.remove('editor-btn-collapsed-done');
		btn.classList.add('editor-btn-collapsed');
		btn.addEventListener('transitionend', function handler(e) {
			if (e.propertyName !== 'opacity') return;
			btn.removeEventListener('transitionend', handler);
			btn.classList.add('editor-btn-collapsed-done');
		});
	} else {
		btn.classList.remove('editor-btn-collapsed-done');
		btn.offsetHeight;
		btn.classList.remove('editor-btn-collapsed');
	}
}

const _fieldSizingSupported = CSS.supports('field-sizing', 'content');

function autoResizeTextarea(textarea) {
	if (_fieldSizingSupported) return;
	if (textarea.offsetParent === null || textarea.clientWidth === 0) {
		const lines = (textarea.value.match(/\n/g) || []).length + 1;
		textarea.style.height = (lines * 1.5 * 13 + 16) + 'px';
		return;
	}
	textarea.style.height = '0';
	textarea.style.height = textarea.scrollHeight + 'px';
}

function resizeAllTextareas(editorId) {
	const editor = document.getElementById(editorId);
	if (!editor) return;
	editor.querySelectorAll('.lyrics-editor-textarea').forEach(t => autoResizeTextarea(t));
}

// Ukryj/pokaż anchor nut i timestampy w zależności od dostępności plików
function setEditorMediaContext(editorId, hasAudio, hasSheets) {
	const editor = document.getElementById(editorId);
	if (!editor) return;
	// Zapisz kontekst żeby nowe sekcje też go respektowały
	editor.dataset.hasAudio  = hasAudio  ? '1' : '';
	editor.dataset.hasSheets = hasSheets ? '1' : '';
	_applyEditorMediaContext(editor);
}

function _applyEditorMediaContext(editor) {
	const hasAudio  = !!editor.dataset.hasAudio;
	const hasSheets = !!editor.dataset.hasSheets;
	editor.querySelectorAll('.lyrics-editor-section').forEach(section => {
		const anchorBtn = section.querySelector('.editor-sheet-anchor-btn');
		const tsChip    = section.querySelector('.editor-ts-chip');
		if (anchorBtn) setElementDisplay(anchorBtn, hasSheets);
		if (tsChip)    setElementDisplay(tsChip, hasAudio);
	});
}

function clearEditor(editorId) {
	const editor = document.getElementById(editorId);
	if (!editor) return;
	editor.innerHTML = '';
	_editorTransposeState[editorId] = 0;
	_updateEditorTransposeDisplay(editorId);
}

// Zbierz dane z edytora i stwórz format v2
function _isValidLyricsV2(data) {
	if (!data || typeof data !== 'object' || Array.isArray(data)) return false;
	if (data.version !== 2 || !data.sections || typeof data.sections !== 'object' || Array.isArray(data.sections)) return false;
	if (!Array.isArray(data.order)) return false;

	const sectionsValid = Object.values(data.sections).every(section =>
		section
		&& typeof section === 'object'
		&& !Array.isArray(section)
		&& typeof section.type === 'string'
		&& Array.isArray(section.lines)
		&& section.lines.every(line => typeof line === 'string')
	);
	if (!sectionsValid) return false;

	return data.order.every(entry =>
		entry
		&& typeof entry === 'object'
		&& !Array.isArray(entry)
		&& (typeof entry.id === 'string' || typeof entry.id === 'number')
		&& Object.hasOwn(data.sections, entry.id)
	);
}

function collectEditorData(editorId) {
	const { jsonTextarea } = getEditorElements(editorId);
	if (jsonTextarea && !jsonTextarea.classList.contains('hidden')) {
		try {
			const data = JSON.parse(jsonTextarea.value.trim());
			if (!_isValidLyricsV2(data)) throw new Error('Invalid lyrics structure');
			return data;
		} catch {
			showToast('error', i18n.t('common.error'), i18n.t('songs.json_error'));
			return undefined;
		}
	}
	return collectEditorDataVisual(editorId);
}

// Załaduj dane v2 (lub stare) do edytora
function loadEditorData(editorId, lyricsRaw, lyrics) {
	clearEditor(editorId);

	const { editor, jsonTextarea, addBtn } = getEditorElements(editorId);

	// Reset do trybu wizualnego
	if (editor)       editor.classList.remove('hidden');
	if (jsonTextarea) jsonTextarea.classList.add('hidden');
	if (addBtn) { addBtn.classList.remove('editor-btn-collapsed-done', 'editor-btn-collapsed'); }

	const tabBar = editor?.closest('[id$="-tab-lyrics"]')?.querySelector('.lyrics-tab-bar');
	if (tabBar) {
		tabBar.querySelectorAll('.lyrics-tab').forEach(function (b, i) { b.classList.toggle('active', i === 0); });
	}

	if (lyricsRaw && lyricsRaw.version === 2) {
		loadV2Sections(editorId, lyricsRaw);
	} else if (Array.isArray(lyrics) && lyrics.length > 0) {
		lyrics.forEach(function (lyric) {
			const text = (lyric.text || '')
				.replace(/<p>/gi, '')
				.replace(/<\/p>/gi, '\n')
				.replace(/<br\s*\/?>/gi, '\n')
				.trim();
			addEditorSection(editorId, lyric.type || 'verse', text);
		});
	}

	if (jsonTextarea) {
		jsonTextarea.value = JSON.stringify(lyricsRaw || EMPTY_LYRICS, null, 2);
	}
}

// Przełącz podkładki edytora tekstu (Wizualny / JSON)
function switchLyricsTab(editorId, mode, btn) {
	const { editor, jsonTextarea, addBtn } = getEditorElements(editorId);
	if (!editor || !jsonTextarea) return;

	const isJson = mode === 'json';

	if (isJson) {
		const data = collectEditorDataVisual(editorId);
		jsonTextarea.value = JSON.stringify(data || EMPTY_LYRICS, null, 2);
	} else {
		try {
			const parsed = JSON.parse(jsonTextarea.value.trim());
			if (parsed && parsed.version === 2) {
				clearEditor(editorId);
				loadV2Sections(editorId, parsed);
			}
		} catch { /* zostaw jak jest */ }
	}

	setElementDisplay(document.getElementById('songEditorTranspose'), !isJson)
	editor.classList.toggle('hidden', isJson);
	jsonTextarea.classList.toggle('hidden', !isJson);
	if (addBtn) collapseEditorBtn(addBtn, isJson);

	btn.closest('.lyrics-tab-bar').querySelectorAll('.lyrics-tab').forEach(function (b) { b.classList.remove('active'); });
	btn.classList.add('active');
}

// Zbierz tylko z wizualnego edytora
function collectEditorDataVisual(editorId) {
	const editor = document.getElementById(editorId);
	if (!editor) return null;

	const sectionEls = editor.querySelectorAll('.lyrics-editor-section');
	if (sectionEls.length === 0) return null;

	const sections = {};
	const order = [];
	const typeCounts = {};
	const textToId = new Map();
	let firstChorusId = null;

	sectionEls.forEach(el => {
		const type = el.dataset.type || 'verse';

		// chorus_ref — wstaw ref do pierwszego refrenu bez definiowania sekcji
		if (type === 'chorus_ref') {
			if (!firstChorusId) return;
			const tsInput = el.querySelector('.lyrics-editor-ts-input');
			const tsVal = tsInput ? parseInt(tsInput.value) : NaN;
			const ts = !isNaN(tsVal) && tsInput?.value !== '' ? tsVal : null;
			const entry = { id: firstChorusId };
			if (ts !== null) entry.timestamp = ts;
			order.push(entry);
			return;
		}

		const textarea = el.querySelector('.lyrics-editor-textarea');
		const text = (textarea?.value)?.trim() || '';
		if (!text) return;

		const repeatInput = el.querySelector('.lyrics-editor-repeat-input');
		const tsInput     = el.querySelector('.lyrics-editor-ts-input');
		const repeatVal = repeatInput ? parseInt(repeatInput.value) || null : null;
		const tsVal     = tsInput ? parseInt(tsInput.value) : NaN;
		const timestamp = !isNaN(tsVal) && tsInput?.value !== '' ? tsVal : null;

		const lines = normalizeChordNotation(text).split('\n').filter(l => l.trim() !== '');
		const dedupeKey = type + ':' + lines.join('\n');

		let sectionId;
		if (textToId.has(dedupeKey)) {
			sectionId = textToId.get(dedupeKey);
		} else {
			if (!typeCounts[type]) typeCounts[type] = 0;
			typeCounts[type]++;
			const pfx = SECTION_PREFIX[type] || 'v';
			sectionId = pfx + typeCounts[type];
			sections[sectionId] = { type, lines };
			textToId.set(dedupeKey, sectionId);
		}

		if (type === 'chorus' && !firstChorusId) firstChorusId = sectionId;

		const entry = { id: sectionId };
		if (repeatVal != null && repeatVal > 1) entry.repeat = repeatVal;
		if (timestamp != null) entry.timestamp = timestamp;
		if (el.dataset.sheetAnchor) {
			try { entry.sheetAnchor = JSON.parse(el.dataset.sheetAnchor); } catch { /* ignoruj */ }
		}
		order.push(entry);
	});

	if (order.length === 0) return null;
	return { version: 2, sections, order };
}

/* ==================== MINI-VIEWER I MINI-PLAYER W MODALU EDYCJI ==================== */

let _editorSheetZoom = 1;
let _editorTranslateX = 0;
let _editorTranslateY = 0;
let _editModalSheetCleanup = null;
let _editModalAudioCleanup = null;

function initEditModalSheet(songId) {
	_editModalSheetCleanup?.();
	_editModalSheetCleanup = null;
	const viewer = document.getElementById('songSheetViewer');
	if (!viewer) return;

	// Klonuj viewer żeby usunąć stare event listenery
	const freshViewer = viewer.cloneNode(false);
	viewer.parentNode.replaceChild(freshViewer, viewer);
	const v = freshViewer;
	const controller = new AbortController();
	const { signal } = controller;

	_editorSheetZoom = 1;
	_editorTranslateX = 0;
	_editorTranslateY = 0;
	const editFitBtn = document.querySelector('[data-action="editor-zoom-reset"]');
	if (editFitBtn) setElementDisplay(editFitBtn, false);

	const img = document.createElement('img');
	img.alt = 'Nuty';
	img.style.width = '100%';
	img.style.height = 'auto';
	img.style.transformOrigin = 'center top';
	img.style.transform = 'scale(1) translate(0px, 0px)';
	v.appendChild(img);

	img.onload = () => {
		_editorSheetZoom = 1;
		_editorTranslateX = 0;
		_editorTranslateY = 0;
		_editorUpdateSheetTransform(v, img);
	};
	img.src = songMediaUrl('sheets', songId);

	let isDragging = false, startX = 0, startY = 0, startTX = 0, startTY = 0;

	v.addEventListener('mousedown', (e) => {
		isDragging = true;
		startX = e.clientX; startY = e.clientY;
		startTX = _editorTranslateX; startTY = _editorTranslateY;
		e.preventDefault();
	});
	document.addEventListener('mousemove', (e) => {
		if (!isDragging) return;
		e.preventDefault();
		_editorTranslateX = startTX + (e.clientX - startX) / _editorSheetZoom;
		_editorTranslateY = startTY + (e.clientY - startY) / _editorSheetZoom;
		_editorUpdateSheetTransform(v, img);
	}, { signal });
	document.addEventListener('mouseup', () => { isDragging = false; }, { signal });

	v.addEventListener('touchstart', (e) => {
		isDragging = true;
		startX = e.touches[0].clientX; startY = e.touches[0].clientY;
		startTX = _editorTranslateX; startTY = _editorTranslateY;
		e.preventDefault();
	}, { passive: false });
	v.addEventListener('touchmove', (e) => {
		if (!isDragging) return;
		e.preventDefault();
		_editorTranslateX = startTX + (e.touches[0].clientX - startX) / _editorSheetZoom;
		_editorTranslateY = startTY + (e.touches[0].clientY - startY) / _editorSheetZoom;
		_editorUpdateSheetTransform(v, img);
	}, { passive: false });
	v.addEventListener('touchend', () => { isDragging = false; });

	v.addEventListener('wheel', (e) => {
		e.preventDefault();
		_editorSheetZoom = Math.max(0.25, Math.min(5, _editorSheetZoom - e.deltaY * 0.001));
		_editorUpdateSheetTransform(v, img);
	}, { passive: false });

	_editModalSheetCleanup = () => {
		controller.abort();
		isDragging = false;
	};
}

function _editorUpdateSheetTransform(viewer, img) {
	if (!img) {
		img = document.querySelector('#songSheetViewer img');
		if (!img) return;
	}
	img.style.transform = `scale(${_editorSheetZoom}) translate(${_editorTranslateX}px, ${_editorTranslateY}px)`;
	_editorUpdateFitBtn();
}

function _editorUpdateFitBtn() {
	const btn = document.querySelector('[data-action="editor-zoom-reset"]');
	if (!btn) return;

	const epsilon = 0.0001;
	const isAtFit = Math.abs(_editorSheetZoom - 1) < epsilon
		&& Math.abs(_editorTranslateX) < epsilon
		&& Math.abs(_editorTranslateY) < epsilon;
	setElementDisplay(btn, !isAtFit);
}

function editModalZoomSheet(delta) {
	if (delta === 0) {
		_editorSheetZoom = 1;
		_editorTranslateX = 0;
		_editorTranslateY = 0;
	} else {
		_editorSheetZoom = Math.max(0.25, Math.min(5, _editorSheetZoom + delta));
	}
	_editorUpdateSheetTransform();
}

function editorGetSheetAnchor() {
	const viewer = document.getElementById('songSheetViewer');
	const img = viewer?.querySelector('img');
	if (!viewer || !img) return null;
	const imgCssHeight = img.getBoundingClientRect().height / _editorSheetZoom || img.clientHeight;
	if (!imgCssHeight) return null;
	const viewerHeight = viewer.clientHeight;
	const centerPx = -_editorTranslateY + viewerHeight / (2 * _editorSheetZoom);
	return {
		y: Math.max(0, Math.min(1, centerPx / imgCssHeight)),
		relativeZoom: _editorSheetZoom,
	};
}

function initEditModalAudio(songId) {
	_editModalAudioCleanup?.();
	_editModalAudioCleanup = null;
	const audio = document.getElementById('editModalAudioPlayer');
	if (!audio) return;

	// Zastąp element audio klonem żeby usunąć stare event listenery
	const fresh = audio.cloneNode(true);
	audio.parentNode.replaceChild(fresh, audio);
	const a = fresh;

	a.querySelector('source').src = songMediaUrl('audio', songId);
	a.load();

	const progressContainer = document.getElementById('editModalProgressContainer');
	const progressFill = document.getElementById('editModalProgressFill');
	const currentTimeEl = document.getElementById('editModalCurrentTime');
	const totalTimeEl = document.getElementById('editModalTotalTime');

	const updateProgress = () => {
		if (!a.duration) return;
		progressFill.style.width = (a.currentTime / a.duration * 100) + '%';
		currentTimeEl.textContent = formatTime(a.currentTime);
		totalTimeEl.textContent = formatTime(a.duration);
	};

	const updatePlayIcon = (playing) => {
		const btn = document.getElementById('editModalPlayPauseBtn');
		if (btn) { btn.innerHTML = `<i data-lucide="${playing ? 'pause' : 'play'}"></i>`; lucide.createIcons({ nodes: [btn] }); }
	};

	let rafId;
	a.addEventListener('play', function tick() { updateProgress(); rafId = requestAnimationFrame(tick); });
	a.addEventListener('play', () => updatePlayIcon(true));
	a.addEventListener('pause', () => { cancelAnimationFrame(rafId); updatePlayIcon(false); });
	a.addEventListener('ended', () => { cancelAnimationFrame(rafId); updatePlayIcon(false); });
	a.addEventListener('loadedmetadata', () => { totalTimeEl.textContent = formatTime(a.duration); });

	const seek = (e) => {
		const bar = document.getElementById('editModalProgressBar');
		const rect = bar.getBoundingClientRect();
		const x = (e.clientX ?? e.touches?.[0]?.clientX) || 0;
		a.currentTime = Math.max(0, Math.min(1, (x - rect.left) / rect.width)) * a.duration;
	};
	progressContainer.addEventListener('click', seek);

	_editModalAudioCleanup = () => {
		a.pause();
		progressContainer.removeEventListener('click', seek);
		cancelAnimationFrame(rafId);
	};
}

function editModalTogglePlayPause() {
	const audio = document.querySelector('#songAudioPlayer audio');
	if (!audio) return;
	audio.paused ? audio.play() : audio.pause();
}

function editorSaveSheetAnchor(section) {
	const anchor = editorGetSheetAnchor();
	if (anchor === null) { showToast('error', i18n.t('songs.no_sheets_title'), i18n.t('songs.no_sheets_description')); return; }
	section.dataset.sheetAnchor = JSON.stringify(anchor);
	const btn = section.querySelector('.editor-sheet-anchor-btn');
	if (btn) { btn.classList.add('active'); btn.title = i18n.t('songs.change_sheets_position'); }
	showToast('success', i18n.t('songs.sheets_pos_saved'));
}

function editorSaveAudioAnchor(section, chip) {
	const audio = document.querySelector('#songAudioPlayer audio');
	if (!audio || !audio.currentSrc || audio.readyState === 0) { showToast('error', i18n.t('songs.no_audio_title'), i18n.t('songs.no_audio_description')); return; }
	const ts = Math.floor(audio.currentTime);
	const tsInput = section.querySelector('.lyrics-editor-ts-input');
	if (tsInput) tsInput.value = ts;
	if (chip) chip.classList.add('active');
	showToast('success', i18n.t('songs.timestamp_set', { time: formatTime(ts) }));
}
