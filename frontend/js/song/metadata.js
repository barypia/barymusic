/* ==================== METADANE UTWORU ==================== */

const METADATA_AUTHOR_ROLES = ['music', 'words', 'translation', 'arranger', 'artist'];
const METADATA_MAX_ROWS = 50;
const METADATA_MAX_AUTHORS = METADATA_MAX_ROWS + 1;

const METADATA_PATTERNS = {
	released: /^\d{4}(?:-\d{2}(?:-\d{2})?)?$/,
	ccliNo: /^\d{1,12}$/,
	duration: /^(?:\d{1,2}:\d{2}(?::\d{2})?|\d{1,5})$/,
	lang: /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/,
};

// Jedna konfiguracja pól dla formularza, modalu i filtrów.
// kind: text | number | chips | rows (lista wierszy z kolumnami).
const METADATA_SECTIONS = [
	{
		id: 'people',
		icon: 'users',
		fields: [
			{
				key: 'authors', kind: 'rows', columns: [
					{ key: 'name', kind: 'text' },
					{ key: 'type', kind: 'role' },
					{ key: 'lang', kind: 'text', narrow: true },
				],
			},
		],
	},
	{
		id: 'release',
		icon: 'calendar',
		fields: [
			{ key: 'released', kind: 'text', placeholder: true },
			{ key: 'publisher', kind: 'text' },
			{ key: 'copyright', kind: 'text' },
			{ key: 'ccliNo', kind: 'text', placeholder: true },
			{ key: 'album', kind: 'text' },
			{
				key: 'songbooks', kind: 'rows', columns: [
					{ key: 'name', kind: 'text' },
					{ key: 'entry', kind: 'text', narrow: true },
				],
			},
		],
	},
	{
		id: 'performance',
		icon: 'guitar',
		fields: [
			{ key: 'key', kind: 'text' },
			{ key: 'timeSignature', kind: 'text' },
			{ key: 'bpm', kind: 'number', min: 1, max: 999 },
			{ key: 'capo', kind: 'number', min: 1, max: 24 },
			{ key: 'transposition', kind: 'number', min: -11, max: 11 },
			{ key: 'duration', kind: 'text', placeholder: true },
			{ key: 'tempoText', kind: 'text', placeholder: true },
			{ key: 'variant', kind: 'text' },
			{ key: 'customVersion', kind: 'text' },
		],
	},
	{
		id: 'other',
		icon: 'info',
		fields: [
			{
				key: 'titles', kind: 'rows', columns: [
					{ key: 'text', kind: 'text' },
					{ key: 'lang', kind: 'text', narrow: true },
					{ key: 'translit', kind: 'text', narrow: true },
					{ key: 'original', kind: 'checkbox' },
				],
			},
			{ key: 'sortTitle', kind: 'text' },
			{ key: 'lang', kind: 'text', placeholder: true },
			{ key: 'comments', kind: 'rows', columns: [{ key: 'text', kind: 'text' }] },
		],
	},
];

// Pola, po których można filtrować wartościami (kolejność = kolejność w menu).
const METADATA_VALUE_FILTERS = [
	{ key: 'authors', icon: 'user-round' },
	{ key: 'songbooks', icon: 'book-open' },
	{ key: 'publisher', icon: 'building-2' },
	{ key: 'album', icon: 'disc-3' },
	{ key: 'copyright', icon: 'copyright' },
	{ key: 'ccliNo', icon: 'barcode' },
];

const METADATA_SEARCH_KEYS = [
	'titles', 'sortTitle', 'authors', 'copyright', 'ccliNo', 'released', 'album',
	'publisher', 'variant', 'customVersion', 'songbooks', 'comments',
];

const EMPTY_METADATA = Object.freeze({ titles: [], authors: [], songbooks: [], comments: [] });

const _metadataFields = METADATA_SECTIONS.flatMap(section => section.fields);

// Pola, dla których można filtrować "ma / nie ma wartości".
const METADATA_PRESENCE_FIELDS = _metadataFields.map(field => field.key);

function _metaId(key) {
	return `songMeta_${key}`;
}

function _hasMetadataValue(value) {
	return Array.isArray(value) ? value.length > 0 : value != null && value !== '';
}

function getSongMetadata(song) {
	return { ...EMPTY_METADATA, ...(song?.metadata || {}) };
}

