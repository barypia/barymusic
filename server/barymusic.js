const http = require('http');
const WebSocket = require('ws');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcrypt');
const { rateLimit, ipKeyGenerator } = require('express-rate-limit');
const cookieParser = require('cookie-parser');
const fs = require('fs');
const multer = require('multer');
const sharp = require('sharp');
const os = require('os');
const crypto = require('crypto');
const { ZipArchive } = require('archiver');
const unzipper = require('unzipper');
const { XMLParser } = require('fast-xml-parser');

// Formaty wymiany danych
const SECTION_PREFIX = {
	verse: 'v',
	chorus: 'c',
	bridge: 'b',
	intro: 'i',
	outro: 'o',
	interlude: 'int',
};
const PREFIX_SECTION = Object.fromEntries(Object.entries(SECTION_PREFIX).map(([section, prefix]) => [prefix, section]));
const SECTION_TYPES = new Set(Object.keys(SECTION_PREFIX));
const CHORDPRO_SECTION_STARTS = { soc: 'chorus', sov: 'verse', sob: 'bridge' };
const CHORDPRO_SECTION_ENDS = new Set(['eoc', 'eov', 'eob']);
const CHORDPRO_METADATA = new Set(['title', 't', 'composer', 'year', 'key', 'time', 'tempo', 'tag']);
const CHORDPRO_IGNORED = new Set(['new_song', 'ns']);

function transferWarning(code, values = {}) {
	return { code, values };
}

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

function decodeXml(value) {
	return String(value ?? '')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"')
		.replace(/&apos;/g, "'")
		.replace(/&amp;/g, '&');
}

function xmlText(value) {
	return typeof value === 'object' ? value?.['#text'] || '' : value;
}

function expandSectionOrder(order) {
	return order.flatMap(item => Array.from(
		{ length: Math.max(1, Number(item.repeat) || 1) },
		() => item
	));
}

function safeLyrics(raw) {
	if (raw && raw.version === 2 && raw.sections && Array.isArray(raw.order)) return raw;
	if (!Array.isArray(raw)) return { version: 2, sections: {}, order: [] };
	const sections = Object.create(null);
	const order = [];
	raw.forEach((entry, index) => {
		const type = entry?.type || 'verse';
		const id = `${SECTION_PREFIX[type] || 'v'}${index + 1}`;
		const text = String(entry?.text || '')
			.replace(/<br\s*\/?\s*>/gi, '\n')
			.replace(/<\/?p>/gi, '');
		sections[id] = { type, lines: text.split(/\r?\n/) };
		order.push({ id });
	});
	return { version: 2, sections, order };
}

function normalizeSong(song = {}) {
	let lyrics = song.lyricsRaw ?? song.lyrics ?? { version: 2, sections: {}, order: [] };
	if (typeof lyrics === 'string') lyrics = parseJson(lyrics, []);

	let tags = song.tags ?? song.type ?? [];
	if (typeof tags === 'string') tags = parseJson(tags, tags ? [tags] : []);

	return {
		archiveId: String(song.archiveId ?? song.id ?? ''),
		title: String(song.title || '').trim(),
		tags: asArray(tags).map(value => String(value).trim()).filter(Boolean),
		bpm: song.bpm == null || song.bpm === '' ? null : Number(song.bpm),
		key: song.key || null,
		timeSignature: song.timeSignature || null,
		composer: song.composer || null,
		year: song.year == null || song.year === '' ? null : Number(song.year),
		lyrics: safeLyrics(lyrics),
		isPublic: song.isPublic !== false && song.isPublic !== 0,
		createdAt: song.createdAt ?? null,
		media: song.media || {},
	};
}

function normalizeOpenLpChord(chord) {
	return String(chord || '').trim()
		.replace(/♭/g, 'b')
		.replace(/♯/g, '#')
		.replace(/^([=(|]*)([a-h])/, (_match, prefix, root) => prefix + root.toUpperCase())
		.replace(/\/([a-h])(?=$|[b#])/, (_match, bass) => '/' + bass.toUpperCase());
}

function lineToOpenLyrics(line) {
	let cursor = 0;
	let output = '';
	const chordPattern = /\[([^\]\n]+)\]/g;
	for (let match; (match = chordPattern.exec(line));) {
		output += escapeXml(line.slice(cursor, match.index));
		output += `<chord name="${escapeXml(normalizeOpenLpChord(match[1]))}"/>`;
		cursor = match.index + match[0].length;
	}
	return output + escapeXml(line.slice(cursor));
}

function songToOpenLyrics(input) {
	const song = normalizeSong(input);
	if (!song.title) throw new Error('Song title is required');

	const order = expandSectionOrder(song.lyrics.order);
	const properties = [
		`    <titles><title>${escapeXml(song.title)}</title></titles>`,
		song.composer ? `    <authors><author type="music">${escapeXml(song.composer)}</author></authors>` : '',
		song.year ? `    <released>${escapeXml(song.year)}</released>` : '',
		song.bpm ? `    <tempo>${escapeXml(song.bpm)}</tempo>` : '',
		song.key ? `    <key>${escapeXml(song.key)}</key>` : '',
		song.timeSignature ? `    <timeSignature>${escapeXml(song.timeSignature)}</timeSignature>` : '',
		song.tags.length ? `    <themes>${song.tags.map(tag => `<theme>${escapeXml(tag)}</theme>`).join('')}</themes>` : '',
		order.length ? `    <verseOrder>${order.map(item => escapeXml(item.id)).join(' ')}</verseOrder>` : '',
	].filter(Boolean).join('\n');

	const seen = new Set();
	const verses = [];
	for (const entry of order) {
		if (seen.has(entry.id)) continue;
		const section = song.lyrics.sections[entry.id];
		if (!section) continue;
		seen.add(entry.id);
		verses.push(`    <verse name="${escapeXml(entry.id)}"><lines>${(section.lines || []).map(lineToOpenLyrics).join('<br/>')}</lines></verse>`);
	}
	return `<?xml version="1.0" encoding="UTF-8"?>\n<song xmlns="http://openlyrics.info/namespace/2009/song" version="0.8" createdIn="BaryMusic" modifiedIn="BaryMusic">\n  <properties>\n${properties}\n  </properties>\n  <lyrics>\n${verses.join('\n')}\n  </lyrics>\n</song>\n`;
}

function getXmlAttribute(attrs, name) {
	const match = String(attrs).match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, 'i'));
	return match ? decodeXml(match[1]) : '';
}

function openLyricsLineText(xml) {
	return decodeXml(String(xml)
		.replace(/<chord\b([^>]*)\/?\s*>/gi, (_m, attrs) => {
			const name = getXmlAttribute(attrs, 'name');
			if (name) return `[${name}]`;

			const root = getXmlAttribute(attrs, 'root');
			const structure = getXmlAttribute(attrs, 'structure');
			const bass = getXmlAttribute(attrs, 'bass');
			return root ? `[${root}${structure}${bass ? `/${bass}` : ''}]` : '';
		})
		.replace(/<br\s*\/?\s*>/gi, '\n')
		.replace(/<comment\b[^>]*>.*?<\/comment>/gis, '')
		.replace(/<[^>]+>/g, ''));
}

function songFromOpenLyrics(xml) {
	if (Buffer.byteLength(String(xml), 'utf8') > MAX_TEXT_FILE_SIZE) throw new Error('OpenLyrics file is too large');
	if (/<!\s*(?:DOCTYPE|ENTITY)\b/i.test(xml)) throw new Error('OpenLyrics DTD declarations are not supported');
	const parser = new XMLParser({
		ignoreAttributes: false,
		attributeNamePrefix: '@_',
		removeNSPrefix: true,
		parseTagValue: false,
		trimValues: false,
	});
	let parsed;
	try {
		parsed = parser.parse(xml);
	} catch (error) {
		throw new Error(`Invalid OpenLyrics XML: ${error.message}`);
	}

	const root = parsed?.song;
	if (!root) throw new Error('OpenLyrics <song> element is missing');
	const props = root.properties || {};
	const title = xmlText(asArray(props.titles?.title)[0]);
	if (!title) throw new Error('OpenLyrics title is missing');
	const version = String(root['@_version'] || '');
	if (version && !['0.8', '0.9'].includes(version)) throw new Error(`Unsupported OpenLyrics version: ${version}`);
	const authorValues = asArray(props.authors?.author).map(xmlText).filter(Boolean);
	const tags = asArray(props.themes?.theme).map(xmlText).filter(Boolean);
	const sections = Object.create(null);
	const discoveredOrder = [];
	const versePattern = /<(?:[\w-]+:)?(?:verse|instrument)\b([^>]*)>([\s\S]*?)<\/(?:[\w-]+:)?(?:verse|instrument)>/gi;
	for (let match; (match = versePattern.exec(xml));) {
		const id = getXmlAttribute(match[1], 'name') || `v${discoveredOrder.length + 1}`;
		const linesMatch = match[2].match(/<(?:[\w-]+:)?lines\b[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?lines>/i);
		const prefix = id.toLowerCase().match(/^([a-z]+)/)?.[1] || 'v';
		sections[id] = {
			type: PREFIX_SECTION[prefix] || 'verse',
			lines: openLyricsLineText(linesMatch?.[1] || '').split(/\r?\n/),
		};
		discoveredOrder.push(id);
	}
	const orderText = xmlText(props.verseOrder);
	const orderedIds = String(orderText || '').trim().split(/\s+/).filter(id => sections[id]);
	const order = (orderedIds.length ? orderedIds : discoveredOrder).map(id => ({ id }));
	return {
		song: normalizeSong({
			title,
			composer: authorValues.join(', ') || null,
			year: props.released || null,
			bpm: props.tempo || null,
			key: props.key || null,
			timeSignature: props.timeSignature || null,
			tags,
			lyrics: { version: 2, sections, order },
		}),
		warnings: [transferWarning('openlyrics_lossy')],
	};
}

function directive(name, value) {
	return value == null || value === '' ? '' : `{${name}: ${String(value).replace(/[{}]/g, '')}}`;
}

function chordProImageSource(value) {
	const text = String(value || '').trim();
	const source = text.match(/\bsrc\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s]+))/i)
		|| text.match(/^(?:"([^"]+)"|'([^']+)'|([^\s]+))/);
	return source ? source.slice(1).find(Boolean) || '' : '';
}

function songToChordPro(input, { sheetFile = '' } = {}) {
	const song = normalizeSong(input);
	if (!song.title) throw new Error('Song title is required');

	const safeSheetFile = String(sheetFile).replace(/["{}\r\n]/g, '_');
	const header = [
		directive('title', song.title),
		directive('composer', song.composer),
		directive('year', song.year),
		directive('key', song.key),
		directive('time', song.timeSignature),
		directive('tempo', song.bpm),
		...song.tags.map(tag => directive('tag', tag)),
		safeSheetFile ? directive('image', `"${safeSheetFile}"`) : '',
	].filter(Boolean);
	const body = [];
	for (const entry of expandSectionOrder(song.lyrics.order)) {
		const section = song.lyrics.sections[entry.id];
		if (!section) continue;
		const env = SECTION_TYPES.has(section.type) ? section.type : 'verse';
		body.push(`{start_of_${env}: label="${entry.id}"}`);
		body.push(...(section.lines || []));
		body.push(`{end_of_${env}}`, '');
	}
	return `${header.join('\n')}\n\n${body.join('\n').trim()}\n`;
}

function songFromChordPro(text, fallbackTitle = '') {
	if (Buffer.byteLength(String(text), 'utf8') > MAX_TEXT_FILE_SIZE) throw new Error('ChordPro file is too large');
	const metadata = { tags: [] };
	const warnings = [];
	const images = [];
	const sections = Object.create(null);
	const order = [];
	let current = null;
	let count = 0;
	for (const rawLine of String(text).replace(/^\uFEFF/, '').split(/\r?\n/)) {
		const directiveMatch = rawLine.match(/^\s*\{([^}:\s]+)(?::\s*([^}]*))?\}\s*$/);
		if (directiveMatch) {
			const name = directiveMatch[1].toLowerCase();
			const value = (directiveMatch[2] || '').trim();
			const startType = name.match(/^start_of_(.+)$/)?.[1] || CHORDPRO_SECTION_STARTS[name];
			const isEnd = /^end_of_.+$/.test(name) || CHORDPRO_SECTION_ENDS.has(name);

			if (startType) {
				const type = SECTION_TYPES.has(startType) ? startType : 'verse';
				count++;
				const label = value.match(/label\s*=\s*["']([^"']+)["']/i)?.[1];
				const id = label || `${SECTION_PREFIX[type] || 'v'}${count}`;
				current = { id, type, lines: [] };
				sections[id] = current;
				order.push({ id });
			} else if (isEnd) {
				current = null;
			} else if (name === 'image') {
				const source = chordProImageSource(value);
				if (source) images.push(source);
				else warnings.push(transferWarning('chordpro_image_directive'));
			} else if (CHORDPRO_METADATA.has(name)) {
				const key = name === 't' ? 'title' : name;
				if (key === 'tag') metadata.tags.push(value);
				else metadata[key] = value;
			} else if (!CHORDPRO_IGNORED.has(name)) {
				warnings.push(transferWarning('chordpro_directive', { directive: name }));
			}
			continue;
		}
		if (!rawLine.trim() && !current) continue;
		if (!current) {
			count++;
			const id = `v${count}`;
			current = { id, type: 'verse', lines: [] };
			sections[id] = current;
			order.push({ id });
		}
		current.lines.push(rawLine);
	}
	const title = metadata.title || fallbackTitle || 'Imported song';
	warnings.push(transferWarning('chordpro_lossy'));
	return {
		song: normalizeSong({
			title,
			composer: metadata.composer,
			year: metadata.year,
			key: metadata.key,
			timeSignature: metadata.time,
			bpm: metadata.tempo,
			tags: metadata.tags,
			lyrics: { version: 2, sections, order },
		}),
		images,
		warnings,
	};
}

function sanitizeFilename(value, fallback = 'song') {
	const clean = String(value || '')
		.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
		.replace(/[. ]+$/g, '')
		.trim();
	return (clean || fallback).slice(0, 120);
}

function portableFilename(value, fallback = 'song') {
	const clean = String(value || '')
		.normalize('NFKD')
		.replace(/[\u0300-\u036f]/g, '')
		.replace(/[^A-Za-z0-9._-]+/g, '-')
		.replace(/^-+|-+$/g, '');
	return (clean || fallback).slice(0, 80);
}

// Eksport i import - funkcje pomocnicze
function dbAll(db, sql, params = []) {
	return new Promise((resolve, reject) => {
		db.all(sql, params, (error, rows) => error ? reject(error) : resolve(rows));
	});
}

function parseJson(value, fallback) {
	try {
		return JSON.parse(value);
	} catch {
		return fallback;
	}
}

function uniqueIntegerIds(value) {
	if (!Array.isArray(value)) return [];
	return [...new Set(value.map(Number).filter(id => Number.isInteger(id) && id > 0))];
}

async function accessibleRowsById(database, table, ids, userId) {
	if (!['songs', 'setlists'].includes(table)) throw new Error('Invalid database table');
	const rows = [];
	for (let index = 0; index < ids.length; index += MAX_SQL_IDS) {
		const chunk = ids.slice(index, index + MAX_SQL_IDS);
		rows.push(...await dbAll(
			database,
			`SELECT * FROM ${table} WHERE id IN (${chunk.map(() => '?').join(',')}) AND (isPublic = 1 OR uploadedBy = ?)`,
			[...chunk, userId]
		));
	}
	return rows.sort((a, b) => String(a.title).localeCompare(String(b.title)));
}

function hashFile(filePath) {
	return new Promise((resolve, reject) => {
		const hash = crypto.createHash('sha256');
		const stream = fs.createReadStream(filePath);
		stream.on('error', reject);
		stream.on('data', chunk => hash.update(chunk));
		stream.on('end', () => resolve(hash.digest('hex')));
	});
}

function collectSetlistSongIds(items) {
	return new Set(collectImportedRefs(items).map(Number).filter(id => Number.isInteger(id) && id > 0));
}

function mapSetlistItems(items) {
	return (Array.isArray(items) ? items : []).map(item => {
		if (item?.type === 'song') return { type: 'song', songRef: String(item.songId) };
		if (item?.type === 'group') {
			return {
				type: 'group',
				title: item.title || '',
				items: mapSetlistItems(item.items),
			};
		}
		return {
			type: 'text',
			sectionType: item?.sectionType || 'verse',
			title: item?.title || '',
			lines: Array.isArray(item?.lines) ? item.lines : [],
		};
	});
}

function dbSongToTransfer(row, media = {}) {
	return normalizeSong({
		archiveId: row.id,
		title: row.title,
		tags: parseJson(row.type, row.type ? [row.type] : []),
		bpm: row.bpm,
		key: row.key,
		timeSignature: row.timeSignature,
		composer: row.composer,
		year: row.year,
		lyrics: parseJson(row.lyrics, []),
		isPublic: row.isPublic === 1,
		createdAt: row.createdAt,
		media,
	});
}

async function appendArchive(res, filename, manifest, fileEntries = []) {
	res.attachment(filename);
	res.type('application/zip');
	const archive = new ZipArchive({ zlib: { level: 7 } });
	archive.on('warning', error => console.warn('Archive warning:', error));
	archive.on('error', error => {
		console.error('Archive error:', error);
		if (!res.headersSent) res.status(500).end();
		else res.destroy(error);
	});
	archive.pipe(res);
	archive.append(JSON.stringify(manifest, null, 2), { name: 'manifest.json' });
	for (const entry of fileEntries) {
		archive.file(entry.filePath, { name: entry.archivePath });
	}
	await archive.finalize();
}

async function buildMediaEntries(rows, audioDir, notesDir) {
	const entries = [];
	const mediaBySong = new Map();
	for (const row of rows) {
		const media = {};
		const archiveId = String(row.id);
		const audioPath = path.join(audioDir, `${row.id}.mp3`);
		if (row.filesAudio === 1 && fs.existsSync(audioPath)) {
			const archivePath = `media/audio/${archiveId}.mp3`;
			entries.push({
				archivePath,
				filePath: audioPath,
				sha256: await hashFile(audioPath),
				size: fs.statSync(audioPath).size,
			});
			media.audio = archivePath;
		}
		if (row.filesSheets) {
			const ext = String(row.filesSheets).toLowerCase();
			const sheetsPath = path.join(notesDir, `${row.id}${ext}`);
			if (['.svg', '.webp'].includes(ext) && fs.existsSync(sheetsPath)) {
				const archivePath = `media/sheets/${archiveId}${ext}`;
				entries.push({
					archivePath,
					filePath: sheetsPath,
					sha256: await hashFile(sheetsPath),
					size: fs.statSync(sheetsPath).size,
				});
				media.sheets = archivePath;
			}
		}
		mediaBySong.set(archiveId, media);
	}
	return { entries, mediaBySong };
}

