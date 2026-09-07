/* ==================== UWIERZYTELNIANIE ==================== */

let currentUser = null;
let currentUserId = null;
let currentIsAdmin = false;
let currentCanAddSongs = false;
let isLogged = false;

function promptForInitialAdminSetup() {
	fetch(`${restApiAddress}/api/auth/bootstrap`, { credentials: 'include' })
		.then(response => response.ok ? response.json() : null)
		.then(data => {
			if (!data?.needsInitialAdmin) return;
			setElementDisplay(document.getElementById('bootstrapRestoreSection'), data.canRestoreBackup === true);
			const info = document.getElementById('registerInfo');
			if (info) {
				info.className = 'info';
				info.textContent = i18n.t('auth.initial_admin_prompt');
			}
			openModal('registerModal');
		})
		.catch(error => console.error('Bootstrap status check failed:', error));
}

async function checkAuth({ skipConnectModal = false } = {}) {
	try {
		const response = await fetch(`${restApiAddress}/api/auth/me`, {
			credentials: 'include',
			method: 'GET',
		});

		if (!response.ok) {
			throw new Error('Token invalid');
		}

		const data = await response.json();
		currentUser = data.username;
		currentUserId = data.userId;
		currentIsAdmin = data.isAdmin === true;
		currentCanAddSongs = data.canAddSongs === true || data.isAdmin === true;
		console.log('Token valid, user:', currentUser);
		function logPermissions(canAddSongs, isAdmin) {
			console.log('User permissions:', {
				canAddSongs,
				isAdmin
			});
		}
		logPermissions(currentCanAddSongs, currentIsAdmin)
		updateLoginStuff(true, skipConnectModal);
		return true;
	} catch (error) {
		console.error('Auth check failed:', error);
		currentUser = null;
		currentUserId = null;
		currentIsAdmin = false;
		currentCanAddSongs = false;
		updateLoginStuff(false, skipConnectModal);
		return false;
	}
}

function register() {
	const username = document.getElementById('registerName').value;
	const password = document.getElementById('registerPassword1').value;
	const repeatPassword = document.getElementById('registerPassword2').value;

	if (password !== repeatPassword) {
		document.getElementById('registerInfo').className = 'error';
		document.getElementById('registerInfo').textContent = i18n.t('auth.passwords_mismatch');
		return;
	}

	setButtonLoading(document.getElementById('registerBtn'), true);
	fetch(`${restApiAddress}/api/auth/register`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ username, password })
	})
	.then(response => {
		if (!response.ok) throw new Error(i18n.t('auth.registration_error'));
		return response.json();
	})
	.then(() => {
		showToast('success', i18n.t('auth.registration_success'));
		closeAllModals();
		login(username, password);
	})
	.catch(error => {
		document.getElementById('registerInfo').className = 'error';
		document.getElementById('registerInfo').textContent = i18n.t('auth.registration_error');
	})
	.finally(() => {
		setTimeout(() => {
			setButtonLoading(document.getElementById('registerBtn'), false);
		}, 250);
	});
}

function login(reg_username, reg_password) {
	const username = reg_username || document.getElementById('loginName').value;
	const password = reg_password || document.getElementById('loginPassword').value;

	setButtonLoading(document.getElementById('loginBtn'), true);

	fetch(`${restApiAddress}/api/auth/login`, {
		method: 'POST',
		credentials: 'include',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ username, password })
	})
	.then(response => {
		if (!response.ok) throw new Error(i18n.t('auth.login_error'));
		return response.json();
	})
	.then(data => {
		currentUser = data.username;
		currentUserId = data.userId;
		currentIsAdmin = data.isAdmin === true;
		currentCanAddSongs = data.canAddSongs === true || data.isAdmin === true;
		showToast('success', i18n.t('auth.login_success'));
		closeAllModals();
		updateLoginStuff(true);
		// Ponownie pobierz utwory po logowaniu (uwzględnią prywatne utwory)
		loadJson();
	})
	.catch(error => {
		document.getElementById('loginInfo').className = 'error';
		document.getElementById('loginInfo').textContent = i18n.t('auth.login_error');
	})
	.finally(() => {
		setTimeout(() => {
			setButtonLoading(document.getElementById('loginBtn'), false);
		}, 250);
	});
}

