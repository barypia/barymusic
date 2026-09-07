/* ==================== WEBSOCKET ==================== */

let ws = null;
let isNewChannel = null;
let channelId = null;
let channelName = null;
let channelUserCount = null;

let socketPing = null;

let libraryMode = false;
let wsReconnectTimeout = null;
let socketFailCount = 0;
let savedPanelStateBeforeLibraryMode = null;

const _wsProto = location.protocol === 'https:' ? 'wss:' : 'ws:';
let webSocketAddress = `${_wsProto}//${location.host}/socket`;
let restApiAddress = '';

function connectWebSocket() {
	let client_id = localStorage.getItem('client_id');
	ws = new WebSocket(webSocketAddress);

	ws.onopen = () => {
		updateWSStatus(1);
		updateConnectModeAccess();
		console.log('Connected to WebSocket');
		updateWebSocketPopupDisplay();
		socketFailCount = 0;

		ws.send(JSON.stringify({ type: 'id', clientId: client_id }));

		// Po wyjściu z biblioteki modal czeka na ponowne połączenie.
		// Przełącz go z ekranu ładowania dopiero, gdy socket jest już otwarty.
		const connectModal = document.getElementById('connectModal');
		const loadingScreen = document.getElementById('connectScreenLoading');
		if (connectModal?.classList.contains('modal-open') && !loadingScreen?.classList.contains('hidden')) {
			connectModalShowStart();
		}
	};

	ws.onmessage = (event) => {
		const data = JSON.parse(event.data);
		switch (data.type) {
			case 'new_id':
				localStorage.setItem('client_id', data.clientId);
				ws.send(JSON.stringify({ type: 'id', clientId: data.clientId }));
				break;
			case 'channels_list':
				generateChannelsList(data);
				updateWSStatus(2);
				break;
			case 'channels_updated':
				if (!isNewChannel) generateChannelsList(data);
				if (isNewChannel) {
					const channelEntry = Object.entries(data.channels).find(([id, channel]) => channel.name === channelName);
					if (channelEntry) {
						const [id, channel] = channelEntry;
						channelId = id;
						channelName = channel.name;
						channelUserCount = channel.userCount;
						updateWSStatus(4);
					} else {
						channelId = null;
						channelName = null;
						channelUserCount = null;
						updateWSStatus(2);
						displayWebsocketConnect();
						updateWebSocketPopupDisplay();
					}
				} else {
					if (channelId) {
						if (data?.channels?.[channelId]?.isUserInChannel === undefined) {
							updateWSStatus(2);
							displayWebsocketConnect();
							updateWebSocketPopupDisplay();
							channelId = null;
							channelName = null;
							showToast('error', i18n.t('common.error'), i18n.t('connection.owner_left'));
						} else {
							if (data.channels[channelId].isUserInChannel) {
								channelName = data.channels[channelId].name;
								channelUserCount = data.channels[channelId].userCount;
								updateWSStatus(4);
								updateWebSocketPopupDisplay();
							} else {
								channelId = null;
								channelName = null;
								updateWSStatus(2);
								displayWebsocketConnect();
								updateWebSocketPopupDisplay();
							}
						}
					}
				}
				break;
			case 'error':
				switch (data.reason) {
					case 'invalidChannelId':
						updateWSStatus(2);
						showToast('error', i18n.t('common.error'), i18n.t('connection.invalid_channel_id'));
						break;
					case 'unexistingChannelId':
						updateWSStatus(2);
						showToast('error', i18n.t('common.error'), i18n.t('connection.channel_id_not_found'));
						break;
					case 'cantJoinToOwnedChannel':
						updateWSStatus(4);
						showToast('error', i18n.t('common.error'), i18n.t('connection.cant_join_owned'));
						break;
					case 'channelNameExists':
						updateWSStatus(2);
						showToast('error', i18n.t('common.error'), i18n.t('connection.channel_exists'));
						break;
					case 'invalidChannelName':
						updateWSStatus(2);
						showToast('error', i18n.t('common.error'), i18n.t('connection.invalid_channel_name'));
						break;
					case 'emptyChannelName':
						updateWSStatus(2);
						showToast('error', i18n.t('common.error'), i18n.t('connection.empty_channel_name'));
						break;
					case 'notInChannel':
						showToast('error', i18n.t('common.error'), i18n.t('connection.not_in_channel'));
						break;
					case 'missingLyricsData_songId':
					case 'missingLyricsData_lyricId1':
					case 'missingLyricsData_lyricId2':
					case 'missingLyricsData_lyricIndex1':
					case 'missingLyricsData_lyricIndex2':
						console.warn("WS Error: Missing required data (" + data.reason + ")");
						showToast('error', i18n.t('common.error'), i18n.t('connection.missing_data'));
						break;
					case 'channelNotExists':
						console.warn("WS Error: Channel does not exist");
						updateWSStatus(2);
						showToast('error', i18n.t('common.error'), i18n.t('connection.channel_not_exists'));
						break;
					case 'notChannelOwner':
						showToast('error', i18n.t('common.error'), i18n.t('connection.no_permissions'));
						break;
					default:
						console.warn("Unknown WS error occurred");
						updateWSStatus(-1, i18n.t('common.error'));
						showToast('error', i18n.t('common.error'), i18n.t('connection.try_again'));
						break;
				}
				break;
			case 'success':
				updateWSStatus(4);
				closeAllModals(true);
				updateWebSocketPopupDisplay();
				if (isNewChannel == true) {
					const section = document.getElementById('channelUsersSection');
					if (section) section.classList.remove('hidden');
					if (savedPanelStateBeforeLibraryMode) {
						displaySongWithRestoredState();
						savedPanelStateBeforeLibraryMode = null;
					} else {
						displaySongWithChannel();
					}
					refreshPanelContent['songlist']();
				} else {
					displayOutput();
				}
				break;
			case 'ping':
				ws.send(JSON.stringify({ type: 'pong', clientTime: performance.now() }));
				break;
			case 'pong_return':
				socketPing = performance.now() - data.clientTime;
				refreshPanelContent['socket']();
				updateWebSocketPopupDisplay();
				break;
			case 'lyric':
				if (!allSongs) {
					console.error('Songs.json not loaded!');
					return;
				}
				const song = data.songData || allSongs.find(s => s.id === data.songId);
				if (!song) {
					console.error('Song not found:', data.songId);
					return;
				}
				const lyric = (data.lyricIndex !== undefined && song.lyrics[data.lyricIndex])
					? song.lyrics[data.lyricIndex]
					: song.lyrics.find(l => l.id === data.lyricId);
				if (!lyric) {
					console.error('Verse not found:', data.lyricId);
					return;
				}
				updateDisplay(lyric.text, lyric.repeat);
				break;
			case 'clear':
				clearDisplay();
				break;
			case 'channel_users':
				refreshPanelContent['socket'](data.users);
				break;
			case 'display_settings_update':
				if (data.settings?.display) {
					updateSettings(settings => {
						settings.display = { ...settings.display, ...data.settings.display };
					});
				}
				break;
			default:
				if (typeof handleExternalWsMessage === 'function') handleExternalWsMessage(data);
		}
	};

	ws.onerror = (error) => {
		console.error('WebSocket Error:', error);
		updateWSStatus(-1, i18n.t('connection.connection_error'));
		updateConnectModeAccess();
		// onclose odpali się zaraz po onerror i wykona reconnect
	};

	ws.onclose = () => {
		console.log('WebSocket disconnected');
		updateWSStatus(0);
		updateConnectModeAccess();

		if (libraryMode) return;
		socketFailCount++;
		const delay = Math.min(1000 * Math.pow(2, socketFailCount - 1), 30000);
		console.log(`Reconnect in ${delay}ms (attempt ${socketFailCount})`);
		if (wsReconnectTimeout) clearTimeout(wsReconnectTimeout);
		wsReconnectTimeout = setTimeout(() => {
			wsReconnectTimeout = null;
			connectWebSocket();
		}, delay);
	};
}