async function chordProSheetPng(row, notesDir) {
	if (!row.filesSheets) return null;
	const ext = String(row.filesSheets).toLowerCase();
	if (!['.svg', '.webp'].includes(ext)) return null;
	const filePath = path.join(notesDir, `${row.id}${ext}`);
	if (!fs.existsSync(filePath)) return null;
	return sharp(filePath, { density: 192, pages: 1, limitInputPixels: MAX_IMAGE_PIXELS })
		.resize({ width: 1600, withoutEnlargement: true })
		.withMetadata({ density: 192 })
		.png()
		.toBuffer();
}

async function streamTextExport(res, format, rows, notesDir) {
	const songs = rows.map(row => dbSongToTransfer(row));
	const extension = format === 'openlyrics' ? 'xml' : 'cho';
	const mime = format === 'openlyrics' ? 'application/xml; charset=utf-8' : 'text/plain; charset=utf-8';
	const serialize = format === 'openlyrics' ? songToOpenLyrics : songToChordPro;
	const baseNames = [];
	const used = new Set();
	for (let index = 0; index < songs.length; index++) {
		let base = portableFilename(songs[index].title, `song-${index + 1}`);
		while (used.has(base.toLowerCase())) base = `${base}-${index + 1}`;
		used.add(base.toLowerCase());
		baseNames.push(base);
	}
	const firstSheet = format === 'chordpro' && songs.length === 1 ? await chordProSheetPng(rows[0], notesDir) : null;
	const needsArchive = songs.length > 1 || !!firstSheet;
	if (!needsArchive) {
		res.type(mime);
		res.attachment(`${sanitizeFilename(songs[0].title)}.${extension}`);
		return res.send(serialize(songs[0]));
	}
	res.attachment(`barymusic-${format}-${new Date().toISOString().slice(0, 10)}.zip`);
	res.type('application/zip');
	const archive = new ZipArchive({ zlib: { level: 7 } });
	archive.on('error', error => res.destroy(error));
	archive.pipe(res);
	for (let index = 0; index < songs.length; index++) {
		const sheet = index === 0 && firstSheet ? firstSheet : format === 'chordpro' ? await chordProSheetPng(rows[index], notesDir) : null;
		const sheetFile = sheet ? `${baseNames[index]}-sheet.png` : '';
		archive.append(serialize(songs[index], { sheetFile }), { name: `${baseNames[index]}.${extension}` });
		if (sheet) archive.append(sheet, { name: sheetFile });
	}
	await archive.finalize();
}

const PREVIEW_TTL_MS = 15 * 60 * 1000;
const TEMP_FILE_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_ARCHIVE_SIZE = 1024 * 1024 * 1024;
const MAX_ENTRY_SIZE = 256 * 1024 * 1024;
const MAX_MANIFEST_SIZE = 16 * 1024 * 1024;
const MAX_TEXT_FILE_SIZE = 8 * 1024 * 1024;
const MAX_ARCHIVE_ENTRIES = 15000;
const MAX_TRANSFER_FILES = 100;
const MAX_SONGS = 5000;
const MAX_SETLISTS = 1000;
const MAX_SETLIST_ITEMS = 10000;
const MAX_SETLIST_DEPTH = 20;
const MAX_USERS = 10000;
const MAX_USER_SETTINGS = 50000;
const MAX_SETTINGS_SIZE = 1024 * 1024;
const MAX_TITLE_LENGTH = 200;
const MAX_METADATA_LENGTH = 500;
const MAX_LYRICS_SIZE = 4 * 1024 * 1024;
const MAX_SQL_IDS = 500;
const MAX_IMAGE_PIXELS = 40_000_000;
const TRANSFER_EXTENSIONS = new Set(['.barymusic', '.zip', '.xml', '.cho', '.crd', '.chopro', '.pro']);
const importPreviews = new Map();
const transferTempDir = path.join(os.tmpdir(), 'barymusic-transfer');
fs.mkdirSync(transferTempDir, { recursive: true });

const transferUpload = multer({
	dest: transferTempDir,
	limits: { fileSize: MAX_ARCHIVE_SIZE, files: MAX_TRANSFER_FILES, fields: 0 },
	fileFilter: (_req, file, callback) => {
		const ext = path.extname(file.originalname).toLowerCase();
		if (!TRANSFER_EXTENSIONS.has(ext)) return callback(new Error(`Unsupported file type: ${file.originalname}`));
		callback(null, true);
	},
});

function dbRun(db, sql, params = []) {
	return new Promise((resolve, reject) => {
		db.run(sql, params, function callback(error) {
			if (error) reject(error);
			else resolve({ lastID: this.lastID, changes: this.changes });
		});
	});
}

function dbGet(db, sql, params = []) {
	return new Promise((resolve, reject) => {
		db.get(sql, params, (error, row) => error ? reject(error) : resolve(row));
	});
}

function removeFile(filePath) {
	try {
		fs.unlinkSync(filePath);
	} catch {}
}

function cleanupTransferTemp() {
	fs.mkdirSync(transferTempDir, { recursive: true });

	const cutoff = Date.now() - TEMP_FILE_TTL_MS;
	for (const entry of fs.readdirSync(transferTempDir, { withFileTypes: true })) {
		const filePath = path.join(transferTempDir, entry.name);
		try {
			if (fs.statSync(filePath).mtimeMs < cutoff) {
				fs.rmSync(filePath, { recursive: true, force: true });
			}
		} catch {}
	}
}

cleanupTransferTemp();

function isSafeArchivePath(name) {
	if (!name || /[\x00-\x1f\x7f]/.test(name) || name.includes('\\') || name.startsWith('/') || /^[A-Za-z]:/.test(name)) return false;
	const normalized = path.posix.normalize(name);
	return normalized === name && !normalized.startsWith('../') && !['.', '..'].includes(normalized);
}

function hashArchiveEntry(entry) {
	return new Promise((resolve, reject) => {
		const hash = crypto.createHash('sha256');
		const stream = entry.stream();
		let size = 0;
		stream.on('error', reject);
		stream.on('data', chunk => {
			size += chunk.length;
			if (size > MAX_ENTRY_SIZE) return stream.destroy(new Error(`Archive entry is too large: ${entry.path}`));
			hash.update(chunk);
		});
		stream.on('end', () => resolve({ size, sha256: hash.digest('hex') }));
	});
}

function readArchiveEntry(entry, maxSize = MAX_ENTRY_SIZE) {
	return new Promise((resolve, reject) => {
		const chunks = [];
		const stream = entry.stream();
		let size = 0;
		stream.on('error', reject);
		stream.on('data', chunk => {
			size += chunk.length;
			if (size > maxSize) return stream.destroy(new Error(`Archive entry is too large: ${entry.path}`));
			chunks.push(chunk);
		});
		stream.on('end', () => resolve(Buffer.concat(chunks, size)));
	});
}

async function openZipEntries(filePath) {
	let archive;
	try {
		archive = await unzipper.Open.file(filePath);
	} catch (error) {
		throw new Error(`Invalid ZIP archive: ${error.message}`);
	}

	if (archive.files.length > MAX_ARCHIVE_ENTRIES) throw new Error('ZIP archive contains too many entries');
	const entries = new Map();
	let totalSize = 0;
	for (const entry of archive.files) {
		if (!isSafeArchivePath(entry.path)) throw new Error(`Unsafe archive path: ${entry.path}`);
		const size = Number(entry.uncompressedSize || 0);
		if (!Number.isSafeInteger(size) || size < 0 || size > MAX_ENTRY_SIZE) throw new Error(`Archive entry is too large: ${entry.path}`);
		totalSize += size;
		if (totalSize > MAX_ARCHIVE_SIZE) throw new Error('Archive contents are too large');
		if (entry.type !== 'File') continue;
		if (entries.has(entry.path)) throw new Error(`ZIP archive contains a duplicate path: ${entry.path}`);
		entries.set(entry.path, entry);
	}
	return { entries };
}

async function openBaryMusic(filePath, opened = null) {
	const { entries } = opened || await openZipEntries(filePath);
	const manifestEntry = entries.get('manifest.json');
	if (!manifestEntry) throw new Error('manifest.json is missing');
	if (manifestEntry.uncompressedSize > MAX_MANIFEST_SIZE) throw new Error('manifest.json is too large');

	const manifestBuffer = await readArchiveEntry(manifestEntry, MAX_MANIFEST_SIZE);
	let manifest;
	try {
		manifest = JSON.parse(manifestBuffer.toString('utf8'));
	} catch {
		throw new Error('manifest.json is invalid');
	}

	if (manifest?.format !== 'BaryMusic' || manifest?.schemaVersion !== 2 || !manifest.payload) throw new Error('Unsupported BaryMusic schema');
	if (!Array.isArray(manifest.files) || manifest.files.length > MAX_ARCHIVE_ENTRIES) throw new Error('Invalid BaryMusic file manifest');
	const declaredPaths = new Set();
	let actualSize = 0;
	for (const file of manifest.files) {
		if (!isSafeArchivePath(file.path)) throw new Error(`Unsafe manifest path: ${file.path}`);
		if (declaredPaths.has(file.path)) throw new Error(`Duplicate manifest path: ${file.path}`);
		if (!Number.isSafeInteger(Number(file.size)) || Number(file.size) < 0 || Number(file.size) > MAX_ENTRY_SIZE || !/^[0-9a-f]{64}$/i.test(file.sha256)) throw new Error(`Invalid manifest entry: ${file.path}`);
		declaredPaths.add(file.path);
		const entry = entries.get(file.path);
		if (!entry) throw new Error(`Missing media file: ${file.path}`);
		const verified = await hashArchiveEntry(entry);
		actualSize += verified.size;
		if (actualSize > MAX_ARCHIVE_SIZE) throw new Error('Archive contents are too large');
		if (verified.size !== Number(file.size) || verified.sha256 !== file.sha256.toLowerCase()) throw new Error(`Media checksum mismatch: ${file.path}`);
	}
	for (const entryPath of entries.keys()) {
		if (entryPath !== 'manifest.json' && !declaredPaths.has(entryPath)) throw new Error(`Undeclared archive entry: ${entryPath}`);
	}
	const referencedPaths = new Set();
	for (const input of Array.isArray(manifest.payload.songs) ? manifest.payload.songs : []) {
		const media = normalizeSong(input).media;
		if (media.audio && path.extname(media.audio).toLowerCase() !== '.mp3') throw new Error(`Unsupported audio file: ${media.audio}`);
		if (media.sheets && !['.svg', '.webp'].includes(path.extname(media.sheets).toLowerCase())) throw new Error(`Unsupported sheets file: ${media.sheets}`);
		for (const filePath of [media.audio, media.sheets].filter(Boolean)) {
			if (!declaredPaths.has(filePath)) throw new Error(`Undeclared media file: ${filePath}`);
			referencedPaths.add(filePath);
		}
	}
	for (const filePath of declaredPaths) {
		if (!referencedPaths.has(filePath)) throw new Error(`Unreferenced media file: ${filePath}`);
	}
	return { manifest, entries };
}

async function openImportArchive(filePath) {
	const opened = await openZipEntries(filePath);
	return opened.entries.has('manifest.json') ? openBaryMusic(filePath, opened) : opened;
}

async function parseExternalZip(filePath, opened = null) {
	const { entries } = opened || await openZipEntries(filePath);
	const songs = [];
	const warnings = [];
	const formats = new Set();
	for (const entry of entries.values()) {
		const ext = path.extname(entry.path).toLowerCase();
		if (!['.xml', '.cho', '.crd', '.chopro', '.pro'].includes(ext)) continue;
		if (entry.uncompressedSize > MAX_TEXT_FILE_SIZE) throw new Error(`Text file is too large: ${entry.path}`);
		formats.add(ext === '.xml' ? 'OpenLyrics ZIP' : 'ChordPro ZIP');
		const text = (await readArchiveEntry(entry, MAX_TEXT_FILE_SIZE)).toString('utf8');
		const parsed = ext === '.xml'
			? songFromOpenLyrics(text)
			: songFromChordPro(text, path.basename(entry.path, ext));
		if (ext !== '.xml' && parsed.images.length) {
			const source = parsed.images[0];
			const externalPath = source.includes('\\') || source.startsWith('/') || /^[A-Za-z]:/.test(source) || /^[a-z][a-z0-9+.-]*:/i.test(source);
			const imagePath = externalPath ? '' : path.posix.normalize(path.posix.join(path.posix.dirname(entry.path), source));
			const imageExt = path.extname(imagePath).toLowerCase();
			if (isSafeArchivePath(imagePath) && ['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp'].includes(imageExt) && entries.has(imagePath)) {
				parsed.song.media.sheets = imagePath;
			} else {
				warnings.push(transferWarning('chordpro_image_missing', { source }));
			}
			if (parsed.images.length > 1) warnings.push(transferWarning('chordpro_single_image', { title: parsed.song.title }));
		}
		songs.push(parsed.song);
		warnings.push(...parsed.warnings);
	}
	if (!songs.length) throw new Error('ZIP archive contains no supported OpenLyrics or ChordPro files');
	return { songs, warnings, formats: [...formats] };
}

function collectImportedRefs(items, refs = []) {
	const stack = [{ items: Array.isArray(items) ? items : [], depth: 0 }];
	let count = 0;
	while (stack.length) {
		const current = stack.pop();
		if (current.depth > MAX_SETLIST_DEPTH) throw new Error('Setlist nesting is too deep');
		for (const item of current.items) {
			if (++count > MAX_SETLIST_ITEMS) throw new Error('Setlist contains too many items');
			if (!item || !['song', 'group', 'text'].includes(item.type)) throw new Error('Setlist contains an invalid item');
			if (item.type === 'song') refs.push(String(item.songRef ?? item.songId ?? ''));
			if (item.type === 'group') {
				if (!Array.isArray(item.items)) throw new Error('Setlist group is invalid');
				stack.push({ items: item.items, depth: current.depth + 1 });
			}
		}
	}
	return refs;
}

function scopeImportedItems(items, refs, sourceIndex) {
	return (Array.isArray(items) ? items : []).map(item => {
		if (item?.type === 'song') {
			const { songId, ...rest } = item;
			const source = String(item.songRef ?? songId ?? '');
			return { ...rest, songRef: refs.get(source) || `${sourceIndex}:${source}` };
		}
		if (item?.type === 'group') return { ...item, items: scopeImportedItems(item.items, refs, sourceIndex) };
		return item;
	});
}

function scopeImportedPayload(songs, setlists, sourceIndex, hasArchive) {
	const refs = new Map();
	const setlistSongIds = new Set((Array.isArray(setlists) ? setlists : []).flatMap(setlist => collectImportedRefs(setlist.items)));
	const scopedSongs = (Array.isArray(songs) ? songs : []).map((input, index) => {
		const song = normalizeSong(input);
		const source = song.archiveId || String(index);
		const archiveId = `${sourceIndex}:${source}`;
		refs.set(source, archiveId);
		return {
			...song,
			archiveId,
			sourceIndex,
			fromSetlist: setlistSongIds.has(source),
			media: { ...song.media, ...(hasArchive ? { archiveIndex: sourceIndex } : {}) },
		};
	});
	const scopedSetlists = (Array.isArray(setlists) ? setlists : []).map(setlist => ({
		...setlist,
		sourceIndex,
		items: scopeImportedItems(setlist.items, refs, sourceIndex),
	}));
	return { songs: scopedSongs, setlists: scopedSetlists };
}

function validateLibraryPayload(payload) {
	if (!payload || !Array.isArray(payload.songs) || !Array.isArray(payload.setlists)) throw new Error('Transfer payload is incomplete');
	if (payload.songs.length > MAX_SONGS || payload.setlists.length > MAX_SETLISTS) throw new Error('Transfer contains too many items');
	const ids = payload.songs.map((input, index) => {
		const song = normalizeSong(input);
		if (!song.title || song.title.length > MAX_TITLE_LENGTH) throw new Error(`Song ${index + 1} has an invalid title`);
		if (song.tags.length > 100 || song.tags.some(tag => tag.length > MAX_METADATA_LENGTH)) throw new Error(`Song ${index + 1} has invalid tags`);
		if ([song.key, song.timeSignature, song.composer].some(value => value != null && String(value).length > MAX_METADATA_LENGTH)) throw new Error(`Song ${index + 1} has invalid metadata`);
		if ([song.bpm, song.year].some(value => value != null && !Number.isFinite(value))) throw new Error(`Song ${index + 1} has invalid numeric metadata`);
		if (Buffer.byteLength(JSON.stringify(song.lyrics), 'utf8') > MAX_LYRICS_SIZE) throw new Error(`Song ${index + 1} lyrics are too large`);
		if (!song.lyrics.sections || Array.isArray(song.lyrics.sections) || !Array.isArray(song.lyrics.order)) throw new Error(`Song ${index + 1} lyrics are invalid`);
		const sectionIds = new Set(Object.keys(song.lyrics.sections));
		if (sectionIds.size > 500 || song.lyrics.order.length > 5000 || song.lyrics.order.some(item => !sectionIds.has(String(item?.id)))) throw new Error(`Song ${index + 1} lyrics structure is invalid`);
		for (const section of Object.values(song.lyrics.sections)) {
			if (!section || !Array.isArray(section.lines) || section.lines.length > 5000 || section.lines.some(line => typeof line !== 'string')) throw new Error(`Song ${index + 1} contains an invalid section`);
		}
		if (!song.media || typeof song.media !== 'object' || Array.isArray(song.media)) throw new Error(`Song ${index + 1} media are invalid`);
		for (const filePath of [song.media.audio, song.media.sheets].filter(Boolean)) {
			if (!isSafeArchivePath(filePath)) throw new Error(`Song ${index + 1} contains an unsafe media path`);
		}
		return String(song.archiveId || index);
	});
	if (new Set(ids).size !== ids.length) throw new Error('Archive contains duplicate song identifiers');
	const known = new Set(ids);
	for (const setlist of payload.setlists) {
		if (!setlist || !String(setlist.title || '').trim() || String(setlist.title).length > MAX_TITLE_LENGTH || String(setlist.description || '').length > 5000) throw new Error('Transfer contains an invalid setlist');
		const missing = collectImportedRefs(setlist.items).filter(ref => !known.has(ref));
		if (missing.length) throw new Error(`Setlist references missing songs: ${[...new Set(missing)].join(', ')}`);
	}
}

