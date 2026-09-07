/* ==================== ODTWARZACZ AUDIO ==================== */

let autoSyncEnabled = false;
let syncCheckInterval = null;

function formatTime(seconds) {
	const mins = Math.floor(seconds / 60);
	const secs = Math.round(Math.floor(seconds % 60));
	return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function togglePlayPause() {
	const audio = document.getElementById('audioPlayer');
    const icon = document.querySelector('#playPauseBtn');
	if (audio.paused) {
		audio.play();
		icon.innerHTML = '<i data-lucide="pause"></i>'
	} else {
		audio.pause();
		icon.innerHTML = '<i data-lucide="play"></i>'
	}
    lucide.createIcons({ nodes: [icon] });
}

function initCustomAudioPlayer() {
    const audio = document.getElementById('audioPlayer');
    const progressContainer = document.querySelector('#progressContainer');
    const progressBar = document.getElementById('progressBar');
    const progressFill = document.getElementById('progressFill');
    const currentTimeEl = document.getElementById('currentTime');
    const totalTimeEl = document.getElementById('totalTime');

    if (syncCheckInterval) {
        clearInterval(syncCheckInterval);
        syncCheckInterval = null;
    }

    let isDragging = false;
	let rafId = null;

	const updateProgress = () => {
		if (!audio.duration) return;
		const percent = (audio.currentTime / audio.duration) * 100;
		progressFill.style.width = percent + '%';
		currentTimeEl.textContent = formatTime(audio.currentTime);
		totalTimeEl.textContent = formatTime(audio.duration);
	};

	function startUpdating() {
		function tick() {
			updateProgress();
			rafId = requestAnimationFrame(tick);
		}

		if (rafId !== null) cancelAnimationFrame(rafId);
		rafId = requestAnimationFrame(tick);
	}
	const stopUpdating = () => {
		if (rafId === null) return;
		cancelAnimationFrame(rafId);
		rafId = null;
	};

	audio.addEventListener('play', startUpdating);

	audio.addEventListener('loadedmetadata', () => {
		totalTimeEl.textContent = formatTime(audio.duration);
		const infoDuration = document.getElementById('audioDurationValue');
		if (infoDuration) infoDuration.textContent = audio.duration.toFixed(1) + 's';
	});

	audio.addEventListener('ended', () => {
		stopUpdating();
        const icon = document.querySelector('#playPauseBtn');
		icon.innerHTML = '<i data-lucide="play"></i>'
        lucide.createIcons({ nodes: [icon] });
	});

	audio.addEventListener('pause', () => {
		stopUpdating();
        const icon = document.querySelector('#playPauseBtn');
		icon.innerHTML = '<i data-lucide="play"></i>'
        lucide.createIcons({ nodes: [icon] });
	});

	audio.addEventListener('play', () => {
        const icon = document.querySelector('#playPauseBtn');
		icon.innerHTML = '<i data-lucide="pause"></i>'
        lucide.createIcons({ nodes: [icon] });
	});

	const seekTo = (e) => {
		const rect = progressBar.getBoundingClientRect();
		const x = e.clientX || e.touches[0].clientX;
		const percent = Math.max(0, Math.min(1, (x - rect.left) / rect.width));
		audio.currentTime = percent * audio.duration;
	};

	progressContainer.addEventListener('click', seekTo);

	progressContainer.addEventListener('mousedown', (e) => {
		isDragging = true;
		progressContainer.classList.add('dragging');
		seekTo(e);
	});

	document.addEventListener('mousemove', (e) => {
		if (isDragging) seekTo(e);
	});

	document.addEventListener('mouseup', () => {
		if (isDragging) {
			isDragging = false;
			progressContainer.classList.remove('dragging');
		}
	});

	progressContainer.addEventListener('touchstart', (e) => {
		isDragging = true;
		progressContainer.classList.add('dragging');
		seekTo(e);
		e.preventDefault();
	}, { passive: false });

	progressContainer.addEventListener('touchmove', (e) => {
		if (isDragging) {
			seekTo(e);
			e.preventDefault();
		}
	}, { passive: false });

	document.addEventListener('touchend', () => {
		if (isDragging) {
			isDragging = false;
			progressContainer.classList.remove('dragging');
		}
	});
}

function seekToLyric(index) {
	const audio = document.getElementById('audioPlayer');
	const lyric = currentSong.lyrics[index];
	if (lyric?.timestamp !== undefined) {
		audio.currentTime = lyric.timestamp;
		audio.play();
		const icon = document.querySelector('#playPauseBtn');
		icon.innerHTML = '<i data-lucide="pause"></i>'
        lucide.createIcons({ nodes: [icon] });
	}
}

function toggleAutoSync() {
    autoSyncEnabled = !autoSyncEnabled;
    const btn = document.querySelector(('[data-action="toggle-auto-sync"]'));

    if (!btn) return;

    btn.classList.toggle('active', autoSyncEnabled);

    if (autoSyncEnabled) {
        startAutoSync();
    } else {
        stopAutoSync();
    }
}

function startAutoSync() {
    const audioPlayer = document.getElementById('audioPlayer');

    if (!currentSong || !currentSong.lyrics ||
        !currentSong.lyrics.some(l => l.timestamp !== undefined && l.timestamp !== null)) {
        console.warn('Piosenka nie ma znaczników czasowych');
        return;
    }

    if (syncCheckInterval) {
        clearInterval(syncCheckInterval);
    }

    syncCheckInterval = setInterval(() => {
        if (!audioPlayer || audioPlayer.paused) return;

        const currentTime = audioPlayer.currentTime;
        checkAndSendLyric(currentTime);
    }, 50);
}

function stopAutoSync() {
	if (syncCheckInterval) {
		clearInterval(syncCheckInterval);
		syncCheckInterval = null;
	}
}

function checkAndSendLyric(currentTime) {
	if (!currentSong || !currentSong.lyrics) return;

	for (let i = 0; i < currentSong.lyrics.length; i++) {
		const lyric = currentSong.lyrics[i];
		const nextLyric = currentSong.lyrics[i + 1];

		const isInRange = currentTime >= lyric.timestamp &&
						(!nextLyric || currentTime < nextLyric.timestamp);

		if (isInRange && currentLyricIndex !== i) {
			sendLyric(lyric, i);
			break;
		}
	}
}

// Context menu - audio
function _openAudioContextMenu(pos) {
	const canEdit = currentIsAdmin || (currentUser && currentUser === currentSong?.uploadedByUsername);

	const items = [
		{
			icon: 'file-audio',
			label: i18n.t('songs.manage_audio'),
			disabled: !canEdit,
			action: () => editSongOnTab('files')
		},
	];

	showContextMenu(items, pos);
}