function refreshWebSocketAuthentication() {
	if (isStartupCheckingRest) return;
	if (wsReconnectTimeout) {
		clearTimeout(wsReconnectTimeout);
		wsReconnectTimeout = null;
	}
	if (ws) {
		// Do not let the retired socket schedule a second reconnect.
		ws.onclose = null;
		ws.close();
	}
	if (!libraryMode) connectWebSocket();
}

function channelExit() {
	if (!isWebSocketAvailable()) return;
	isNewChannel = false;
	channelId = null;
	channelName = null;
	ws.send(JSON.stringify({ type: 'channel_exit' }));
	displayWebsocketConnect();
}

function joinToChannel(id, name) {
	if (!isWebSocketAvailable()) return;
	if (id !== undefined) {
		console.log('Selected channel:', id);
		ws.send(JSON.stringify({ type: 'select_channel', 'selectedId': id }));
		updateWSStatus(3);
		channelId = id;
		channelName = name || null;
		isNewChannel = false;
	} else {
		console.warn("No channel selected");
	}
}

function createNewChannel() {
	if (!isLogged || !isWebSocketAvailable()) return;
	channelName = document.getElementById('newChannelName').value.trim();
	ws.send(JSON.stringify({ type: 'new_channel', 'channelName': channelName }));
	updateWSStatus(3);
	isNewChannel = true;
}

