/* ==================== TEKST PIOSENEK ==================== */

let currentLyricIndex = -1;
let lyricScroll = true;

function syncLyricsControlsWidth() {
    const textView = document.getElementById('mainContainer-tab-text');
    const controls = textView?.querySelector('.sheet-floating-controls');
    if (!textView || !controls) return;

    textView.style.setProperty('--lyrics-controls-width', `${controls.offsetWidth}px`);
}

const lyricsControls = document.getElementById('mainContainer-tab-text')?.querySelector('.sheet-floating-controls');
if (lyricsControls) {
    syncLyricsControlsWidth();
    new ResizeObserver(syncLyricsControlsWidth).observe(lyricsControls);
}

function animateLyricCards(changeFn) {
    const cards = [...document.querySelectorAll('.lyric-card')];
    const first = cards.map(card => card.getBoundingClientRect().height);
    // Wyłącz transition na elementach wewnętrznych żeby getBoundingClientRect po changeFn
    // zwrócił docelową wysokość, a nie pośrednią z trwającej animacji CSS
    const inner = [...document.querySelectorAll('.chord')];
    inner.forEach(el => { el.style.transition = 'none'; });
    changeFn();
    // Reflow — przeglądarka przelicza layout z nowym stanem CSS
    cards[0]?.offsetHeight;
    const last = cards.map(card => card.getBoundingClientRect().height);
    // Przywróć transition na elementach wewnętrznych
    inner.forEach(el => { el.style.transition = ''; });
    cards.forEach((card, i) => {
        if (first[i] === last[i]) return;
        card.style.transition = 'none';
        card.style.height = first[i] + 'px';
        card.offsetHeight; // reflow
        card.style.transition = 'height 0.25s ease';
        card.style.height = last[i] + 'px';
        const cleanup = () => { card.style.height = ''; };
        card.addEventListener('transitionend', cleanup, { once: true });
        setTimeout(cleanup, 400);
    });
}