async function parseUploadedFiles(files) {
	if (!files.length) throw new Error('No files selected');
	if (files.length > MAX_TRANSFER_FILES) throw new Error('Too many files selected');
	const totalUploadSize = files.reduce((total, file) => total + Number(file.size ?? fs.statSync(file.path).size), 0);
	if (!Number.isSafeInteger(totalUploadSize) || totalUploadSize > MAX_ARCHIVE_SIZE) throw new Error('Selected files are too large');
	const payload = { songs: [], setlists: [] };
	const warnings = [];
	const formats = new Set();
	const formatsBySource = files.map(() => new Set());
	const archivePaths = Array(files.length).fill(null);
	const addFormat = (sourceIndex, format) => {
		formats.add(format);
		formatsBySource[sourceIndex].add(format);
	};
	for (const [sourceIndex, file] of files.entries()) {
		const ext = path.extname(file.originalname).toLowerCase();
		if (!TRANSFER_EXTENSIONS.has(ext)) throw new Error(`Unsupported file type: ${file.originalname}`);
		if (ext === '.barymusic' || ext === '.zip') {
			archivePaths[sourceIndex] = file.path;
			const opened = await openZipEntries(file.path);
			if (!opened.entries.has('manifest.json')) {
				if (ext === '.zip') {
					const parsed = await parseExternalZip(file.path, opened);
					const scoped = scopeImportedPayload(parsed.songs, [], sourceIndex, true);
					payload.songs.push(...scoped.songs);
					warnings.push(...parsed.warnings);
					parsed.formats.forEach(format => addFormat(sourceIndex, format));
					continue;
				}
				throw new Error('manifest.json is missing');
			}
			const baryMusic = await openBaryMusic(file.path, opened);
			if (baryMusic.manifest.kind !== 'library') throw new Error('This is not a library transfer archive');
			validateLibraryPayload(baryMusic.manifest.payload);
			const scoped = scopeImportedPayload(baryMusic.manifest.payload.songs, baryMusic.manifest.payload.setlists, sourceIndex, true);
			payload.songs.push(...scoped.songs);
			payload.setlists.push(...scoped.setlists);
			addFormat(sourceIndex, 'BaryMusic');
		} else {
			const fileSize = Number(file.size ?? fs.statSync(file.path).size);
			if (fileSize > MAX_TEXT_FILE_SIZE) throw new Error(`Text file is too large: ${file.originalname}`);
			const text = fs.readFileSync(file.path, 'utf8');
			if (ext === '.xml') {
				const parsed = songFromOpenLyrics(text);
				payload.songs.push(...scopeImportedPayload([parsed.song], [], sourceIndex, false).songs);
				warnings.push(...parsed.warnings);
				addFormat(sourceIndex, 'OpenLyrics');
			} else if (['.cho', '.crd', '.chopro', '.pro'].includes(ext)) {
				const parsed = songFromChordPro(text, path.basename(file.originalname, ext));
				payload.songs.push(...scopeImportedPayload([parsed.song], [], sourceIndex, false).songs);
				warnings.push(...parsed.warnings);
				if (parsed.images.length) warnings.push(transferWarning('chordpro_images_zip'));
				addFormat(sourceIndex, 'ChordPro');
			} else throw new Error(`Unsupported file type: ${file.originalname}`);
		}
	}
	if (!payload.songs.length && !payload.setlists.length) throw new Error('No transferable data found');
	validateLibraryPayload(payload);
	const uniqueWarnings = [...new Map(warnings.map(warning => [JSON.stringify(warning), warning])).values()];
	const sources = files.map((file, sourceIndex) => ({
		sourceIndex,
		filename: path.basename(file.originalname),
		formats: [...formatsBySource[sourceIndex]],
	}));
	return { payload, warnings: uniqueWarnings, formats: [...formats], sources, archivePaths };
}

function cleanupPreview(token) {
	const preview = importPreviews.get(token);
	if (!preview) return;
	(preview.files || []).forEach(removeFile);
	importPreviews.delete(token);
}

function cleanupUserPreviews(userId) {
	for (const [token, preview] of importPreviews) {
		if (preview.userId === userId) cleanupPreview(token);
	}
}

setInterval(() => {
	const cutoff = Date.now() - PREVIEW_TTL_MS;
	for (const [token, preview] of importPreviews) {
		if (preview.createdAt < cutoff) cleanupPreview(token);
	}
	cleanupTransferTemp();
}, 60 * 1000).unref();

function remapItems(items, idMap) {
	return (Array.isArray(items) ? items : []).map(item => {
		if (item?.type === 'song') {
			const source = String(item.songRef ?? item.songId ?? '');
			return { type: 'song', songId: idMap.get(source) || null };
		}
		if (item?.type === 'group') {
			return {
				type: 'group',
				title: item.title || '',
				items: remapItems(item.items, idMap),
			};
		}
		return {
			type: 'text',
			sectionType: item?.sectionType || 'verse',
			title: item?.title || '',
			lines: Array.isArray(item?.lines) ? item.lines : [],
		};
	}).filter(item => item.type !== 'song' || item.songId);
}

async function importLibrary(db, payload, userId, archivePath, audioDir, notesDir) {
	const archivePaths = Array.isArray(archivePath) ? archivePath : [archivePath];
	const openedArchives = await Promise.all(archivePaths.map(filePath => filePath ? openImportArchive(filePath) : null));
	const idMap = new Map();
	const createdMedia = [];
	await dbRun(db, 'BEGIN IMMEDIATE');
	try {
		for (let index = 0; index < payload.songs.length; index++) {
			const input = payload.songs[index];
			const song = normalizeSong(input);
			const archiveIndex = Number(song.media?.archiveIndex);
			const opened = Number.isInteger(archiveIndex) ? openedArchives[archiveIndex] : openedArchives.find(Boolean);
			if (!song.title) throw new Error(`Song ${index + 1} has no title`);
			const result = await dbRun(
				db,
				`INSERT INTO songs (title, type, bpm, key, timeSignature, composer, year, lyrics, filesAudio, filesSheets, uploadedBy, isPublic, createdAt)
				 VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, ?, ?, COALESCE(?, strftime('%s', 'now')))`,
				[
					song.title,
					song.tags.length ? JSON.stringify(song.tags) : null,
					song.bpm,
					song.key,
					song.timeSignature,
					song.composer,
					song.year,
					JSON.stringify(song.lyrics),
					userId,
					song.isPublic ? 1 : 0,
					song.createdAt,
				]
			);
			const newId = result.lastID;
			idMap.set(String(song.archiveId || index), newId);
			if (song.media?.audio) {
				if (!opened) throw new Error(`Missing media archive for ${song.title}`);
				const entry = opened.entries.get(song.media.audio);
				if (!entry) throw new Error(`Missing audio for ${song.title}`);
				const target = path.join(audioDir, `${newId}.mp3`);
				fs.writeFileSync(target, await readArchiveEntry(entry));
				createdMedia.push(target);
				await dbRun(db, 'UPDATE songs SET filesAudio = 1 WHERE id = ?', [newId]);
			}
			if (song.media?.sheets) {
				if (!opened) throw new Error(`Missing media archive for ${song.title}`);
				const entry = opened.entries.get(song.media.sheets);
				if (!entry) throw new Error(`Missing sheets for ${song.title}`);
				const sourceExt = path.extname(song.media.sheets).toLowerCase();
				const isBaryMusicSheet = !!opened.manifest && ['.svg', '.webp'].includes(sourceExt);
				const targetExt = isBaryMusicSheet ? sourceExt : '.webp';
				const target = path.join(notesDir, `${newId}${targetExt}`);
				const source = await readArchiveEntry(entry);
				const output = isBaryMusicSheet
					? source
					: await sharp(source, { density: 144, pages: 1, limitInputPixels: MAX_IMAGE_PIXELS }).webp({ lossless: true }).toBuffer();
				fs.writeFileSync(target, output);
				createdMedia.push(target);
				await dbRun(db, 'UPDATE songs SET filesSheets = ? WHERE id = ?', [targetExt, newId]);
			}
		}
		for (const setlist of payload.setlists || []) {
			await dbRun(
				db,
				`INSERT INTO setlists (title, description, items, uploadedBy, isPublic, createdAt)
				 VALUES (?, ?, ?, ?, ?, COALESCE(?, strftime('%s', 'now')))`,
				[
					String(setlist.title || 'Imported setlist').slice(0, 200),
					setlist.description || null,
					JSON.stringify(remapItems(setlist.items, idMap)),
					userId,
					setlist.isPublic === false ? 0 : 1,
					setlist.createdAt ?? null,
				]
			);
		}
		await dbRun(db, 'COMMIT');
		return { importedSongs: payload.songs.length, importedSetlists: (payload.setlists || []).length };
	} catch (error) {
		try {
			await dbRun(db, 'ROLLBACK');
		} catch {}
		createdMedia.forEach(removeFile);
		throw error;
	}
}

function validateBackupManifest(manifest) {
	if (manifest.kind !== 'server-backup') throw new Error('This is not a server backup');
	const payload = manifest.payload || {};
	if (!Array.isArray(payload.users) || !payload.users.some(user => user.isAdmin === 1)) throw new Error('Backup must contain at least one administrator');
	if (!Array.isArray(payload.songs) || !Array.isArray(payload.setlists) || !Array.isArray(payload.userSettings)) throw new Error('Backup payload is incomplete');
	if (payload.users.length > MAX_USERS || payload.userSettings.length > MAX_USER_SETTINGS) throw new Error('Backup contains too many user records');
	validateLibraryPayload(payload);
	const userIds = new Set(payload.users.map(user => Number(user.id)));
	if (userIds.size !== payload.users.length || [...userIds].some(id => !Number.isInteger(id) || id <= 0)) throw new Error('Backup contains invalid user identifiers');
	const usernames = payload.users.map(user => String(user.username || ''));
	if (new Set(usernames).size !== usernames.length || usernames.some(name => name.length < 3 || name.length > 32 || /[\r\n]/.test(name))) throw new Error('Backup contains invalid usernames');
	if (payload.users.some(user => typeof user.passwordHash !== 'string' || user.passwordHash.length < 20 || user.passwordHash.length > 255 || /[\r\n]/.test(user.passwordHash))) throw new Error('Backup contains invalid password hashes');
	if (payload.songs.some(song => song.uploadedBy != null && !userIds.has(Number(song.uploadedBy)))) throw new Error('Backup contains an invalid song owner');
	if (payload.setlists.some(setlist => setlist.uploadedBy != null && !userIds.has(Number(setlist.uploadedBy)))) throw new Error('Backup contains an invalid setlist owner');
	const songIds = new Set(payload.songs.map(song => String(song.id)));
	if (songIds.size !== payload.songs.length || payload.songs.some(song => !Number.isInteger(Number(song.id)) || Number(song.id) <= 0)) throw new Error('Backup contains invalid song identifiers');
	const setlistIds = new Set(payload.setlists.map(setlist => String(setlist.id)));
	if (setlistIds.size !== payload.setlists.length || payload.setlists.some(setlist => !Number.isInteger(Number(setlist.id)) || Number(setlist.id) <= 0)) throw new Error('Backup contains invalid setlist identifiers');
	const settingIds = new Set(payload.userSettings.map(setting => Number(setting.id)));
	if (settingIds.size !== payload.userSettings.length) throw new Error('Backup contains duplicate user setting identifiers');
	if (payload.userSettings.some(setting => {
		const id = Number(setting.id);
		const channelId = setting.channelId == null ? null : Number(setting.channelId);
		return !Number.isInteger(id) || id <= 0
			|| !userIds.has(Number(setting.userId))
			|| (channelId != null && (!Number.isInteger(channelId) || channelId <= 0))
			|| Buffer.byteLength(JSON.stringify(setting.settings ?? {}), 'utf8') > MAX_SETTINGS_SIZE;
	})) throw new Error('Backup contains invalid user settings');
	for (const setlist of payload.setlists) {
		const missing = collectImportedRefs(setlist.items).filter(ref => !songIds.has(ref));
		if (missing.length) throw new Error('Backup contains an invalid setlist song reference');
	}
	return payload;
}