/* ==================== FUNKCJE POMOCNICZE ==================== */

function generateChannelsList(data) {
	_renderChannelsList(data);
}

function _renderChannelsList(data) {
	if (Object.keys(data.channels).length === 0) {
		setElementDisplay('#noChannels', true);
		setElementDisplay('#channelsList', false);
	} else {
		setElementDisplay('#channelsList', true);
		setElementDisplay('#noChannels', false);
		const channelsList = document.getElementById('channelsList');
		channelsList.innerHTML = '';

		Object.entries(data.channels).forEach(([id, channel]) => {
			const safeId = parseInt(id, 10);
			channelsList.insertAdjacentHTML('beforeend', `
				<div class="flex card flex-row justify-between items-center rounded-2xl p-4">
					<div class="flex flex-col justify-between">
						<div class="text-2xl text-white">${escapeHtml(channel.name)}</div>
						<div class="text-secondary text-sm">${i18n.t('connection.participant_count', { count: channel.userCount })}</div>
					</div>
					<div class="self-center">
						<button class="btn primary" type="submit" data-channel-id="${safeId}" data-channel-name="${escapeHtml(channel.name)}" onclick="joinToChannel(+this.dataset.channelId, this.dataset.channelName)">${i18n.t('connection.join')}</button>
					</div>
				</div>
			`);
		});
	}

	setElementDisplay('#loadingText', false);
}


function updateWSStatus(state, errorMessage) {
	if (libraryMode) return;
	const status = document.getElementById('wsPopupBtn');
	const wsStatus = document.getElementById('wsStatus');
	const wsStatusDesc = document.getElementById('wsStatusDesc');

	const stateMap = {
		'-1': { color: 'danger',  key: 'connection.status_error', desc: errorMessage },
		'0':  { color: 'danger',  key: 'connection.disconnected', desc: '' },
		'1':  { color: 'warning', key: 'connection.connecting', desc: '' },
		'2':  { color: 'success', key: 'connection.select_channel', desc: '' },
		'3':  { color: 'warning', key: 'connection.joining', desc: '' },
		'4':  { color: 'success', key: 'connection.connected', desc: '' },
	};

	const current = stateMap[state];
	if (!current) { console.warn('Unknown WS state:', state); return; }

	if (['0', '1', '2'].includes(String(state))) {
		channelName = null;
		channelId = null;
		hideChannelUsers();
	}

	status.className = `btn ${current.color}`;
	if (typeof updateChannelDisplaySettingsDescription === 'function') {
		updateChannelDisplaySettingsDescription();
	}
	wsStatus.textContent = i18n.t('connection.status_label', { status: i18n.t(current.key) });
	wsStatus.className = `font-medium text-${current.color}`;
	if (current.desc == '') {
		wsStatusDesc.className = `hidden`;
	} else {
		wsStatusDesc.innerHTML = current.desc;
		wsStatusDesc.className = `font-medium text-${current.color}`;
	}
}