function populateLyricsGrid(lyricsGrid, song) {
    if (!lyricsGrid) return;

    if (!song || !song.lyrics || song.lyrics.length === 0) {
        lyricsGrid.innerHTML = `<div class="flex items-center justify-center h-full text-[2rem]" style="color:var(--color-muted)">${i18n.t('songs.no_lyrics')}</div>`;
        return;
    }

    let verseCount = 0;

    song.lyrics.forEach((lyric, index) => {
        const card = document.createElement('div');
        card.className = `lyric-card lyric-card--${lyric.type || 'verse'}`;
        card.onclick = () => sendLyric(lyric, index);
        addContextMenu(card, pos => _openLyricCardContextMenu(lyric, index, card, pos));
        if (lyric.sheetAnchor) {
            card.dataset.sheetAnchor = JSON.stringify(lyric.sheetAnchor);
        }

        let label = '';
        if (lyric.type === 'verse') {
            verseCount++;
            label = `${getSectionTypes().find(st => st.value === 'verse').label} ${verseCount}`;
        } else {
            label = (getSectionTypes().find(st => st.value === lyric.type) ?? getSectionTypes()[0]).label;
        }

        const showTimestamp = lyric.timestamp !== undefined && lyric.timestamp !== null;
        const hasChords = lyric.hasChords || /\[[A-GHa-gh][♯♭#b]?(?:m|maj|min|dim|aug|sus|add|M)?[0-9]*\]/.test(lyric.text);
        const repeatBadge = lyric.repeat && lyric.repeat > 1 ? `<span class="repeat-badge">x${lyric.repeat}</span>` : '';

        let content = '';
        if (hasChords) {
            const parsedLines = parseChords(lyric.text);
            content = '<div class="lyrics-with-chords">';
            parsedLines.forEach(line => {
                content += '<div class="lyric-line">';
                if (line.chords.length > 0) {
                    const sortedChords = [...line.chords].sort((a, b) => a.position - b.position);

                    // Buduj listę chunków: { chords[], text, sep }
                    // sep=true oznacza że po tym chunku jest spacja (punkt łamania)
                    const chunks = [];

                    const firstChordPos = sortedChords[0].position;
                    if (firstChordPos > 0) {
                        const pre = line.text.substring(0, firstChordPos);
                        const preInner = pre.trimEnd();
                        const preSep = pre.length > preInner.length;
                        if (preInner) chunks.push({ chords: [], text: preInner, sep: preSep });
                    }

                    let pendingChords = [];
                    sortedChords.forEach((ch, ci) => {
                        const nextPos = ci + 1 < sortedChords.length ? sortedChords[ci + 1].position : line.text.length;
                        const raw = line.text.substring(ch.position, nextPos);
                        const inner = raw.trimEnd();
                        const hasSep = raw.length > inner.length;
                        pendingChords.push(ch.chord);
                        if (inner || ci === sortedChords.length - 1) {
                            chunks.push({ chords: pendingChords, text: inner, sep: hasSep });
                            pendingChords = [];
                        }
                    });

                    // Grupuj kolejne chunki bez separatora w nowrap-wrapper
                    let wordGroup = [];
                    const flushGroup = () => {
                        if (!wordGroup.length) return;
                        const inner = wordGroup.map(ck => {
                            const chordsHtml = ck.chords.length
                                ? ck.chords.map(c => `<span class="chord" data-original="${escapeHtml(c)}">${escapeHtml(c)}</span>`).join('')
                                : `<span class="chord chord-empty">&nbsp;</span>`;
                            const textHtml = escapeHtml(ck.text).replace(/ /g, '&nbsp;');
                            return `<span class="chord-chunk"><span class="chord-chunk-chords">${chordsHtml}</span><span class="chord-chunk-text">${textHtml || '&ZeroWidthSpace;'}</span></span>`;
                        }).join('');
                        content += wordGroup.length > 1
                            ? `<span class="chord-word">${inner}</span>`
                            : inner;
                        wordGroup = [];
                    };

                    chunks.forEach((ck, i) => {
                        wordGroup.push(ck);
                        if (ck.sep) {
                            flushGroup();
                            content += ' ';
                        } else if (i === chunks.length - 1) {
                            flushGroup();
                        }
                    });
                } else {
                    content += `<span class="chord-chunk-text">${escapeHtml(line.text)}</span>`;
                }
                content += '</div>';
            });
            content += '</div>';
        } else {
            const normalized = lyric.text
                .replace(/<p>/gi, '')
                .replace(/<\/p>/gi, '\n')
                .replace(/<br\s*\/?>/gi, '\n')
                .trim();
            content = `<div class="lyric-text">${escapeHtml(normalized)}</div>`;
        }

        card.innerHTML = `
            <div class="lyric-label">
                <span class="lyric-title">${label}</span>
                ${repeatBadge}
                <span class="lyric-label-right">
                    ${showTimestamp ? `<span class="timestamp${timestampsVisible ? ' flex' : ' hidden'}" data-time="${lyric.timestamp}" data-index="${index}">${formatTime(lyric.timestamp)}</span>` : ''}
                </span>
            </div>
            ${content}
        `;

        if (showTimestamp) {
            card.querySelector('.timestamp')?.addEventListener('click', (e) => {
                e.stopPropagation();
                seekToLyric(index);
            });
        }

        lyricsGrid.appendChild(card);
    });
    lucide.createIcons({ nodes: [lyricsGrid] });
}

async function saveSheetAnchor(lyric, card) {
    const anchor = getSheetAnchor();
    if (anchor === null) {
        showToast('error', i18n.t('songs.no_sheets_title'), i18n.t('songs.sheet_anchor_missing_description'));
        return;
    }

    const raw = currentSong.lyricsRaw;
    if (!raw || raw.version !== 2) return;

    const entry = raw.order[lyric.orderIndex];
    if (!entry || entry.id !== lyric.id) return;
    entry.sheetAnchor = anchor;

    try {
        const resp = await fetch(`${restApiAddress}/api/songs/${currentSong.id}`, {
            method: 'PUT',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ lyrics: raw }),
        });
        if (!resp.ok) throw new Error();
        lyric.sheetAnchor = anchor;
        card.dataset.sheetAnchor = JSON.stringify(anchor);
        const btn = card.querySelector('[data-role="sheet-anchor"]');
        if (btn) { btn.classList.add('has-anchor'); btn.title = i18n.t('songs.change_sheets_position'); }
        showToast('success', i18n.t('songs.sheets_pos_saved'));
    } catch {
        showToast('error', i18n.t('songs.sheet_anchor_save_error'));
    }
}