async function restoreBackup(db, opened, { audioDir, notesDir, updateEnvFile, config, requireEmpty = false }) {
	const payload = validateBackupManifest(opened.manifest);
	const dataRoot = path.dirname(audioDir);
	if (path.dirname(notesDir) !== dataRoot) throw new Error('Media directories must share the same parent');
	const stageRoot = fs.mkdtempSync(path.join(dataRoot, '.restore-'));
	const stageAudio = path.join(stageRoot, 'audio');
	const stageNotes = path.join(stageRoot, 'notes');
	const previousAudio = path.join(stageRoot, 'previous-audio');
	const previousNotes = path.join(stageRoot, 'previous-notes');
	fs.mkdirSync(stageAudio);
	fs.mkdirSync(stageNotes);

	try {
		for (const songInput of payload.songs) {
			const song = normalizeSong(songInput);
			if (song.media?.audio) {
				const entry = opened.entries.get(song.media.audio);
				if (!entry) throw new Error(`Missing audio for song ${songInput.id}`);
				fs.writeFileSync(path.join(stageAudio, `${songInput.id}.mp3`), await readArchiveEntry(entry));
			}
			if (song.media?.sheets) {
				const ext = path.extname(song.media.sheets).toLowerCase();
				const entry = opened.entries.get(song.media.sheets);
				if (!entry || !['.svg', '.webp'].includes(ext)) throw new Error(`Invalid sheets for song ${songInput.id}`);
				fs.writeFileSync(path.join(stageNotes, `${songInput.id}${ext}`), await readArchiveEntry(entry));
			}
		}
		await dbRun(db, 'BEGIN IMMEDIATE');
		try {
			if (requireEmpty) {
				const status = await dbGet(db, 'SELECT EXISTS (SELECT 1 FROM users) AS hasUsers');
				if (status.hasUsers) throw new Error('Bootstrap restore is no longer available');
			}
			await dbRun(db, 'DELETE FROM sessions');
			await dbRun(db, 'DELETE FROM user_settings');
			await dbRun(db, 'DELETE FROM setlists');
			await dbRun(db, 'DELETE FROM songs');
			await dbRun(db, 'DELETE FROM users');

			for (const user of payload.users) {
				await dbRun(
					db,
					'INSERT INTO users (id, username, passwordHash, canAddSongs, isAdmin, createdAt) VALUES (?, ?, ?, ?, ?, ?)',
					[user.id, user.username, user.passwordHash, user.canAddSongs ? 1 : 0, user.isAdmin ? 1 : 0, user.createdAt]
				);
			}

			for (const songInput of payload.songs) {
				const song = normalizeSong(songInput);
				await dbRun(
					db,
					`INSERT INTO songs (id, title, type, bpm, key, timeSignature, composer, year, lyrics, filesAudio, filesSheets, uploadedBy, isPublic, createdAt)
					 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
					[
						songInput.id,
						song.title,
						song.tags.length ? JSON.stringify(song.tags) : null,
						song.bpm,
						song.key,
						song.timeSignature,
						song.composer,
						song.year,
						JSON.stringify(song.lyrics),
						song.media?.audio ? 1 : 0,
						song.media?.sheets ? path.extname(song.media.sheets).toLowerCase() : null,
						songInput.uploadedBy,
						song.isPublic ? 1 : 0,
						song.createdAt,
					]
				);
			}

			for (const setlist of payload.setlists) {
				await dbRun(
					db,
					'INSERT INTO setlists (id, title, description, items, uploadedBy, isPublic, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)',
					[setlist.id, setlist.title, setlist.description, JSON.stringify(setlist.items || []), setlist.uploadedBy, setlist.isPublic ? 1 : 0, setlist.createdAt]
				);
			}

			for (const setting of payload.userSettings) {
				await dbRun(
					db,
					'INSERT INTO user_settings (id, userId, channelId, settings, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?)',
					[setting.id, setting.userId, setting.channelId, JSON.stringify(setting.settings || {}), setting.createdAt, setting.updatedAt]
				);
			}
			fs.renameSync(audioDir, previousAudio);
			fs.renameSync(notesDir, previousNotes);
			fs.renameSync(stageAudio, audioDir);
			fs.renameSync(stageNotes, notesDir);
			await dbRun(db, 'COMMIT');
		} catch (error) {
			try {
				await dbRun(db, 'ROLLBACK');
			} catch {}
			for (const [current, previous] of [[audioDir, previousAudio], [notesDir, previousNotes]]) {
				if (!fs.existsSync(previous)) continue;
				fs.rmSync(current, { recursive: true, force: true });
				fs.renameSync(previous, current);
			}
			throw error;
		}

		const saved = payload.config || {};
		const cleanNames = value => (Array.isArray(value) ? value : [])
			.map(item => String(item).replace(/[\r\n,"']/g, '').trim())
			.filter(Boolean);
		const restoredPort = Number(saved.port);
		const restoredCorsOrigin = String(saved.corsOrigin || config.corsOrigin).replace(/[\r\n]/g, '').trim() || config.corsOrigin;
		const envValues = {
			ADMINS: cleanNames(saved.admins).join(','),
			CAN_ADD_SONGS: cleanNames(saved.canAddSongs).join(','),
			ALLOW_ALL_USERS_TO_ADD_SONGS: saved.allowAllUsersToAddSongs ? 'true' : 'false',
			ALLOW_REGISTRATION: saved.allowRegistration ? 'true' : 'false',
			CORS_ORIGIN: restoredCorsOrigin,
			PORT: Number.isInteger(restoredPort) && restoredPort > 0 && restoredPort <= 65535
				? restoredPort
				: config.port,
		};
		updateEnvFile(envValues);
		Object.assign(config, {
			admins: cleanNames(saved.admins),
			canAddSongs: cleanNames(saved.canAddSongs),
			allowAllUsersToAddSongs: !!saved.allowAllUsersToAddSongs,
			allowRegistration: !!saved.allowRegistration,
			corsOrigin: envValues.CORS_ORIGIN,
			port: envValues.PORT,
		});
	} finally {
		fs.rmSync(stageRoot, { recursive: true, force: true });
	}
}

const versionData = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8'));
const SOCKET_VERSION = versionData['version'];
console.log(`BaryMusic v${SOCKET_VERSION}`)

const baryMusicHome = process.env.BARYMUSIC_HOME
	? path.resolve(process.env.BARYMUSIC_HOME)
	: null;

function migrateLegacyHomeLayout(homeDir) {
	const migrations = [
		['.env', path.join('config', '.env')],
		['db.sqlite3', path.join('data', 'db.sqlite3')],
		['db.sqlite3.bak', path.join('data', 'db.sqlite3.bak')],
		['audio', path.join('data', 'audio')],
		['notes', path.join('data', 'notes')],
	];
	fs.mkdirSync(path.join(homeDir, 'config'), { recursive: true });
	fs.mkdirSync(path.join(homeDir, 'data'), { recursive: true });
	fs.mkdirSync(path.join(homeDir, 'logs'), { recursive: true });
	for (const [legacyRelative, targetRelative] of migrations) {
		const legacyPath = path.join(homeDir, legacyRelative);
		const targetPath = path.join(homeDir, targetRelative);
		if (!fs.existsSync(legacyPath) || fs.existsSync(targetPath)) continue;
		fs.mkdirSync(path.dirname(targetPath), { recursive: true });
		fs.renameSync(legacyPath, targetPath);
		console.log(`Migrated ${legacyRelative} to ${targetRelative}`);
	}
}

if (baryMusicHome) migrateLegacyHomeLayout(baryMusicHome);

const envPath = baryMusicHome
	? path.join(baryMusicHome, 'config', '.env')
	: path.join(__dirname, '.env');
require('dotenv').config({ path: envPath, quiet: true });

const env = process.env;
const toList = v => v ? v.split(',').map(s => s.trim()).filter(Boolean) : [];
const dataDir = baryMusicHome
	? path.join(baryMusicHome, 'data')
	: path.join(__dirname, 'data');
const defaultDbDir = baryMusicHome ? dataDir : __dirname;
const SESSION_TTL_DAYS = 7;

const config = {
    admins:                  toList(env.ADMINS),
    canAddSongs:             toList(env.CAN_ADD_SONGS),
    allowAllUsersToAddSongs: env.ALLOW_ALL_USERS_TO_ADD_SONGS !== 'false',
    allowRegistration:       env.ALLOW_REGISTRATION !== 'false',
    corsOrigin:              env.CORS_ORIGIN || 'http://localhost:3000',
    port:                    parseInt(env.PORT) || 3000,
    host:                    String(env.HOST || '127.0.0.1').trim(),
    dbPath:                  path.join(defaultDbDir, 'db.sqlite3'),
    dbBackupPath:            path.join(defaultDbDir, 'db.sqlite3.bak'),
    envPath,
};

// ─── Katalogi danych (audio, nuty) ──────────────────────────────────
const audioDir = path.join(dataDir, 'audio');
const notesDir = path.join(dataDir, 'notes');
const requiredDirectories = [dataDir, audioDir, notesDir];
if (baryMusicHome) requiredDirectories.push(path.join(baryMusicHome, 'config'), path.join(baryMusicHome, 'logs'));
requiredDirectories.forEach(dir => {
	if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

for (const filePath of [config.dbPath, config.dbBackupPath]) {
	if (filePath === ':memory:') continue;
	fs.mkdirSync(path.dirname(path.resolve(filePath)), { recursive: true });
}

const uploadAudio = multer({
	storage: multer.memoryStorage(),
	limits: { fileSize: 15 * 1024 * 1024 },
	fileFilter: (_req, file, cb) => {
		cb(null, file.mimetype === 'audio/mpeg' || file.originalname.endsWith('.mp3'));
	}
}).single('file');

const SHEETS_STORED_EXTS = new Set(['.svg', '.webp']);

function isSvg(file) {
	return file.mimetype === 'image/svg+xml' || path.extname(file.originalname).toLowerCase() === '.svg';
}

function convertUploadedSheet(input) {
	return sharp(input, { pages: 1, limitInputPixels: MAX_IMAGE_PIXELS })
		.resize({ width: 2500, withoutEnlargement: true })
		.webp({ quality: 88 })
		.toBuffer();
}

function findSheetsFile(songId) {
	for (const ext of SHEETS_STORED_EXTS) {
		const p = path.join(notesDir, songId + ext);
		if (fs.existsSync(p)) return { filePath: p, ext };
	}
	return null;
}

function deleteSheetsFile(songId) {
	for (const ext of SHEETS_STORED_EXTS) {
		const p = path.join(notesDir, songId + ext);
		if (fs.existsSync(p)) fs.unlinkSync(p);
	}
}

const uploadSheets = multer({
	storage: multer.memoryStorage(),
	limits: { fileSize: 30 * 1024 * 1024 },
	fileFilter: (_req, file, cb) => {
		cb(null, file.mimetype.startsWith('image/'));
	}
}).single('file');

const loginAttempts = new Map();
const app = express();
app.set('trust proxy', process.env.TRUST_PROXY !== undefined ? Number(process.env.TRUST_PROXY) : 1);
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });
wss.on('error', error => console.error('WebSocket server error:', error.message));

// WAŻNE: zapytania SQL w WebSocket nie mogą być bez parametryzacji

// ─── Lyrics v2: sections + order ────────────────────────────────────
function resolveLyrics(raw) {
	if (!raw) return [];
	// Stary format (tablica) — zwróć bez zmian
	if (Array.isArray(raw)) return raw;
	// Nowy format v2
	if (raw.version === 2 && raw.sections && raw.order) {
		return raw.order.map((entry, idx) => {
			const section = raw.sections[entry.id];
			if (!section) return null;
			return {
				id: entry.id,
				type: section.type,
				text: section.lines.join('\n'),
				timestamp: entry.timestamp ?? null,
				repeat: entry.repeat ?? null,
				sheetAnchor: entry.sheetAnchor ?? null,
				orderIndex: idx,
			};
		}).filter(Boolean);
	}
	return [];
}

function parseLyricsFromDb(lyricsStr) {
	if (!lyricsStr) return { lyrics: [], lyricsRaw: null };
	const parsed = JSON.parse(lyricsStr);
	return {
		lyrics: resolveLyrics(parsed),
		lyricsRaw: Array.isArray(parsed) ? null : parsed,
	};
}

function parseTagsFromDb(typeStr) {
	if (!typeStr) return [];
	try {
		const parsed = JSON.parse(typeStr);
		if (Array.isArray(parsed)) return parsed.map(t => String(t).trim()).filter(Boolean);
	} catch {}
	// Stary format — pojedynczy string
	return typeStr.trim() ? [typeStr.trim()] : [];
}

function serializeTagsForDb(tags) {
	if (!tags) return null;
	if (Array.isArray(tags)) {
		const clean = tags.map(t => String(t).trim()).filter(Boolean);
		return clean.length ? JSON.stringify(clean) : null;
	}
	// Jeśli string (wsteczna kompatybilność)
	const clean = String(tags).trim();
	return clean ? JSON.stringify([clean]) : null;
}

function getUserSettings(userId, channelId, callback) {
	db.get(
		'SELECT settings FROM user_settings WHERE userId = ? AND (channelId IS NULL OR channelId = ?) ORDER BY channelId DESC, updatedAt DESC LIMIT 1',
		[userId, channelId || null],
		(err, row) => {
			if (err) {
				console.error('Error fetching user settings:', err);
				callback(DEFAULT_DISPLAY_SETTINGS);
				return;
			}

			if (row && row.settings) {
				try {
					const userSettings = JSON.parse(row.settings);
					callback({ ...DEFAULT_DISPLAY_SETTINGS, ...userSettings });
				} catch (e) {
					console.error('Error parsing user settings:', e);
					callback(DEFAULT_DISPLAY_SETTINGS);
				}
			} else {
				callback(DEFAULT_DISPLAY_SETTINGS);
			}
		}
	);
}
// ─────────────────────────────────────────────────────────────────────

const channels = {}

function parseCookies(cookieHeader) {
	const cookies = {};
	if (!cookieHeader) return cookies;
	cookieHeader.split(';').forEach(part => {
		const [key, ...val] = part.split('=');
		if (key) {
			try {
				cookies[key.trim()] = decodeURIComponent(val.join('=').trim());
			} catch {
				cookies[key.trim()] = val.join('=').trim();
			}
		}
	});
	return cookies;
}

function getUsernameFromToken(token) {
	return new Promise((resolve) => {
		if (!token) return resolve(null);
		const now = Math.floor(Date.now() / 1000);
		db.get(
			'SELECT u.username FROM sessions s JOIN users u ON s.userId = u.id WHERE s.token = ? AND s.expiresAt > ?',
			[token, now],
			(err, row) => {
				if (err || !row) return resolve(null);
				resolve(row.username);
			}
	);
})};

// Domyślne ustawienia display (przechowywane w bazie danych per-kanał)
const DEFAULT_DISPLAY_SETTINGS = {
	display: {
		fontFamily: 'Noto Sans',
		fontWeight: '400',
		lineHeight: 1.6,
		letterSpacing: 0,
		textAlign: 'center',
		background: '#141414',
		color: '#ffffff',
		textShadow: 'none',
		leftPadding: 3,
		rightPadding: 3,
		topPadding: 3,
		bottomPadding: 3
	}
};

async function requireWebSocketAuthentication(ws) {
	if (!ws.authToken) {
		ws.send(JSON.stringify({ type: 'error', reason: 'authenticationRequired' }));
		return false;
	}

	try {
		const userId = await verifyToken(ws.authToken);
		if (!userId) {
			ws.userId = null;
			ws.username = null;
			ws.send(JSON.stringify({ type: 'error', reason: 'authenticationRequired' }));
			return false;
		}
		ws.userId = userId;
		ws.username = await getUsernameFromToken(ws.authToken);
		return true;
	} catch (error) {
		console.error('WebSocket authentication error:', error);
		ws.send(JSON.stringify({ type: 'error', reason: 'authenticationError' }));
		return false;
	}
}

wss.on('connection', async (ws, req) => {
	ws.currentChannel = null;
	ws.username = null;
	ws.userId = null;

	const cookies = parseCookies(req.headers.cookie);
	const authToken = cookies.authToken;
	ws.authToken = authToken;
	if (authToken) {
		ws.username = await getUsernameFromToken(authToken);
		ws.userId = await verifyToken(authToken);
	}

	ws.on('message', async (message) => {
		const inp = message.toString('utf8')
		let input;
		try {
			input = JSON.parse(inp);
		} catch {
			ws.send(JSON.stringify({type: 'error', reason: 'invalidJson'}));
			return;
		}

		// console.log('Otrzymano:', inp);
		// może się przydać do debugowania

		switch(input.type) {
			case 'id':
				// otrzymano clientId -> weryfikacja -> wysłanie listy kanałów
				const clientIdRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
				if (clientIdRegex.test(input.clientId)) {
					ws.clientId = input.clientId;
					const channelsList = getChannelsListForClient(ws.clientId);
					ws.send(JSON.stringify({type: 'channels_list', channels: channelsList, socketVersion: SOCKET_VERSION}));
				} else {
					ws.send(JSON.stringify({type: 'new_id', clientId: createClientId()}))
				}
				break;
			case 'select_channel':
				// otrzymano id kanału (selectedId) -> weryfikacja -> dodanie użytkownika do kanału
				const selectedId = input.selectedId;
				if (typeof selectedId !== 'number' || !Number.isInteger(selectedId)) {
					ws.send(JSON.stringify({type: 'error', reason: 'invalidChannelId'}))
					return;
				}

				if (!channels[selectedId]) {
					ws.send(JSON.stringify({type: 'error', reason: 'unexistingChannelId'}))
					return;
				}

				if (channels[selectedId].ownerWs === ws) {
					ws.send(JSON.stringify({type: 'error', reason: 'cantJoinToOwnedChannel'}))
					return;
				}
				
				deleteUserFromChannels(ws);
				deleteOwnedChannels(ws);
				addUserToChannel(ws, selectedId);
				ws.currentChannel = selectedId;
				broadcastChannelUpdate();
				broadcastChannelUsers(selectedId);
				sendSuccess(ws);

				break;
			case 'new_channel':
				if (!await requireWebSocketAuthentication(ws)) return;
				// tworzenie nowego kanału
				if (typeof input.channelName !== 'string') {
					ws.send(JSON.stringify({type: 'error', reason: 'invalidChannelName'}))
					return;
				}

				const trimmedName = input.channelName.trim();
				if (trimmedName.length == 0) {
					ws.send(JSON.stringify({type: 'error', reason: 'emptyChannelName'}))
					return;
				}

				let nameExistsId = null;
				for (const id in channels) {
					if (channels[id].name === trimmedName) {
						nameExistsId = id;
						break;
					}
				}

				if (nameExistsId !== null && channels[nameExistsId].ownerWs !== ws) {
					ws.send(JSON.stringify({type: 'error', reason: 'channelNameExists'}))
					return;
				}

				deleteUserFromChannels(ws);
				deleteOwnedChannels(ws);
				const newChannelId = createNewChannel(input.channelName.trim(), ws);
				ws.currentChannel = newChannelId;
				broadcastChannelUpdate();
				broadcastChannelUsers(newChannelId);
				sendSuccess(ws);
				break;
			case 'pong':
				ws._wsAlive = true;
				ws.send(JSON.stringify({ type: 'pong_return', clientTime: input.clientTime }));
				break;
			case 'lyric':
				if (!ws.currentChannel) {
					ws.send(JSON.stringify({type: 'error', reason: 'notInChannel'}));
					break;
				}

				if (typeof input.songId !== 'number') {
					ws.send(JSON.stringify({type: 'error', reason: 'missingLyricsData_songId'}));
					break;
				}


				if (typeof input.lyricId !== 'number' && typeof input.lyricId !== 'string') {
					ws.send(JSON.stringify({type: 'error', reason: 'missingLyricsData_lyricId1'}));
					break;
				}
				if (typeof input.lyricId === 'number' && !Number.isInteger(input.lyricId)) {
					ws.send(JSON.stringify({type: 'error', reason: 'missingLyricsData_lyricId2'}));
					break;
				}


				if (typeof input.lyricIndex !== 'number') {
					ws.send(JSON.stringify({type: 'error', reason: 'missingLyricsData_lyricIndex1'}));
					break;
				}
				if (!Number.isInteger(input.lyricIndex)) {
					ws.send(JSON.stringify({type: 'error', reason: 'missingLyricsData_lyricIndex2'}));
					break;
				}


				const lyricChannel = channels[ws.currentChannel];
				if (!lyricChannel) {
					ws.send(JSON.stringify({type: 'error', reason: 'channelNotExists'}));
					break;
				}

				if (lyricChannel.ownerWs !== ws) {
					ws.send(JSON.stringify({type: 'error', reason: 'notChannelOwner'}));
					break;
				}
				if (!await requireWebSocketAuthentication(ws)) break;

				db.get(
					`SELECT s.isPublic, s.title, s.type, s.bpm, s.key, s.timeSignature, s.composer, s.year, s.lyrics, s.filesAudio, s.filesSheets
					 FROM songs s
					 WHERE s.id = ? AND (s.isPublic = 1 OR s.uploadedBy = (SELECT id FROM users WHERE username = ?))`,
					[input.songId, ws.username],
					(err, song) => {
					if (err || !song) {
						ws.send(JSON.stringify({type: 'error', reason: 'songNotFound'}));
						return;
					}

					const msgObj = {
						type: 'lyric',
						songId: input.songId,
						lyricId: input.lyricId,
						lyricIndex: input.lyricIndex
					};

					if (song.isPublic === 0) {
						const { lyrics, lyricsRaw } = parseLyricsFromDb(song.lyrics);
						msgObj.songData = {
							id: input.songId,
							title: song.title,
							tags: parseTagsFromDb(song.type),
							bpm: song.bpm,
							key: song.key,
							timeSignature: song.timeSignature,
							composer: song.composer,
							year: song.year,
							lyrics,
							lyricsRaw,
							files: { audio: song.filesAudio === 1, sheets: song.filesSheets || null },
							isPublic: false,
						};
					}

					const lyricMessage = JSON.stringify(msgObj);
					lyricChannel.clients.forEach(client => {
						if (client.readyState === WebSocket.OPEN) {
							client.send(lyricMessage);
						}
					});
				});

				break;
			case 'clear':
				if (!ws.currentChannel) {
					ws.send(JSON.stringify({type: 'error', reason: 'notInChannel'}));
					break;
				}

				const clearChannel = channels[ws.currentChannel];
				if (!clearChannel) {
					ws.send(JSON.stringify({type: 'error', reason: 'channelNotExists'}));
					break;
				}

				if (clearChannel.ownerWs !== ws) {
					ws.send(JSON.stringify({type: 'error', reason: 'notChannelOwner'}));
					break;
				}
				if (!await requireWebSocketAuthentication(ws)) break;
				
				clearChannel.clients.forEach(client => {
					if (client.readyState === WebSocket.OPEN) {
						client.send(JSON.stringify({type: 'clear'}));
					}
				});
				
				break;
			case 'channel_exit':
				broadcastChannelUsers(ws.currentChannel);
				deleteUserFromChannels(ws)
				deleteOwnedChannels(ws);
				broadcastChannelUpdate();
				break;
			case 'setlist_select':
				if (!ws.currentChannel) {
					ws.send(JSON.stringify({type: 'error', reason: 'notInChannel'}));
					break;
				}
				const slSelectChannel = channels[ws.currentChannel];
				if (!slSelectChannel) {
					ws.send(JSON.stringify({type: 'error', reason: 'channelNotExists'}));
					break;
				}
				if (slSelectChannel.ownerWs !== ws) {
					ws.send(JSON.stringify({type: 'error', reason: 'notChannelOwner'}));
					break;
				}
				if (!await requireWebSocketAuthentication(ws)) break;
				if (typeof input.setlistId !== 'number' || !Number.isInteger(input.setlistId) || input.setlistId <= 0) {
					ws.send(JSON.stringify({type: 'error', reason: 'invalidSetlistId'}));
					break;
				}
				if (typeof input.itemIndex !== 'number' || !Number.isInteger(input.itemIndex) || input.itemIndex < 0) {
					ws.send(JSON.stringify({type: 'error', reason: 'invalidItemIndex'}));
					break;
				}
				{
					const slMsg = JSON.stringify({type: 'setlist_select', setlistId: input.setlistId, itemIndex: input.itemIndex});
					slSelectChannel.clients.forEach(client => {
						if (client.readyState === WebSocket.OPEN) client.send(slMsg);
					});
				}
				break;
			case 'setlist_clear':
				if (!ws.currentChannel) {
					ws.send(JSON.stringify({type: 'error', reason: 'notInChannel'}));
					break;
				}
				const slClearChannel = channels[ws.currentChannel];
				if (!slClearChannel) {
					ws.send(JSON.stringify({type: 'error', reason: 'channelNotExists'}));
					break;
				}
				if (slClearChannel.ownerWs !== ws) {
					ws.send(JSON.stringify({type: 'error', reason: 'notChannelOwner'}));
					break;
				}
				if (!await requireWebSocketAuthentication(ws)) break;
				{
					const slClearMsg = JSON.stringify({type: 'setlist_clear'});
					slClearChannel.clients.forEach(client => {
						if (client.readyState === WebSocket.OPEN) client.send(slClearMsg);
					});
				}
				break;
			case 'display_settings_update':
				// Zapisanie ustawień display do bazy danych dla kanału
				if (!ws.currentChannel) {
					ws.send(JSON.stringify({type: 'error', reason: 'notInChannel'}));
					break;
				}

				if (!input.settings || typeof input.settings !== 'object') {
					ws.send(JSON.stringify({type: 'error', reason: 'invalidSettings'}));
					break;
				}

				const dsChannel = channels[ws.currentChannel];
				if (!dsChannel) {
					ws.send(JSON.stringify({type: 'error', reason: 'channelNotExists'}));
					break;
				}

				if (dsChannel.ownerWs !== ws) {
					ws.send(JSON.stringify({type: 'error', reason: 'notChannelOwner'}));
					break;
				}
				if (!await requireWebSocketAuthentication(ws)) break;

				// Jeśli userId istnieje, zapisz ustawienia do bazy
				if (ws.userId) {
					const settingsJson = JSON.stringify(input.settings);
					
					// Sprawdź czy istnieją już ustawienia dla tego kanału
					db.get(
						'SELECT id FROM user_settings WHERE userId = ? AND channelId = ?',
						[ws.userId, ws.currentChannel],
						(err, row) => {
							if (err) {
								console.error('Database error:', err);
								ws.send(JSON.stringify({type: 'error', reason: 'databaseError'}));
								return;
							}

							const updateCallback = (updateErr) => {
								if (updateErr) {
									console.error('Database update error:', updateErr);
									ws.send(JSON.stringify({type: 'error', reason: 'databaseError'}));
									return;
								}

								// Rozesłanie ustawień do wszystkich klientów w kanale
								const settingsMsg = JSON.stringify({
									type: 'display_settings_update',
									settings: input.settings
								});
								dsChannel.clients.forEach(client => {
									if (client.readyState === WebSocket.OPEN) {
										client.send(settingsMsg);
									}
								});

							};

							if (row) {
								// Aktualizuj istniejące ustawienie
								db.run(
									'UPDATE user_settings SET settings = ?, updatedAt = strftime("%s", "now") WHERE id = ?',
									[settingsJson, row.id],
									updateCallback
								);
							} else {
								// Stwórz nowe ustawienie
								db.run(
									'INSERT INTO user_settings (userId, channelId, settings, updatedAt) VALUES (?, ?, ?, strftime("%s", "now"))',
									[ws.userId, ws.currentChannel, settingsJson],
									updateCallback
								);
							}
						}
					);
				} else {
					// Jeśli brak userId (nie zalogowany), tylko rozesłanie bez zapisu
					const settingsMsg = JSON.stringify({
						type: 'display_settings_update',
						settings: input.settings
					});
					dsChannel.clients.forEach(client => {
						if (client.readyState === WebSocket.OPEN) {
							client.send(settingsMsg);
						}
					});
				}
				break;
			default:
				console.warn('Unknown message type:', input.type);
		}
	});

	ws.on('error', (error) => {
		console.error('WebSocket error:', error);
	});

	ws.on('close', () => {
		// rozłączono -> usuń kanały w których client_id jest ownerem lub klientem
		deleteUserFromChannels(ws)
		deleteOwnedChannels(ws);
		broadcastChannelUpdate();
		broadcastChannelUsers(ws.currentChannel);
	});
});

function createClientId() {
	// wygeneruj clientId
	return crypto.randomUUID();
}

function addUserToChannel(ws, channel_id) {
	// dodanie użytkownika client_id do kanału channel_id
	channels[channel_id].clients.push(ws);

	// Wyślij ustawienia kanału do nowego klienta
	const sendChannelSettings = () => {
		db.get(
			'SELECT settings FROM user_settings WHERE channelId = ? ORDER BY updatedAt DESC LIMIT 1',
			[channel_id],
			(err, row) => {
				if (err) {
					console.error('Error fetching channel settings:', err);
					return;
				}

				let channelSettings = null;
				if (row && row.settings) {
					try {
						channelSettings = JSON.parse(row.settings);
					} catch (e) {
							console.error('Error parsing channel settings:', e);
					}
				}

			if (channelSettings) {
				ws.send(JSON.stringify({
					type: 'display_settings_update',
					settings: channelSettings
				}));
			}
		}
	);
	};

	// Wyślij ustawienia po krótkim opóźnieniu, aby upewnić się, że klient jest gotowy
	setTimeout(sendChannelSettings, 100);
}

function deleteUserFromChannels(ws) {
	// usuwanie użytkownika client_id z kanału
	for (const id in channels) {
		for (let i = 0; i < channels[id].clients.length; i++) {
			if (channels[id].clients[i] === ws) {
				channels[id].clients.splice(i, 1);
				break;
			}
		}
	}
}
function deleteOwnedChannels(ws) {
	// usuwanie kanału, którego właścicielem jest owner_id
	const toDelete = [];
	for (const id in channels) {
		if (channels[id].ownerWs === ws) {
			toDelete.push(id);
		}
	}

	toDelete.forEach(id => {
		const disconnectMsg = JSON.stringify({type: 'channel_deleted', channelId: id});
		channels[id].clients.forEach(client => {
			if (client.readyState === WebSocket.OPEN) {
				client.send(disconnectMsg);
				client.currentChannel = null;
			}
		});
		delete channels[id];
	});
}

function createNewChannel(channel_name, ownerWs) {
	// tworzenie nowego kanału o nazwie channel_nane -> ustawianie właściciela na client_id
	// utwórz najniższy niestniejący ID kanału
	let newId = 1;
	while (channels.hasOwnProperty(newId)) { // czy istnieje kanał o takim id?
		newId++;
	}

	channels[newId] = {
		name: channel_name, 
		ownerWs: ownerWs,
		clients: []
	};
	return newId;
}

function getChannelsListForClient(clientId) {
	const list = {};
	for (const id in channels) {
											/* taki for   element   warunek  */
		const isUserInChannel = channels[id].clients.some(client => client.clientId === clientId); 
		list[id] = {
			name: channels[id].name,
			userCount: channels[id].clients.length,
			isUserInChannel: isUserInChannel
		};
	}
	return list;
}

function broadcastChannelUpdate() {
	wss.clients.forEach(client => {
		if (client.readyState === WebSocket.OPEN && client.clientId) {
			const channelsList = getChannelsListForClient(client.clientId);
			const updateMsg = JSON.stringify({type: 'channels_updated', channels: channelsList});
			client.send(updateMsg);
		}
	});
}

function broadcastChannelUsers(channelId) {
	const channel = channels[channelId];
	if (!channel) return;

	const users = [];

	// Właściciel kanału
	users.push({
		username: channel.ownerWs.username || null,
		isOwner: true
	});

	// Klienci w kanale
	channel.clients.forEach(client => {
		users.push({
			username: client.username || null,
			isOwner: false
		});
	});

	const msg = JSON.stringify({ type: 'channel_users', users });

	// Wyślij do właściciela
	if (channel.ownerWs.readyState === WebSocket.OPEN) {
		channel.ownerWs.send(msg);
	}
	// Wyślij do klientów
	channel.clients.forEach(client => {
		if (client.readyState === WebSocket.OPEN) {
			client.send(msg);
		}
	});
}

function sendSuccess(ws) {
	ws.send(JSON.stringify({type: 'success'}))
}


// baza danych SQLite

// Funkcja tworząca backup bazy
function createBackup(callback) {
	if (!fs.existsSync(config.dbPath)) {
		console.log('Database file does not exist - skipping backup');
		if (typeof callback === 'function') callback();
		return;
	}

	try {
		const backupData = fs.readFileSync(config.dbPath);
		fs.writeFileSync(config.dbBackupPath, backupData);
		console.log(`Backup created: ${config.dbBackupPath}`);
	} catch (err) {
		console.error('Backup creation error:', err);
	} finally {
		if (typeof callback === 'function') callback();
	}
}

const db = new sqlite3.Database(config.dbPath, (err) => {
	if (err) {
		console.error('Database connection error:', err);
    } else {
        createBackup(() => {
            initializeDatabase(() => {
                applyConfigToDatabase();
            });
        });
    }
});

function initializeDatabase(callback) {
	db.serialize(() => {
		db.run("PRAGMA foreign_keys = ON");

		db.run(`CREATE TABLE IF NOT EXISTS "users" (
			"id"	INTEGER NOT NULL UNIQUE,
			"username"	TEXT NOT NULL UNIQUE,
			"passwordHash"	TEXT NOT NULL,
			"canAddSongs"	INTEGER DEFAULT 0,
			"isAdmin"	INTEGER DEFAULT 0,
			"createdAt"	INTEGER DEFAULT (strftime('%s', 'now')),
			PRIMARY KEY("id" AUTOINCREMENT)
		)`);

		db.run(`CREATE TABLE IF NOT EXISTS "sessions" (
			"token"	TEXT NOT NULL UNIQUE,
			"userId"	INTEGER NOT NULL,
			"expiresAt"	INTEGER NOT NULL,
			"createdAt"	INTEGER DEFAULT (strftime('%s', 'now')),
			PRIMARY KEY("token"),
			FOREIGN KEY("userId") REFERENCES "users"("id")
		)`);

		db.run(`CREATE TABLE IF NOT EXISTS "songs" (
			"id"	INTEGER PRIMARY KEY AUTOINCREMENT,
			"title"	TEXT NOT NULL,
			"type"	TEXT,
			"bpm"	INTEGER,
			"key"	TEXT,
			"timeSignature"	TEXT,
			"composer"	TEXT,
			"year"	INTEGER,
			"lyrics"	TEXT,
			"filesAudio"	INTEGER DEFAULT 0,
			"filesSheets"	TEXT DEFAULT NULL,
			"uploadedBy"	INTEGER,
			"isPublic"	INTEGER DEFAULT 1,
			"createdAt"	INTEGER DEFAULT (strftime('%s', 'now')),
			FOREIGN KEY("uploadedBy") REFERENCES "users"("id")
		)`);

		db.run(`CREATE TABLE IF NOT EXISTS "setlists" (
			"id"          INTEGER PRIMARY KEY AUTOINCREMENT,
			"title"       TEXT NOT NULL,
			"description" TEXT,
			"items"       TEXT DEFAULT '[]',
			"uploadedBy"  INTEGER,
			"isPublic"    INTEGER DEFAULT 1,
			"createdAt"   INTEGER DEFAULT (strftime('%s', 'now')),
			FOREIGN KEY("uploadedBy") REFERENCES "users"("id")
		)`, (err) => {
			if (err) console.error('Error initializing the setlists table:', err);
		});

		db.run(`CREATE TABLE IF NOT EXISTS "user_settings" (
			"id" INTEGER PRIMARY KEY AUTOINCREMENT,
			"userId" INTEGER NOT NULL,
			"channelId" INTEGER,
			"settings" TEXT NOT NULL,
			"createdAt" INTEGER DEFAULT (strftime('%s', 'now')),
			"updatedAt" INTEGER DEFAULT (strftime('%s', 'now')),
			FOREIGN KEY("userId") REFERENCES "users"("id") ON DELETE CASCADE,
			UNIQUE("userId", "channelId")
		)`, (err) => {
			if (err) console.error('Error initializing the user_settings table:', err);
		});

		db.run('PRAGMA user_version = 1', (err) => {
			if (err) console.error('Error setting database schema version:', err);
			if (typeof callback === 'function') callback();
		});
	});
}

function applyConfigToDatabase() {
	if (!config) return;

	db.serialize(() => {
		db.run('UPDATE users SET isAdmin = 0', (err) => {
			if (err) console.error('Error resetting isAdmin:', err);
		});
		if (config.admins.length > 0) {
			config.admins.forEach(username => {
				db.run('UPDATE users SET isAdmin = 1 WHERE username = ?', [username], (err) => {
					if (err) console.error(`Error setting admin for "${username}":`, err);
				});
			});
		}

		db.run('UPDATE users SET canAddSongs = 0', (err) => {
			if (err) console.error('Error resetting canAddSongs:', err);
		});
		if (Array.isArray(config.canAddSongs)) {
			config.canAddSongs.forEach(username => {
				db.run('UPDATE users SET canAddSongs = 1 WHERE username = ?', [username], (err) => {
					if (err) console.error(`Error setting canAddSongs for "${username}":`, err);
				});
			});
		}
	});
}

const corsOrigin = config.corsOrigin || 'http://localhost:3000';
app.use(cors({
  origin: corsOrigin,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  exposedHeaders: ['Content-Disposition']
}));

app.use(express.json());
app.use(cookieParser());

function getServiceHealth(callback) {
	const checks = {
		database: { ok: false },
		websocket: {
			ok: !!(wss && wss.clients),
			clients: wss?.clients?.size || 0,
		},
		http: { ok: !!server.listening },
	};

	db.get('SELECT 1', (err) => {
		if (err) {
			checks.database.error = err.message;
		} else {
			checks.database.ok = true;
		}

		const ok = Object.values(checks).every(check => check.ok);
		callback({
			ok,
			status: ok ? 'ok' : 'degraded',
			version: SOCKET_VERSION,
			uptimeSeconds: Math.floor(process.uptime()),
			timestamp: new Date().toISOString(),
			checks,
		});
	});
}

// W Electronie frontend jest lokalny, więc nie zapisujemy go w cache przeglądarki.
// Dzięki temu kolejne uruchomienie od razu korzysta z aktualnych plików aplikacji.
const frontendPath = fs.existsSync(path.join(__dirname, 'frontend')) 
	? path.join(__dirname, 'frontend')
	: path.join(__dirname, '..', 'frontend');
app.use(express.static(frontendPath, {
	setHeaders(res) {
		if (process.versions.electron) {
			res.setHeader('Cache-Control', 'no-store');
		}
	},
}));

const authLimiter = rateLimit({
    windowMs: 30 * 1000, // 30 sekund
    max: 5, // max 5 prób
    message: { error: 'Zbyt wiele prób, spróbuj ponownie za 30 sekund.' },
    standardHeaders: true,
    legacyHeaders: false,
});

const songWriteLimiter = rateLimit({
    windowMs: 60 * 1000, // 60 sekund
    max: 20,
    message: { error: 'Zbyt wiele żądań, spróbuj ponownie za chwilę.' },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => req.cookies.authToken || ipKeyGenerator(req.ip),
});

const transferLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 10,
    message: { error: 'Zbyt wiele operacji importu lub eksportu, spróbuj ponownie za chwilę.' },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => req.cookies.authToken || ipKeyGenerator(req.ip),
});

// Rejestracja
app.get('/api/auth/bootstrap', (_req, res) => {
	db.get('SELECT EXISTS (SELECT 1 FROM users) AS hasUsers', (err, row) => {
		if (err) {
			console.error('Bootstrap status database error:', err);
			return res.status(500).json({ error: 'Błąd bazy danych' });
		}

		res.json({ needsInitialAdmin: row.hasUsers === 0, canRestoreBackup: row.hasUsers === 0 });
	});
});

app.post('/api/auth/register', authLimiter, async (req, res) => {
	if (config.allowRegistration === false) {
		return res.status(403).json({ error: 'Rejestracja jest wyłączona przez administratora' });
	}

	const { username, password } = req.body;

	if (!username || !password) {
		return res.status(400).json({ error: 'Login i hasło są wymagane' });
	}

	if (typeof username !== 'string' || typeof password !== 'string') {
		return res.status(400).json({ error: 'Nieodpowiednie typy danych' });
	}

	if (username.length < 3 || username.length > 32) {
		return res.status(400).json({ error: 'Login musi mieć od 3 do 32 znaków' });
	}

	if (password.length < 8) {
		return res.status(400).json({ error: 'Hasło musi mieć przynajmniej 8 znaków' });
	}

	try {
		const bcrypt = require('bcrypt');
		const passwordHash = await bcrypt.hash(password, 12);

		db.run(
			`INSERT INTO users (username, passwordHash, isAdmin)
			 SELECT ?, ?, CASE WHEN NOT EXISTS (SELECT 1 FROM users) THEN 1 ELSE 0 END`,
			[username, passwordHash],
			(err) => {
			if (err) {
				if (err.message.includes('UNIQUE constraint failed')) {
					return res.status(409).json({ error: 'Użytkownik o takim loginie już istnieje' });
				}
				console.error('Registration database error:', err);
				return res.status(500).json({ error: 'Błąd bazy danych' });
			}

			db.get('SELECT isAdmin FROM users WHERE username = ?', [username], (adminError, user) => {
				if (!adminError && user?.isAdmin === 1) {
					const admins = [...new Set([...config.admins, username])];
					updateEnvFile({ ADMINS: admins.join(',') });
					config.admins = admins;
				}
				res.status(201).json({ message: 'Utworzono użytkownika' });
			});
		});
	} catch (error) {
		console.error('Bcrypt error:', error);
		res.status(500).json({ error: 'Rejestracja nieudana' });
	}
});


// Logowanie
app.post('/api/auth/login', authLimiter, async (req, res) => {
	const { username, password } = req.body;

	if (!username || !password) {
		return res.status(400).json({ error: 'Login i hasło są wymagane' });
	}

	try {
		db.get(
			'SELECT id, passwordHash, canAddSongs, isAdmin FROM users WHERE username = ?',
			[username],
			async (err, user) => {
				if (err) {
					console.error('Login database error:', err);
					return res.status(500).json({ error: 'Błąd bazy danych' });
				}

				if (!user) {
					return res.status(401).json({ error: 'Nieprawidłowy login lub (i) hasło' });
				}

				const passwordMatch = await bcrypt.compare(password, user.passwordHash);
				if (!passwordMatch) {
					return res.status(401).json({ error: 'Nieprawidłowy login lub (i) hasło' });
				}

				// Hasło OK - generuj token
				const token = createClientId();
				const expiresAt = Math.floor(Date.now() / 1000) + (SESSION_TTL_DAYS * 24 * 60 * 60);

				db.run(
					'INSERT INTO sessions (token, userId, expiresAt) VALUES (?, ?, ?)',
					[token, user.id, expiresAt],
					(err) => {
						if (err) {
							console.error('Session creation error:', err);
							return res.status(500).json({ error: 'Nie udało się utworzyć sesji' });
						}

						res.cookie('authToken', token, {
							httpOnly: true,
							secure: true,
							sameSite: 'strict',
							maxAge: SESSION_TTL_DAYS * 24 * 60 * 60 * 1000
						});
						const canAddSongs = user.isAdmin === 1 || user.canAddSongs === 1 || config.allowAllUsersToAddSongs !== false;
						const isAdmin = user.isAdmin === 1;
						res.json({ userId: user.id, username, canAddSongs, isAdmin });
					}
				);
			}
		);
	} catch (error) {
		console.error('Login error:', error);
		res.status(500).json({ error: 'Logowanie nieudane' });
	}
});

// Wylogowywaie
app.post('/api/auth/logout', async (req, res) => {
	const token = req.cookies.authToken;

	if (!token) {
		return res.status(400).json({ error: 'Wymagany token' });
	}

	db.run('DELETE FROM sessions WHERE token = ?', [token], (err) => {
		if (err) {
			console.error('Logout database error:', err);
			return res.status(500).json({ error: 'Wylogowanie nieudane' });
		}
		wss.clients.forEach((client) => {
			if (client.authToken === token) client.terminate();
		});
		
		// Usuń cookie
		res.clearCookie('authToken', {
			httpOnly: true,
			secure: true,
			sameSite: 'strict'
		});
		
		res.json({ message: 'Wylogowano pomyślnie' });
	});
});

// Funkcja pomocnicza - Sprawdź token
function verifyToken(token) {
	return new Promise((resolve, reject) => {
		db.get(
			'SELECT userId, expiresAt FROM sessions WHERE token = ?',
			[token],
			(err, row) => {
				if (err) return reject(err);
				if (!row) return resolve(null);
				if (row.expiresAt < Math.floor(Date.now() / 1000)) {
					db.run('DELETE FROM sessions WHERE token = ?', [token]);
					return resolve(null);
				} else {
					return resolve(row.userId);
				}
			}
		);
	});
}

// Zweryfikuj token
async function requireAuthenticated(req, res, next) {
	const authToken = req.cookies.authToken;
	if (!authToken) return res.status(401).json({ error: 'Wymagane uwierzytelnienie' });

	try {
		const userId = await verifyToken(authToken);
		if (!userId) return res.status(401).json({ error: 'Nieprawidłowy lub wygasły token' });
		req.authToken = authToken;
		req.userId = userId;
		next();
	} catch (error) {
		console.error('API authentication error:', error);
		res.status(500).json({ error: 'Błąd weryfikacji uwierzytelnienia' });
	}
}

app.get('/api/auth/me', async (req, res) => {
	const token = req.cookies.authToken;

    if (!token) {
        return res.status(401).json({ error: 'Wymagany token' });
    }

	const userId = await verifyToken(token);

	if (!userId) {
		return res.status(401).json({ error: 'Nieprawidłowy lub wygasły token' });
	}

	const newExpiresAt = Math.floor(Date.now() / 1000) + (SESSION_TTL_DAYS * 24 * 60 * 60);

	db.run('UPDATE sessions SET expiresAt = ? WHERE token = ?', [newExpiresAt, token], (err) => {
		if (err) console.error('Session renewal error:', err);
	});

	res.cookie('authToken', token, {
		httpOnly: true,
		secure: true,
		sameSite: 'strict',
		maxAge: SESSION_TTL_DAYS * 24 * 60 * 60 * 1000
	});

	db.get(
		'SELECT id, username, canAddSongs, isAdmin FROM users WHERE id = ?',
		[userId],
		(err, user) => {
			if (err) {
				console.error('Auth profile database error:', err);
				return res.status(500).json({ error: 'Błąd bazy danych' });
			}

			if (!user) {
				return res.status(404).json({ error: 'Nie znaleziono użytkownika' });
			}

			res.json({
				userId: user.id,
				username: user.username,
				canAddSongs: user.isAdmin === 1 || user.canAddSongs === 1 || config.allowAllUsersToAddSongs !== false,
				isAdmin: user.isAdmin === 1
			});
		}
	);
});

// GET wszystkie publiczne piosenki + prywatne zalogowanego użytkownika
app.get('/api/songs', requireAuthenticated, async (req, res) => {
	const userId = req.userId;

	const query = userId
		? `SELECT s.*, u.username as uploadedByUsername
		   FROM songs s
		   LEFT JOIN users u ON s.uploadedBy = u.id
		   WHERE s.isPublic = 1 OR s.uploadedBy = ?
		   ORDER BY s.title ASC`
		: `SELECT s.*, u.username as uploadedByUsername
		   FROM songs s
		   LEFT JOIN users u ON s.uploadedBy = u.id
		   WHERE s.isPublic = 1
		   ORDER BY s.title ASC`;
	const params = userId ? [userId] : [];

	db.all(query, params, (err, rows) => {
		if (err) {
			console.error('Error fetching songs:', err);
			return res.status(500).json({ error: 'Błąd bazy danych' });
		}

		const songs = rows.map(row => {
			const { lyrics, lyricsRaw } = parseLyricsFromDb(row.lyrics);
			return {
				id: row.id,
				title: row.title,
				tags: parseTagsFromDb(row.type),
				bpm: row.bpm,
				key: row.key,
				timeSignature: row.timeSignature,
				composer: row.composer,
				year: row.year,
				lyrics,
				lyricsRaw,
				files: {
					audio: row.filesAudio === 1,
					sheets: row.filesSheets || null
				},
				uploadedBy: row.uploadedBy,
				uploadedByUsername: row.uploadedByUsername,
				isPublic: row.isPublic === 1,
			};
		});

		res.json(songs);
	});
});

// GET pojedyncza piosenka po ID
app.get('/api/songs/:id', requireAuthenticated, async (req, res) => {
	const { id } = req.params;
	const userId = req.userId;

	let isAdmin = false;
	if (userId) {
		await new Promise(resolve => db.get('SELECT isAdmin FROM users WHERE id = ?', [userId], (err, row) => {
			if (!err && row) isAdmin = row.isAdmin === 1;
			resolve();
		}));
	}

	const whereClause = isAdmin ? 'WHERE s.id = ?' : 'WHERE s.id = ? AND (s.isPublic = 1 OR s.uploadedBy = ?)';
	const params = isAdmin ? [id] : [id, userId];

	db.get(
		`SELECT s.*, u.username as uploadedByUsername
		FROM songs s
		LEFT JOIN users u ON s.uploadedBy = u.id
		${whereClause}`,
		params,
		(err, row) => {
			if (err) {
				console.error('Error fetching song:', err);
				return res.status(500).json({ error: 'Błąd bazy danych' });
			}

			if (!row) {
				return res.status(404).json({ error: 'Nie znaleziono piosenki' });
			}

			const { lyrics, lyricsRaw } = parseLyricsFromDb(row.lyrics);
			const song = {
				id: row.id,
				title: row.title,
				tags: parseTagsFromDb(row.type),
				bpm: row.bpm,
				key: row.key,
				timeSignature: row.timeSignature,
				composer: row.composer,
				year: row.year,
				lyrics,
				lyricsRaw,
				files: {
					audio: row.filesAudio === 1,
					sheets: row.filesSheets || null
				},
				uploadedBy: row.uploadedBy,
				uploadedByUsername: row.uploadedByUsername,
				isPublic: row.isPublic === 1,
			};

			res.json(song);
		}
	);
});

// POST nowa piosenka
app.post('/api/songs', requireAuthenticated, songWriteLimiter, async (req, res) => {
	const token = req.authToken;

	if (!token) {
		return res.status(401).json({ error: 'Wymagane uwierzytelnienie' });
	}

	const userId = req.userId;
	if (!userId) {
		return res.status(401).json({ error: 'Nieprawidłowy token' });
	}

	// Sprawdź uprawnienia
	db.get(
		'SELECT canAddSongs, isAdmin FROM users WHERE id = ?',
		[userId],
		(err, user) => {
			if (err) {
				console.error('Song create permission database error:', err);
				return res.status(500).json({ error: 'Błąd bazy danych' });
			}

			if (!user) {
				return res.status(403).json({ error: 'Brak uprawnień do dodawania piosenek' });
			}

			const canAdd = user.isAdmin === 1 || user.canAddSongs === 1 || config.allowAllUsersToAddSongs !== false;
			if (!canAdd) {
				return res.status(403).json({ error: 'Brak uprawnień do dodawania piosenek' });
			}

			const { title, tags, bpm, key, timeSignature, composer, year, lyrics, files, isPublic} = req.body;

			if (!title) {
				return res.status(400).json({ error: 'Tytuł jest wymagany' });
			}
			if (typeof title !== 'string' || title.length > 200) {
				return res.status(400).json({ error: 'Tytuł może mieć maksymalnie 200 znaków' });
			}
			if (composer != null && (typeof composer !== 'string' || composer.length > 200)) {
				return res.status(400).json({ error: 'Kompozytor może mieć maksymalnie 200 znaków' });
			}

			const lyricsJSON = JSON.stringify(lyrics || []);
			const tagsJSON = serializeTagsForDb(tags);
			const filesAudio = files?.audio ? 1 : 0;
			const publicFlag = isPublic !== undefined ? (isPublic ? 1 : 0) : 1;

			db.run(
				`INSERT INTO songs (title, type, bpm, key, timeSignature, composer, year, lyrics, filesAudio, uploadedBy, isPublic)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
				[title, tagsJSON, bpm, key, timeSignature, composer, year, lyricsJSON, filesAudio, userId, publicFlag],
				function(err) {
					if (err) {
						console.error('Error adding song:', err);
						return res.status(500).json({ error: 'Błąd bazy danych' });
					}

					res.status(201).json({ message: 'Piosenka została dodana', id: this.lastID });
				}
			);
		}
	);
});

