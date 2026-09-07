/* ==================== AKORDY I TRANSPOZYCJA ==================== */

const CHORD_MAP = {
  // Durowe
  'C': 0,
  'C♯': 1, 'C#': 1, 'D♭': 1, 'Db': 1,
  'D': 2,
  'D♯': 3, 'D#': 3, 'E♭': 3, 'Eb': 3,
  'E': 4,
  'F': 5,
  'F♯': 6, 'F#': 6, 'G♭': 6, 'Gb': 6,
  'G': 7,
  'G♯': 8, 'G#': 8, 'A♭': 8, 'Ab': 8,
  'A': 9,
  'A♯': 10, 'A#': 10, 'B♭': 10, 'Bb': 10, 'H♭': 10, 'Hb': 10,
  'B': 11, 'H': 11,

  // Molowe
  'c': 0,
  'c♯': 1, 'c#': 1, 'd♭': 1, 'db': 1,
  'd': 2,
  'd♯': 3, 'd#': 3, 'e♭': 3, 'eb': 3,
  'e': 4,
  'f': 5,
  'f♯': 6, 'f#': 6, 'g♭': 6, 'gb': 6,
  'g': 7,
  'g♯': 8, 'g#': 8, 'a♭': 8, 'ab': 8,
  'a': 9,
  'a♯': 10, 'a#': 10, 'b♭': 10, 'bb': 10, 'h♭': 10, 'hb': 10,
  'b': 11, 'h': 11
};

const CHORD_NAMES_SHARP = [
  'C', 'C♯', 'D', 'D♯', 'E', 'F',
  'F♯', 'G', 'G♯', 'A', 'A♯', 'B'
];

const CHORD_NAMES_FLAT = [
  'C', 'D♭', 'D', 'E♭', 'E', 'F',
  'G♭', 'G', 'A♭', 'A', 'B♭', 'H♭', 'B'
]

const CHORD_NAMES_SHARP_MINOR = [
  'c', 'c♯', 'd', 'd♯', 'e', 'f',
  'f♯', 'g', 'g♯', 'a', 'a♯', 'b'
];

const CHORD_NAMES_FLAT_MINOR = [
  'c', 'd♭', 'd', 'e♭', 'e', 'f',
  'g♭', 'g', 'a♭', 'a', 'b♭', 'h♭', 'b'
];

let currentTranspose = 0;



function parseChords(text) {
    // Rozszerzony regex dla akordów - obsługuje więcej wariantów
    const chordRegex = /\[([A-GHa-gh][♯♭#b]?(?:m|maj|min|dim|aug|sus|add|M)?[0-9]*(?:\/[A-GHa-gh][♯♭#b]?)?)\]/g;

    // Rozbij tekst na linie - obsługa różnych formatów
    const lines = text
        .replace(/<\/p>/gi, '\n')
        .replace(/<p>/gi, '')
        .replace(/<br\s*\/?>/gi, '\n')
        .split('\n');

    const parsedLines = [];

    lines.forEach(line => {
        const chords = [];
        let match;

        // Reset regex dla każdej linii
        chordRegex.lastIndex = 0;

        while ((match = chordRegex.exec(line)) !== null) {
            // Oblicz pozycję w tekście BEZ znaczników akordów
            const positionInOriginal = match.index;

            // Policz ile znaków akordowych było przed tą pozycją
            let chordCharsBefore = 0;
            let tempMatch;
            const tempRegex = /\[([A-GHa-gh][♯♭#b]?(?:m|maj|min|dim|aug|sus|add|M)?[0-9]*(?:\/[A-GHa-gh][♯♭#b]?)?)\]/g;

            while ((tempMatch = tempRegex.exec(line)) !== null && tempMatch.index < positionInOriginal) {
                chordCharsBefore += tempMatch[0].length;
            }

            chords.push({
                chord: match[1],
                position: positionInOriginal - chordCharsBefore
            });
        }

        // Usuń wszystkie znaczniki akordów z tekstu
        chordRegex.lastIndex = 0;
        const plainText = line.replace(chordRegex, '');

        // Dodaj linię nawet jeśli jest pusta (zachowaj puste linie dla formatowania)
        if (plainText.trim() || chords.length > 0) {
            parsedLines.push({
                text: plainText,  // Zachowujemy spacje na początku/końcu
                chords: chords
            });
        }
    });

    return parsedLines;
}

let chordsVisible = true;

function toggleChords() {
    chordsVisible = !chordsVisible;
    document.querySelectorAll('.transpose-controls').forEach(el => {
        setElementDisplay(el, chordsVisible);
    });
    animateLyricCards(() => {
        document.querySelectorAll('.lyric-line').forEach(line => {
            line.classList.toggle('chords-hidden', !chordsVisible);
        });
    });
    document.querySelectorAll('[data-action="toggle-chords"]').forEach(btn => {
        btn.classList.toggle('active', chordsVisible);
    });
}

function transposeChord(chord, semitones, preferFlats = false) {
    const match = chord.match(/^([A-GHa-gh][♯♭#b]?)(.*)/);
    if (!match) return chord;

    const [, root, suffix] = match;
    const isMinor = root[0] === root[0].toLowerCase() && root[0] !== root[0].toUpperCase();

    const rootIndex = CHORD_MAP[root];
    if (rootIndex === undefined) return chord;

    const newIndex = (rootIndex + semitones + 12) % 12;

    // Wybierz odpowiedni zestaw nazw
    let chordNames;
    if (isMinor) {
        chordNames = preferFlats ? CHORD_NAMES_FLAT_MINOR : CHORD_NAMES_SHARP_MINOR;
    } else {
        chordNames = preferFlats ? CHORD_NAMES_FLAT : CHORD_NAMES_SHARP;
    }

    return chordNames[newIndex] + suffix;
}

function transposeAllChords(semitones) {
    // Ogranicz zakres do -12..+12
    const newTranspose = currentTranspose + semitones;
    if (newTranspose < -12 || newTranspose > 12) {
        return; // Nie pozwól wyjść poza zakres
    }

    currentTranspose = newTranspose;

    // Określ czy używać bemoli czy krzyżyków
    const normalizedTranspose = ((currentTranspose % 12) + 12) % 12;
    const preferFlats = [1, 3, 6, 8, 10, 5].includes(normalizedTranspose);

    document.querySelectorAll('.chord').forEach(el => {
        const originalChord = el.getAttribute('data-original') || el.textContent;
        if (!el.hasAttribute('data-original')) {
            el.setAttribute('data-original', originalChord);
        }
        el.textContent = transposeChord(originalChord, currentTranspose, preferFlats);
    });

    updateTransposeDisplay();
}

function resetTranspose() {
    currentTranspose = 0;
    document.querySelectorAll('.chord').forEach(el => {
        const original = el.getAttribute('data-original');
        if (original) {
            el.textContent = original;
            el.removeAttribute('data-original');
        }
    });
    updateTransposeDisplay();
}

function updateTransposeDisplay() {
    const sign = currentTranspose > 0 ? '+' : '';
    const text = currentTranspose === 0 ? '0' : `${sign}${currentTranspose}`;
    document.querySelectorAll('[data-transpose-display]').forEach(el => {
        el.textContent = text;
    });

    // Zablokuj przyciski na krańcach zakresu
    document.querySelectorAll('.transpose-controls').forEach(container => {
        const downBtn = container.querySelector('[data-action="transpose-down"]');
        const upBtn   = container.querySelector('[data-action="transpose-up"]');
        if (downBtn) downBtn.disabled = currentTranspose <= -12;
        if (upBtn)   upBtn.disabled   = currentTranspose >= 12;
    });
}
