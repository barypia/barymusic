/* ==================== ŁADOWANIE UTWORÓW ==================== */

let allSongs = [];
let songFiles = {};
let _connectSubtitleCallback = null;

function sortSongsByTitle(songs) {
    return songs.sort((a, b) => String(a.title || '').localeCompare(String(b.title || ''), 'pl'));
}

async function loadJson() {
    if (window.innerWidth <= 600 || window.innerHeight <= 600) {
        const subtitle = document.getElementById('connectModalSubtitle');
        if (subtitle) setElementDisplay(subtitle, false);
        return true;
    }

    try {
        const response = await fetch(`${restApiAddress}/api/songs`, { credentials: 'include' });
        if (response.status === 401) {
            allSongs = [];
			const subtitle = document.getElementById('connectModalSubtitle');
			if (subtitle) subtitle.classList.add('hidden');
            return true;
        }
        if (!response.ok) throw new Error(i18n.t('songs.load_error'));
        allSongs = await response.json();
        sortSongsByTitle(allSongs);

        // Wyciągnij metadane plików z każdej piosenki
        allSongs.forEach(s => {
            if (!Array.isArray(s.tags)) s.tags = [];
            if (s.files) {
                songFiles[s.id] = s.files;
            }
        });
        setConnectSubtitle(() => {
            const n = allSongs.length;
            const label = i18n.t('songs.count', { count: n });
            return i18n.t('songs.library_status', { label });
        });
        return true;
    } catch (e) {
        console.error('Błąd ładowania:', e);
        setConnectSubtitle(() => i18n.t('connection.library_unavailable'));
    }
}

function resolveLyricsClient(raw) {
    if (!raw) return [];
    if (Array.isArray(raw)) return raw;
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

function setConnectSubtitle(getContent) {
    _connectSubtitleCallback = getContent;
    const subtitle = document.getElementById('connectModalSubtitle');
    if (!subtitle) return;
	if (!isLogged) {
		subtitle.classList.add('hidden');
		return;
	}
	subtitle.classList.remove('hidden');
    subtitle.style.transition = 'opacity 0.2s ease';
    subtitle.style.opacity = '0';
    requestAnimationFrame(() => {
        subtitle.textContent = getContent();
        subtitle.style.opacity = '';
    });
}