// PUT aktualizacja piosenki
app.put('/api/songs/:id', requireAuthenticated, songWriteLimiter, async (req, res) => {
	const token = req.authToken;
	const { id } = req.params;

	if (!token) {
		return res.status(401).json({ error: 'Wymagane uwierzytelnienie' });
	}

	const userId = req.userId;
	if (!userId) {
		return res.status(401).json({ error: 'Nieprawidłowy token' });
	}

	// Sprawdź czy użytkownik może edytować
	db.get(
		'SELECT uploadedBy FROM songs WHERE id = ?',
		[id],
		(err, song) => {
			if (err) {
				console.error('Song update lookup error:', err);
				return res.status(500).json({ error: 'Błąd bazy danych' });
			}

			if (!song) {
				return res.status(404).json({ error: 'Nie znaleziono piosenki' });
			}

			db.get(
				'SELECT isAdmin FROM users WHERE id = ?',
				[userId],
				(err, user) => {
					if (err) {
						console.error('Song update authorization database error:', err);
						return res.status(500).json({ error: 'Błąd bazy danych' });
					}

					// Tylko właściciel lub admin może edytować
					if (song.uploadedBy !== userId && user.isAdmin !== 1) {
						return res.status(403).json({ error: 'Brak uprawnień do edycji tej piosenki' });
					}

					const { title, tags, bpm, key, timeSignature, composer, year, lyrics, files, isPublic } = req.body;

					if (title !== undefined && (typeof title !== 'string' || title.length > 200)) {
						return res.status(400).json({ error: 'Tytuł może mieć maksymalnie 200 znaków' });
					}
					if (composer != null && (typeof composer !== 'string' || composer.length > 200)) {
						return res.status(400).json({ error: 'Kompozytor może mieć maksymalnie 200 znaków' });
					}

					const lyricsJSON = lyrics ? JSON.stringify(lyrics) : undefined;
					const tagsJSON = tags !== undefined ? serializeTagsForDb(tags) : undefined;
					const filesAudio = files?.audio !== undefined ? (files.audio ? 1 : 0) : undefined;
					const publicFlag = isPublic !== undefined ? (isPublic ? 1 : 0) : undefined;

					// Buduj dynamiczne zapytanie SQL
					const updates = [];
					const values = [];

					if (title !== undefined) { updates.push('title = ?'); values.push(title); }
					if (tagsJSON !== undefined) { updates.push('type = ?'); values.push(tagsJSON); }
					if (bpm !== undefined) { updates.push('bpm = ?'); values.push(bpm); }
					if (key !== undefined) { updates.push('key = ?'); values.push(key); }
					if (timeSignature !== undefined) { updates.push('timeSignature = ?'); values.push(timeSignature); }
					if (composer !== undefined) { updates.push('composer = ?'); values.push(composer); }
					if (year !== undefined) { updates.push('year = ?'); values.push(year); }
					if (lyricsJSON !== undefined) { updates.push('lyrics = ?'); values.push(lyricsJSON); }
					if (filesAudio !== undefined) { updates.push('filesAudio = ?'); values.push(filesAudio); }
					if (publicFlag !== undefined) { updates.push('isPublic = ?'); values.push(publicFlag); }

					if (updates.length === 0) {
						return res.status(400).json({ error: 'Brak danych do aktualizacji' });
					}

					values.push(id);

					db.run(
						`UPDATE songs SET ${updates.join(', ')} WHERE id = ?`,
						values,
						(err) => {
							if (err) {
								console.error('Error updating song:', err);
								return res.status(500).json({ error: 'Błąd bazy danych' });
							}

							res.json({ message: 'Piosenka została zaktualizowana' });
						}
					);
				}
			);
		}
	);
});