function logout() {
	setButtonLoading(document.getElementById('logoutBtn'), true);
	fetch(`${restApiAddress}/api/auth/logout`, {
		method: 'POST',
		credentials: 'include',
		headers: { 'Content-Type': 'application/json' }
	})
	.then(response => response.json())
	.then(() => {
		currentUser = null;
		currentUserId = null;
		currentIsAdmin = false;
		currentCanAddSongs = false;
		showToast('success', i18n.t('auth.logout_success'));
		updateLoginStuff(false);
		allSongs = [];
		songFiles = {};
		const showConnectionModal = () => {
			if (typeof exitLibraryMode === 'function' && libraryMode) {
				exitLibraryMode();
			} else if (typeof displayWebsocketConnect === 'function') {
				displayWebsocketConnect();
			}
		};
		const settingsModal = document.getElementById('settingsModal');
		if (settingsModal?.classList.contains('modal-open')) {
			closeAllModals(true);
			setTimeout(showConnectionModal, 260);
		} else {
			showConnectionModal();
		}
	})
	.catch(() => {
		showToast('error', i18n.t('auth.logout_error'));
	})
	.finally(() => {
		setTimeout(() => {
			setButtonLoading(document.getElementById('logoutBtn'), false);
		}, 250);
	});
}

function updateLoginStuff(isLoggedIn, _skipConnectModal = false) {
	if (isLoggedIn && typeof currentSong !== 'undefined' && currentSong) {
		renderSong();
	}
	if (isLoggedIn) {
		isLogged = true;
		setElementDisplay('#logoutBtn', true);

		document.getElementById('accountStatus').textContent = i18n.t('settings.account.logged_in');
		setElementDisplay(document.getElementById('accountUsernameItem'), true);
		document.getElementById('accountUsername').innerHTML = escapeHtml(currentUser);

		setElementDisplay('#connectModalLoggedInSkeleton', false);
		setElementDisplay('#connectModalLoggedIn', true);
		document.getElementById('connectModalSubtitle').classList.remove('hidden');
		if (typeof _connectSubtitleCallback === 'function') setConnectSubtitle(_connectSubtitleCallback);
		document.getElementById('connectModalUsername').innerHTML = escapeHtml(currentUser);

		const connectModal = document.getElementById('connectModal');
		if (!_skipConnectModal && connectModal && connectModal.classList.contains('modal-open')) {
			connectModalShowStart();
		}

		// Pokaż zakładkę administratora
		if (typeof setAdminTabVisible === 'function') setAdminTabVisible(currentIsAdmin);
	} else {
		isLogged = false;
		setElementDisplay('#logoutBtn', false);

		document.getElementById('accountStatus').textContent = i18n.t('settings.account.logged_out');
		setElementDisplay(document.getElementById('accountUsernameItem'), false);

		setElementDisplay('#connectModalLoggedIn', false);
		setElementDisplay('#connectModalLoggedInSkeleton', false);
		document.getElementById('connectModalSubtitle').classList.add('hidden');

		const connectModal = document.getElementById('connectModal');
		const loadingScreen = document.getElementById('connectScreenLoading');
		if (!_skipConnectModal && connectModal && connectModal.classList.contains('modal-open') &&
			loadingScreen && !loadingScreen.classList.contains('hidden')) {
			connectModalShowStart();
		}

		// Ukryj zakładkę administratora i przełącz aktywną jeśli trzeba
		if (typeof setAdminTabVisible === 'function') setAdminTabVisible(false);
	}

	if (typeof updateConnectModeAccess === 'function') updateConnectModeAccess();
	if (typeof refreshWebSocketAuthentication === 'function') refreshWebSocketAuthentication();
}