// Wartości pola jako lista tekstów (do filtrów, wyszukiwarki i sprawdzania, czy pole jest wypełnione).
function metadataValues(metadata, key) {
	const value = metadata[key];
	if (Array.isArray(value)) {
		return value.map(item => typeof item === 'object' ? item.name ?? item.text : item).filter(_hasMetadataValue);
	}
	return _hasMetadataValue(value) ? [String(value)] : [];
}

function metadataPresenceValues(song, key) {
	if (['key', 'timeSignature', 'bpm'].includes(key)) {
		const value = song?.[key];
		return _hasMetadataValue(value) ? [String(value)] : [];
	}
	return metadataValues(getSongMetadata(song), key);
}

function metadataAuthorNames(song) {
	return [...new Set(metadataValues(getSongMetadata(song), 'authors'))];
}

/* ---------- Formularz ---------- */

function _metadataFieldHtml(field) {
	const id = _metaId(field.key);
	const label = `songs.metadata.${field.key}`;
	const placeholder = field.placeholder ? ` data-i18n="songs.metadata.placeholder_${field.key}"` : '';
	if (field.kind === 'rows') {
		return `<div class="list-item">
			<div class="list-item__text">
				<div class="list-item__title" data-i18n="${label}"></div>
				<div class="metadata-rows" id="${id}"></div>
				<button type="button" class="btn secondary small self-start" onclick="addMetadataRow('${field.key}')">
					<i data-lucide="plus"></i><span data-i18n="songs.metadata.add_row"></span>
				</button>
			</div>
		</div>`;
	}
	const control = field.kind === 'chips'
		? `<div class="tag-editor" id="${id}" onclick="tagEditorFocus(this)">
				<input type="text" class="tag-editor-input"${placeholder} autocomplete="off" onkeydown="tagEditorKeydown(event, '${id}')" oninput="tagEditorInput(event, '${id}')">
			</div>`
		: `<input type="${field.kind === 'number' ? 'number' : 'text'}" id="${id}" maxlength="200"${placeholder}${field.kind === 'number' ? ` min="${field.min}" max="${field.max}"` : ''}>`;
	return `<div class="list-item">
		<div class="list-item__text"><label for="${id}" class="list-item__title" data-i18n="${label}"></label></div>
		${control}
	</div>`;
}

function buildMetadataForm() {
	const root = document.getElementById('songMetadataSections');
	if (!root || root.dataset.built) return;
	root.dataset.built = '1';
	root.innerHTML = METADATA_SECTIONS.map(section => `
		<details class="list-group metadata-section" data-section="${section.id}">
			<summary class="list-group__title">
				<i data-lucide="${section.icon}"></i>
				<span data-i18n="songs.metadata.section_${section.id}"></span>
				<i data-lucide="chevron-down" class="metadata-section__chevron"></i>
			</summary>
			<div class="metadata-section__content">
				<div class="metadata-section__content-inner">${section.fields.map(_metadataFieldHtml).join('')}</div>
			</div>
		</details>`).join('');
	root.addEventListener('click', _handleMetadataSectionClick);
	i18n.translatePage();
}

const _metadataSectionTransitions = new WeakMap();

function _cancelMetadataSectionTransition(details) {
	const transition = _metadataSectionTransitions.get(details);
	if (!transition) return;
	clearTimeout(transition.timeout);
	transition.content.removeEventListener('transitionend', transition.onEnd);
	_metadataSectionTransitions.delete(details);
}

function _metadataTransitionDuration(content) {
	const style = getComputedStyle(content);
	const toMilliseconds = value => value.trim().endsWith('ms')
		? parseFloat(value)
		: parseFloat(value) * 1000;
	const durations = style.transitionDuration.split(',').map(toMilliseconds);
	const delays = style.transitionDelay.split(',').map(toMilliseconds);
	return Math.max(0, ...durations.map((duration, index) => duration + (delays[index % delays.length] || 0)));
}