// GET lista użytkowników (dla filtrów) — tylko ci, którzy mają publiczne utwory
app.get('/api/users', requireAuthenticated, (_req, res) => {
	db.all(
		`SELECT DISTINCT u.id, u.username
		FROM users u
		INNER JOIN songs s ON s.uploadedBy = u.id
		WHERE s.isPublic = 1
		ORDER BY u.username ASC`,
		[],
		(err, rows) => {
			if (err) {
				console.error('Error fetching users:', err);
				return res.status(500).json({ error: 'Błąd bazy danych' });
			}

			res.json(rows);
		}
	);
});

// ─── Serwowanie plików audio/nut ────────────────────────────────────

function setMutableMediaCacheHeaders(res) {
	res.setHeader('Cache-Control', 'private, no-cache, must-revalidate');
	res.setHeader('Pragma', 'no-cache');
	res.setHeader('Expires', '0');
}

app.use('/api/files', (_req, res, next) => {
	setMutableMediaCacheHeaders(res);
	next();
});

function authorizeSongFileAccess(req, res, callback) {
	const songId = req.params.id;
	db.get('SELECT uploadedBy, isPublic FROM songs WHERE id = ?', [songId], (err, song) => {
		if (err) {
			console.error('Song file authorization database error:', err);
			return res.status(500).json({ error: 'Błąd bazy danych' });
		}
		if (!song) return res.status(404).json({ error: 'Nie znaleziono piosenki' });
		if (song.isPublic === 1) return callback();

		const token = req.authToken;
		if (!token) return res.status(404).json({ error: 'Nie znaleziono piosenki' });
		Promise.resolve(req.userId).then(userId => {
			if (!userId) return res.status(404).json({ error: 'Nie znaleziono piosenki' });
			if (song.uploadedBy === userId) return callback();
			db.get('SELECT isAdmin FROM users WHERE id = ?', [userId], (err, user) => {
				if (err) {
					console.error('Song file admin authorization database error:', err);
					return res.status(500).json({ error: 'Błąd bazy danych' });
				}
				if (user && user.isAdmin === 1) return callback();
				return res.status(404).json({ error: 'Nie znaleziono piosenki' });
			});
		}).catch((err) => {
			console.error('Song file token verification error:', err);
			res.status(500).json({ error: 'Błąd weryfikacji' });
		});
	});
}

app.get('/api/files/audio/:id', requireAuthenticated, (req, res) => {
	if (!/^[\w-]+$/.test(req.params.id)) return res.status(400).json({ error: 'Nieprawidłowe ID' });
	const filePath = path.resolve(audioDir, req.params.id + '.mp3');
	if (!filePath.startsWith(path.resolve(audioDir) + path.sep)) return res.status(400).json({ error: 'Nieprawidłowa ścieżka' });
	if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Nie znaleziono pliku audio' });
	authorizeSongFileAccess(req, res, () => res.sendFile(filePath, { cacheControl: false }));
});

app.get('/api/files/notes/:id', requireAuthenticated, (req, res) => {
	if (!/^[\w-]+$/.test(req.params.id)) return res.status(400).json({ error: 'Nieprawidłowe ID' });
	const found = findSheetsFile(req.params.id);
	if (!found) return res.status(404).json({ error: 'Nie znaleziono pliku nut' });
	if (!found.filePath.startsWith(path.resolve(notesDir) + path.sep)) return res.status(400).json({ error: 'Nieprawidłowa ścieżka' });
	authorizeSongFileAccess(req, res, () => {
		if (found.ext === '.svg') {
			res.setHeader('Content-Disposition', 'attachment');
		}
		res.sendFile(found.filePath, { cacheControl: false });
	});
});

// ─── Upload / usuwanie plików audio/nut ─────────────────────────────

function verifySongOwnership(req, res, callback) {
	const token = req.authToken;
	const songId = req.params.id;

	if (!token) return res.status(401).json({ error: 'Wymagane uwierzytelnienie' });

	Promise.resolve(req.userId).then(userId => {
		if (!userId) return res.status(401).json({ error: 'Nieprawidłowy token' });

		db.get('SELECT uploadedBy FROM songs WHERE id = ?', [songId], (err, song) => {
			if (err) {
				console.error('Song ownership database error:', err);
				return res.status(500).json({ error: 'Błąd bazy danych' });
			}
			if (!song) return res.status(404).json({ error: 'Nie znaleziono piosenki' });

			db.get('SELECT isAdmin FROM users WHERE id = ?', [userId], (err, user) => {
				if (err) {
					console.error('Song ownership admin database error:', err);
					return res.status(500).json({ error: 'Błąd bazy danych' });
				}
				if (!user) return res.status(403).json({ error: 'Użytkownik nie istnieje' });
				if (song.uploadedBy !== userId && user.isAdmin !== 1) {
					return res.status(403).json({ error: 'Brak uprawnień' });
				}
				callback(songId);
			});
		});
	}).catch((err) => {
		console.error('Song ownership token verification error:', err);
		res.status(500).json({ error: 'Błąd weryfikacji' });
	});
}

app.post('/api/songs/:id/audio', requireAuthenticated, (req, res) => {
	verifySongOwnership(req, res, (songId) => {
		uploadAudio(req, res, (err) => {
			if (err) return res.status(400).json({ error: 'Błąd uploadu: ' + err.message });
			if (!req.file) return res.status(400).json({ error: 'Nie przesłano pliku audio' });
			try {
				fs.writeFileSync(path.join(audioDir, songId + '.mp3'), req.file.buffer);
			} catch (writeErr) {
				console.error('Audio upload file write error:', writeErr);
				return res.status(500).json({ error: 'Błąd zapisu pliku audio' });
			}
			db.run('UPDATE songs SET filesAudio = 1 WHERE id = ?', [songId], (err) => {
				if (err) {
					console.error('Audio upload database update error:', err);
					return res.status(500).json({ error: 'Błąd bazy danych' });
				}
				res.json({ message: 'Audio przesłane' });
			});
		});
	});
});