function updateWebSocketPopupDisplay() {
	if (libraryMode) return;
	const popup = document.getElementById('wsPopup');
	if (!popup) return;

	if (channelName && channelId) {
		setElementDisplay('#wsActionSection', true);
	} else {
		setElementDisplay('#wsActionSection', false);
	}
}

function openWsPopup() {
	updateWebSocketPopupDisplay();
}

function closeWsPopup() {
	closeAllDropdowns();
}

function hideChannelUsers() {
	const section = document.getElementById('channelUsersSection');
	if (section) section.classList.add('hidden');
	const container = document.getElementById('channelUsersList');
	if (container) container.innerHTML = '';
	refreshPanelContent['socket']();
}

/* ==================== MODAL POŁĄCZENIA ==================== */

function openConnectModal() {
	connectModalShowLoading();
	const badge = document.getElementById('setup-version-badge');
	if (badge && window.appVersion) {
		badge.textContent = i18n.t('common.version_value', { version: window.appVersion });
	}
	openModal('connectModal');
}

function _connectModalAnimate(changeFn) {
	const body = document.getElementById('connectModalBody');
	const title = document.getElementById('connectModalTitle');
	const modal = document.getElementById('connectModal');
	const currentScreen = body && body.querySelector('.connect-screen:not(.hidden)');
	const modalVisible = modal && modal.classList.contains('modal-open');

	function applyChange() {
		// Zmierz wysokość przed zmianą
		const from = body ? body.offsetHeight : 0;
		const dialog = body && body.closest('.modal-dialog--setup');
		const watchFrom = dialog ? getComputedStyle(dialog).maxWidth : null;

		changeFn();

		const to = body ? body.offsetHeight : 0;
		const watchTo = dialog ? getComputedStyle(dialog).maxWidth : null;

		if (body && modalVisible && typeof animateModalResize === 'function') {
			animateModalResize(body, from, to, dialog || null, watchFrom, watchTo);
		}

		// Fade-in nowego ekranu
		const nextScreen = body && body.querySelector('.connect-screen:not(.hidden)');
		if (nextScreen && modalVisible) {
			nextScreen.classList.add('screen-fade-in');
			requestAnimationFrame(function () {
				requestAnimationFrame(function () { nextScreen.classList.remove('screen-fade-in'); });
			});
		}

		// Przywróć tytuł
		if (title && modalVisible) {
			requestAnimationFrame(function () {
				title.style.transition = 'opacity 0.15s ease';
				title.style.opacity = '';
				title.addEventListener('transitionend', function cleanup() {
					title.removeEventListener('transitionend', cleanup);
					title.style.transition = '';
				});
			});
		}
	}

	// Brak aktywnego ekranu lub modal niewidoczny — zmień bez animacji fade-out
	if (!currentScreen || !modalVisible) {
		changeFn();
		return;
	}

	// Fade-out tytułu i ekranu, potem zmiana
	if (title) { title.style.transition = 'opacity 0.15s ease'; title.style.opacity = '0'; }
	currentScreen.classList.add('screen-fade-out');
	var _done = false;
	function onOut(e) {
		if (e && e.propertyName !== 'opacity') return;
		if (_done) return;
		_done = true;
		currentScreen.removeEventListener('transitionend', onOut);
		applyChange();
		currentScreen.classList.remove('screen-fade-out');
	}
	currentScreen.addEventListener('transitionend', onOut);
	setTimeout(onOut, 200);
}