function _handleMetadataSectionClick(event) {
	const summary = event.target.closest?.('summary');
	const details = summary?.parentElement;
	if (!details?.matches('.metadata-section')) return;
	event.preventDefault();

	const content = details.querySelector('.metadata-section__content');
	if (!content) return;
	_cancelMetadataSectionTransition(details);

	if (!details.open) {
		details.classList.add('metadata-section--collapsed');
		details.open = true;
		requestAnimationFrame(() => {
			if (details.open && !details.classList.contains('metadata-section--closing')) {
				details.classList.remove('metadata-section--collapsed');
			}
		});
		return;
	}

	if (details.classList.contains('metadata-section--closing')) {
		details.classList.remove('metadata-section--closing', 'metadata-section--collapsed');
		return;
	}

	details.classList.add('metadata-section--closing', 'metadata-section--collapsed');
	const finishClosing = event => {
		if (event && (event.target !== content || event.propertyName !== 'grid-template-rows')) return;
		const transition = _metadataSectionTransitions.get(details);
		if (!transition) return;
		_cancelMetadataSectionTransition(details);
		if (!details.classList.contains('metadata-section--closing')) return;
		details.open = false;
		details.classList.remove('metadata-section--closing', 'metadata-section--collapsed');
	};

	const duration = _metadataTransitionDuration(content);
	if (duration < 1) {
		details.open = false;
		details.classList.remove('metadata-section--closing', 'metadata-section--collapsed');
		return;
	}
	const transition = {
		onEnd: finishClosing,
		timeout: setTimeout(finishClosing, duration + 50),
	};
	_metadataSectionTransitions.set(details, transition);
	content.addEventListener('transitionend', finishClosing);
}

function _metadataColumnElement(column, value) {
	const labelKey = `songs.metadata.col_${column.key}`;
	if (column.kind === 'role') {
		const select = document.createElement('select');
		select.className = 'metadata-row__field';
		select.dataset.col = column.key;
		METADATA_AUTHOR_ROLES.forEach(role => {
			const option = new Option(i18n.t(`songs.metadata.role_${role}`), role);
			option.dataset.i18n = `songs.metadata.role_${role}`;
			select.appendChild(option);
		});
		select.value = METADATA_AUTHOR_ROLES.includes(value) ? value : METADATA_AUTHOR_ROLES[0];
		return select;
	}
	if (column.kind === 'checkbox') {
		const label = document.createElement('label');
		label.className = 'metadata-row__check';
		const input = document.createElement('input');
		input.type = 'checkbox';
		input.checked = value === true;
		input.dataset.col = column.key;
		const text = document.createElement('span');
		text.dataset.i18n = labelKey;
		text.textContent = i18n.t(labelKey);
		label.append(input, text);
		return label;
	}
	const input = document.createElement('input');
	input.type = 'text';
	input.maxLength = 200;
	input.className = `metadata-row__field${column.narrow ? ' metadata-row__field--narrow' : ''}`;
	input.dataset.col = column.key;
	input.dataset.i18n = labelKey;
	input.placeholder = i18n.t(labelKey);
	input.value = value ?? '';
	return input;
}

function addMetadataRow(fieldKey, values = {}) {
	const field = _metadataFields.find(item => item.key === fieldKey);
	const container = document.getElementById(_metaId(fieldKey));
	if (!field || !container) return;

	const row = document.createElement('div');
	row.className = 'metadata-row';
	field.columns.forEach(column => row.appendChild(_metadataColumnElement(column, values[column.key])));

	const remove = document.createElement('button');
	remove.type = 'button';
	remove.className = 'btn small danger';
	remove.dataset.i18nTitle = 'common.delete';
	remove.title = i18n.t('common.delete');
	remove.innerHTML = '<i data-lucide="trash"></i>';
	remove.onclick = () => row.remove();
	row.appendChild(remove);

	container.appendChild(row);
	lucide.createIcons({ nodes: [row] });
}

// Listy z jedną kolumną (np. komentarze) są zapisywane jako zwykłe teksty.
function _rowToValue(row, field) {
	const read = column => {
		const element = row.querySelector(`[data-col="${column.key}"]`);
		return column.kind === 'checkbox' ? element.checked : element.value.trim();
	};
	if (field.columns.length === 1) return read(field.columns[0]);
	return Object.fromEntries(field.columns.map(column => [column.key, read(column)]));
}

function _valueToRow(value, field) {
	return typeof value === 'object' ? value : { [field.columns[0].key]: value };
}

