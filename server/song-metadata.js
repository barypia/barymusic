// Metadane utworów: walidacja oraz mapowanie na formaty OpenLyrics i ChordPro.

const AUTHOR_ROLES = ['music', 'words', 'translation', 'arranger', 'artist'];
const DEFAULT_AUTHOR_ROLE = 'music';
const MAX_LIST_ITEMS = 50;
const MAX_AUTHORS = MAX_LIST_ITEMS + 1;
const MAX_TEXT_LENGTH = 200;
const MAX_COMMENT_LENGTH = 1000;
const LANG_PATTERN = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/;
const RELEASED_PATTERN = /^\d{1,4}(?:-\d{2}(?:-\d{2})?)?(?!\d)/;
const DURATION_PATTERN = /^(?:\d{1,2}:\d{2}(?::\d{2})?|\d{1,5})$/;
const CCLI_PATTERN = /^\d{1,12}$/;

const OPENLYRICS_AUTHOR_TYPES = { music: 'music', words: 'words', translation: 'translation', arranger: 'arrangement' };
const OPENLYRICS_ROLES = {
	music: 'music',
	words: 'words',
	translation: 'translation',
	translator: 'translation',
	arrangement: 'arranger',
	arranger: 'arranger',
};
const CHORDPRO_AUTHOR_DIRECTIVES = { artist: 'artist', music: 'composer', words: 'lyricist', arranger: 'arranger' };
const CHORDPRO_DIRECTIVE_ROLES = Object.fromEntries(
	Object.entries(CHORDPRO_AUTHOR_DIRECTIVES).map(([role, directive]) => [directive, role])
);
const CHORDPRO_ALIASES = { t: 'title', st: 'subtitle' };
const CHORDPRO_METADATA = new Set([
	'title', 'sorttitle', 'subtitle', 'artist', 'composer', 'lyricist', 'arranger', 'copyright', 'album',
	'year', 'key', 'time', 'tempo', 'duration', 'capo', 'tag',
]);

function asArray(value) {
	if (value == null) return [];
	return Array.isArray(value) ? value : [value];
}

function escapeXml(value) {
	return String(value ?? '')
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&apos;');
}

function xmlText(value) {
	return typeof value === 'object' ? value?.['#text'] || '' : value;
}

function cleanText(value, maxLength = MAX_TEXT_LENGTH) {
	if (value == null || typeof value === 'object') return null;
	return String(value).replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, maxLength) || null;
}

function cleanMatching(value, pattern, maxLength) {
	const text = cleanText(value, maxLength);
	return text && pattern.test(text) ? text : null;
}

function cleanLang(value) {
	return cleanMatching(value, LANG_PATTERN, 35);
}

function cleanReleased(value) {
	return cleanText(value, 40)?.match(RELEASED_PATTERN)?.[0] ?? null;
}

function cleanInteger(value, min, max) {
	if (value == null || value === '') return null;
	const number = Number(value);
	return Number.isInteger(number) && number >= min && number <= max ? number : null;
}

function cleanList(value, normalizeItem, maxItems = MAX_LIST_ITEMS) {
	return asArray(value).slice(0, maxItems).map(normalizeItem).filter(Boolean);
}

function compact(object) {
	return Object.fromEntries(Object.entries(object).filter(([, value]) => value != null));
}

function normalizeTitle(item) {
	const { text, lang, translit, original } = item && typeof item === 'object' ? item : { text: item };
	const title = cleanText(text);
	if (!title) return null;
	return compact({
		text: title,
		lang: cleanLang(lang),
		translit: cleanLang(translit),
		original: original === true || original === 'true' ? true : null,
	});
}

function normalizeAuthor(item) {
	const { name, type, lang } = item && typeof item === 'object' ? item : { name: item };
	const author = cleanText(name);
	if (!author) return null;
	return compact({
		name: author,
		type: AUTHOR_ROLES.includes(type) ? type : DEFAULT_AUTHOR_ROLE,
		lang: cleanLang(lang),
	});
}

function normalizeSongbook(item) {
	const { name, entry } = item && typeof item === 'object' ? item : { name: item };
	const songbook = cleanText(name);
	if (!songbook) return null;
	return compact({ name: songbook, entry: cleanText(entry, 50) });
}

function normalizeKeywords(value) {
	const items = typeof value === 'string' ? value.split(',') : value;
	return normalizeTags(cleanList(items, item => cleanText(item, 100)));
}

function normalizeTags(value) {
	const seen = new Set();
	return asArray(value).filter(item => item != null && typeof item !== 'object')
		.map(item => String(item).replace(/[\u0000-\u001f\u007f]+/g, ' ').trim())
		.filter(tag => {
			if (!tag) return false;
			const key = tag.toLowerCase();
			if (seen.has(key)) return false;
			seen.add(key);
			return true;
		});
}