app.post('/api/songs/:id/sheets', requireAuthenticated, (req, res) => {
	verifySongOwnership(req, res, (songId) => {
		uploadSheets(req, res, async (err) => {
			if (err) return res.status(400).json({ error: 'Błąd uploadu: ' + err.message });
			if (!req.file) return res.status(400).json({ error: 'Nie przesłano pliku nut' });
			deleteSheetsFile(songId);
			try {
				let finalBuffer, finalExt;
				if (isSvg(req.file)) {
					finalBuffer = req.file.buffer;
					finalExt = '.svg';
				} else {
					finalBuffer = await convertUploadedSheet(req.file.buffer);
					finalExt = '.webp';
				}
				fs.writeFileSync(path.join(notesDir, songId + finalExt), finalBuffer);
				db.run('UPDATE songs SET filesSheets = ? WHERE id = ?', [finalExt, songId], (err) => {
					if (err) {
						console.error('Sheets upload database update error:', err);
						return res.status(500).json({ error: 'Błąd bazy danych' });
					}
					res.json({ message: 'Nuty przesłane', ext: finalExt });
				});
			} catch (convErr) {
				console.error('Sheets upload processing error:', convErr);
				res.status(500).json({ error: 'Błąd przetwarzania obrazu' });
			}
		});
	});
});

app.delete('/api/songs/:id/audio', requireAuthenticated, (req, res) => {
	verifySongOwnership(req, res, (songId) => {
		const filePath = path.join(audioDir, songId + '.mp3');
		if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
		db.run('UPDATE songs SET filesAudio = 0 WHERE id = ?', [songId], (err) => {
			if (err) {
				console.error('Audio delete database update error:', err);
				return res.status(500).json({ error: 'Błąd bazy danych' });
			}
			res.json({ message: 'Audio usunięte' });
		});
	});
});

app.delete('/api/songs/:id/sheets', requireAuthenticated, (req, res) => {
	verifySongOwnership(req, res, (songId) => {
		deleteSheetsFile(songId);
		db.run('UPDATE songs SET filesSheets = NULL WHERE id = ?', [songId], (err) => {
			if (err) {
				console.error('Sheets delete database update error:', err);
				return res.status(500).json({ error: 'Błąd bazy danych' });
			}
			res.json({ message: 'Nuty usunięte' });
		});
	});
});

// DELETE usunięcie piosenki
app.delete('/api/songs/:id', requireAuthenticated, async (req, res) => {
	const token = req.authToken;
	const { id } = req.params;

	if (!token) {
		return res.status(401).json({ error: 'Wymagane uwierzytelnienie' });
	}

	const userId = req.userId;
	if (!userId) {
		return res.status(401).json({ error: 'Nieprawidłowy token' });
	}

	// Sprawdź czy użytkownik może usunąć
	db.get(
		'SELECT uploadedBy FROM songs WHERE id = ?',
		[id],
		(err, song) => {
			if (err) {
				console.error('Song delete lookup error:', err);
				return res.status(500).json({ error: 'Błąd bazy danych' });
			}

			if (!song) {
				return res.status(404).json({ error: 'Nie znaleziono piosenki' });
			}

			db.get(
				'SELECT isAdmin FROM users WHERE id = ?',
				[userId],
				(err, user) => {
					if (err) {
						console.error('Song delete authorization database error:', err);
						return res.status(500).json({ error: 'Błąd bazy danych' });
					}

					// Tylko właściciel utworu lub admin może usunąć
					if (song.uploadedBy !== userId && user.isAdmin !== 1) {
						return res.status(403).json({ error: 'Brak uprawnień do usunięcia tej piosenki' });
					}

					db.run(
						'DELETE FROM songs WHERE id = ?',
						[id],
						(err) => {
							if (err) {
								console.error('Error deleting song:', err);
								return res.status(500).json({ error: 'Błąd bazy danych' });
							}

							// Usuń pliki audio/nut z dysku
							const audioPath = path.join(audioDir, id + '.mp3');
							if (fs.existsSync(audioPath)) fs.unlink(audioPath, () => {});
							deleteSheetsFile(id);

							res.json({ message: 'Piosenka została usunięta' });
						}
					);
				}
			);
		}
	);
});

// ─── Diagnostyka plików (tylko admin) ───────────────────────────────

app.get('/api/admin/diagnostics/files', requireAuthenticated, async (req, res) => {
	const userId = await requireAdmin(req, res);
	if (!userId) return;

	db.all('SELECT id, title, filesSheets, filesAudio FROM songs ORDER BY id ASC', [], (err, songs) => {
		if (err) {
			console.error('File diagnostics database error:', err);
			return res.status(500).json({ error: 'Błąd bazy danych' });
		}

		const results = songs.map(song => {
			const sheetsOnDisk = findSheetsFile(String(song.id));
			const audioOnDisk = fs.existsSync(path.join(audioDir, song.id + '.mp3'));
			const sheetsOk = sheetsOnDisk
				? song.filesSheets === sheetsOnDisk.ext
				: song.filesSheets === null || song.filesSheets === undefined;

			return {
				id: song.id,
				title: song.title,
				sheets: {
					db: song.filesSheets,
					disk: sheetsOnDisk ? sheetsOnDisk.ext : null,
					ok: sheetsOk,
				},
				audio: {
					db: song.filesAudio ? true : false,
					disk: audioOnDisk,
					ok: (!!song.filesAudio) === audioOnDisk,
				},
			};
		});

		const issues = results.filter(r => !r.sheets.ok || !r.audio.ok);
		res.json({ total: results.length, issues: issues.length, results });
	});
});

app.get('/api/admin/health', requireAuthenticated, async (req, res) => {
	const userId = await requireAdmin(req, res);
	if (!userId) return;

	getServiceHealth((health) => {
		res.status(health.ok ? 200 : 503).json(health);
	});
});

function updateEnvFile(updates) {
	let content = '';
	if (fs.existsSync(config.envPath)) {
		content = fs.readFileSync(config.envPath, 'utf8');
	}
	const lines = content.split(/\r?\n/);
	const updatedKeys = new Set();
	
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i].trim();
		if (line.startsWith('#') || !line.includes('=')) continue;
		const eqIndex = line.indexOf('=');
		const key = line.substring(0, eqIndex).trim();
		if (updates.hasOwnProperty(key)) {
			lines[i] = `${key}=${updates[key]}`;
			updatedKeys.add(key);
		}
	}
	
	// Add keys that weren't found
	for (const key in updates) {
		if (!updatedKeys.has(key)) {
			lines.push(`${key}=${updates[key]}`);
		}
	}
	
	fs.mkdirSync(path.dirname(config.envPath), { recursive: true });
	fs.writeFileSync(config.envPath, lines.join('\n'), 'utf8');
}

app.get('/api/admin/config', requireAuthenticated, async (req, res) => {
	const userId = await requireAdmin(req, res);
	if (!userId) return;

	res.json({
		admins: config.admins.join(', '),
		allowAllUsersToAddSongs: config.allowAllUsersToAddSongs,
		canAddSongs: config.canAddSongs.join(', '),
		allowRegistration: config.allowRegistration
	});
});