async function saveAudioTimestamp(lyric, card) {
    const audio = document.getElementById('audioPlayer');
    if (!audio) {
        showToast('error', i18n.t('songs.no_audio_title'), i18n.t('songs.audio_anchor_missing_description'));
        return;
    }

    const ts = Math.floor(audio.currentTime);

    const raw = currentSong.lyricsRaw;
    if (!raw || raw.version !== 2) return;

    const entry = raw.order[lyric.orderIndex];
    if (!entry || entry.id !== lyric.id) return;
    entry.timestamp = ts;

    try {
        const resp = await fetch(`${restApiAddress}/api/songs/${currentSong.id}`, {
            method: 'PUT',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ lyrics: raw }),
        });
        if (!resp.ok) throw new Error();
        lyric.timestamp = ts;

        // Zaktualizuj lub dodaj element .timestamp na karcie
        const right = card.querySelector('.lyric-label-right');
        let tsEl = right.querySelector('.timestamp');
        if (!tsEl) {
            tsEl = document.createElement('span');
            tsEl.className = 'timestamp' + (timestampsVisible ? ' flex' : ' hidden');
            tsEl.addEventListener('click', (e) => { e.stopPropagation(); seekToLyric(currentSong.lyrics.indexOf(lyric)); });
            right.appendChild(tsEl);
        }
        tsEl.dataset.time = ts;
        tsEl.textContent = formatTime(ts);

        const btn = card.querySelector('[data-role="audio-anchor"]');
        if (btn) { btn.classList.add('has-anchor'); btn.title = i18n.t('songs.set_timestamp'); }
        updateTimestampVisibility();
        showToast('success', i18n.t('songs.timestamp_updated'));
    } catch {
        showToast('error', i18n.t('songs.timestamp_save_error'));
    }
}

function sendLyric(lyric, index) {
	if (libraryMode) {
		currentLyricIndex = index;
		updateLyricHighlight();
		return;
	}
	if (ws && ws.readyState === WebSocket.OPEN) {
		ws.send(JSON.stringify({
			type: 'lyric',
			songId: currentSong.id,
			lyricId: lyric.id,
			lyricIndex: index
		}));

		currentLyricIndex = index;
		updateLyricHighlight();
	} else {
		showToast('error', i18n.t('common.error'), i18n.t('songs.connection_required'));
	}
}

function clearScreen() {
	if (libraryMode) {
		currentLyricIndex = -1;
		updateLyricHighlight();
		return;
	}
	if (ws && ws.readyState === WebSocket.OPEN) {
		ws.send(JSON.stringify({ type: 'clear'}));
		currentLyricIndex = -1;
		updateLyricHighlight();
	}
}

function updateLyricHighlight() {
    document.querySelectorAll('.lyric-card').forEach((card, idx) => {
        const wasActive = card.classList.contains('active');
        card.classList.toggle('active', idx === currentLyricIndex);

        if (idx === currentLyricIndex) {
            // Scroll nut do zapisanej pozycji
            if (card.dataset.sheetAnchor) {
                scrollSheetToY(JSON.parse(card.dataset.sheetAnchor));
            }

            const container = card.parentElement;
            const prevCard = card.previousElementSibling;
            const nextCard = card.nextElementSibling;

            // Sprawdź czy poprzednia i następna karta istnieją
            const hasPrevCard = prevCard && prevCard.classList.contains('lyric-card');
            const hasNextCard = nextCard && nextCard.classList.contains('lyric-card');

            const containerRect = container.getBoundingClientRect();
            const cardRect = card.getBoundingClientRect();

            // Jeśli to pierwszy element (brak poprzedniego)
            if (!hasPrevCard) {
                const isCardFullyVisible = cardRect.top >= containerRect.top &&
                                          cardRect.bottom <= containerRect.bottom;
                if (!isCardFullyVisible) {
                    card.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }
            }
            // Jeśli to ostatni element (brak następnego)
            else if (!hasNextCard) {
                const isCardFullyVisible = cardRect.top >= containerRect.top &&
                                          cardRect.bottom <= containerRect.bottom;
                if (!isCardFullyVisible) {
                    card.scrollIntoView({ behavior: 'smooth', block: 'end' });
                }
            }
            // Jeśli są sąsiedzi - sprawdź ich widoczność
            else {
                const prevVisible = prevCard.getBoundingClientRect().top >= containerRect.top &&
                                   prevCard.getBoundingClientRect().bottom <= containerRect.bottom;

                const nextVisible = nextCard.getBoundingClientRect().top >= containerRect.top &&
                                   nextCard.getBoundingClientRect().bottom <= containerRect.bottom;

                // Jeśli któryś z sąsiadów nie jest widoczny, przewiń do centrum
                if (!prevVisible || !nextVisible) {
                    card.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }
            }

            // Dodaj przycisk clear jeśli nie istnieje
            const label = card.querySelector('.lyric-label');
            if (label && !label.querySelector('.card-clear-btn')) {
                const clearBtn = document.createElement('button');
                clearBtn.className = 'card-clear-btn';
                clearBtn.innerHTML = '<i data-lucide="x"></i>';
                clearBtn.onclick = (e) => {
                    e.stopPropagation();
                    clearScreen();
                };
                const rightEl = label.querySelector('.lyric-label-right');
                if (rightEl) {
                    rightEl.before(clearBtn);
                } else {
                    label.appendChild(clearBtn);
                }
                lucide.createIcons({ nodes: [clearBtn] });
                // Animacja wejścia
                clearBtn.style.width = '0';
                clearBtn.style.overflow = 'hidden';
                requestAnimationFrame(() => { clearBtn.style.width = ''; });
            }
        } else if (wasActive) {
            // Usuń przycisk clear z animacją wyjścia
            const clearBtn = card.querySelector('.card-clear-btn');
            if (clearBtn) {
                clearBtn.style.width = '0';
                clearBtn.style.overflow = 'hidden';
                clearBtn.addEventListener('transitionend', () => clearBtn.remove(), { once: true });
            }
        }
    });
}