function fillMetadataForm(metadataInput = null) {
	const metadata = { ...EMPTY_METADATA, ...(metadataInput || {}) };
	for (const field of _metadataFields) {
		const element = document.getElementById(_metaId(field.key));
		if (!element) continue;
		const value = metadata[field.key];
		if (field.kind === 'chips') tagEditorSetTags(element.id, value || []);
		else if (field.kind === 'rows') {
			element.replaceChildren();
			(value || []).forEach(item => addMetadataRow(field.key, _valueToRow(item, field)));
		} else element.value = value ?? '';
	}
	document.querySelectorAll('#songMetadataSections .metadata-section').forEach(details => {
		const section = METADATA_SECTIONS.find(item => item.id === details.dataset.section);
		details.open = section.fields.some(field => _hasMetadataValue(metadata[field.key]));
	});
}

function collectMetadata() {
	const metadata = {};
	for (const field of _metadataFields) {
		const element = document.getElementById(_metaId(field.key));
		if (!element) continue;
		if (field.kind === 'chips') metadata[field.key] = tagEditorGetTags(element.id);
		else if (field.kind === 'rows') metadata[field.key] = [...element.querySelectorAll('.metadata-row')].map(row => _rowToValue(row, field));
		else if (field.kind === 'number') {
			const number = parseInt(element.value, 10);
			metadata[field.key] = Number.isFinite(number) ? number : null;
		} else metadata[field.key] = element.value.trim() || null;
	}
	return metadata;
}

// Zwraca komunikat o pierwszym niepoprawnym polu albo null.
function validateMetadataForm() {
	for (const [key, pattern] of Object.entries(METADATA_PATTERNS)) {
		const element = document.getElementById(_metaId(key));
		const value = element?.value.trim();
		if (value && !pattern.test(value)) {
			return i18n.t('songs.metadata.invalid_value', { field: i18n.t(`songs.metadata.${key}`) });
		}
	}
	for (const field of _metadataFields.filter(item => item.kind === 'number')) {
		const value = document.getElementById(_metaId(field.key))?.value.trim();
		if (value && !(Number.isInteger(Number(value)) && Number(value) >= field.min && Number(value) <= field.max)) {
			return i18n.t('songs.metadata.invalid_value', { field: i18n.t(`songs.metadata.${field.key}`) });
		}
	}
	for (const field of _metadataFields.filter(item => item.kind === 'rows')) {
		const container = document.getElementById(_metaId(field.key));
		const rows = [...(container?.querySelectorAll('.metadata-row') || [])];
		const limit = field.key === 'authors' ? METADATA_MAX_AUTHORS : METADATA_MAX_ROWS;
		if (rows.length > limit) {
			return i18n.t('songs.metadata.too_many_rows', {
				field: i18n.t(`songs.metadata.${field.key}`),
				limit,
			});
		}
		for (const column of field.columns.filter(item => item.key === 'lang')) {
			for (const row of rows) {
				const value = row.querySelector(`[data-col="${column.key}"]`)?.value.trim();
				if (value && !METADATA_PATTERNS.lang.test(value)) {
					return i18n.t('songs.metadata.invalid_value', { field: i18n.t('songs.metadata.lang') });
				}
			}
		}
	}
	return null;
}

/* ---------- Modal "Metadane utworu" ---------- */

let _metadataModalSong = null;

function _metadataDisplayLines(key, value) {
	switch (key) {
		case 'authors':
			return value.map(author => `${author.name} — ${i18n.t(`songs.metadata.role_${author.type}`)}${author.lang ? ` (${author.lang})` : ''}`);
		case 'songbooks':
			return value.map(songbook => songbook.entry ? `${songbook.name} #${songbook.entry}` : songbook.name);
		case 'titles':
			return value.map(title => {
				const extra = [
					title.lang,
					title.translit && `${i18n.t('songs.metadata.col_translit')}: ${title.translit}`,
					title.original && i18n.t('songs.metadata.col_original'),
				].filter(Boolean).join(', ');
				return extra ? `${title.text} (${extra})` : title.text;
			});
		case 'comments':
			return value;
		case 'transposition':
			return [value > 0 ? `+${value}` : String(value)];
		default:
			return [String(value)];
	}
}