app.post('/api/admin/config', requireAuthenticated, async (req, res) => {
	const userId = await requireAdmin(req, res);
	if (!userId) return;

	let { admins, allowAllUsersToAddSongs, canAddSongs, allowRegistration } = req.body;

	if (admins === undefined || allowAllUsersToAddSongs === undefined || canAddSongs === undefined || allowRegistration === undefined) {
		return res.status(400).json({ error: 'Brakujące parametry' });
	}

	// Sanitize inputs
	const cleanAdmins = String(admins).replace(/[\r\n"']/g, '').trim();
	const cleanCanAddSongs = String(canAddSongs).replace(/[\r\n"']/g, '').trim();
	const cleanAllowAll = allowAllUsersToAddSongs === true;
	const cleanAllowReg = allowRegistration === true;

	try {
		updateEnvFile({
			ADMINS: cleanAdmins,
			CAN_ADD_SONGS: cleanCanAddSongs,
			ALLOW_ALL_USERS_TO_ADD_SONGS: cleanAllowAll ? 'true' : 'false',
			ALLOW_REGISTRATION: cleanAllowReg ? 'true' : 'false'
		});

		config.admins = cleanAdmins.split(',').map(s => s.trim()).filter(Boolean);
		config.canAddSongs = cleanCanAddSongs.split(',').map(s => s.trim()).filter(Boolean);
		config.allowAllUsersToAddSongs = cleanAllowAll;
		config.allowRegistration = cleanAllowReg;

		applyConfigToDatabase();

		res.json({ message: 'Ustawienia administratora zostały zaktualizowane' });
	} catch (err) {
		console.error('Error updating configuration:', err);
		res.status(500).json({ error: 'Błąd podczas zapisu do pliku .env' });
	}
});

// ─── Autoryzacja administratora ────────────────────────────────────────────

async function requireAdmin(req, res) {
	const token = req.authToken;
	if (!token) { res.status(401).json({ error: 'Wymagane uwierzytelnienie' }); return null; }
	const userId = req.userId;
	if (!userId) { res.status(401).json({ error: 'Nieprawidłowy token' }); return null; }
	return new Promise((resolve) => {
		db.get('SELECT isAdmin FROM users WHERE id = ?', [userId], (err, user) => {
			if (err) {
				console.error('Admin authorization database error:', err);
				res.status(500).json({ error: 'Błąd bazy danych' });
				resolve(null);
			} else if (!user || user.isAdmin !== 1) {
				res.status(403).json({ error: 'Brak uprawnień' });
				resolve(null);
			} else {
				resolve(userId);
			}
		});
	});
}

// ─── Setlisty ───────────────────────────────────────────────────────────────

async function requireCanAddSongs(req, res) {
	const token = req.authToken;
	if (!token) { res.status(401).json({ error: 'Wymagane uwierzytelnienie' }); return null; }
	const userId = req.userId;
	if (!userId) { res.status(401).json({ error: 'Nieprawidłowy token' }); return null; }
	return new Promise(resolve => {
		db.get('SELECT canAddSongs, isAdmin FROM users WHERE id = ?', [userId], (err, user) => {
			if (err) {
				console.error('Song permission database error:', err);
				res.status(500).json({ error: 'Błąd bazy danych' });
				return resolve(null);
			}
			if (!user) { res.status(500).json({ error: 'Błąd bazy danych' }); return resolve(null); }
			const canAdd = user.isAdmin === 1 || user.canAddSongs === 1 || config.allowAllUsersToAddSongs !== false;
			if (!canAdd) { res.status(403).json({ error: 'Brak uprawnień' }); return resolve(null); }
			resolve(userId);
		});
	});
}

function verifySetlistAccess(setlistId, userId, res, callback) {
	const id = parseInt(setlistId, 10);
	if (!id || id <= 0) { res.status(400).json({ error: 'Nieprawidłowe ID' }); return; }
	db.get(
		`SELECT s.*, u.username as uploadedByUsername FROM setlists s LEFT JOIN users u ON s.uploadedBy = u.id WHERE s.id = ? AND (s.isPublic = 1 OR s.uploadedBy = ?)`,
		[id, userId || -1],
		(err, row) => {
			if (err) {
				console.error('Setlist access database error:', err);
				res.status(500).json({ error: 'Błąd bazy danych' });
				return;
			}
			if (!row) { res.status(404).json({ error: 'Setlista nie istnieje lub brak dostępu' }); return; }
			callback(row);
		}
	);
}

function requireSetlistOwner(setlistId, userId, res, callback) {
	const id = parseInt(setlistId, 10);
	if (!id || id <= 0) { res.status(400).json({ error: 'Nieprawidłowe ID' }); return; }
	db.get('SELECT s.*, u.isAdmin as userIsAdmin FROM setlists s LEFT JOIN users u ON u.id = ? WHERE s.id = ?', [userId, id], (err, row) => {
		if (err) {
			console.error('Setlist owner database error:', err);
			res.status(500).json({ error: 'Błąd bazy danych' });
			return;
		}
		if (!row) { res.status(404).json({ error: 'Setlista nie istnieje' }); return; }
		if (row.uploadedBy !== userId && row.userIsAdmin !== 1) { res.status(403).json({ error: 'Brak uprawnień' }); return; }
		callback(row);
	});
}

function _parseSetlistItems(raw) {
	try { return JSON.parse(raw || '[]'); } catch { return []; }
}

function _serializeSetlistItems(items) {
	return JSON.stringify(Array.isArray(items) ? items : []);
}

app.get('/api/setlists', requireAuthenticated, async (req, res) => {
	const userId = req.userId;

	const query = userId
		? `SELECT s.id, s.title, s.description, s.items, s.uploadedBy, s.isPublic, s.createdAt, u.username as uploadedByUsername FROM setlists s LEFT JOIN users u ON s.uploadedBy = u.id WHERE s.isPublic = 1 OR s.uploadedBy = ? ORDER BY s.createdAt DESC`
		: `SELECT s.id, s.title, s.description, s.items, s.uploadedBy, s.isPublic, s.createdAt, u.username as uploadedByUsername FROM setlists s LEFT JOIN users u ON s.uploadedBy = u.id WHERE s.isPublic = 1 ORDER BY s.createdAt DESC`;
	const params = userId ? [userId] : [];

	db.all(query, params, (err, rows) => {
		if (err) {
			console.error('Error fetching setlists:', err);
			return res.status(500).json({ error: 'Błąd bazy danych' });
		}
		res.json(rows.map(r => {
			const items = _parseSetlistItems(r.items);
			function countItems(list) { return list.reduce((n, i) => i.type === 'group' ? n + countItems(i.items || []) : n + 1, 0); }
			return { ...r, isPublic: r.isPublic === 1, items, itemCount: countItems(items) };
		}));
	});
});

app.post('/api/setlists', requireAuthenticated, async (req, res) => {
	const userId = await requireCanAddSongs(req, res);
	if (!userId) return;

	const { title, description, isPublic, items } = req.body;
	if (!title || typeof title !== 'string' || title.trim().length === 0 || title.trim().length > 200) {
		return res.status(400).json({ error: 'Nieprawidłowy tytuł' });
	}

	db.run(
		'INSERT INTO setlists (title, description, items, uploadedBy, isPublic) VALUES (?, ?, ?, ?, ?)',
		[title.trim(), description?.trim() || null, _serializeSetlistItems(items), userId, isPublic === false ? 0 : 1],
		function(err) {
			if (err) {
				console.error('Error creating setlist:', err);
				return res.status(500).json({ error: 'Błąd bazy danych' });
			}
			res.json({ id: this.lastID, message: 'Setlista utworzona' });
		}
	);
});

app.get('/api/setlists/:id', requireAuthenticated, async (req, res) => {
	const userId = req.userId;

	verifySetlistAccess(req.params.id, userId, res, (setlist) => {
		const items = _parseSetlistItems(setlist.items);
		// Zbierz wszystkie songId rekurencyjnie (w tym z grup)
		function collectSongIds(list) {
			const ids = [];
			for (const item of list) {
				if (item.type === 'song' && item.songId) ids.push(item.songId);
				else if (item.type === 'group' && Array.isArray(item.items)) ids.push(...collectSongIds(item.items));
			}
			return ids;
		}
		function enrichItems(list, songMap) {
			return list.map(item => {
				if (item.type === 'song') return { ...item, ...(songMap[item.songId] || {}) };
				if (item.type === 'group') return { ...item, items: enrichItems(item.items || [], songMap) };
				return item;
			});
		}
		const songIds = collectSongIds(items);
		if (songIds.length === 0) {
			return res.json({ ...setlist, isPublic: setlist.isPublic === 1, items });
		}
		const placeholders = songIds.map(() => '?').join(',');
		db.all(`SELECT id, title, key, type as tags FROM songs WHERE id IN (${placeholders})`, songIds, (err, songs) => {
			if (err) {
				console.error('Error fetching setlist songs:', err);
				return res.status(500).json({ error: 'Błąd bazy danych' });
			}
			const songMap = {};
			(songs || []).forEach(s => { songMap[s.id] = { songTitle: s.title, songKey: s.key, songTags: (() => { try { return JSON.parse(s.tags); } catch { return []; } })() }; });
			res.json({ ...setlist, isPublic: setlist.isPublic === 1, items: enrichItems(items, songMap) });
		});
	});
});

app.put('/api/setlists/:id', requireAuthenticated, async (req, res) => {
	const token = req.authToken;
	if (!token) return res.status(401).json({ error: 'Wymagane uwierzytelnienie' });
	const userId = req.userId;
	if (!userId) return res.status(401).json({ error: 'Nieprawidłowy token' });

	requireSetlistOwner(req.params.id, userId, res, (setlist) => {
		const { title, description, isPublic, items } = req.body;
		const updates = [];
		const params = [];

		if (title !== undefined) {
			if (typeof title !== 'string' || title.trim().length === 0 || title.trim().length > 200) {
				return res.status(400).json({ error: 'Nieprawidłowy tytuł' });
			}
			updates.push('title = ?'); params.push(title.trim());
		}
		if (description !== undefined) { updates.push('description = ?'); params.push(description?.trim() || null); }
		if (isPublic !== undefined) { updates.push('isPublic = ?'); params.push(isPublic ? 1 : 0); }
		if (items !== undefined) { updates.push('items = ?'); params.push(_serializeSetlistItems(items)); }

		if (updates.length === 0) return res.json({ message: 'Brak zmian' });

		params.push(setlist.id);
		db.run(`UPDATE setlists SET ${updates.join(', ')} WHERE id = ?`, params, (err) => {
			if (err) {
				console.error('Error updating setlist:', err);
				return res.status(500).json({ error: 'Błąd bazy danych' });
			}
			res.json({ message: 'Zaktualizowano' });
		});
	});
});

app.delete('/api/setlists/:id', requireAuthenticated, async (req, res) => {
	const token = req.authToken;
	if (!token) return res.status(401).json({ error: 'Wymagane uwierzytelnienie' });
	const userId = req.userId;
	if (!userId) return res.status(401).json({ error: 'Nieprawidłowy token' });

	requireSetlistOwner(req.params.id, userId, res, (setlist) => {
		db.run('DELETE FROM setlists WHERE id = ?', [setlist.id], (err) => {
			if (err) {
				console.error('Error deleting setlist:', err);
				return res.status(500).json({ error: 'Błąd bazy danych' });
			}
			res.json({ message: 'Usunięto setlistę' });
		});
	});
});

// ─── Ustawienia użytkownika ─────────────────────────────────────────
app.get('/api/users/me/settings', requireAuthenticated, async (req, res) => {
	const token = req.authToken;
	if (!token) return res.status(401).json({ error: 'Wymagane uwierzytelnienie' });
	const userId = req.userId;
	if (!userId) return res.status(401).json({ error: 'Nieprawidłowy token' });

	const channelId = req.query.channel ? parseInt(req.query.channel) : null;

	db.get(
		'SELECT settings FROM user_settings WHERE userId = ? AND (channelId IS NULL OR channelId = ?) ORDER BY channelId DESC, updatedAt DESC LIMIT 1',
		[userId, channelId || null],
		(err, row) => {
			if (err) {
				console.error('Error fetching user settings:', err);
				return res.status(500).json({ error: 'Błąd bazy danych' });
			}

			if (row && row.settings) {
				try {
					const userSettings = JSON.parse(row.settings);
					res.json({ ...DEFAULT_DISPLAY_SETTINGS, ...userSettings });
				} catch (e) {
					console.error('Error parsing user settings:', e);
					res.json(DEFAULT_DISPLAY_SETTINGS);
				}
			} else {
				res.json(DEFAULT_DISPLAY_SETTINGS);
			}
		}
	);
});

app.put('/api/users/me/settings', requireAuthenticated, async (req, res) => {
	const token = req.authToken;
	if (!token) return res.status(401).json({ error: 'Wymagane uwierzytelnienie' });
	const userId = req.userId;
	if (!userId) return res.status(401).json({ error: 'Nieprawidłowy token' });

	const channelId = req.body.channel ? parseInt(req.body.channel) : null;
	const settings = req.body.settings;

	if (!settings || typeof settings !== 'object') {
		return res.status(400).json({ error: 'Ustawienia muszą być obiektem' });
	}

	const settingsJson = JSON.stringify(settings);

	// Sprawdź, czy istnieje już ustawienie dla tego użytkownika i kanału
	db.get(
		'SELECT id FROM user_settings WHERE userId = ? AND channelId = ?',
		[userId, channelId || null],
		(err, row) => {
			if (err) {
				console.error('Error checking user settings:', err);
				return res.status(500).json({ error: 'Błąd bazy danych' });
			}

			if (row) {
				// Aktualizuj istniejące ustawienie
				db.run(
					'UPDATE user_settings SET settings = ?, updatedAt = strftime("%s", "now") WHERE id = ?',
					[settingsJson, row.id],
					(err) => {
						if (err) {
							console.error('Error updating user settings:', err);
							return res.status(500).json({ error: 'Błąd bazy danych' });
						}
						res.json({ message: 'Zaktualizowano ustawienia' });
					}
				);
			} else {
				// Stwórz nowe ustawienie
				db.run(
					'INSERT INTO user_settings (userId, channelId, settings, updatedAt) VALUES (?, ?, ?, strftime("%s", "now"))',
					[userId, channelId || null, settingsJson],
					(err) => {
						if (err) {
							console.error('Error creating user settings:', err);
							return res.status(500).json({ error: 'Błąd bazy danych' });
						}
						res.json({ message: 'Zapisano ustawienia' });
					}
				);
			}
		}
	);
});

app.get('/api/channels/:channelId/settings', requireAuthenticated, async (req, res) => {
	const token = req.authToken;
	if (!token) return res.status(401).json({ error: 'Wymagane uwierzytelnienie' });
	const userId = req.userId;
	if (!userId) return res.status(401).json({ error: 'Nieprawidłowy token' });

	const channelId = parseInt(req.params.channelId);
	if (!channelId) return res.status(400).json({ error: 'Nieprawidłowy ID kanału' });

	// Pobierz ustawienia kanału (jeśli istnieją)
	db.get(
		'SELECT settings FROM user_settings WHERE channelId = ? ORDER BY updatedAt DESC LIMIT 1',
		[channelId],
		(err, row) => {
			if (err) {
				console.error('Error fetching channel settings:', err);
				return res.status(500).json({ error: 'Błąd bazy danych' });
			}

			if (row && row.settings) {
				try {
					const channelSettings = JSON.parse(row.settings);
					res.json({ ...DEFAULT_DISPLAY_SETTINGS, ...channelSettings });
				} catch (e) {
					console.error('Error parsing channel settings:', e);
					res.json(DEFAULT_DISPLAY_SETTINGS);
				}
			} else {
				res.json(DEFAULT_DISPLAY_SETTINGS);
			}
		}
	);
});

app.put('/api/channels/:channelId/settings', requireAuthenticated, async (req, res) => {
	const token = req.authToken;
	if (!token) return res.status(401).json({ error: 'Wymagane uwierzytelnienie' });
	const userId = req.userId;
	if (!userId) return res.status(401).json({ error: 'Nieprawidłowy token' });

	const channelId = parseInt(req.params.channelId);
	if (!channelId) return res.status(400).json({ error: 'Nieprawidłowy ID kanału' });

	const settings = req.body.settings;
	if (!settings || typeof settings !== 'object') {
		return res.status(400).json({ error: 'Ustawienia muszą być obiektem' });
	}

	const settingsJson = JSON.stringify(settings);

	// Sprawdź, czy istnieje już ustawienie dla tego kanału
	db.get(
		'SELECT id FROM user_settings WHERE channelId = ?',
		[channelId],
		(err, row) => {
			if (err) {
				console.error('Error checking channel settings:', err);
				return res.status(500).json({ error: 'Błąd bazy danych' });
			}

			if (row) {
				// Aktualizuj istniejące ustawienie
				db.run(
					'UPDATE user_settings SET settings = ?, updatedAt = strftime("%s", "now") WHERE id = ?',
					[settingsJson, row.id],
					(err) => {
						if (err) {
							console.error('Error updating channel settings:', err);
							return res.status(500).json({ error: 'Błąd bazy danych' });
						}
						res.json({ message: 'Zaktualizowano ustawienia kanału' });
					}
				);
			} else {
				// Stwórz nowe ustawienie (przypisane do pierwszego użytkownika, który je ustawia)
				db.run(
					'INSERT INTO user_settings (userId, channelId, settings, updatedAt) VALUES (?, ?, ?, strftime("%s", "now"))',
					[userId, channelId, settingsJson],
					(err) => {
						if (err) {
							console.error('Error creating channel settings:', err);
							return res.status(500).json({ error: 'Błąd bazy danych' });
						}
						res.json({ message: 'Zapisano ustawienia kanału' });
					}
				);
			}
		}
	);
});

// WebSocket keepalive + pomiar latencji — ping co 20s, rozłącz jeśli brak odpowiedzi
const WS_PING_INTERVAL = 20000;
setInterval(() => {
	wss.clients.forEach(client => {
		if (client.readyState !== WebSocket.OPEN) return;
		if (client._wsAlive === false) {
			client.terminate();
			return;
		}
		client._wsAlive = false;
		client.send(JSON.stringify({ type: 'ping', time: Date.now() }));
	});
}, WS_PING_INTERVAL).unref();

// Eksport i import biblioteki
app.post('/api/transfer/export', requireAuthenticated, transferLimiter, async (req, res) => {
	try {
		const format = String(req.body?.format || 'barymusic').toLowerCase();
		const scope = req.body?.scope || { type: 'songs', songIds: [] };
		if (!['barymusic', 'openlyrics', 'chordpro'].includes(format)) return res.status(400).json({ error: 'Unsupported export format' });
		if (!['songs', 'setlists'].includes(scope.type)) return res.status(400).json({ error: 'Unsupported export scope' });
		let setlists = [];
		let ids = [];
		if (scope.type === 'setlists') {
			if (format !== 'barymusic') return res.status(400).json({ error: 'Setlists can only be exported as BaryMusic' });
			const requestedSetlistIds = uniqueIntegerIds(scope.setlistIds);
			if (!requestedSetlistIds.length) return res.status(400).json({ error: 'No setlists selected' });
			if (requestedSetlistIds.length > MAX_SETLISTS) return res.status(400).json({ error: 'Too many setlists selected' });
			const selectedSetlistRows = await accessibleRowsById(db, 'setlists', requestedSetlistIds, req.userId);
			if (selectedSetlistRows.length !== requestedSetlistIds.length) return res.status(403).json({ error: 'One or more selected setlists are not accessible' });

			const songIds = new Set();
			setlists = selectedSetlistRows.map(row => {
				const items = parseJson(row.items, []);
				collectSetlistSongIds(items).forEach(id => songIds.add(id));
				return {
					archiveId: String(row.id),
					title: row.title,
					description: row.description,
					isPublic: row.isPublic === 1,
					createdAt: row.createdAt,
					items: mapSetlistItems(items),
				};
			});
			ids = [...songIds];
		} else {
			ids = uniqueIntegerIds(scope.songIds);
		}
		if (ids.length > MAX_SONGS) return res.status(400).json({ error: 'Too many songs selected' });
		const rows = ids.length ? await accessibleRowsById(db, 'songs', ids, req.userId) : [];
		if (ids.length && rows.length !== ids.length) return res.status(403).json({ error: 'One or more selected songs are not accessible' });
		if (!rows.length && !setlists.length) return res.status(400).json({ error: 'Nothing to export' });
		if (format !== 'barymusic') return streamTextExport(res, format, rows, notesDir);

		const { entries, mediaBySong } = await buildMediaEntries(rows, audioDir, notesDir);
		const manifest = {
			format: 'BaryMusic',
			schemaVersion: 2,
			kind: 'library',
			appVersion: SOCKET_VERSION,
			exportedAt: new Date().toISOString(),
			payload: {
				songs: rows.map(row => dbSongToTransfer(row, mediaBySong.get(String(row.id)))),
				setlists,
			},
			files: entries.map(({ archivePath, sha256, size }) => ({ path: archivePath, sha256, size })),
		};
		return appendArchive(res, `barymusic-library-${new Date().toISOString().slice(0, 10)}.barymusic`, manifest, entries);
	} catch (error) {
		console.error('Library export error:', error);
		if (!res.headersSent) res.status(500).json({ error: 'Export failed' });
	}
});

app.get('/api/admin/backup', requireAuthenticated, transferLimiter, async (req, res) => {
	const adminId = await requireAdmin(req, res);
	if (!adminId) return;
	try {
		const [users, settings, rows, setlistRows] = await Promise.all([
			dbAll(db, 'SELECT id, username, passwordHash, canAddSongs, isAdmin, createdAt FROM users ORDER BY id'),
			dbAll(db, 'SELECT id, userId, channelId, settings, createdAt, updatedAt FROM user_settings ORDER BY id'),
			dbAll(db, 'SELECT * FROM songs ORDER BY id'),
			dbAll(db, 'SELECT * FROM setlists ORDER BY id'),
		]);
		const { entries, mediaBySong } = await buildMediaEntries(rows, audioDir, notesDir);
		const manifest = {
			format: 'BaryMusic',
			schemaVersion: 2,
			kind: 'server-backup',
			appVersion: SOCKET_VERSION,
			exportedAt: new Date().toISOString(),
			payload: {
				config: {
					admins: users.filter(user => user.isAdmin === 1).map(user => user.username),
					canAddSongs: users.filter(user => user.canAddSongs === 1).map(user => user.username),
					allowAllUsersToAddSongs: config.allowAllUsersToAddSongs,
					allowRegistration: config.allowRegistration,
					corsOrigin: config.corsOrigin,
					port: config.port,
				},
				users,
				userSettings: settings.map(row => ({ ...row, settings: parseJson(row.settings, {}) })),
				songs: rows.map(row => ({
					...dbSongToTransfer(row, mediaBySong.get(String(row.id))),
					id: row.id,
					uploadedBy: row.uploadedBy,
				})),
				setlists: setlistRows.map(row => ({
					id: row.id,
					title: row.title,
					description: row.description,
					items: parseJson(row.items, []),
					uploadedBy: row.uploadedBy,
					isPublic: row.isPublic === 1,
					createdAt: row.createdAt,
				})),
			},
			files: entries.map(({ archivePath, sha256, size }) => ({ path: archivePath, sha256, size })),
		};
		return appendArchive(res, `barymusic-backup-${new Date().toISOString().slice(0, 10)}.barymusic`, manifest, entries);
	} catch (error) {
		console.error('Admin backup error:', error);
		if (!res.headersSent) res.status(500).json({ error: 'Backup failed' });
	}
});

app.post('/api/transfer/import/preview', requireAuthenticated, transferLimiter, async (req, res) => {
	try {
		const userId = await requireCanAddSongs(req, res);
		if (!userId) return;

		transferUpload.array('files', MAX_TRANSFER_FILES)(req, res, async error => {
			const files = (req.files || []).map(file => file.path);
			if (error) {
				files.forEach(removeFile);
				return res.status(400).json({ error: error.message });
			}

			try {
				const parsed = await parseUploadedFiles(req.files || []);
				const sources = parsed.sources.map(source => ({ ...source, songs: [], setlists: [] }));
				const songs = parsed.payload.songs.map(song => ({
					title: song.title,
					hasAudio: !!song.media?.audio,
					hasSheets: !!song.media?.sheets,
					sourceIndex: song.sourceIndex,
					fromSetlist: song.fromSetlist,
				}));
				const setlists = parsed.payload.setlists.map(setlist => ({
					title: setlist.title,
					sourceIndex: setlist.sourceIndex,
				}));
				songs.forEach(song => sources[song.sourceIndex].songs.push(song));
				setlists.forEach(setlist => sources[setlist.sourceIndex].setlists.push(setlist));
				const token = crypto.randomUUID();
				cleanupUserPreviews(userId);
				importPreviews.set(token, {
					userId,
					createdAt: Date.now(),
					payload: parsed.payload,
					archivePaths: parsed.archivePaths,
					files,
				});
				res.json({
					token,
					expiresInSeconds: PREVIEW_TTL_MS / 1000,
					formats: parsed.formats,
					sources,
					songs,
					setlists,
					warnings: parsed.warnings,
				});
			} catch (parseError) {
				files.forEach(removeFile);
				res.status(400).json({ error: parseError.message });
			}
		});
	} catch (error) {
		console.error('Import permission error:', error);
		res.status(500).json({ error: 'Import failed' });
	}
});

app.post('/api/transfer/import/commit', requireAuthenticated, transferLimiter, async (req, res) => {
	const userId = await requireCanAddSongs(req, res);
	if (!userId) return;
	const token = String(req.body?.token || '');
	if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(token)) return res.status(410).json({ error: 'Import preview expired' });
	const preview = importPreviews.get(token);
	if (!preview || preview.userId !== req.userId) return res.status(410).json({ error: 'Import preview expired' });
	if (Date.now() - preview.createdAt > PREVIEW_TTL_MS) {
		cleanupPreview(token);
		return res.status(410).json({ error: 'Import preview expired' });
	}
	importPreviews.delete(token);

	try {
		const result = await importLibrary(db, preview.payload, userId, preview.archivePaths, audioDir, notesDir);
		res.json(result);
	} catch (error) {
		console.error('Library import error:', error);
		res.status(500).json({ error: error.message });
	} finally {
		(preview.files || []).forEach(removeFile);
	}
});

app.post('/api/auth/bootstrap/restore', authLimiter, async (req, res, next) => {
	try {
		const status = await dbGet(db, 'SELECT EXISTS (SELECT 1 FROM users) AS hasUsers');
		if (status.hasUsers) return res.status(403).json({ error: 'Bootstrap restore is no longer available' });
		next();
	} catch (error) {
		console.error('Bootstrap restore status error:', error);
		res.status(500).json({ error: 'Could not verify bootstrap state' });
	}
}, (req, res) => {
	transferUpload.single('file')(req, res, async error => {
		if (error) {
			if (req.file) removeFile(req.file.path);
			return res.status(400).json({ error: error.message });
		}
		if (!req.file) return res.status(400).json({ error: 'Backup file is required' });
		try {
			const status = await dbGet(db, 'SELECT EXISTS (SELECT 1 FROM users) AS hasUsers');
			if (status.hasUsers) return res.status(403).json({ error: 'Bootstrap restore is no longer available' });
			const opened = await openBaryMusic(req.file.path);
			await restoreBackup(db, opened, { audioDir, notesDir, config, updateEnvFile, requireEmpty: true });
			res.json({ restored: true, restartRequired: true });
		} catch (restoreError) {
			console.error('Bootstrap restore error:', restoreError);
			res.status(400).json({ error: restoreError.message });
		} finally {
			removeFile(req.file.path);
		}
	});
});

wss.on('connection', (client) => {
	client._wsAlive = true;
});

// czyść tokeny które wygasły - sprawdzaj co godzinę
setInterval(() => {
    const now = Math.floor(Date.now() / 1000);
    db.run('DELETE FROM sessions WHERE expiresAt < ?', [now], (err) => {
        if (err) console.error('Session cleanup error:', err);
    });
}, 60 * 60 * 1000).unref();

// czyść listę prób logowania - co minutę
setInterval(() => {
    const now = Date.now();
    for (let [ip, data] of loginAttempts.entries()) {
        if (now > data.resetTime) {
            loginAttempts.delete(ip);
        }
    }
}, 60 * 1000).unref();

function start(port, host) {
	const listenPort = port ?? config.port;
	const listenHost = host ?? config.host;
	return new Promise((resolve, reject) => {
		const handleError = error => reject(error);
		server.once('error', handleError);
		server.listen(listenPort, listenHost, () => {
			server.off('error', handleError);
			const address = server.address();
			const actualPort = typeof address === 'object' && address ? address.port : listenPort;
			console.log(`BaryMusic is running on ${listenHost}:${actualPort}`);
			resolve(address);
		});
	});
}

function closeDatabase() {
	return new Promise((resolve, reject) => {
		db.close(error => error ? reject(error) : resolve())
	})
}

module.exports = {
	start,
	closeDatabase,
	convertUploadedSheet,
	accessibleRowsById,
	normalizeSong,
	safeLyrics,
	sanitizeFilename,
	songFromChordPro,
	songFromOpenLyrics,
	songToChordPro,
	songToOpenLyrics,
	streamTextExport,
	openBaryMusic,
	parseExternalZip,
	parseUploadedFiles,
	remapItems,
	validateBackupManifest,
	importLibrary,
	restoreBackup,
	setMutableMediaCacheHeaders,
}

// Jeśli uruchamiany bezpośrednio (node barymusic.js):
if (require.main === module) {
	start(config.port, config.host).catch(error => {
		console.error(`Unable to start BaryMusic on ${config.host}:${config.port}:`, error.message);
		process.exitCode = 1;
	});
}