function connectModalShowLoading() {
	_connectModalAnimate(function () {
		document.getElementById('connectModalTitle').textContent = i18n.t('connection.welcome_title');
		setElementDisplay('#connectScreenLoading', true);
		setElementDisplay('#connectScreenMode', false);
		setElementDisplay('#connectScreenChannels', false);
		const errEl = document.getElementById('connectScreenError');
		if (errEl) errEl.classList.add('hidden');
	});
}

function connectModalShowMode() {
	_connectModalAnimate(function () {
		document.getElementById('connectModalTitle').textContent = i18n.t('connection.how_to_start');
		setElementDisplay('#connectScreenLoading', false);
		setElementDisplay('#connectScreenMode', true);
		setElementDisplay('#connectScreenChannels', false);
		setElementDisplay('#connectScreenCreateChannel', false);
		setElementDisplay('#createNewChannel', false);
		const errEl = document.getElementById('connectScreenError');
		if (errEl) errEl.classList.add('hidden');
		const hint = document.getElementById('connectLoginHint');
		if (hint) hint.classList.toggle('hidden', !!isLogged);
		updateConnectModeAccess();
	});
}

function updateConnectModeAccess() {
	const wsAvailable = isWebSocketAvailable();
	['connectJoinChannelBtn', 'connectCreateChannelBtn'].forEach(id => {
		const button = document.getElementById(id);
		if (!button) return;
		const disabled = !wsAvailable || (id === 'connectCreateChannelBtn' && !isLogged);
		button.disabled = disabled;
		button.setAttribute('aria-disabled', String(disabled));
		button.classList.toggle('opacity-45', disabled);
		button.classList.toggle('cursor-not-allowed', disabled);
	});

	const libraryButton = document.getElementById('libraryMode');
	if (libraryButton) {
		libraryButton.disabled = !isLogged;
		libraryButton.setAttribute('aria-disabled', String(!isLogged));
	}

	document.getElementById('connectWebSocketError').classList.toggle('hidden', wsAvailable);
}

function isWebSocketAvailable() {
	return ws?.readyState === WebSocket.OPEN;
}

function isMobileDevice() {
	return window.innerWidth <= 600;
}

function connectModalShowStart() {
	const wsAvailable = isWebSocketAvailable();
	if (isMobileDevice() && wsAvailable) {
		connectModalShowChannels();
	} else {
		connectModalShowMode();
	}
}

function connectModalCreateChannel() {
	if (!isLogged || !isWebSocketAvailable()) return;
	_connectModalAnimate(function () {
		document.getElementById('connectModalTitle').textContent = i18n.t('connection.create_channel_title');
		setElementDisplay('#connectScreenLoading', false);
		setElementDisplay('#connectScreenMode', false);
		setElementDisplay('#connectScreenCreateChannel', true);
		setElementDisplay('#createNewChannel', true);
		const errEl = document.getElementById('connectScreenError');
		if (errEl) errEl.classList.add('hidden');
		const backBtn = document.querySelector('#connectScreenChannels .setup-back-btn');
		if (backBtn) backBtn.classList.toggle('hidden!', isMobileDevice());
	});
}

function connectModalShowChannels() {
	_connectModalAnimate(function () {
		document.getElementById('connectModalTitle').textContent = i18n.t('connection.join_channel_title');
		setElementDisplay('#connectScreenLoading', false);
		setElementDisplay('#connectScreenMode', false);
		setElementDisplay('#connectScreenChannels', true);
		const errEl = document.getElementById('connectScreenError');
		if (errEl) errEl.classList.add('hidden');
		const backBtn = document.querySelector('#connectScreenChannels .setup-back-btn');
		if (backBtn) backBtn.classList.toggle('hidden!', isMobileDevice());
	});
}