document.addEventListener('keydown', (e) => {
    if (!currentSong) return;
    if (e.target.matches('input, textarea, select, [contenteditable]')) return;

    if (e.key === 'ArrowDown' || e.key === 'ArrowRight' || e.key === ' ' || e.key === 'PageDown') {
        e.preventDefault();
        const next = currentLyricIndex + 1;
        if (next < currentSong.lyrics.length) sendLyric(currentSong.lyrics[next], next);
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft' || e.key === 'PageUp') {
        e.preventDefault();
        const prev = currentLyricIndex - 1;
        if (prev >= 0) sendLyric(currentSong.lyrics[prev], prev);
        else if (currentLyricIndex >= 0) clearScreen();
    }
});

function toggleLyricScroll() {
    lyricScroll = !lyricScroll;
    const controls = document.getElementById('mainContainer-tab-text').querySelector('.sheet-floating-controls');
    controls.classList.toggle('right-5!', lyricScroll);
    controls.classList.toggle('right-3!', !lyricScroll);
    document.querySelectorAll('[data-lyrics-grid]').forEach(grid => {
        grid.classList.toggle('overflow-y-scroll', lyricScroll);
        grid.classList.toggle('overflow-hidden!', !lyricScroll);
    });
    document.querySelectorAll('[data-action="toggle-scroll"]').forEach(btn => {
        btn.classList.toggle('active', lyricScroll);
    });
}

function _stripChords(text) {
	return (text || '').replace(/\[[A-GHa-gh][^\]]*\]/g, '').replace(/  +/g, ' ').trim();
}

async function _removeSheetAnchor(lyric, card) {
	const raw = currentSong.lyricsRaw;
	if (!raw || raw.version !== 2) return;
	const entry = raw.order[lyric.orderIndex];
	if (!entry || entry.id !== lyric.id) return;
	delete entry.sheetAnchor;

	try {
		const resp = await fetch(`${restApiAddress}/api/songs/${currentSong.id}`, {
			method: 'PUT',
			credentials: 'include',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ lyrics: raw }),
		});
		if (!resp.ok) throw new Error();
		lyric.sheetAnchor = null;
		delete card.dataset.sheetAnchor;
		showToast('success', i18n.t('songs.sheets_removed'));
	} catch {
		showToast('error', i18n.t('songs.save_error'));
	}
}

async function _removeAudioTimestamp(lyric, card) {
	const raw = currentSong.lyricsRaw;
	if (!raw || raw.version !== 2) return;
	const entry = raw.order[lyric.orderIndex];
	if (!entry || entry.id !== lyric.id) return;
	delete entry.timestamp;

	try {
		const resp = await fetch(`${restApiAddress}/api/songs/${currentSong.id}`, {
			method: 'PUT',
			credentials: 'include',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ lyrics: raw }),
		});
		if (!resp.ok) throw new Error();
		delete lyric.timestamp;
		card.querySelector('.timestamp')?.remove();
		const btn = card.querySelector('[data-role="audio-anchor"]');
		if (btn) { btn.classList.remove('has-anchor'); btn.title = i18n.t('songs.remove_timestamp'); }
		showToast('success', i18n.t('songs.timestamp_removed'));
	} catch {
		showToast('error', i18n.t('songs.save_error'));
	}
}