function _metadataModalGroups(song) {
	const metadata = getSongMetadata(song);
	const basicRows = [
		['songs.title_label', song.title],
		['songs.tags_label', Array.isArray(song.tags) && song.tags.length ? song.tags.join(', ') : null],
		['songs.key_label', song.key],
		['songs.time_signature_label', song.timeSignature],
		['songs.bpm_label', song.bpm],
		['songs.metadata.uploaded_by', song.uploadedByUsername],
	].filter(([, value]) => _hasMetadataValue(value)).map(([label, value]) => ({ label, lines: [String(value)] }));

	// Wyklucz key, timeSignature, bpm z sekcji Wykonanie w modalu — są już w Podstawowe.
	const basicKeys = new Set(['key', 'timeSignature', 'bpm']);
	return [
		{ title: 'songs.metadata.section_basic', rows: basicRows },
		...METADATA_SECTIONS.map(section => ({
			title: `songs.metadata.section_${section.id}`,
			rows: section.fields
				.filter(field => !basicKeys.has(field.key) && _hasMetadataValue(metadata[field.key]))
				.map(field => ({ label: `songs.metadata.${field.key}`, lines: _metadataDisplayLines(field.key, metadata[field.key]) })),
		})),
	].filter(group => group.rows.length > 0);
}

function _metadataModalGroupElement(group) {
	const box = document.createElement('div');
	box.className = 'list-group';
	const title = document.createElement('span');
	title.className = 'list-group__title';
	title.textContent = i18n.t(group.title);
	box.appendChild(title);
	group.rows.forEach(row => {
		const item = document.createElement('div');
		item.className = 'list-item items-start!';
		const label = document.createElement('div');
		label.className = 'list-item__desc metadata-view__label';
		label.textContent = i18n.t(row.label);
		const values = document.createElement('div');
		values.className = 'list-item__text select-text';
		row.lines.forEach(line => {
			const element = document.createElement('div');
			element.className = 'list-item__title break-words';
			element.textContent = line;
			values.appendChild(element);
		});
		item.append(label, values);
		box.appendChild(item);
	});
	return box;
}

function openSongMetadataModal(song = currentSong) {
	if (!song) return;
	_metadataModalSong = song;
	document.getElementById('songMetadataBody').replaceChildren(
		..._metadataModalGroups(song).map(_metadataModalGroupElement)
	);
	updateAddSongButtonVisibility('songMetadataEditBtn', song.uploadedBy ?? null);
	openModal('songMetadataModal');
}

function editSongFromMetadataModal() {
	const song = _metadataModalSong;
	_metadataModalSong = null;
	closeAllModals();
	// Zamknięcie modalu ma opóźnione usuwanie backdropu (setTimeout 250 ms).
	// Otwórz modal edycji po krótkim opóźnieniu, aby backdrop był poprawnie przywrócony.
	if (song) setTimeout(() => editSong(song), 260);
}

/* ---------- Filtry i wyszukiwarka ---------- */

function uniqueMetadataValues(songs, key) {
	return [...new Set(songs.flatMap(song => metadataValues(getSongMetadata(song), key)))]
		.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
}

// filters: { values: { [klucz]: [wartości lub null] }, has: [klucze], missing: [klucze] }
function matchesMetadataFilters(song, filters) {
	const metadata = getSongMetadata(song);
	const matchesValues = Object.entries(filters.values).every(([key, selected]) => {
		if (selected.length === 0) return true;
		const values = metadataValues(metadata, key);
		return selected.some(item => item === null ? values.length === 0 : values.includes(item));
	});
	return matchesValues
		&& filters.has.every(key => metadataPresenceValues(song, key).length > 0)
		&& filters.missing.every(key => metadataPresenceValues(song, key).length === 0);
}

function isMetadataFilterActive(filters) {
	return Object.values(filters.values).some(selected => selected.length > 0)
		|| filters.has.length > 0
		|| filters.missing.length > 0;
}

const _songSearchCache = new WeakMap();

function songSearchText(song) {
	const metadata = getSongMetadata(song);
	const tagsText = Array.isArray(song.tags) ? song.tags.join('\n') : '';
	const cached = _songSearchCache.get(song);
	if (cached?.metadata === song.metadata && cached.title === song.title && cached.tagsText === tagsText) return cached.text;
	const entries = metadata.songbooks.map(songbook => songbook.entry).filter(Boolean);
	const text = [song.title, tagsText, ...METADATA_SEARCH_KEYS.flatMap(key => metadataValues(metadata, key)), ...entries]
		.join('\n')
		.toLocaleLowerCase();
	_songSearchCache.set(song, { metadata: song.metadata, title: song.title, tagsText, text });
	return text;
}

window.addEventListener('i18nReady', buildMetadataForm);