/**
 * Zwraca metadane w stałym kształcie: listy są zawsze tablicami, pozostałe pola są wartością lub null.
 * `legacy` pozwala przenieść pola sprzed wprowadzenia metadanych (composer, year).
 */
function normalizeMetadata(input, legacy = {}) {
	const source = input && typeof input === 'object' ? input : {};
	const metadata = {
		lang: cleanLang(source.lang),
		titles: cleanList(source.titles, normalizeTitle),
		sortTitle: cleanText(source.sortTitle),
		authors: cleanList(source.authors, normalizeAuthor, MAX_AUTHORS),
		copyright: cleanText(source.copyright),
		ccliNo: cleanMatching(source.ccliNo, CCLI_PATTERN, 12),
		released: cleanReleased(source.released) ?? cleanReleased(legacy.year),
		album: cleanText(source.album),
		publisher: cleanText(source.publisher),
		variant: cleanText(source.variant),
		customVersion: cleanText(source.customVersion),
		songbooks: cleanList(source.songbooks, normalizeSongbook),
		comments: cleanList(source.comments, item => cleanText(item, MAX_COMMENT_LENGTH)),
		transposition: cleanInteger(source.transposition, -11, 11) || null,
		capo: cleanInteger(source.capo, 1, 24),
		duration: cleanMatching(source.duration, DURATION_PATTERN, 20),
		tempoText: cleanText(source.tempoText, 100),
	};
	const composer = cleanText(legacy.composer);
	if (composer && !metadata.authors.some(author => author.type === 'music' && author.name.toLowerCase() === composer.toLowerCase())) {
		metadata.authors.push({ name: composer, type: 'music' });
	}
	return metadata;
}

function songComposerFromMetadata(input) {
	return normalizeMetadata(parseMetadata(input)).authors.find(author => author.type === 'music')?.name ?? null;
}

function parseMetadata(raw) {
	if (typeof raw !== 'string') return raw;
	try {
		return JSON.parse(raw);
	} catch {
		return null;
	}
}

/** Postać zapisywana w bazie: bez pustych pól, `null` gdy nie ma żadnych metadanych. */
function serializeMetadata(metadata) {
	const filled = Object.fromEntries(
		Object.entries(metadata).filter(([, value]) => Array.isArray(value) ? value.length : value != null)
	);
	return Object.keys(filled).length ? JSON.stringify(filled) : null;
}

function yearFromMetadata(metadata) {
	return metadata.released ? Number(metadata.released.slice(0, 4)) : null;
}

// OpenLyrics

function xmlElement(tag, content, attributes = {}) {
	if (content == null || content === '') return '';
	const attrs = Object.entries(attributes)
		.filter(([, value]) => value != null && value !== false)
		.map(([name, value]) => ` ${name}="${escapeXml(value === true ? 'true' : value)}"`)
		.join('');
	return `<${tag}${attrs}>${escapeXml(content)}</${tag}>`;
}

function xmlGroup(tag, items) {
	return items.length ? `<${tag}>${items.join('')}</${tag}>` : '';
}

function openLyricsProperties(song) {
	const { metadata } = song;
	const hasBpm = song.bpm != null && song.bpm !== '' && Number.isFinite(Number(song.bpm));
	return [
		xmlGroup('titles', [
			xmlElement('title', song.title),
			...metadata.titles.map(title => xmlElement('title', title.text, {
				lang: title.lang,
				translit: title.translit,
				original: title.original,
			})),
		]),
		xmlGroup('authors', metadata.authors
			.filter(author => OPENLYRICS_AUTHOR_TYPES[author.type])
			.map(author => xmlElement('author', author.name, {
				type: OPENLYRICS_AUTHOR_TYPES[author.type],
				lang: author.type === 'translation' ? author.lang : null,
			}))),
		xmlElement('copyright', metadata.copyright),
		xmlElement('ccliNo', metadata.ccliNo),
		xmlElement('released', metadata.released),
		xmlElement('transposition', metadata.transposition),
		hasBpm
			? xmlElement('tempo', song.bpm, { type: 'bpm' })
			: xmlElement('tempo', metadata.tempoText ?? song.bpm, { type: 'text' }),
		xmlElement('key', song.key),
		xmlElement('timeSignature', song.timeSignature),
		xmlElement('variant', metadata.variant),
		xmlElement('publisher', metadata.publisher),
		xmlElement('version', metadata.customVersion),
		xmlGroup('songbooks', metadata.songbooks.map(songbook =>
			`<songbook name="${escapeXml(songbook.name)}"${songbook.entry ? ` entry="${escapeXml(songbook.entry)}"` : ''}/>`)),
		xmlGroup('themes', song.tags.map(tag => xmlElement('theme', tag))),
		xmlGroup('comments', metadata.comments.map(comment => xmlElement('comment', comment))),
	].filter(Boolean).map(line => `    ${line}`);
}