// Context menu - lyrics
function _openLyricCardContextMenu(lyric, index, card, pos) {
	const canEdit = currentIsAdmin || (currentUser && currentUser === currentSong?.uploadedByUsername);
	const hasChords = /\[[A-GHa-gh][^\]]*\]/.test(lyric.text || '');
	const hasAnchor = !!lyric.sheetAnchor;

	const items = [
		{
			icon: 'pencil',
			label: i18n.t('songs.edit_section'),
			disabled: !canEdit,
			action: () => editSongOnTab('lyrics')
		},
		{
			icon: 'clipboard',
			label: i18n.t('songs.copy'),
			submenu: [
				{
					icon: 'clipboard-copy',
					label: i18n.t('songs.copy_text'),
					action: () => {
						const text = _stripChords(lyric.text);
						navigator.clipboard.writeText(text).then(
							() => showToast('success', i18n.t('songs.copy_text_success')),
							() => showToast('error', i18n.t('songs.copy_error'))
						);
					}
				},
				{
					icon: 'clipboard-copy',
					label: i18n.t('songs.copy_text_chords'),
					disabled: !hasChords,
					action: () => {
						const text = lyric.text || '';
						navigator.clipboard.writeText(text).then(
							() => showToast('success', i18n.t('songs.copy_with_chords_success')),
							() => showToast('error', i18n.t('songs.copy_error'))
						);
					}
				}
			]
		}, 
		{
			icon: 'hash',
			label: i18n.t('songs.transpose'),
			disabled: !hasChords,
			submenu: [
				{
					icon: 'hash',
					content: `${i18n.t('songs.transpose_state')}: ${currentTranspose}`,
					disabled: !hasChords
				},
				{
					icon: 'plus',
					label: i18n.t('songs.transpose_up'),
					disabled: !hasChords || currentTranspose >= 12,
					action: () => transposeAllChords(1)
				},
				{
					icon: 'minus',
					label: i18n.t('songs.transpose_down'),
					disabled: !hasChords || currentTranspose <= -12,
					action: () => transposeAllChords(-1)
				},
				{
					icon: 'rotate-ccw',
					label: i18n.t('songs.transpose_reset'),
					disabled: !hasChords,
					action: () => resetTranspose()
				}
			]
		},
		{
			icon: 'eye',
			label: i18n.t('songs.show'),
			submenu: {
				type: 'multi',
				value: [
					...(chordsVisible ? ['chords'] : []),
					...(timestampsVisible ? ['timestamps'] : []),
					...(lyricScroll ? ['scrollbar'] : [])
				],
				defaultValue: ['chords', 'timestamps', 'scrollbar'],
				items: [
					{ value: 'chords', label: i18n.t('songs.show_chords') },
					{ value: 'timestamps', label: i18n.t('songs.show_timestamps') },
					{ value: 'scrollbar', label: i18n.t('songs.show_scrollbar') }
				],
				onChange: (values, option) => {
					if (option.value === 'chords') toggleChords();
					if (option.value === 'timestamps') toggleTimestamps();
					if (option.value === 'scrollbar') toggleLyricScroll();
				}
			}
		},
		{ separator: true },
		{
			icon: 'anchor',
			label: i18n.t('songs.set_sheets_position'),
    		disabled: !canEdit || !currentSong?.files?.sheets,
			action: () => saveSheetAnchor(lyric, card)
		},
		{
			icon: 'anchor',
			label: i18n.t('songs.remove_sheets_position'),
			disabled: !canEdit || !currentSong?.files?.sheets || !hasAnchor,
			danger: true,
			action: () => _removeSheetAnchor(lyric, card)
		},
		{ separator: true },
		{
			icon: 'clock',
			label: i18n.t('songs.set_timestamp'),
			disabled: !canEdit || !currentSong?.files?.audio,
			action: () => saveAudioTimestamp(lyric, card)
		},
		{
			icon: 'clock',
			label: i18n.t('songs.remove_timestamp'),
			disabled: !canEdit || !currentSong?.files?.audio || lyric.timestamp === null,
			danger: true,
			action: () => _removeAudioTimestamp(lyric, card)
		}
	];

	showContextMenu(items, pos);
}