function enterLibraryMode() {
	if (!isLogged) return;
	libraryMode = true;
	const socketToClose = ws;
	setTimeout(() => {
		if (!socketToClose) return;
		socketToClose.onclose = null;
		socketToClose.close();
		if (ws === socketToClose) ws = null;
	}, 250);
	const wsBtn = document.getElementById('wsPopupBtn');
	if (wsBtn) {
		setElementDisplay(wsBtn, false);
		wsBtn.className = 'btn secondary';
	}
	updateWSLibraryModeUI();
	closeAllModals(true);
	displaySongWithChannel();
}

function exitLibraryMode() {
	libraryMode = false;
	closeAllDropdowns();
	const leaveBtn = document.getElementById('wsLeaveChannelBtn');
	const exitLibraryBtn = document.getElementById('wsExitLibraryBtn');
	const infoSection = document.getElementById('infoSection');
	if (leaveBtn) leaveBtn.classList.remove('hidden');
	if (exitLibraryBtn) exitLibraryBtn.classList.add('hidden');
	if (infoSection) setElementDisplay(infoSection, false);
	connectWebSocket();
	// Zresetuj ekrany bez animacji przed otwarciem modala
	const body = document.getElementById('connectModalBody');
	if (body) { body.style.transition = ''; body.style.height = ''; }
	setElementDisplay('#connectScreenLoading', true);
	setElementDisplay('#connectScreenMode', false);
	setElementDisplay('#connectScreenChannels', false);
	const errEl = document.getElementById('connectScreenError');
	if (errEl) errEl.classList.add('hidden');
	const titleEl = document.getElementById('connectModalTitle');
	if (titleEl) { titleEl.style.transition = ''; titleEl.style.opacity = ''; titleEl.textContent = i18n.t('connection.welcome_title'); }
	openModal('connectModal');
}

function updateWSLibraryModeUI() {
	const wsStatus = document.getElementById('wsStatus');
	const wsStatusDesc = document.getElementById('wsStatusDesc');
	const wsActionSection = document.getElementById('wsActionSection');
	const leaveBtn = document.getElementById('wsLeaveChannelBtn');
	const exitLibraryBtn = document.getElementById('wsExitLibraryBtn');

	if (wsStatus) wsStatus.textContent = i18n.t('connection.library_mode');
	if (wsStatusDesc) wsStatusDesc.textContent = '';
	if (wsActionSection) setElementDisplay(wsActionSection, true);
	if (leaveBtn)  setElementDisplay(leaveBtn, false);
	if (exitLibraryBtn)  setElementDisplay(exitLibraryBtn, true);
}

/* ==================== STARTUP ==================== */

let isStartupCheckingRest = true;

function shouldOpenMainInterfaceOnStartup() {
	return settings.startupBehavior === 'mainInterface' && !isMobileDevice() && isLogged;
}

function applyStartupBehavior() {
	if (shouldOpenMainInterfaceOnStartup()) {
		enterLibraryMode();
		return;
	}

	connectModalShowMode();
	connectWebSocket();
}

// Wait for i18n to be ready, then initialize websocket and startup sequence
window.addEventListener('i18nReady', async () => {
	openConnectModal();
	const restOk = await loadJson();
	if (!restOk) {
		showRestApiUnavailable();
		return;
	}

	await checkAuth({ skipConnectModal: true });
	isStartupCheckingRest = false;
	applyStartupBehavior();

	// Uruchom równolegle: songs + auth
});

function showRestApiUnavailable() {
	// Czekaj aż obie wartości (REST i WS) będą znane (non-null)
	_connectModalAnimate(function () {
			document.getElementById('connectModalTitle').textContent = i18n.t('connection.connection_error');
			setElementDisplay('#connectScreenLoading', false);
			setElementDisplay('#connectScreenMode', false);
			setElementDisplay('#connectScreenChannels', false);
			setElementDisplay('#connectScreenError', true);
	});
}