/** Pola utworu z elementu <song> sparsowanego przez fast-xml-parser (bez tytułu głównego i tekstu). */
function songPropertiesFromOpenLyrics(root) {
	const props = root.properties || {};
	const text = value => xmlText(asArray(value)[0]);
	const tempo = asArray(props.tempo)[0];
	const tempoValue = String(xmlText(tempo) ?? '').trim();
	const isBpm = tempo?.['@_type'] !== 'text' && /^\d+(?:\.\d+)?$/.test(tempoValue);
	return {
		tags: normalizeTags([
			...asArray(props.themes?.theme).map(xmlText),
			...normalizeKeywords(text(props.keywords)),
		]),
		bpm: isBpm ? Number(tempoValue) : null,
		key: text(props.key) || null,
		timeSignature: text(props.timeSignature) || null,
		metadata: {
			lang: root['@_lang'] ?? root['@_xml:lang'],
			titles: asArray(props.titles?.title).slice(1).map(title => ({
				text: xmlText(title),
				lang: title?.['@_lang'],
				translit: title?.['@_translit'],
				original: title?.['@_original'],
			})),
			authors: asArray(props.authors?.author).map(author => ({
				name: xmlText(author),
				type: OPENLYRICS_ROLES[author?.['@_type']],
				lang: author?.['@_lang'],
			})),
			copyright: text(props.copyright),
			ccliNo: text(props.ccliNo),
			released: text(props.released),
			transposition: text(props.transposition),
			tempoText: isBpm ? null : tempoValue,
			variant: text(props.variant),
			publisher: text(props.publisher),
			customVersion: text(props.version ?? props.customVersion),
			songbooks: asArray(props.songbooks?.songbook).map(songbook => ({
				name: songbook?.['@_name'],
				entry: songbook?.['@_entry'],
			})),
			comments: asArray(props.comments?.comment).map(xmlText),
		},
	};
}

// ChordPro

/** Lista par [dyrektywa, wartość] w kolejności zapisu; puste wartości są pomijane przez wywołującego. */
function chordProMetadata(song) {
	const { metadata } = song;
	return [
		['title', song.title],
		['sorttitle', metadata.sortTitle],
		...metadata.titles.map(title => ['subtitle', title.text]),
		...Object.entries(CHORDPRO_AUTHOR_DIRECTIVES).flatMap(([role, directive]) =>
			metadata.authors.filter(author => author.type === role).map(author => [directive, author.name])),
		['copyright', metadata.copyright],
		['album', metadata.album],
		['year', song.year],
		['key', song.key],
		['time', song.timeSignature],
		['tempo', song.bpm ?? metadata.tempoText],
		['duration', metadata.duration],
		['capo', metadata.capo],
		...song.tags.map(tag => ['tag', tag]),
	];
}

/** Zwraca kanoniczną nazwę dyrektywy metadanych ChordPro albo null, gdy to nie metadana. */
function chordProMetadataName(name) {
	const canonical = CHORDPRO_ALIASES[name] || name;
	return CHORDPRO_METADATA.has(canonical) ? canonical : null;
}

function songPropertiesFromChordPro(entries) {
	const values = name => entries.filter(([key]) => key === name).map(([, value]) => value);
	const first = name => values(name)[0];
	const tempo = first('tempo');
	const isBpm = /^\d+(?:\.\d+)?$/.test(tempo ?? '');
	return {
		title: first('title'),
		tags: values('tag'),
		bpm: isBpm ? Number(tempo) : null,
		key: first('key'),
		timeSignature: first('time'),
		metadata: {
			released: first('year'),
			sortTitle: first('sorttitle'),
			titles: values('subtitle'),
			authors: Object.entries(CHORDPRO_DIRECTIVE_ROLES).flatMap(([directive, type]) =>
				values(directive).map(name => ({ name, type }))),
			copyright: first('copyright'),
			album: first('album'),
			duration: first('duration'),
			capo: first('capo'),
			tempoText: isBpm ? null : tempo,
		},
	};
}

module.exports = {
	AUTHOR_ROLES,
	asArray,
	chordProMetadata,
	chordProMetadataName,
	escapeXml,
	normalizeMetadata,
	normalizeKeywords,
	normalizeTags,
	openLyricsProperties,
	parseMetadata,
	serializeMetadata,
	songComposerFromMetadata,
	songPropertiesFromChordPro,
	songPropertiesFromOpenLyrics,
	xmlText,
	yearFromMetadata,
};
