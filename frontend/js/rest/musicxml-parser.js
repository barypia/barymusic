/* ==================== PARSER MUSICXML (frontend) ==================== */

function decodeMusicXmlEntities(str) {
	return str
		.replace(/&quot;/g, '"')
		.replace(/&amp;/g, '&')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&apos;/g, "'");
}

function parseMusicXmlChordName(harmonyXml) {
	const stepM  = harmonyXml.match(/<root-step>(.*?)<\/root-step>/);
	const alterM = harmonyXml.match(/<root-alter>(.*?)<\/root-alter>/);
	const kindM  = harmonyXml.match(/<kind[^>]*>(.*?)<\/kind>/);
	if (!stepM) return null;
	let root = stepM[1].trim();
	if (alterM) {
		const alter = parseFloat(alterM[1]);
		root += alter > 0 ? '#' : alter < 0 ? 'b' : '';
	}
	const kindText = (kindM?.[1] ?? '').trim();
	const suffix = kindText === 'minor' ? 'm' : kindText === 'dominant' ? '7'
		: kindText === 'major-seventh' ? 'maj7' : kindText === 'minor-seventh' ? 'm7'
		: kindText === 'diminished' ? 'dim' : kindText === 'augmented' ? 'aug' : '';
	return root + suffix;
}

function parseMusicXmlText(xmlString) {
	const tokenRe = /(<measure\b[^>]*>|<harmony[\s\S]*?<\/harmony>|<note[\s\S]*?<\/note>)/g;
	const xmlNodes = [...xmlString.matchAll(tokenRe)].map(m => {
		const xml = m[1];
		if (xml.startsWith('<measure')) return { type: 'measure', xml };
		if (xml.startsWith('<harmony')) return { type: 'harmony', xml };
		return { type: 'note', xml };
	});

	const rawEntries = [];
	let pendingChord = null;
	let currentMeasure = 0;

	for (const token of xmlNodes) {
		if (token.type === 'measure') { currentMeasure++; continue; }
		if (token.type === 'harmony') { pendingChord = parseMusicXmlChordName(token.xml); continue; }

		const noteXml = token.xml;
		if (/<chord\s*\/>/.test(noteXml)) continue;

		const lyricM    = noteXml.match(/<lyric[^>]*>([\s\S]*?)<\/lyric>/);
		const syllabicM = lyricM ? lyricM[1].match(/<syllabic>(.*?)<\/syllabic>/) : null;
		const textM     = lyricM ? lyricM[1].match(/<text>([\s\S]*?)<\/text>/)    : null;

		const syllabic = syllabicM ? syllabicM[1].trim() : null;
		const syllable = textM ? decodeMusicXmlEntities(textM[1].replace(/<[^>]+>/g, '').trim()) : null;
		const chord = pendingChord;
		pendingChord = null;

		if (syllable !== null || chord !== null) {
			rawEntries.push({ syllabic, syllable, chord, measure: currentMeasure });
		}
	}

	// Budujemy tokeny: sylaby → słowa z akordami i pozycją taktu
	const tokens = [];
	let pendingOrphanChord = null;

	for (const { syllabic, syllable, chord, measure } of rawEntries) {
		if (syllable === null) {
			if (chord !== null) pendingOrphanChord = pendingOrphanChord ?? chord;
			continue;
		}
		const effectiveChord = chord ?? pendingOrphanChord;
		pendingOrphanChord = null;

		const isBegin  = syllabic === 'begin';
		const isSingle = syllabic === 'single' || syllabic === null || syllabic === undefined;
		const wordBreakBefore = (isBegin || isSingle) && tokens.length > 0;
		tokens.push({ text: syllable, chord: effectiveChord, wordBreakBefore, measure });
	}

	return buildLyricsFromTokens(tokens);
}

const MUSICXML_MEASURES_PER_LINE = 2;

function buildLyricsFromTokens(tokens) {
	if (tokens.length === 0) return null;

	const lines = [];
	let currentLine = '';
	let lastMeasure = tokens[0]?.measure ?? 1;
	let measuresSinceBreak = 0;
	let pendingBreak = false;

	for (const { text, chord, wordBreakBefore, measure } of tokens) {
		if (measure !== lastMeasure) {
			measuresSinceBreak += measure - lastMeasure;
			lastMeasure = measure;
		}
		if (pendingBreak && wordBreakBefore) {
			lines.push(currentLine.trim());
			currentLine = '';
			measuresSinceBreak = 0;
			pendingBreak = false;
		}
		if (measuresSinceBreak >= MUSICXML_MEASURES_PER_LINE) pendingBreak = true;
		if (wordBreakBefore && currentLine.length > 0) currentLine += ' ';
		if (chord) currentLine += `[${chord}]`;
		currentLine += text;
	}
	if (currentLine.trim()) lines.push(currentLine.trim());
	if (lines.length === 0) return null;

	const sectionId = 'v1';
	return {
		version: 2,
		sections: { [sectionId]: { type: 'verse', lines } },
		order: [{ id: sectionId }],
	};
}

// Otwiera dialog wyboru pliku i zwraca Promise<lyrics v2 | null>
function importMusicXmlFromFile() {
	return new Promise((resolve) => {
		const input = document.createElement('input');
		input.type = 'file';
		input.accept = '.musicxml,.mxl,.xml';
		input.onchange = () => {
			const file = input.files[0];
			if (!file) return resolve(null);
			const reader = new FileReader();
			reader.onload = (e) => {
				try {
					resolve(parseMusicXmlText(e.target.result));
				} catch (err) {
					console.error('Błąd parsowania MusicXML:', err);
					resolve(null);
				}
			};
			reader.readAsText(file, 'utf-8');
		};
		input.oncancel = () => resolve(null);
		input.click();
	});
}

